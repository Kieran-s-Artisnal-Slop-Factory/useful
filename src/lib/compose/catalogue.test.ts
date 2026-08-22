/**
 * The template catalogue, the snippet catalogue, injection, the archive and
 * the importer.
 *
 * The catalogue tests are table-driven over EVERY entry rather than over a
 * chosen few: a template is content, content is where typos live, and a
 * broken template that ships is a compose file someone pastes into a terminal
 * and watches fail.
 */
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { archiveEntries, archiveName, readmeFor } from './archive';
import { emitCompose } from './emit';
import { ComposeImportError, importCompose, parseShortMount, parseShortPort } from './import';
import { normalizeProject, starterProject } from './model';
import { injectSnippet, SNIPPETS, snippetById, STACKS, stackById } from './templates';
import { validateProject } from './validate';
import { zipBytes, zipEntries } from '../zip';

const errors = (project: Parameters<typeof validateProject>[0]) =>
  validateProject(project).filter((f) => f.level === 'error');

describe('the stack catalogue', () => {
  it('has the nine stacks the release asked for, with unique ids', () => {
    expect(STACKS.length).toBeGreaterThanOrEqual(9);
    expect(new Set(STACKS.map((s) => s.id)).size).toBe(STACKS.length);
    for (const id of ['wordpress', 'flask', 'fastapi', 'node', 'mern', 'go', 'django', 'astro', 'nextjs']) {
      expect(stackById(id), id).toBeDefined();
    }
  });

  it.each(STACKS.map((s) => [s.id, s] as const))('%s builds a project that validates', (id, template) => {
    const project = template.build();
    expect(project.services.length, id).toBeGreaterThan(0);
    // The point of the table: a template that ships must not carry an error
    // the builder would flag the moment it loaded.
    expect(errors(project), id).toEqual([]);
  });

  it.each(STACKS.map((s) => [s.id, s] as const))('%s emits YAML that parses back', (id, template) => {
    const text = emitCompose(template.build());
    const doc = parse(text);
    expect(doc.services, id).toBeTruthy();
    expect(Object.keys(doc.services as object).length, id).toBeGreaterThan(0);
    // Round trip: what we emit, we can read.
    const back = importCompose(text);
    expect(back.project.services.map((s) => s.name), id).toEqual(Object.keys(doc.services as object));
  });

  it.each(STACKS.map((s) => [s.id, s] as const))('%s pins every image it uses', (id, template) => {
    const project = template.build();
    expect(template.pins.length, id).toBeGreaterThan(0);
    for (const service of project.services) {
      // Every image carries a tag, and every tag is declared on the card —
      // a card that under-reports what it pins is worse than no card.
      expect(service.image, `${id}/${service.name}`).toMatch(/:/);
      expect(template.pins, `${id}/${service.name}`).toContain(service.image);
    }
  });

  it.each(STACKS.map((s) => [s.id, s] as const))('%s survives a store round trip', (id, template) => {
    // Templates go into the library, and the library is JSON in IndexedDB.
    const stored = JSON.parse(JSON.stringify(template.build()));
    expect(emitCompose(normalizeProject(stored)), id).toBe(emitCompose(template.build()));
  });

  it('ships sources where the framework has no scaffolder, and steps where it has', () => {
    // Q10, as decided: vendored scaffolding is stale within a release.
    for (const id of ['flask', 'fastapi', 'node', 'mern', 'go']) {
      expect(stackById(id)!.files?.length, id).toBeGreaterThan(0);
    }
    for (const id of ['astro', 'nextjs', 'django']) {
      expect(stackById(id)!.steps?.length, id).toBeGreaterThan(0);
    }
  });
});

describe('the snippet catalogue', () => {
  it('has the ten snippets the release asked for, with unique ids', () => {
    expect(SNIPPETS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(SNIPPETS.map((s) => s.id)).size).toBe(SNIPPETS.length);
    for (const id of ['redis', 'postgres', 'valkey', 'flask', 'fastapi', 'nextjs', 'go-stdlib', 'go-fiber', 'sveltekit', 'tanstack']) {
      expect(snippetById(id), id).toBeDefined();
    }
  });

  it.each(SNIPPETS.map((s) => [s.id, s] as const))('%s injects into a project and leaves it valid', (id, snippet) => {
    const { project } = injectSnippet(starterProject(), snippet);
    expect(errors(project), id).toEqual([]);
    expect(parse(emitCompose(project)).services, id).toBeTruthy();
  });

  it.each(SNIPPETS.map((s) => [s.id, s] as const))('%s pins a tagged image', (id, snippet) => {
    const service = snippet.build();
    expect(service.image, id).toMatch(/:/);
    expect(snippet.pins, id).toContain(service.image);
  });
});

