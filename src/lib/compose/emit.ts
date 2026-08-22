/**
 * The model as a `compose.yaml` (0.3.0 phase 12).
 *
 * Two rules, and the second is the one that matters for anyone reading a
 * diff:
 *
 *  1. **Only what was set is written.** An empty field is absent, not `""` —
 *     Compose treats an empty `command` as "run nothing", which is not what a
 *     blank text box means.
 *  2. **Keys come out in Compose-spec order, not insertion order.** The
 *     editor's field order changes whenever the UI is rearranged; a document
 *     whose key order tracks that produces a diff on every unrelated edit. The
 *     ordering below is fixed, so re-emitting an unchanged project is a no-op
 *     diff — which is what makes this safe to keep in version control.
 */
import { stringify } from 'yaml';
import type {
  ComposeConfig,
  ComposeMount,
  ComposeNetwork,
  ComposePort,
  ComposeProjectModel,
  ComposeSecret,
  ComposeService,
  ComposeVolume,
} from './model';

type Doc = Record<string, unknown>;

const has = (value: string): boolean => value.trim() !== '';

/** Split a shell-ish string into a list, keeping quoted runs together. */
export function splitCommand(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) out.push(match[1] ?? match[2] ?? match[3] ?? '');
  return out;
}

/** Assign only the keys with something in them, in the order given. */
function put(target: Doc, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' && value.trim() === '') return;
  if (Array.isArray(value) && value.length === 0) return;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Doc).length === 0) return;
  target[key] = value;
}

/** A port as the long syntax when it needs it, the short string when it does not. */
export function emitPort(port: ComposePort): string | Doc | null {
  if (!has(port.target)) return null;
  const simple = !has(port.hostIp) && !has(port.mode) && port.protocol === 'tcp';
  if (simple) {
    const body = has(port.published) ? `${port.published.trim()}:${port.target.trim()}` : port.target.trim();
    return body;
  }
  const out: Doc = {};
  put(out, 'host_ip', port.hostIp.trim());
  put(out, 'target', port.target.trim());
  put(out, 'published', port.published.trim());
  put(out, 'protocol', port.protocol);
  put(out, 'mode', port.mode);
  return out;
}

/** A mount as the long syntax, which is the one that cannot be misread. */
export function emitMount(mount: ComposeMount): string | Doc | null {
  if (!has(mount.target)) return null;
  if (mount.type === 'volume' && !has(mount.source)) {
    // An anonymous volume is a bare container path and nothing else.
    return mount.target.trim();
  }
  const out: Doc = { type: mount.type };
  put(out, 'source', mount.source.trim());
  out.target = mount.target.trim();
  if (mount.readOnly) out.read_only = true;
  if (mount.type === 'tmpfs' && has(mount.size)) out.tmpfs = { size: mount.size.trim() };
  return out;
}

function emitHealthcheck(service: ComposeService): Doc | null {
  const hc = service.healthcheck;
  if (!hc.enabled) return null;
  if (hc.disable) return { disable: true };
  const out: Doc = {};
  // CMD-SHELL is the form that takes a shell line; CMD takes an argv list.
  if (has(hc.test)) out.test = ['CMD-SHELL', hc.test.trim()];
  put(out, 'interval', hc.interval.trim());
  put(out, 'timeout', hc.timeout.trim());
  if (has(hc.retries) && Number.isFinite(Number(hc.retries))) out.retries = Number(hc.retries);
  put(out, 'start_period', hc.startPeriod.trim());
  put(out, 'start_interval', hc.startInterval.trim());
  return Object.keys(out).length > 0 ? out : null;
}

function emitDeploy(service: ComposeService): Doc | null {
  const limits: Doc = {};
  put(limits, 'cpus', service.cpuLimit.trim());
  put(limits, 'memory', service.memLimit.trim());
  if (has(service.pidsLimit) && Number.isFinite(Number(service.pidsLimit))) {
    limits.pids = Number(service.pidsLimit);
  }

  const reservations: Doc = {};
  put(reservations, 'cpus', service.cpuReservation.trim());
  put(reservations, 'memory', service.memReservation.trim());
  if (has(service.gpus)) {
    const count = service.gpus.trim();
    reservations.devices = [
      count.toLowerCase() === 'all'
        ? { driver: 'nvidia', count: 'all', capabilities: ['gpu'] }
        : { driver: 'nvidia', count: Number(count) || 1, capabilities: ['gpu'] },
    ];
  }

  const resources: Doc = {};
  put(resources, 'limits', limits);
  put(resources, 'reservations', reservations);
  if (Object.keys(resources).length === 0) return null;
  return { resources };
}

/**
 * The Compose-spec order for a service's keys.
 *
 * Roughly the order the specification documents them in, with the identity
 * keys first and the long tail after — what a human writing one by hand puts
 * at the top.
 */
const SERVICE_KEY_ORDER = [
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
  'expose',
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
];

