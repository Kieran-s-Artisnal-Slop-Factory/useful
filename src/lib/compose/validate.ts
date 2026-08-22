/**
 * The checks that stop a compose file that will not do what it looks like it
 * does (0.3.0 phase 12).
 *
 * Two kinds, and the difference is the point:
 *
 *  - **error** — the file is wrong. Compose will refuse it, or it will start
 *    and behave in a way nobody wanted (two services fighting over one host
 *    port; a volume that is never declared).
 *  - **warning** — the file is valid and the behaviour surprises people.
 *    `network_mode: host` with published ports is the classic: Compose
 *    accepts it, and the ports do nothing at all.
 *
 * Every finding carries the service (and where possible the field) it is
 * about, so the page can put it next to the control that caused it rather
 * than in a list at the bottom that nobody reads.
 */
import type { ComposeProjectModel, ComposeService } from './model';

export type FindingLevel = 'error' | 'warning';

export interface Finding {
  level: FindingLevel;
  /** The service this is about, or '' for a project-level finding. */
  service: string;
  /** A field hint the UI can match on: 'ports', 'networks', 'volumes'… */
  field: string;
  message: string;
}

const has = (value: string): boolean => value.trim() !== '';

/** Every host port a service publishes, expanded from ranges. */
export function publishedPorts(service: ComposeService): { port: number; protocol: string }[] {
  const out: { port: number; protocol: string }[] = [];
  for (const port of service.ports) {
    const published = port.published.trim();
    if (published === '') continue;
    const range = /^(\d+)-(\d+)$/.exec(published);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      // A range is expanded rather than compared as text, because 8000-8010
      // and 8005 collide and no string comparison notices.
      if (to - from > 10_000) continue;
      for (let p = from; p <= to; p++) out.push({ port: p, protocol: port.protocol });
    } else if (/^\d+$/.test(published)) {
      out.push({ port: Number(published), protocol: port.protocol });
    }
  }
  return out;
}

/**
 * Services that cannot start because they wait on each other.
 *
 * Returns the cycle as a readable path (`a → b → a`), because "there is a
 * cycle" is not something anyone can act on.
 */
export function findDependencyCycle(project: ComposeProjectModel): string[] | null {
  const edges = new Map<string, string[]>();
  for (const service of project.services) {
    edges.set(
      service.name,
      service.dependsOn.map((d) => d.service).filter((name) => name !== service.name || true)
    );
  }

  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];

  const walk = (name: string): string[] | null => {
    if (state.get(name) === 'done') return null;
    if (state.get(name) === 'open') return [...path.slice(path.indexOf(name)), name];
    state.set(name, 'open');
    path.push(name);
    for (const next of edges.get(name) ?? []) {
      if (!edges.has(next)) continue;
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(name, 'done');
    return null;
  };

  for (const service of project.services) {
    const cycle = walk(service.name);
    if (cycle) return cycle;
  }
  return null;
}