describe('injection', () => {
  it('renames rather than replacing a service that is already there', () => {
    const first = injectSnippet(starterProject(), snippetById('postgres')!);
    expect(first.added.service).toBe('db');
    const second = injectSnippet(first.project, snippetById('postgres')!);
    // Compose keys services by name: a collision would silently replace the
    // first one, and nothing would say so.
    expect(second.added.service).toBe('db-2');
    expect(second.project.services.map((s) => s.name)).toEqual(['web', 'db', 'db-2']);
  });

  it('declares the volumes the snippet mounts, once', () => {
    const first = injectSnippet(starterProject(), snippetById('redis')!);
    expect(first.added.volumes).toEqual(['redis_data']);
    expect(first.project.volumes.map((v) => v.name)).toEqual(['redis_data']);

    const second = injectSnippet(first.project, snippetById('redis')!);
    // Already declared: not added twice, and the receipt says so.
    expect(second.added.volumes).toEqual([]);
    expect(second.project.volumes.map((v) => v.name)).toEqual(['redis_data']);
  });

  it('moves a host port that is already published, and says it did', () => {
    // The starter project publishes 8080; the Go snippet wants it too. Two
    // containers cannot bind one host port, and "address already in use" is
    // a confusing thing to get from clicking "add Go".
    const { project, added } = injectSnippet(starterProject(), snippetById('go-stdlib')!);
    expect(added.ports).toEqual([{ from: '8080', to: '8081' }]);
    expect(project.services[1]!.ports[0]!.published).toBe('8081');
    // Only the host side moves — the container port is the image's contract.
    expect(project.services[1]!.ports[0]!.target).toBe('8080');
    expect(errors(project)).toEqual([]);
  });

  it('leaves a port RANGE alone rather than silently bumping one end', () => {
    // No shipped snippet publishes a range, so the rule is exercised
    // directly — otherwise this asserts nothing and passes forever.
    const ranged = {
      ...snippetById('go-stdlib')!,
      build: () => {
        const service = snippetById('go-stdlib')!.build();
        service.ports = [{ ...service.ports[0]!, published: '8080-8090', target: '8080' }];
        return service;
      },
    };
    const { project, added } = injectSnippet(starterProject(), ranged);
    expect(added.ports).toEqual([]);
    expect(project.services[1]!.ports[0]!.published).toBe('8080-8090');
    // It still collides, and the validator is what says so — a warning the
    // user can act on beats a silent rewrite of what they asked for.
    expect(errors(project).some((f) => f.message.includes('Host port 8080/tcp'))).toBe(true);
  });

  it('adds to the project rather than replacing it', () => {
    const before = starterProject();
    const { project } = injectSnippet(before, snippetById('postgres')!);
    expect(project.services[0]).toEqual(before.services[0]);
    expect(project.services).toHaveLength(2);
  });
});

describe('the archive', () => {
  it.each(STACKS.map((s) => [s.id, s] as const))('%s zips a compose file, a README and its sources', (id, template) => {
    const project = template.build();
    const entries = archiveEntries(template, project);
    const names = entries.map((e) => e.name);
    expect(names[0], id).toBe('compose.yaml');
    expect(names, id).toContain('README.md');
    for (const file of template.files ?? []) expect(names, id).toContain(file.name);

    // It is a real archive that reads back, not a list of strings.
    const archive = zipEntries(zipBytes(entries));
    expect(archive.map((e) => e.name), id).toEqual(names);
    expect(archiveName(template), id).toMatch(/\.zip$/);
  });

  it('writes a README that states the pins and warns that tags move', () => {
    const template = stackById('wordpress')!;
    const readme = readmeFor(template, template.build());
    for (const pin of template.pins) expect(readme).toContain(pin);
    expect(readme).toContain('**Tags move.**');
    expect(readme).toContain('http://localhost:8080');
    // Interpolated variables are called out, because they are what stops the
    // stack starting on someone else's machine.
    expect(readme).toContain('DB_PASSWORD');
  });

  it('puts the scaffolding steps in the README of the templates that need them', () => {
    const astro = stackById('astro')!;
    expect(readmeFor(astro, astro.build())).toContain('npm create astro@latest');
  });
});

