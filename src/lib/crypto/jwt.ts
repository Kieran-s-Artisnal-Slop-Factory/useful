/**
 * JSON Web Tokens: decode, verify, sign.
 *
 * The distinction this module exists to keep is the one every JWT bug starts
 * with: **decoding is not verifying**. Anyone holding a token can read its
 * payload — it is base64url, not encryption — and a decoded token means
 * nothing at all until a signature has been checked against a key you trust.
 * `decode()` never touches a key and never reports validity; `verify()` is the
 * only thing here that says a token is genuine.
 *
 * Two attacks are refused by name rather than by silence:
 *
 * - **`alg: none`.** The original specification allowed an unsigned token, and
 *   libraries that honoured it accepted anything anyone sent. There is no
 *   configuration here that will verify one.
 * - **Algorithm confusion.** A verifier told "HS256" that holds an RSA PUBLIC
 *   key can be tricked into treating that public key as an HMAC secret — the
 *   key is public, so the attacker can forge tokens with it. Handing this
 *   module a PEM for an HMAC algorithm is refused.
 */
import { decodeBytes, decodeText, encodeBytes, encodeText } from '../encode/base64';
import { fromPem } from './rsa';

export type JwtAlgorithm =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'EdDSA';

export interface AlgorithmDef {
  id: JwtAlgorithm;
  family: 'HMAC' | 'RSA' | 'RSA-PSS' | 'ECDSA' | 'EdDSA';
  /** What the key is: a shared secret, or a key pair. */
  symmetric: boolean;
  description: string;
}

export const ALGORITHMS: AlgorithmDef[] = [
  { id: 'HS256', family: 'HMAC', symmetric: true, description: 'HMAC with SHA-256 — one shared secret.' },
  { id: 'HS384', family: 'HMAC', symmetric: true, description: 'HMAC with SHA-384.' },
  { id: 'HS512', family: 'HMAC', symmetric: true, description: 'HMAC with SHA-512.' },
  { id: 'RS256', family: 'RSA', symmetric: false, description: 'RSASSA-PKCS1-v1_5 with SHA-256.' },
  { id: 'RS384', family: 'RSA', symmetric: false, description: 'RSASSA-PKCS1-v1_5 with SHA-384.' },
  { id: 'RS512', family: 'RSA', symmetric: false, description: 'RSASSA-PKCS1-v1_5 with SHA-512.' },
  { id: 'PS256', family: 'RSA-PSS', symmetric: false, description: 'RSA-PSS with SHA-256 — the modern RSA padding.' },
  { id: 'PS384', family: 'RSA-PSS', symmetric: false, description: 'RSA-PSS with SHA-384.' },
  { id: 'PS512', family: 'RSA-PSS', symmetric: false, description: 'RSA-PSS with SHA-512.' },
  { id: 'ES256', family: 'ECDSA', symmetric: false, description: 'ECDSA on P-256 with SHA-256.' },
  { id: 'ES384', family: 'ECDSA', symmetric: false, description: 'ECDSA on P-384 with SHA-384.' },
  { id: 'ES512', family: 'ECDSA', symmetric: false, description: 'ECDSA on P-521 with SHA-512.' },
  { id: 'EdDSA', family: 'EdDSA', symmetric: false, description: 'Ed25519 — where the browser has it.' },
];

export const algorithmById = (id: string): AlgorithmDef | undefined =>
  ALGORITHMS.find((def) => def.id === id);

export class JwtError extends Error {}

function subtle(): SubtleCrypto {
  const source = globalThis.crypto as Crypto | undefined;
  if (!source || !('subtle' in source) || !source.subtle) {
    throw new JwtError('Signing and verifying need crypto.subtle, which this context does not have.');
  }
  return source.subtle;
}

/* ------------------------------------------------------------------ decode --- */

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: Uint8Array;
  /** The bytes that were signed: `header.payload`, exactly as they arrived. */
  signingInput: string;
  parts: { header: string; payload: string; signature: string };
  /** The algorithm the token CLAIMS, which is not evidence of anything. */
  algorithm: string;
}

/** Split and parse a token. Never checks a signature. */
export function decode(token: string): DecodedJwt {
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new JwtError(
      `A JWT has three dot-separated parts; this has ${parts.length}. (A five-part token is JWE — encrypted — which this tool does not read.)`
    );
  }
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(decodeText(headerPart)) as Record<string, unknown>;
  } catch {
    throw new JwtError('The header is not base64url-encoded JSON.');
  }
  try {
    payload = JSON.parse(decodeText(payloadPart)) as Record<string, unknown>;
  } catch {
    throw new JwtError('The payload is not base64url-encoded JSON.');
  }
  let signature: Uint8Array;
  try {
    signature = signaturePart === '' ? new Uint8Array(0) : decodeBytes(signaturePart);
  } catch {
    throw new JwtError('The signature is not base64url.');
  }
  return {
    header,
    payload,
    signature,
    signingInput: `${headerPart}.${payloadPart}`,
    parts: { header: headerPart, payload: payloadPart, signature: signaturePart },
    algorithm: String(header.alg ?? ''),
  };
}

