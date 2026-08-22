/**
 * The Docker Compose project model (0.3.0 phase 12).
 *
 * **The model is the source of truth; the YAML is a projection of it.** A
 * builder that stores text has to re-parse on every keystroke, and the first
 * time either side changes independently the two disagree — so nothing here
 * stores YAML. [emit.ts](./emit.ts) turns this into a document, and
 * [import.ts](./import.ts) turns a document into this, reporting whatever it
 * could not represent rather than dropping it.
 *
 * Every structure is JSON-native, so a project rides backup export/import
 * byte-identically. Every field has a value rather than being optional: an
 * editor binding to `undefined` is an editor that writes `undefined` into the
 * database, and emit decides what is worth writing out.
 *
 * `normalizeProject` is the read boundary. Nothing that comes back from the
 * database or a backup is trusted — the generic data suite writes an ARRAY
 * into every json column on purpose — so a stored model is re-shaped, not
 * cast.
 */
import { newId } from '../db/repo';

export type Protocol = 'tcp' | 'udp';

export interface ComposePort {
  /** Bind to one interface. Empty means every interface, which is the trap. */
  hostIp: string;
  /** Host port or range, e.g. '8080' or '8000-8010'. Empty publishes none. */
  published: string;
  /** Container port or range. */
  target: string;
  protocol: Protocol;
  /** 'host' bypasses the routing mesh; only meaningful in Swarm. */
  mode: '' | 'host' | 'ingress';
}

export type MountType = 'volume' | 'bind' | 'tmpfs';

export interface ComposeMount {
  type: MountType;
  /** Named volume, host path, or empty for an anonymous volume. */
  source: string;
  target: string;
  readOnly: boolean;
  /** tmpfs only, e.g. '64m'. */
  size: string;
}

export interface ComposeHealthcheck {
  enabled: boolean;
  /** True emits `disable: true`, which switches off an image's own check. */
  disable: boolean;
  test: string;
  interval: string;
  timeout: string;
  retries: string;
  startPeriod: string;
  startInterval: string;
}

export type DependsCondition =
  | 'service_started'
  | 'service_healthy'
  | 'service_completed_successfully';

export interface ComposeDependency {
  service: string;
  condition: DependsCondition;
  required: boolean;
  /** Restart this service when the dependency is restarted. */
  restart: boolean;
}

export interface KeyValue {
  key: string;
  value: string;
}

export interface ComposeService {
  /** Session-only handle for the editor. Not emitted, not serialized. */
  id: string;
  name: string;
  image: string;
  containerName: string;
  user: string;
  workingDir: string;
  entrypoint: string;
  command: string;
  hostname: string;
  tty: boolean;
  stdinOpen: boolean;
  privileged: boolean;
  dependsOn: ComposeDependency[];
  restart: '' | 'no' | 'always' | 'on-failure' | 'unless-stopped';
  healthcheck: ComposeHealthcheck;
  postStart: string;
  preStop: string;
  cpuLimit: string;
  memLimit: string;
  cpuReservation: string;
  memReservation: string;
  pidsLimit: string;
  shmSize: string;
  /** 'all', a count, or empty. Emitted as a device reservation. */
  gpus: string;
  ports: ComposePort[];
  /** 'host', 'none', 'service:x' — mutually exclusive with `networks`. */
  networkMode: string;
  networks: string[];
  ipv4: string;
  ipv6: string;
  dns: string[];
  extraHosts: string[];
  environment: KeyValue[];
  envFiles: string[];
  secrets: string[];
  configs: string[];
  volumes: ComposeMount[];
  tmpfs: string[];
}

export type NetworkDriver = 'bridge' | 'host' | 'none' | 'ipvlan' | 'macvlan' | 'overlay';

export interface ComposeNetwork {
  name: string;
  driver: NetworkDriver;
  /** ipvlan / macvlan: the host interface to attach to. Required by both. */
  parent: string;
  /** ipvlan only: 'l2' or 'l3'. */
  ipvlanMode: string;
  external: boolean;
  subnet: string;
  gateway: string;
}

export interface ComposeVolume {
  name: string;
  external: boolean;
  driver: string;
}

export interface ComposeSecret {
  name: string;
  /** A file on the host. */
  file: string;
  /** Or an environment variable holding the value (Compose 2.24+). */
  environment: string;
  external: boolean;
}

export interface ComposeConfig {
  name: string;
  file: string;
  /** Inline content, which ends up IN the compose file — and in a backup. */
  content: string;
  external: boolean;
}

export interface ComposeProjectModel {
  /** The project name, emitted as the document's top-level `name`. */
  name: string;
  services: ComposeService[];
  networks: ComposeNetwork[];
  volumes: ComposeVolume[];
  secrets: ComposeSecret[];
  configs: ComposeConfig[];
}

