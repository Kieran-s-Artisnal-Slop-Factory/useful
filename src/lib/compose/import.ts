/**
 * Reading an existing `compose.yaml` back into the model (0.3.0 phase 13, Q9).
 *
 * Best-effort, and **loud about the effort**. The builder covers a large
 * subset of the Compose specification and nothing like all of it, so the one
 * unacceptable behaviour is to drop what it does not understand and hand back
 * something that looks complete. Every key that could not be represented is
 * reported with its path, and the page shows the list before anything is
 * replaced.
 *
 * The report is the product here. The parsing is the easy half.
 */
import { parse } from 'yaml';
import {
  emptyProject,
  newConfig,
  newMount,
  newNetwork,
  newPort,
  newSecret,
  newService,
  newVolume,
  type ComposeMount,
  type ComposeProjectModel,
  type ComposeService,
  type DependsCondition,
} from './model';

export interface ImportNote {
  /** Dotted path into the document, e.g. `services.web.build`. */
  path: string;
  message: string;
}

export interface ImportResult {
  project: ComposeProjectModel;
  /** Keys the builder cannot represent. Listed, never dropped silently. */
  unsupported: ImportNote[];
  /** Things that were read but changed shape on the way in. */
  notes: ImportNote[];
}

export class ComposeImportError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';

/**
 * A command may be a string or an argv list; the editor holds one line.
 *
 * An argument containing whitespace is re-quoted on the way in, because
 * `emit.ts` splits the line back into an argv list — and without the quotes
 * `["sh", "-c", "a && b"]` comes back as five arguments and the container
 * runs something else entirely. The round trip is asserted over every
 * template in catalogue.test.ts, which is how this was found.
 */