describe('importing an existing compose file', () => {
  const FIXTURE = [
    'version: "3.8"',
    'name: legacy',
    'services:',
    '  web:',
    '    image: nginx:1.27',
    '    ports:',
    '      - "127.0.0.1:8080:80/tcp"',
    '      - "9000:9000"',
    '    volumes:',
    '      - ./site:/usr/share/nginx/html:ro',
    '      - assets:/assets',
    '    environment:',
    '      - LOG_LEVEL=debug',
    '      - QUIET',
    '    depends_on:',
    '      - api',
    '    build: ./web',
    '    labels:',
    '      app: web',
    '  api:',
    '    image: node:22-alpine',
    '    command: ["node", "server.js"]',
    '    environment:',
    '      PORT: 4000',
    '    healthcheck:',
    '      test: ["CMD", "curl", "-f", "http://localhost:4000"]',
    '      interval: 10s',
    '    deploy:',
    '      replicas: 3',
    '      resources:',
    '        limits:',
    '          cpus: "0.5"',
    '          memory: 512M',
    'volumes:',
    '  assets:',
    'x-shared: &shared',
    '  restart: always',
  ].join('\n');

  it('reads the parts it understands', () => {
    const { project } = importCompose(FIXTURE);
    expect(project.name).toBe('legacy');
    expect(project.services.map((s) => s.name)).toEqual(['web', 'api']);

    const web = project.services[0]!;
    expect(web.image).toBe('nginx:1.27');
    expect(web.ports[0]).toMatchObject({ hostIp: '127.0.0.1', published: '8080', target: '80', protocol: 'tcp' });
    expect(web.ports[1]).toMatchObject({ published: '9000', target: '9000' });
    expect(web.volumes[0]).toMatchObject({ type: 'bind', source: './site', target: '/usr/share/nginx/html', readOnly: true });
    expect(web.volumes[1]).toMatchObject({ type: 'volume', source: 'assets', target: '/assets' });
    expect(web.environment).toEqual([
      { key: 'LOG_LEVEL', value: 'debug' },
      { key: 'QUIET', value: '' },
    ]);
    expect(web.dependsOn).toEqual([{ service: 'api', condition: 'service_started', required: true, restart: false }]);

    const api = project.services[1]!;
    expect(api.command).toBe('node server.js');
    expect(api.environment).toEqual([{ key: 'PORT', value: '4000' }]);
    expect(api.healthcheck.enabled).toBe(true);
    expect(api.healthcheck.test).toBe('curl -f http://localhost:4000');
    expect(api.cpuLimit).toBe('0.5');
    expect(api.memLimit).toBe('512M');
    expect(project.volumes.map((v) => v.name)).toEqual(['assets']);
  });

  it('LISTS what it cannot represent instead of dropping it', () => {
    const { unsupported } = importCompose(FIXTURE);
    const paths = unsupported.map((u) => u.path);
    expect(paths).toContain('services.web.build');
    expect(paths).toContain('services.web.labels');
    expect(paths).toContain('services.api.deploy.replicas');
    expect(paths).toContain('x-shared');
    for (const note of unsupported) expect(note.message.length).toBeGreaterThan(10);
  });

  it('notes the things it changed on the way in', () => {
    const { notes } = importCompose(FIXTURE);
    const paths = notes.map((n) => n.path);
    expect(paths).toContain('version');
    expect(paths).toContain('services.api.healthcheck.test');
    expect(notes.find((n) => n.path === 'version')!.message).toContain('obsolete');
  });

  it('round-trips a file this builder wrote, with nothing unsupported', () => {
    for (const template of STACKS) {
      const text = emitCompose(template.build());
      const result = importCompose(text);
      expect(result.unsupported, template.id).toEqual([]);
      // And re-emitting what came back gives the same document.
      expect(emitCompose(result.project), template.id).toBe(text);
    }
  });

  it('refuses what is not a compose file, with a reason', () => {
    expect(() => importCompose('key: [unclosed')).toThrow(ComposeImportError);
    expect(() => importCompose('- a\n- b')).toThrow(/mapping of top-level keys/);
    expect(() => importCompose('just a string')).toThrow(/mapping of top-level keys/);
  });

  it('reads the short syntaxes the way Compose does', () => {
    expect(parseShortPort('80')).toMatchObject({ target: '80', published: '' });
    expect(parseShortPort('8080:80')).toMatchObject({ published: '8080', target: '80' });
    expect(parseShortPort('127.0.0.1:8080:80')).toMatchObject({ hostIp: '127.0.0.1', published: '8080', target: '80' });
    expect(parseShortPort('53:53/udp')).toMatchObject({ published: '53', target: '53', protocol: 'udp' });

    // A bare word is a NAMED VOLUME to Compose, and a path is a bind — the
    // distinction the builder warns about elsewhere.
    expect(parseShortMount('data:/var/lib')).toMatchObject({ type: 'volume', source: 'data' });
    expect(parseShortMount('./src:/app')).toMatchObject({ type: 'bind', source: './src' });
    expect(parseShortMount('/etc/hosts:/etc/hosts:ro')).toMatchObject({ type: 'bind', readOnly: true });
    expect(parseShortMount('/data')).toMatchObject({ type: 'volume', source: '', target: '/data' });
  });
});
