/**
 * The compose model, the emitter and the validators.
 *
 * The emit cases parse the YAML back with the `yaml` package and compare
 * STRUCTURALLY rather than matching text: a golden string test fails on
 * indentation nobody cares about and passes on a key emitted at the wrong
 * nesting level, which is exactly backwards.
 *
 * Key ORDER is asserted separately and on purpose — it is the property that
 * makes a re-emit a no-op diff, and it is invisible to a structural compare.
 */
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { emitCompose, emitMount, emitPort, splitCommand, toDocument } from './emit';
import {
  cloneProject,
  emptyProject,
  newConfig,
  newMount,
  newNetwork,
  newPort,
  newSecret,
  newService,
  newVolume,
  normalizeProject,
  starterProject,
  uniqueName,
  type ComposeProjectModel,
} from './model';
import { errorCount, findDependencyCycle, publishedPorts, validateProject } from './validate';

/** Emit and parse back, which is what every structural assertion works on. */
const round = (project: ComposeProjectModel): Record<string, any> => parse(emitCompose(project));

function projectWith(build: (p: ComposeProjectModel) => void): ComposeProjectModel {
  const project = emptyProject('test');
  build(project);
  return project;
}

const service = (name: string, image = 'nginx:1.27') => {
  const s = newService(name);
  s.image = image;
  return s;
};

describe('the model', () => {
  it('opens with something that already works', () => {
    const project = starterProject();
    expect(project.services).toHaveLength(1);
    expect(validateProject(project).filter((f) => f.level === 'error')).toEqual([]);
  });

  it('re-shapes anything at all into a project', () => {
    // The generic data suite writes an ARRAY into every json column, and a
    // backup can be hand-edited — so this is a real input, not a hypothetical.
    for (const junk of [null, undefined, 42, 'text', [], [1, 2], { services: 'no' }, { services: [null, 7] }]) {
      const project = normalizeProject(junk);
      expect(Array.isArray(project.services)).toBe(true);
      expect(typeof project.name).toBe('string');
      expect(project.name).not.toBe('');
      expect(() => emitCompose(project)).not.toThrow();
    }
    expect(normalizeProject({ services: [null, 7] }).services).toHaveLength(2);
  });

  it('keeps every field a value, so an editor never binds to undefined', () => {
    const s = normalizeProject({ services: [{ name: 'x' }] }).services[0]!;
    for (const [key, value] of Object.entries(s)) {
      expect(value, key).not.toBeUndefined();
      expect(value, key).not.toBeNull();
    }
  });

  it('names a service uniquely rather than silently replacing one', () => {
    expect(uniqueName('db', [])).toBe('db');
    expect(uniqueName('db', ['db'])).toBe('db-2');
    expect(uniqueName('db', ['db', 'db-2'])).toBe('db-3');
    expect(uniqueName('  ', [])).toBe('service');
  });

  it('clones deeply, with fresh handles', () => {
    const original = starterProject();
    const copy = cloneProject(original);
    copy.services[0]!.image = 'changed';
    copy.services[0]!.ports[0]!.published = '9999';
    expect(original.services[0]!.image).not.toBe('changed');
    expect(original.services[0]!.ports[0]!.published).not.toBe('9999');
    expect(copy.services[0]!.id).not.toBe(original.services[0]!.id);
  });
});