const quoteArg = (text: string): string => {
  if (!/[\s"']/.test(text)) return text;
  return text.includes('"') ? `'${text}'` : `"${text}"`;
};

const asCommandLine = (value: unknown): string =>
  Array.isArray(value) ? value.map((v) => quoteArg(asString(v))).join(' ') : asString(value);

/** Service keys the builder has a control for. Everything else is reported. */
const KNOWN_SERVICE_KEYS = new Set([
  'image',
  'container_name',
  'hostname',
  'user',
  'working_dir',
  'entrypoint',
  'command',
  'restart',
  'depends_on',
  'environment',
  'env_file',
  'ports',
  'networks',
  'network_mode',
  'dns',
  'extra_hosts',
  'volumes',
  'tmpfs',
  'secrets',
  'configs',
  'healthcheck',
  'deploy',
  'shm_size',
  'privileged',
  'tty',
  'stdin_open',
  'post_start',
  'pre_stop',
]);

const KNOWN_TOP_KEYS = new Set(['name', 'version', 'services', 'networks', 'volumes', 'configs', 'secrets']);

/** `8080:80`, `127.0.0.1:8080:80/udp`, `80` — the short syntax, all of it. */
export function parseShortPort(text: string): ReturnType<typeof newPort> {
  const port = newPort();
  let body = text.trim();
  const protocol = /\/(tcp|udp)$/i.exec(body);
  if (protocol) {
    port.protocol = protocol[1]!.toLowerCase() as 'tcp' | 'udp';
    body = body.slice(0, protocol.index);
  }
  const parts = body.split(':');
  if (parts.length === 3) {
    port.hostIp = parts[0]!;
    port.published = parts[1]!;
    port.target = parts[2]!;
  } else if (parts.length === 2) {
    port.published = parts[0]!;
    port.target = parts[1]!;
  } else {
    port.target = parts[0] ?? '';
  }
  return port;
}

/** `./src:/app:ro` — the short mount syntax. */
export function parseShortMount(text: string): ComposeMount {
  const parts = text.trim().split(':');
  if (parts.length === 1) return { ...newMount('volume'), target: parts[0]! };
  const source = parts[0]!;
  const target = parts[1]!;
  const readOnly = parts[2] === 'ro';
  const isPath = source.startsWith('.') || source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source);
  return { ...newMount(isPath ? 'bind' : 'volume'), source, target, readOnly };
}

function importService(name: string, raw: unknown, result: ImportResult): ComposeService {
  const service = newService(name);
  const where = `services.${name}`;
  if (!isRecord(raw)) {
    result.unsupported.push({ path: where, message: 'Not a mapping — the service was read as empty.' });
    return service;
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_SERVICE_KEYS.has(key)) {
      result.unsupported.push({
        path: `${where}.${key}`,
        message: `\`${key}\` has no control in this builder, so it is not in the model and will be missing if you export from here.`,
      });
    }
  }

  service.image = asString(raw.image);
  service.containerName = asString(raw.container_name);
  service.hostname = asString(raw.hostname);
  service.user = asString(raw.user);
  service.workingDir = asString(raw.working_dir);
  service.entrypoint = asCommandLine(raw.entrypoint);
  service.command = asCommandLine(raw.command);
  service.hostname = asString(raw.hostname);
  service.tty = raw.tty === true;
  service.stdinOpen = raw.stdin_open === true;
  service.privileged = raw.privileged === true;
  service.shmSize = asString(raw.shm_size);
  service.networkMode = asString(raw.network_mode);

  const restart = asString(raw.restart);
  if (['no', 'always', 'on-failure', 'unless-stopped'].includes(restart)) {
    service.restart = restart as ComposeService['restart'];
  } else if (restart !== '') {
    // `on-failure:5` is valid Compose and the dropdown has no room for the
    // count — so it is read as `on-failure` and the loss is reported.
    service.restart = restart.startsWith('on-failure') ? 'on-failure' : '';
    result.notes.push({ path: `${where}.restart`, message: `Read "${restart}" as "${service.restart || 'unset'}".` });
  }

  // environment: mapping or `KEY=value` list.
  if (isRecord(raw.environment)) {
    service.environment = Object.entries(raw.environment).map(([key, value]) => ({ key, value: asString(value) }));
  } else if (Array.isArray(raw.environment)) {
    service.environment = raw.environment.map((entry) => {
      const text = asString(entry);
      const at = text.indexOf('=');
      return at < 0 ? { key: text, value: '' } : { key: text.slice(0, at), value: text.slice(at + 1) };
    });
  }

  const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((v) => asString(v)).filter(Boolean) : asString(value) ? [asString(value)] : [];

  service.envFiles = stringList(raw.env_file);
  service.dns = stringList(raw.dns);
  service.extraHosts = stringList(raw.extra_hosts);
  service.tmpfs = stringList(raw.tmpfs);

  service.secrets = Array.isArray(raw.secrets)
    ? raw.secrets.map((s) => (isRecord(s) ? asString(s.source) : asString(s))).filter(Boolean)
    : [];
  service.configs = Array.isArray(raw.configs)
    ? raw.configs.map((c) => (isRecord(c) ? asString(c.source) : asString(c))).filter(Boolean)
    : [];

  if (Array.isArray(raw.ports)) {
    service.ports = raw.ports.map((entry) => {
      if (isRecord(entry)) {
        return {
          ...newPort(),
          hostIp: asString(entry.host_ip),
          published: asString(entry.published),
          target: asString(entry.target),
          protocol: asString(entry.protocol) === 'udp' ? 'udp' : 'tcp',
          mode: asString(entry.mode) === 'host' ? 'host' : asString(entry.mode) === 'ingress' ? 'ingress' : '',
        };
      }
      return parseShortPort(asString(entry));
    });
  }

  if (Array.isArray(raw.volumes)) {
    service.volumes = raw.volumes.map((entry) => {
      if (isRecord(entry)) {
        const type = asString(entry.type);
        const mount = newMount(type === 'bind' || type === 'tmpfs' ? type : 'volume');
        mount.source = asString(entry.source);
        mount.target = asString(entry.target);
        mount.readOnly = entry.read_only === true;
        if (isRecord(entry.tmpfs)) mount.size = asString(entry.tmpfs.size);
        return mount;
      }
      return parseShortMount(asString(entry));
    });
  }

  // networks: a list, or a mapping carrying per-network addresses.
  if (Array.isArray(raw.networks)) {
    service.networks = raw.networks.map((n) => asString(n)).filter(Boolean);
  } else if (isRecord(raw.networks)) {
    service.networks = Object.keys(raw.networks);
    for (const [network, body] of Object.entries(raw.networks)) {
      if (!isRecord(body)) continue;
      if (asString(body.ipv4_address)) service.ipv4 = asString(body.ipv4_address);
      if (asString(body.ipv6_address)) service.ipv6 = asString(body.ipv6_address);
      for (const key of Object.keys(body)) {
        if (key !== 'ipv4_address' && key !== 'ipv6_address') {
          result.unsupported.push({
            path: `${where}.networks.${network}.${key}`,
            message: `Per-network \`${key}\` has no control here.`,
          });
        }
      }
    }
  }

  // depends_on: a list (short) or a mapping with conditions (long).
  if (Array.isArray(raw.depends_on)) {
    service.dependsOn = raw.depends_on.map((d) => ({
      service: asString(d),
      condition: 'service_started' as DependsCondition,
      required: true,
      restart: false,
    }));
  } else if (isRecord(raw.depends_on)) {
    service.dependsOn = Object.entries(raw.depends_on).map(([target, body]) => {
      const rec = isRecord(body) ? body : {};
      const condition = asString(rec.condition);
      return {
        service: target,
        condition: (['service_started', 'service_healthy', 'service_completed_successfully'].includes(condition)
          ? condition
          : 'service_started') as DependsCondition,
        required: rec.required !== false,
        restart: rec.restart === true,
      };
    });
  }

  if (isRecord(raw.healthcheck)) {
    const hc = raw.healthcheck;
    service.healthcheck = {
      enabled: true,
      disable: hc.disable === true,
      // `test` is ['CMD-SHELL', 'line'], ['CMD', 'a', 'b'], or a bare string.
      test: Array.isArray(hc.test)
        ? hc.test[0] === 'CMD-SHELL'
          ? asString(hc.test[1])
          : hc.test.slice(1).map(asString).join(' ')
        : asString(hc.test),
      interval: asString(hc.interval),
      timeout: asString(hc.timeout),
      retries: asString(hc.retries),
      startPeriod: asString(hc.start_period),
      startInterval: asString(hc.start_interval),
    };
    if (Array.isArray(hc.test) && hc.test[0] === 'CMD') {
      result.notes.push({
        path: `${where}.healthcheck.test`,
        message: 'Read a `CMD` argv list as a shell line; it is re-emitted as `CMD-SHELL`.',
      });
    }
  }

  if (isRecord(raw.deploy)) {
    const resources = isRecord(raw.deploy.resources) ? raw.deploy.resources : {};
    const limits = isRecord(resources.limits) ? resources.limits : {};
    const reservations = isRecord(resources.reservations) ? resources.reservations : {};
    service.cpuLimit = asString(limits.cpus);
    service.memLimit = asString(limits.memory);
    service.pidsLimit = asString(limits.pids);
    service.cpuReservation = asString(reservations.cpus);
    service.memReservation = asString(reservations.memory);
    if (Array.isArray(reservations.devices)) {
      const gpu = reservations.devices.find((d) => isRecord(d) && Array.isArray(d.capabilities));
      if (isRecord(gpu)) service.gpus = asString(gpu.count) || 'all';
    }
    for (const key of Object.keys(raw.deploy)) {
      if (key !== 'resources') {
        result.unsupported.push({
          path: `${where}.deploy.${key}`,
          message: `\`deploy.${key}\` is a Swarm setting with no control here.`,
        });
      }
    }
  }

  const hook = (value: unknown): string => {
    if (!Array.isArray(value) || value.length === 0) return '';
    const first = value[0];
    return isRecord(first) ? asCommandLine(first.command) : asCommandLine(first);
  };
  service.postStart = hook(raw.post_start);
  service.preStop = hook(raw.pre_stop);

  return service;
}