export function validateProject(project: ComposeProjectModel): Finding[] {
  const findings: Finding[] = [];
  const add = (level: FindingLevel, service: string, field: string, message: string) =>
    findings.push({ level, service, field, message });

  const names = project.services.map((s) => s.name.trim());
  const declaredNetworks = new Set(project.networks.map((n) => n.name.trim()));
  const declaredVolumes = new Set(project.volumes.map((v) => v.name.trim()));
  const declaredSecrets = new Set(project.secrets.map((s) => s.name.trim()));
  const declaredConfigs = new Set(project.configs.map((c) => c.name.trim()));

  if (project.services.length === 0) {
    add('error', '', 'services', 'A compose file needs at least one service.');
  }

  for (const [index, name] of names.entries()) {
    if (name === '') {
      add('error', '', 'name', `Service ${index + 1} has no name.`);
    } else if (names.indexOf(name) !== index) {
      // Compose does not report this: the second service silently replaces
      // the first, because services are a mapping keyed by name.
      add('error', name, 'name', `Two services are called "${name}" — the second would replace the first.`);
    }
  }

  // ---- per service ---------------------------------------------------------
  for (const service of project.services) {
    const where = service.name;

    if (!has(service.image)) {
      add('error', where, 'image', 'No image. A service needs an image to run (this builder does not do `build:`).');
    } else if (/^[^:@]+$/.test(service.image.trim())) {
      add(
        'warning',
        where,
        'image',
        `"${service.image.trim()}" has no tag, so it means \`:latest\` — which is a different image tomorrow.`
      );
    }

    // The one everybody hits: host networking publishes nothing.
    if (service.networkMode.trim() === 'host' && service.ports.length > 0) {
      add(
        'warning',
        where,
        'ports',
        'With `network_mode: host` the container already uses the host network, so published ports do nothing at all. Remove them, or drop host networking.'
      );
    }
    if (has(service.networkMode) && service.networks.length > 0) {
      add(
        'error',
        where,
        'networks',
        '`network_mode` and `networks` cannot both be set — Compose refuses the file. The mode wins here and the networks are not emitted.'
      );
    }

    for (const network of service.networks) {
      if (!declaredNetworks.has(network)) {
        add('error', where, 'networks', `Network "${network}" is used but never declared in the project.`);
      }
    }

    for (const mount of service.volumes) {
      if (mount.type === 'volume' && has(mount.source) && !declaredVolumes.has(mount.source.trim())) {
        add('error', where, 'volumes', `Volume "${mount.source.trim()}" is mounted but never declared.`);
      }
      if (mount.type === 'bind' && !mount.source.trim().startsWith('.') && !mount.source.trim().startsWith('/')) {
        add(
          'warning',
          where,
          'volumes',
          `Bind mount "${mount.source.trim()}" is not a path — Compose reads a bare word as a NAMED VOLUME, not a folder. Start it with ./ or /.`
        );
      }
      if (mount.type === 'tmpfs') {
        add('warning', where, 'volumes', 'tmpfs mounts are Linux-only — they are ignored on Docker Desktop for Mac and Windows.');
      }
      if (!has(mount.target)) {
        add('error', where, 'volumes', 'A mount with no container path is dropped from the file.');
      }
    }

    for (const secret of service.secrets) {
      if (!declaredSecrets.has(secret)) {
        add('error', where, 'secrets', `Secret "${secret}" is used but never declared.`);
      }
    }
    for (const config of service.configs) {
      if (!declaredConfigs.has(config)) {
        add('error', where, 'configs', `Config "${config}" is used but never declared.`);
      }
    }

    for (const dep of service.dependsOn) {
      if (!names.includes(dep.service)) {
        add('error', where, 'depends_on', `Depends on "${dep.service}", which is not a service in this project.`);
      }
      if (dep.condition === 'service_healthy') {
        const target = project.services.find((s) => s.name === dep.service);
        if (target && !target.healthcheck.enabled) {
          add(
            'error',
            where,
            'depends_on',
            `Waits for "${dep.service}" to be healthy, but that service has no healthcheck — Compose will wait forever.`
          );
        }
      }
    }

    if (service.privileged) {
      add(
        'warning',
        where,
        'privileged',
        'A privileged container can do essentially anything the host can. It is almost never what a normal service needs.'
      );
    }
  }

  // ---- across services -----------------------------------------------------
  const seen = new Map<string, string>();
  for (const service of project.services) {
    if (service.networkMode.trim() === 'host') continue;
    for (const { port, protocol } of publishedPorts(service)) {
      const key = `${port}/${protocol}`;
      const owner = seen.get(key);
      if (owner && owner !== service.name) {
        add(
          'error',
          service.name,
          'ports',
          `Host port ${key} is published by both "${owner}" and "${service.name}" — the second container will fail to start.`
        );
      } else {
        seen.set(key, service.name);
      }
    }
  }

  const cycle = findDependencyCycle(project);
  if (cycle) {
    add('error', cycle[0] ?? '', 'depends_on', `These services wait on each other and none can start: ${cycle.join(' → ')}.`);
  }

  // ---- networks ------------------------------------------------------------
  for (const network of project.networks) {
    if ((network.driver === 'ipvlan' || network.driver === 'macvlan') && !has(network.parent)) {
      add(
        'error',
        '',
        'networks',
        `Network "${network.name}" uses ${network.driver} but names no parent interface. Both drivers attach to a real host interface (\`eth0\`, \`en0\`) and cannot work without one.`
      );
    }
    if (network.driver === 'ipvlan' || network.driver === 'macvlan') {
      add(
        'warning',
        '',
        'networks',
        `"${network.name}" (${network.driver}) puts containers directly on your LAN. It needs a Linux host with that interface present — it does not work inside Docker Desktop's VM — and most Wi-Fi access points drop the extra MAC addresses macvlan needs.`
      );
    }
    if (network.driver === 'overlay') {
      add('warning', '', 'networks', `"${network.name}" is an overlay network, which needs Swarm mode — plain \`docker compose up\` cannot create one.`);
    }
  }

  // ---- declared but unused -------------------------------------------------
  const usedNetworks = new Set(project.services.flatMap((s) => s.networks));
  for (const network of project.networks) {
    if (!usedNetworks.has(network.name)) {
      add('warning', '', 'networks', `Network "${network.name}" is declared but no service joins it.`);
    }
  }
  const usedVolumes = new Set(
    project.services.flatMap((s) => s.volumes.filter((v) => v.type === 'volume').map((v) => v.source.trim()))
  );
  for (const volume of project.volumes) {
    if (!usedVolumes.has(volume.name)) {
      add('warning', '', 'volumes', `Volume "${volume.name}" is declared but nothing mounts it.`);
    }
  }

  // ---- secrets, said once --------------------------------------------------
  const inlineConfigs = project.configs.filter((c) => c.content.trim() !== '');
  if (inlineConfigs.length > 0) {
    add(
      'warning',
      '',
      'configs',
      `${inlineConfigs.length} config${inlineConfigs.length === 1 ? ' has' : 's have'} inline content, which ends up in the compose file itself — and in this app's backup. Use \`file:\` for anything that should not be.`
    );
  }

  return findings;
}

/** Findings for one service, for the badge beside its editor. */
export const findingsFor = (findings: Finding[], service: string): Finding[] =>
  findings.filter((f) => f.service === service);

export const errorCount = (findings: Finding[]): number =>
  findings.filter((f) => f.level === 'error').length;