describe('emit — what gets written', () => {
  it('writes only what was set', () => {
    const doc = round(projectWith((p) => p.services.push(service('web'))));
    expect(doc.services.web).toEqual({ image: 'nginx:1.27' });
    // An empty command is not `command: ""` — that would mean "run nothing".
    expect(doc.services.web.command).toBeUndefined();
    expect(doc.networks).toBeUndefined();
    expect(doc.volumes).toBeUndefined();
  });

  it('emits a single service with a healthcheck and resources', () => {
    const doc = round(
      projectWith((p) => {
        const db = service('db', 'postgres:16-alpine');
        db.restart = 'unless-stopped';
        db.environment = [{ key: 'POSTGRES_PASSWORD', value: '${DB_PASSWORD:-secret}' }];
        db.healthcheck = {
          enabled: true,
          disable: false,
          test: 'pg_isready -U postgres',
          interval: '10s',
          timeout: '5s',
          retries: '5',
          startPeriod: '30s',
          startInterval: '',
        };
        db.cpuLimit = '0.5';
        db.memLimit = '512M';
        db.memReservation = '256M';
        p.services.push(db);
      })
    );
    expect(doc.services.db.healthcheck).toEqual({
      test: ['CMD-SHELL', 'pg_isready -U postgres'],
      interval: '10s',
      timeout: '5s',
      retries: 5,
      start_period: '30s',
    });
    expect(doc.services.db.deploy).toEqual({
      resources: { limits: { cpus: '0.5', memory: '512M' }, reservations: { memory: '256M' } },
    });
    expect(doc.services.db.environment).toEqual({ POSTGRES_PASSWORD: '${DB_PASSWORD:-secret}' });
  });

  it('emits a multi-network project with addresses', () => {
    const doc = round(
      projectWith((p) => {
        const api = service('api', 'node:22-alpine');
        api.networks = ['frontend', 'backend'];
        const db = service('db', 'postgres:16');
        db.networks = ['backend'];
        db.ipv4 = '172.20.0.5';
        p.services.push(api, db);
        p.networks.push(newNetwork('frontend'), { ...newNetwork('backend'), subnet: '172.20.0.0/16' });
      })
    );
    expect(doc.services.api.networks).toEqual(['frontend', 'backend']);
    expect(doc.services.db.networks).toEqual({ backend: { ipv4_address: '172.20.0.5' } });
    expect(doc.networks.backend).toEqual({ ipam: { config: [{ subnet: '172.20.0.0/16' }] } });
    // A bridge network with nothing else set is `frontend:` and no body —
    // which is what the spec's own examples look like.
    expect(doc.networks.frontend).toBeNull();
  });

  it('emits secrets and configs, and drops references to ones that do not exist', () => {
    const doc = round(
      projectWith((p) => {
        const app = service('app', 'app:1');
        app.secrets = ['db_password', 'ghost'];
        app.configs = ['nginx_conf'];
        p.services.push(app);
        p.secrets.push({ ...newSecret('db_password'), file: './secrets/db.txt' });
        p.configs.push({ ...newConfig('nginx_conf'), content: 'server { listen 80; }' });
      })
    );
    expect(doc.services.app.secrets).toEqual(['db_password']);
    expect(doc.secrets).toEqual({ db_password: { file: './secrets/db.txt' } });
    expect(doc.configs.nginx_conf).toEqual({ content: 'server { listen 80; }' });
  });

  it('writes depends_on as the long form, with its conditions', () => {
    const doc = round(
      projectWith((p) => {
        const web = service('web');
        web.dependsOn = [
          { service: 'db', condition: 'service_healthy', required: true, restart: true },
          { service: 'cache', condition: 'service_started', required: false, restart: false },
        ];
        p.services.push(web, service('db', 'postgres:16'), service('cache', 'valkey:8'));
      })
    );
    expect(doc.services.web.depends_on).toEqual({
      db: { condition: 'service_healthy', restart: true },
      cache: { condition: 'service_started', required: false },
    });
  });

  it('splits a command into words, keeping quoted runs together', () => {
    expect(splitCommand('npm run dev')).toEqual(['npm', 'run', 'dev']);
    expect(splitCommand('sh -c "echo hello world"')).toEqual(['sh', '-c', 'echo hello world']);
    expect(splitCommand("sh -c 'a b'")).toEqual(['sh', '-c', 'a b']);
    expect(splitCommand('')).toEqual([]);
  });

  it('uses the short port syntax when it can and the long one when it must', () => {
    expect(emitPort({ ...newPort(), published: '8080', target: '80' })).toBe('8080:80');
    expect(emitPort({ ...newPort(), target: '80' })).toBe('80');
    expect(emitPort({ ...newPort(), published: '8000-8010', target: '8000-8010' })).toBe('8000-8010:8000-8010');
    expect(emitPort({ ...newPort(), published: '53', target: '53', protocol: 'udp' })).toEqual({
      target: '53',
      published: '53',
      protocol: 'udp',
    });
    expect(emitPort({ ...newPort(), hostIp: '127.0.0.1', published: '8080', target: '80' })).toEqual({
      host_ip: '127.0.0.1',
      target: '80',
      published: '8080',
      protocol: 'tcp',
    });
    expect(emitPort(newPort())).toBeNull();
  });

  it('uses the long mount syntax, except for an anonymous volume', () => {
    expect(emitMount({ ...newMount('volume'), target: '/data' })).toBe('/data');
    expect(emitMount({ ...newMount('volume'), source: 'db', target: '/var/lib/db' })).toEqual({
      type: 'volume',
      source: 'db',
      target: '/var/lib/db',
    });
    expect(emitMount({ ...newMount('bind'), source: './src', target: '/app', readOnly: true })).toEqual({
      type: 'bind',
      source: './src',
      target: '/app',
      read_only: true,
    });
    expect(emitMount({ ...newMount('tmpfs'), target: '/tmp', size: '64m' })).toEqual({
      type: 'tmpfs',
      target: '/tmp',
      tmpfs: { size: '64m' },
    });
    expect(emitMount(newMount())).toBeNull();
  });

  it('lets network_mode win over networks, because both is a refusal', () => {
    const doc = round(
      projectWith((p) => {
        const s = service('web');
        s.networkMode = 'host';
        s.networks = ['backend'];
        p.services.push(s);
        p.networks.push(newNetwork('backend'));
      })
    );
    expect(doc.services.web.network_mode).toBe('host');
    expect(doc.services.web.networks).toBeUndefined();
  });

  it('emits a GPU reservation in the shape the runtime expects', () => {
    const doc = round(
      projectWith((p) => {
        const s = service('trainer', 'cuda:12');
        s.gpus = 'all';
        p.services.push(s);
      })
    );
    expect(doc.services.trainer.deploy.resources.reservations.devices).toEqual([
      { driver: 'nvidia', count: 'all', capabilities: ['gpu'] },
    ]);
  });

  it('produces YAML that parses, for a project using everything', () => {
    const project = projectWith((p) => {
      const web = service('web');
      web.ports = [{ ...newPort(), published: '8080', target: '80' }];
      web.volumes = [{ ...newMount('bind'), source: './site', target: '/usr/share/nginx/html', readOnly: true }];
      web.dependsOn = [{ service: 'db', condition: 'service_healthy', required: true, restart: false }];
      web.networks = ['backend'];
      web.tty = true;
      web.stdinOpen = true;
      web.postStart = 'chown -R app /data';
      const db = service('db', 'postgres:16-alpine');
      db.healthcheck = { ...db.healthcheck, enabled: true, test: 'pg_isready', retries: '3' };
      db.networks = ['backend'];
      db.volumes = [{ ...newMount('volume'), source: 'pgdata', target: '/var/lib/postgresql/data' }];
      p.services.push(web, db);
      p.networks.push(newNetwork('backend'));
      p.volumes.push(newVolume('pgdata'));
    });
    const text = emitCompose(project);
    expect(() => parse(text)).not.toThrow();
    expect(parse(text).services.web.post_start).toEqual([{ command: 'chown -R app /data' }]);
    expect(text).toContain('name: test');
  });
});