// ---- constructors -----------------------------------------------------------

export const RESTART_POLICIES = ['', 'no', 'always', 'on-failure', 'unless-stopped'] as const;

export const NETWORK_DRIVERS: { id: NetworkDriver; label: string }[] = [
  { id: 'bridge', label: 'bridge — the default, one private network per project' },
  { id: 'host', label: 'host — no isolation, the container uses the host stack' },
  { id: 'none', label: 'none — no networking at all' },
  { id: 'ipvlan', label: 'ipvlan — an address on your LAN, sharing the host MAC' },
  { id: 'macvlan', label: 'macvlan — an address on your LAN with its own MAC' },
  { id: 'overlay', label: 'overlay — across hosts (Swarm)' },
];

export function newHealthcheck(): ComposeHealthcheck {
  return {
    enabled: false,
    disable: false,
    test: '',
    interval: '',
    timeout: '',
    retries: '',
    startPeriod: '',
    startInterval: '',
  };
}

export function newPort(): ComposePort {
  return { hostIp: '', published: '', target: '', protocol: 'tcp', mode: '' };
}

export function newMount(type: MountType = 'volume'): ComposeMount {
  return { type, source: '', target: '', readOnly: false, size: '' };
}

export function newService(name = 'app'): ComposeService {
  return {
    id: newId(),
    name,
    image: '',
    containerName: '',
    user: '',
    workingDir: '',
    entrypoint: '',
    command: '',
    hostname: '',
    tty: false,
    stdinOpen: false,
    privileged: false,
    dependsOn: [],
    restart: '',
    healthcheck: newHealthcheck(),
    postStart: '',
    preStop: '',
    cpuLimit: '',
    memLimit: '',
    cpuReservation: '',
    memReservation: '',
    pidsLimit: '',
    shmSize: '',
    gpus: '',
    ports: [],
    networkMode: '',
    networks: [],
    ipv4: '',
    ipv6: '',
    dns: [],
    extraHosts: [],
    environment: [],
    envFiles: [],
    secrets: [],
    configs: [],
    volumes: [],
    tmpfs: [],
  };
}

export function newNetwork(name = 'backend'): ComposeNetwork {
  return { name, driver: 'bridge', parent: '', ipvlanMode: '', external: false, subnet: '', gateway: '' };
}

export function newVolume(name = 'data'): ComposeVolume {
  return { name, external: false, driver: '' };
}

export function newSecret(name = 'db_password'): ComposeSecret {
  return { name, file: '', environment: '', external: false };
}

export function newConfig(name = 'app_config'): ComposeConfig {
  return { name, file: '', content: '', external: false };
}

export function emptyProject(name = 'my-project'): ComposeProjectModel {
  return { name, services: [], networks: [], volumes: [], secrets: [], configs: [] };
}

/** A project with one service, which is what the page opens with. */
export function starterProject(): ComposeProjectModel {
  const web = newService('web');
  web.image = 'nginx:1.27-alpine';
  web.restart = 'unless-stopped';
  web.ports = [{ ...newPort(), published: '8080', target: '80' }];
  return { ...emptyProject(), services: [web] };
}

// ---- the read boundary ------------------------------------------------------

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;

const bool = (value: unknown): boolean => value === true;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const strings = (value: unknown): string[] =>
  list(value)
    .map((v) => str(v))
    .filter((v) => v !== '');

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function normalizePort(raw: unknown): ComposePort {
  const r = record(raw);
  return {
    hostIp: str(r.hostIp),
    published: str(r.published),
    target: str(r.target),
    protocol: oneOf(r.protocol, ['tcp', 'udp'] as const, 'tcp'),
    mode: oneOf(r.mode, ['', 'host', 'ingress'] as const, ''),
  };
}

function normalizeMount(raw: unknown): ComposeMount {
  const r = record(raw);
  return {
    type: oneOf(r.type, ['volume', 'bind', 'tmpfs'] as const, 'volume'),
    source: str(r.source),
    target: str(r.target),
    readOnly: bool(r.readOnly),
    size: str(r.size),
  };
}

function normalizeDependency(raw: unknown): ComposeDependency {
  const r = record(raw);
  return {
    service: str(r.service),
    condition: oneOf(
      r.condition,
      ['service_started', 'service_healthy', 'service_completed_successfully'] as const,
      'service_started'
    ),
    required: r.required === undefined ? true : bool(r.required),
    restart: bool(r.restart),
  };
}

function normalizeKeyValue(raw: unknown): KeyValue {
  const r = record(raw);
  return { key: str(r.key), value: str(r.value) };
}