/* ------------------------------------------------------------------ claims --- */

export interface ClaimRow {
  name: string;
  label: string;
  value: unknown;
  /** A rendered form for the time claims. */
  detail?: string;
}

const REGISTERED: Record<string, string> = {
  iss: 'Issuer',
  sub: 'Subject',
  aud: 'Audience',
  exp: 'Expires at',
  nbf: 'Not valid before',
  iat: 'Issued at',
  jti: 'Token id',
};

const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat']);

/** Seconds since the epoch, as a date and a relative age. */
export function describeTime(seconds: number, now = Date.now()): string {
  const when = new Date(seconds * 1000);
  const delta = when.getTime() - now;
  const absolute = when.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
  const minutes = Math.round(Math.abs(delta) / 60000);
  const relative =
    minutes < 1
      ? 'less than a minute'
      : minutes < 60
        ? `${minutes} minute${minutes === 1 ? '' : 's'}`
        : minutes < 60 * 24
          ? `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? '' : 's'}`
          : `${Math.round(minutes / (60 * 24))} day${Math.round(minutes / (60 * 24)) === 1 ? '' : 's'}`;
  return `${absolute} — ${delta >= 0 ? `in ${relative}` : `${relative} ago`}`;
}

/** The registered claims first, in specification order, then everything else. */
export function claims(payload: Record<string, unknown>, now = Date.now()): ClaimRow[] {
  const rows: ClaimRow[] = [];
  for (const [name, label] of Object.entries(REGISTERED)) {
    if (!(name in payload)) continue;
    const value = payload[name];
    rows.push({
      name,
      label,
      value,
      detail: TIME_CLAIMS.has(name) && typeof value === 'number' ? describeTime(value, now) : undefined,
    });
  }
  for (const [name, value] of Object.entries(payload)) {
    if (name in REGISTERED) continue;
    rows.push({ name, label: name, value });
  }
  return rows;
}

export interface Validity {
  expired: boolean;
  notYetValid: boolean;
  /** True when the payload carries no `exp` at all — worth saying out loud. */
  neverExpires: boolean;
  summary: string;
}

/** What the time claims say, independently of whether the signature is good. */
export function validity(payload: Record<string, unknown>, now = Date.now()): Validity {
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : null;
  const expired = exp !== null && exp * 1000 <= now;
  const notYetValid = nbf !== null && nbf * 1000 > now;
  const neverExpires = exp === null;
  const summary = expired
    ? `Expired ${describeTime(exp!, now)}`
    : notYetValid
      ? `Not valid until ${describeTime(nbf!, now)}`
      : neverExpires
        ? 'No expiry claim — this token does not expire on its own'
        : `Valid until ${describeTime(exp!, now)}`;
  return { expired, notYetValid, neverExpires, summary };
}

/* ------------------------------------------------------------------ crypto --- */

const HASH_FOR: Record<string, string> = {
  '256': 'SHA-256',
  '384': 'SHA-384',
  '512': 'SHA-512',
};

const CURVE_FOR: Record<string, string> = {
  ES256: 'P-256',
  ES384: 'P-384',
  ES512: 'P-521',
};

function paramsFor(def: AlgorithmDef): { importAlgorithm: unknown; signAlgorithm: unknown } {
  const size = def.id.slice(2);
  const hash = HASH_FOR[size] ?? 'SHA-256';
  switch (def.family) {
    case 'HMAC':
      return { importAlgorithm: { name: 'HMAC', hash }, signAlgorithm: { name: 'HMAC' } };
    case 'RSA':
      return {
        importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash },
        signAlgorithm: { name: 'RSASSA-PKCS1-v1_5' },
      };
    case 'RSA-PSS':
      return {
        importAlgorithm: { name: 'RSA-PSS', hash },
        // The salt length equals the digest length, which is what the JOSE
        // specification requires for PS*.
        signAlgorithm: { name: 'RSA-PSS', saltLength: Number(size) / 8 },
      };
    case 'ECDSA':
      return {
        importAlgorithm: { name: 'ECDSA', namedCurve: CURVE_FOR[def.id] ?? 'P-256' },
        signAlgorithm: { name: 'ECDSA', hash },
      };
    default:
      return { importAlgorithm: { name: 'Ed25519' }, signAlgorithm: { name: 'Ed25519' } };
  }
}