describe('emit — key order', () => {
  it('writes document keys in spec order, not insertion order', () => {
    const project = projectWith((p) => {
      p.secrets.push({ ...newSecret('s'), file: './s' });
      p.volumes.push(newVolume('v'));
      p.networks.push(newNetwork('n'));
      const s = service('web');
      s.volumes = [{ ...newMount('volume'), source: 'v', target: '/v' }];
      s.networks = ['n'];
      s.secrets = ['s'];
      p.services.push(s);
    });
    expect(Object.keys(toDocument(project))).toEqual(['name', 'services', 'networks', 'volumes', 'secrets']);
  });

  it('writes service keys in spec order whatever order they were set in', () => {
    const project = projectWith((p) => {
      const s = service('web');
      s.tty = true;
      s.restart = 'always';
      s.command = 'nginx -g daemon off;';
      s.containerName = 'web1';
      s.ports = [{ ...newPort(), published: '80', target: '80' }];
      p.services.push(s);
    });
    const keys = Object.keys((toDocument(project).services as Record<string, object>).web!);
    expect(keys).toEqual(['image', 'container_name', 'command', 'restart', 'ports', 'tty']);
  });

  it('re-emits an unchanged project byte-identically', () => {
    // The property the ordering exists for: a project kept in version control
    // must not produce a diff because the editor was reopened.
    const project = starterProject();
    expect(emitCompose(project)).toBe(emitCompose(cloneProject(project)));
  });
});