export function emitService(service: ComposeService, project: ComposeProjectModel): Doc {
  const out: Doc = {};

  put(out, 'image', service.image.trim());
  put(out, 'container_name', service.containerName.trim());
  put(out, 'hostname', service.hostname.trim());
  put(out, 'user', service.user.trim());
  put(out, 'working_dir', service.workingDir.trim());
  if (has(service.entrypoint)) out.entrypoint = splitCommand(service.entrypoint.trim());
  if (has(service.command)) out.command = splitCommand(service.command.trim());
  put(out, 'restart', service.restart);

  if (service.dependsOn.length > 0) {
    const deps: Doc = {};
    for (const dep of service.dependsOn) {
      const body: Doc = { condition: dep.condition };
      if (!dep.required) body.required = false;
      if (dep.restart) body.restart = true;
      deps[dep.service] = body;
    }
    put(out, 'depends_on', deps);
  }

  if (service.environment.length > 0) {
    const env: Doc = {};
    for (const item of service.environment) if (has(item.key)) env[item.key.trim()] = item.value;
    put(out, 'environment', env);
  }
  put(out, 'env_file', service.envFiles.map((f) => f.trim()).filter(has));

  const ports = service.ports.map(emitPort).filter((p): p is string | Doc => p !== null);
  put(out, 'ports', ports);

  // `network_mode` and `networks` are mutually exclusive — Compose refuses a
  // file with both, so the mode wins and the page says why.
  if (has(service.networkMode)) put(out, 'network_mode', service.networkMode.trim());
  else if (service.networks.length > 0) {
    const needsDetail = has(service.ipv4) || has(service.ipv6);
    if (needsDetail) {
      const networks: Doc = {};
      for (const [i, name] of service.networks.entries()) {
        const body: Doc = {};
        if (i === 0) {
          put(body, 'ipv4_address', service.ipv4.trim());
          put(body, 'ipv6_address', service.ipv6.trim());
        }
        networks[name] = Object.keys(body).length > 0 ? body : null;
      }
      out.networks = networks;
    } else {
      out.networks = [...service.networks];
    }
  }

  put(out, 'dns', service.dns.map((d) => d.trim()).filter(has));
  put(out, 'extra_hosts', service.extraHosts.map((h) => h.trim()).filter(has));

  const volumes = service.volumes.map(emitMount).filter((v): v is string | Doc => v !== null);
  put(out, 'volumes', volumes);
  put(out, 'tmpfs', service.tmpfs.map((t) => t.trim()).filter(has));
  put(out, 'secrets', service.secrets.filter((s) => project.secrets.some((x) => x.name === s)));
  put(out, 'configs', service.configs.filter((c) => project.configs.some((x) => x.name === c)));

  const healthcheck = emitHealthcheck(service);
  if (healthcheck) out.healthcheck = healthcheck;

  const deploy = emitDeploy(service);
  if (deploy) out.deploy = deploy;

  put(out, 'shm_size', service.shmSize.trim());
  if (service.privileged) out.privileged = true;
  if (service.tty) out.tty = true;
  if (service.stdinOpen) out.stdin_open = true;
  if (has(service.postStart)) out.post_start = [{ command: service.postStart.trim() }];
  if (has(service.preStop)) out.pre_stop = [{ command: service.preStop.trim() }];

  return order(out, SERVICE_KEY_ORDER);
}

/** Rebuild an object with its keys in a fixed order, unknown keys last. */
function order(source: Doc, keys: readonly string[]): Doc {
  const out: Doc = {};
  for (const key of keys) if (key in source) out[key] = source[key];
  for (const key of Object.keys(source)) if (!(key in out)) out[key] = source[key];
  return out;
}

function emitNetwork(network: ComposeNetwork): Doc | null {
  if (network.external) return { external: true };
  const out: Doc = {};
  put(out, 'driver', network.driver === 'bridge' ? '' : network.driver);

  const options: Doc = {};
  if (network.driver === 'ipvlan' || network.driver === 'macvlan') {
    put(options, 'parent', network.parent.trim());
  }
  if (network.driver === 'ipvlan' && has(network.ipvlanMode)) {
    options.ipvlan_mode = network.ipvlanMode.trim();
  }
  put(out, 'driver_opts', options);

  if (has(network.subnet)) {
    const entry: Doc = { subnet: network.subnet.trim() };
    put(entry, 'gateway', network.gateway.trim());
    out.ipam = { config: [entry] };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function emitVolume(volume: ComposeVolume): Doc | null {
  if (volume.external) return { external: true };
  const out: Doc = {};
  put(out, 'driver', volume.driver.trim());
  return Object.keys(out).length > 0 ? out : null;
}

function emitSecret(secret: ComposeSecret): Doc | null {
  if (secret.external) return { external: true };
  const out: Doc = {};
  put(out, 'file', secret.file.trim());
  put(out, 'environment', secret.environment.trim());
  return Object.keys(out).length > 0 ? out : null;
}

function emitConfig(config: ComposeConfig): Doc | null {
  if (config.external) return { external: true };
  const out: Doc = {};
  put(out, 'file', config.file.trim());
  put(out, 'content', config.content);
  return Object.keys(out).length > 0 ? out : null;
}

/** The whole project as a plain object, ready to stringify. */
export function toDocument(project: ComposeProjectModel): Doc {
  const doc: Doc = {};
  put(doc, 'name', project.name.trim());

  const services: Doc = {};
  for (const service of project.services) {
    if (!has(service.name)) continue;
    services[service.name.trim()] = emitService(service, project);
  }
  doc.services = services;

  const named = <T extends { name: string }>(items: T[], emit: (item: T) => Doc | null): Doc => {
    const out: Doc = {};
    for (const item of items) {
      if (!has(item.name)) continue;
      // `null` is how Compose spells "use the defaults", and it is emitted as
      // an empty value rather than as `{}` — which is what the spec's own
      // examples look like.
      out[item.name.trim()] = emit(item);
    }
    return out;
  };

  put(doc, 'networks', named(project.networks, emitNetwork));
  put(doc, 'volumes', named(project.volumes, emitVolume));
  put(doc, 'configs', named(project.configs, emitConfig));
  put(doc, 'secrets', named(project.secrets, emitSecret));

  return order(doc, ['name', 'services', 'networks', 'volumes', 'configs', 'secrets']);
}

/** The document as YAML text, ready to write to `compose.yaml`. */
export function emitCompose(project: ComposeProjectModel): string {
  return stringify(toDocument(project), {
    // Block style throughout: a compose file people read and edit by hand.
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
    lineWidth: 0,
    nullStr: '',
  });
}