function normalizeHealthcheck(raw: unknown): ComposeHealthcheck {
  const r = record(raw);
  return {
    enabled: bool(r.enabled),
    disable: bool(r.disable),
    test: str(r.test),
    interval: str(r.interval),
    timeout: str(r.timeout),
    retries: str(r.retries),
    startPeriod: str(r.startPeriod),
    startInterval: str(r.startInterval),
  };
}

export function normalizeService(raw: unknown, index = 0): ComposeService {
  const r = record(raw);
  const base = newService(str(r.name) || `service-${index + 1}`);
  return {
    ...base,
    id: str(r.id) || base.id,
    image: str(r.image),
    containerName: str(r.containerName),
    user: str(r.user),
    workingDir: str(r.workingDir),
    entrypoint: str(r.entrypoint),
    command: str(r.command),
    hostname: str(r.hostname),
    tty: bool(r.tty),
    stdinOpen: bool(r.stdinOpen),
    privileged: bool(r.privileged),
    dependsOn: list(r.dependsOn).map(normalizeDependency).filter((d) => d.service !== ''),
    restart: oneOf(r.restart, RESTART_POLICIES, ''),
    healthcheck: normalizeHealthcheck(r.healthcheck),
    postStart: str(r.postStart),
    preStop: str(r.preStop),
    cpuLimit: str(r.cpuLimit),
    memLimit: str(r.memLimit),
    cpuReservation: str(r.cpuReservation),
    memReservation: str(r.memReservation),
    pidsLimit: str(r.pidsLimit),
    shmSize: str(r.shmSize),
    gpus: str(r.gpus),
    ports: list(r.ports).map(normalizePort),
    networkMode: str(r.networkMode),
    networks: strings(r.networks),
    ipv4: str(r.ipv4),
    ipv6: str(r.ipv6),
    dns: strings(r.dns),
    extraHosts: strings(r.extraHosts),
    environment: list(r.environment).map(normalizeKeyValue).filter((e) => e.key !== ''),
    envFiles: strings(r.envFiles),
    secrets: strings(r.secrets),
    configs: strings(r.configs),
    volumes: list(r.volumes).map(normalizeMount),
    tmpfs: strings(r.tmpfs),
  };
}

/**
 * Re-shape anything into a project.
 *
 * Total by construction: every branch produces a valid model, because the
 * caller is a `<script>` about to bind form fields to it and there is no
 * useful "refuse to open" for a row that is already in the database.
 */
export function normalizeProject(raw: unknown): ComposeProjectModel {
  const r = record(raw);
  return {
    name: str(r.name) || 'my-project',
    services: list(r.services).map((s, i) => normalizeService(s, i)),
    networks: list(r.networks).map((n) => {
      const rec = record(n);
      const base = newNetwork(str(rec.name) || 'network');
      return {
        ...base,
        driver: oneOf(rec.driver, ['bridge', 'host', 'none', 'ipvlan', 'macvlan', 'overlay'] as const, 'bridge'),
        parent: str(rec.parent),
        ipvlanMode: str(rec.ipvlanMode),
        external: bool(rec.external),
        subnet: str(rec.subnet),
        gateway: str(rec.gateway),
      };
    }),
    volumes: list(r.volumes).map((v) => {
      const rec = record(v);
      return { name: str(rec.name) || 'volume', external: bool(rec.external), driver: str(rec.driver) };
    }),
    secrets: list(r.secrets).map((s) => {
      const rec = record(s);
      return {
        name: str(rec.name) || 'secret',
        file: str(rec.file),
        environment: str(rec.environment),
        external: bool(rec.external),
      };
    }),
    configs: list(r.configs).map((c) => {
      const rec = record(c);
      return {
        name: str(rec.name) || 'config',
        file: str(rec.file),
        content: str(rec.content),
        external: bool(rec.external),
      };
    }),
  };
}

// ---- editing ----------------------------------------------------------------

/**
 * A name that is not already taken, by appending `-2`, `-3`…
 *
 * Used when adding a service and when injecting a snippet into a project that
 * already has one by that name. Two services with the same key is not an
 * error Compose reports — the second silently replaces the first in the
 * mapping — so this has to happen before the model, not at emit.
 */
export function uniqueName(base: string, taken: readonly string[]): string {
  const clean = base.trim() || 'service';
  if (!taken.includes(clean)) return clean;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${clean}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${clean}-${newId().slice(0, 6)}`;
}

/** Every service name in the project, in order. */
export const serviceNames = (project: ComposeProjectModel): string[] =>
  project.services.map((s) => s.name);

/** Deep clone, so an edit to a loaded template never reaches the catalogue. */
export function cloneProject(project: ComposeProjectModel): ComposeProjectModel {
  const copy = normalizeProject(JSON.parse(JSON.stringify(project)));
  // Fresh session ids: two copies of one template must not share handles.
  copy.services = copy.services.map((s) => ({ ...s, id: newId() }));
  return copy;
}