describe('validate', () => {
  const messages = (project: ComposeProjectModel) => validateProject(project).map((f) => f.message).join(' | ');

  it('catches a dependency cycle and says which services', () => {
    const project = projectWith((p) => {
      const a = service('a');
      const b = service('b');
      a.dependsOn = [{ service: 'b', condition: 'service_started', required: true, restart: false }];
      b.dependsOn = [{ service: 'a', condition: 'service_started', required: true, restart: false }];
      p.services.push(a, b);
    });
    expect(findDependencyCycle(project)).toEqual(['a', 'b', 'a']);
    expect(messages(project)).toContain('a → b → a');
    expect(errorCount(validateProject(project))).toBeGreaterThan(0);
  });

  it('catches a service that depends on itself', () => {
    const project = projectWith((p) => {
      const a = service('a');
      a.dependsOn = [{ service: 'a', condition: 'service_started', required: true, restart: false }];
      p.services.push(a);
    });
    expect(findDependencyCycle(project)).toEqual(['a', 'a']);
  });

  it('catches a duplicate host port, including inside a range', () => {
    const project = projectWith((p) => {
      const a = service('a');
      const b = service('b');
      a.ports = [{ ...newPort(), published: '8000-8010', target: '80' }];
      b.ports = [{ ...newPort(), published: '8005', target: '80' }];
      p.services.push(a, b);
    });
    expect(messages(project)).toContain('Host port 8005/tcp is published by both');

    // Different protocols on one number do not collide.
    const fine = projectWith((p) => {
      const a = service('a');
      const b = service('b');
      a.ports = [{ ...newPort(), published: '53', target: '53', protocol: 'tcp' }];
      b.ports = [{ ...newPort(), published: '53', target: '53', protocol: 'udp' }];
      p.services.push(a, b);
    });
    expect(messages(fine)).not.toContain('published by both');
  });

  it('expands port ranges when counting', () => {
    const s = service('a');
    s.ports = [{ ...newPort(), published: '8000-8002', target: '80' }];
    expect(publishedPorts(s)).toEqual([
      { port: 8000, protocol: 'tcp' },
      { port: 8001, protocol: 'tcp' },
      { port: 8002, protocol: 'tcp' },
    ]);
  });

  it('catches a volume, network, secret or config that is used but never declared', () => {
    const project = projectWith((p) => {
      const s = service('web');
      s.volumes = [{ ...newMount('volume'), source: 'ghostvol', target: '/data' }];
      s.networks = ['ghostnet'];
      s.secrets = ['ghostsecret'];
      s.configs = ['ghostconfig'];
      p.services.push(s);
    });
    const text = messages(project);
    expect(text).toContain('Volume "ghostvol" is mounted but never declared');
    expect(text).toContain('Network "ghostnet" is used but never declared');
    expect(text).toContain('Secret "ghostsecret" is used but never declared');
    expect(text).toContain('Config "ghostconfig" is used but never declared');
  });

  it('warns that host networking makes published ports do nothing', () => {
    const project = projectWith((p) => {
      const s = service('web');
      s.networkMode = 'host';
      s.ports = [{ ...newPort(), published: '8080', target: '80' }];
      p.services.push(s);
    });
    const finding = validateProject(project).find((f) => f.field === 'ports')!;
    expect(finding.level).toBe('warning');
    expect(finding.message).toContain('do nothing at all');
    expect(finding.service).toBe('web');
  });

  it('refuses ipvlan and macvlan with no parent, and warns about them regardless', () => {
    const project = projectWith((p) => {
      p.services.push(service('web'));
      p.networks.push({ ...newNetwork('lan'), driver: 'macvlan' });
    });
    const text = messages(project);
    expect(text).toContain('names no parent interface');
    expect(text).toContain("does not work inside Docker Desktop's VM");
  });

  it('catches two services with the same name, which Compose does not report', () => {
    const project = projectWith((p) => p.services.push(service('web'), service('web')));
    expect(messages(project)).toContain('the second would replace the first');
  });

  it('catches waiting on a healthcheck that does not exist', () => {
    const project = projectWith((p) => {
      const web = service('web');
      web.dependsOn = [{ service: 'db', condition: 'service_healthy', required: true, restart: false }];
      p.services.push(web, service('db', 'postgres:16'));
    });
    expect(messages(project)).toContain('Compose will wait forever');
  });

  it('reads a bare bind source as the named volume Compose would read it as', () => {
    const project = projectWith((p) => {
      const s = service('web');
      s.volumes = [{ ...newMount('bind'), source: 'src', target: '/app' }];
      p.services.push(s);
    });
    expect(messages(project)).toContain('reads a bare word as a NAMED VOLUME');
  });

  it('warns about an untagged image, tmpfs, privileged and inline config content', () => {
    const project = projectWith((p) => {
      const s = service('web', 'nginx');
      s.privileged = true;
      s.volumes = [{ ...newMount('tmpfs'), target: '/tmp' }];
      s.configs = ['inline'];
      p.services.push(s);
      p.configs.push({ ...newConfig('inline'), content: 'a: 1' });
    });
    const text = messages(project);
    expect(text).toContain('means `:latest`');
    expect(text).toContain('tmpfs mounts are Linux-only');
    expect(text).toContain('privileged container');
    expect(text).toContain("in this app's backup");
  });

  it('says nothing about a project that is fine', () => {
    const project = projectWith((p) => {
      const web = service('web');
      web.ports = [{ ...newPort(), published: '8080', target: '80' }];
      web.networks = ['backend'];
      web.volumes = [{ ...newMount('volume'), source: 'data', target: '/data' }];
      p.services.push(web);
      p.networks.push(newNetwork('backend'));
      p.volumes.push(newVolume('data'));
    });
    expect(validateProject(project)).toEqual([]);
  });
});