/**
 * Read a compose document.
 *
 * Throws only when the text is not YAML or not a mapping — everything else is
 * a note, because a half-understood file the user can see the gaps in beats a
 * refusal.
 */
export function importCompose(text: string): ImportResult {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    throw new ComposeImportError(`That is not valid YAML: ${err instanceof Error ? err.message : 'unreadable'}`);
  }
  if (!isRecord(doc)) throw new ComposeImportError('A compose file is a mapping of top-level keys; this is not.');

  const result: ImportResult = { project: emptyProject(), unsupported: [], notes: [] };

  for (const key of Object.keys(doc)) {
    if (!KNOWN_TOP_KEYS.has(key)) {
      result.unsupported.push({ path: key, message: `Top-level \`${key}\` has no control in this builder.` });
    }
  }
  if ('version' in doc) {
    result.notes.push({
      path: 'version',
      message: '`version` has been obsolete since Compose v2 — it is read and dropped, which is what Docker does too.',
    });
  }

  result.project.name = asString(doc.name) || 'imported';

  if (isRecord(doc.services)) {
    result.project.services = Object.entries(doc.services).map(([name, raw]) => importService(name, raw, result));
  } else {
    result.unsupported.push({ path: 'services', message: 'No services in this file.' });
  }

  if (isRecord(doc.networks)) {
    result.project.networks = Object.entries(doc.networks).map(([name, raw]) => {
      const network = newNetwork(name);
      if (!isRecord(raw)) return network;
      const driver = asString(raw.driver);
      if (['bridge', 'host', 'none', 'ipvlan', 'macvlan', 'overlay'].includes(driver)) {
        network.driver = driver as typeof network.driver;
      }
      network.external = raw.external === true;
      if (isRecord(raw.driver_opts)) {
        network.parent = asString(raw.driver_opts.parent);
        network.ipvlanMode = asString(raw.driver_opts.ipvlan_mode);
      }
      if (isRecord(raw.ipam) && Array.isArray(raw.ipam.config) && isRecord(raw.ipam.config[0])) {
        network.subnet = asString(raw.ipam.config[0].subnet);
        network.gateway = asString(raw.ipam.config[0].gateway);
      }
      return network;
    });
  }

  if (isRecord(doc.volumes)) {
    result.project.volumes = Object.entries(doc.volumes).map(([name, raw]) => {
      const volume = newVolume(name);
      if (isRecord(raw)) {
        volume.external = raw.external === true;
        volume.driver = asString(raw.driver);
      }
      return volume;
    });
  }

  if (isRecord(doc.secrets)) {
    result.project.secrets = Object.entries(doc.secrets).map(([name, raw]) => {
      const secret = newSecret(name);
      if (isRecord(raw)) {
        secret.external = raw.external === true;
        secret.file = asString(raw.file);
        secret.environment = asString(raw.environment);
      }
      return secret;
    });
  }

  if (isRecord(doc.configs)) {
    result.project.configs = Object.entries(doc.configs).map(([name, raw]) => {
      const config = newConfig(name);
      if (isRecord(raw)) {
        config.external = raw.external === true;
        config.file = asString(raw.file);
        config.content = asString(raw.content);
      }
      return config;
    });
  }

  return result;
}