/** Does this runtime have the primitive this algorithm needs? */
export async function supported(id: JwtAlgorithm): Promise<boolean> {
  const def = algorithmById(id);
  if (!def) return false;
  try {
    const api = subtle();
    if (def.family === 'EdDSA') {
      await api.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

export interface KeyInput {
  /** For HS*: the shared secret, as text. */
  secret?: string;
  /** For everything else: a PEM block. */
  pem?: string;
}

async function importKey(def: AlgorithmDef, key: KeyInput, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  const api = subtle();
  const { importAlgorithm } = paramsFor(def);
  if (def.symmetric) {
    if (key.pem) {
      throw new JwtError(
        `${def.id} is an HMAC algorithm: its key is a shared secret, not a PEM. Verifying an HS* token with an RSA PUBLIC key is the algorithm-confusion attack — the "key" is public, so anyone could forge tokens with it.`
      );
    }
    return api.importKey(
      'raw',
      encodeSecret(key.secret ?? ''),
      importAlgorithm as AlgorithmIdentifier,
      false,
      [usage]
    );
  }
  if (!key.pem) {
    throw new JwtError(`${def.id} needs a PEM key — a public key to verify, a private key to sign.`);
  }
  const der = fromPem(key.pem);
  const isPrivate = /BEGIN [^-]*PRIVATE KEY/.test(key.pem);
  if (usage === 'sign' && !isPrivate) throw new JwtError('Signing needs the PRIVATE key.');
  if (usage === 'verify' && isPrivate) {
    // Not an error: a private key contains the public one, and people paste
    // what they have. WebCrypto will not import pkcs8 for verify, though.
    throw new JwtError('Verifying needs the PUBLIC key, not the private one.');
  }
  return api.importKey(
    isPrivate ? 'pkcs8' : 'spki',
    der as unknown as BufferSource,
    importAlgorithm as AlgorithmIdentifier,
    false,
    [usage]
  );
}

function encodeSecret(secret: string): BufferSource {
  return new TextEncoder().encode(secret === '' ? ' ' : secret) as unknown as BufferSource;
}

export interface VerifyResult {
  valid: boolean;
  /** Why not, when not. */
  reason?: string;
}

/** Check a token's signature against a key. The only function here that can. */
export async function verify(token: string, key: KeyInput): Promise<VerifyResult> {
  const decoded = decode(token);
  const claimed = decoded.algorithm;
  if (claimed === 'none' || claimed === '') {
    return {
      valid: false,
      reason:
        'This token says alg: none — an unsigned token. There is nothing to verify, and a library that accepts one accepts anything anybody sends.',
    };
  }
  const def = algorithmById(claimed);
  if (!def) return { valid: false, reason: `Unknown algorithm "${claimed}".` };

  const cryptoKey = await importKey(def, key, 'verify');
  const { signAlgorithm } = paramsFor(def);
  const ok = await subtle().verify(
    signAlgorithm as AlgorithmIdentifier,
    cryptoKey,
    decoded.signature as unknown as BufferSource,
    new TextEncoder().encode(decoded.signingInput) as unknown as BufferSource
  );
  return ok
    ? { valid: true }
    : {
        valid: false,
        reason: 'The signature does not match — wrong key, or the header or payload has been changed.',
      };
}

/** Build and sign a token. */
export async function sign(
  payload: Record<string, unknown>,
  key: KeyInput,
  algorithm: JwtAlgorithm = 'HS256',
  extraHeader: Record<string, unknown> = {}
): Promise<string> {
  const def = algorithmById(algorithm);
  if (!def) throw new JwtError(`Unknown algorithm "${algorithm}".`);
  const header = { alg: algorithm, typ: 'JWT', ...extraHeader };
  const signingInput = `${encodeText(JSON.stringify(header), { url: true })}.${encodeText(
    JSON.stringify(payload),
    { url: true }
  )}`;
  const cryptoKey = await importKey(def, key, 'sign');
  const { signAlgorithm } = paramsFor(def);
  const signature = new Uint8Array(
    await subtle().sign(
      signAlgorithm as AlgorithmIdentifier,
      cryptoKey,
      new TextEncoder().encode(signingInput) as unknown as BufferSource
    )
  );
  return `${signingInput}.${encodeBytes(signature, { url: true })}`;
}

/** Pretty-print the header or payload for the editor panes. */
export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
