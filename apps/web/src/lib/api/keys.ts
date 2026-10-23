import { API_LIMITS } from './limits'

/**
 * API keys: `zeespare_sk_` + 43 base62 characters (256 random bits) + a 6-character base62 CRC32 of
 * everything before it, 61 characters in all (`\bzeespare_sk_[0-9A-Za-z]{49}\b` for secret
 * scanners). The checksum lets the Worker refuse typos and truncated keys without a database
 * call. Postgres only ever sees the SHA-256 of a key (`api_keys.key_hash`, 32 bytes), computed
 * here with Web Crypto; the plaintext is shown once by Settings and never stored or logged.
 *
 * Pure module (Web Crypto and TextEncoder only): Server Actions, route handlers and Vitest use it.
 */

export const API_KEY_PREFIX = 'zeespare_sk_'
export const API_KEY_RANDOM_CHARS = 43
export const API_KEY_CHECKSUM_CHARS = 6
export const API_KEY_LENGTH = API_KEY_PREFIX.length + API_KEY_RANDOM_CHARS + API_KEY_CHECKSUM_CHARS
/** The whole key; the checksum is checked separately by `checkFormat`. */
export const API_KEY_PATTERN = /^zeespare_sk_[0-9A-Za-z]{49}$/
/** Characters of the display prefix after `zeespare_sk_` (`api_keys.display_prefix`). */
export const DISPLAY_PREFIX_CHARS = 4

/** Base62 digits in ascending value: 0-9, A-Z, a-z. */
export const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

declare const keyHashBrand: unique symbol

/**
 * The SHA-256 of an API key as the `api_*` RPCs take it: a Postgres `bytea` hex literal
 * (`\x` + 64 lower-case hex digits), which PostgREST hands to a `bytea` parameter unchanged. Only
 * `hashApiKey` (and `generateApiKey`) produce one, so a plaintext key can never be passed where a
 * hash is expected.
 */
export type KeyHash = string & { readonly [keyHashBrand]: 'KeyHash' }

export const KEY_HASH_PATTERN = /^\\x[0-9a-f]{64}$/

/* ------------------------------------------------------------------------------------------ */
/* Checksum                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32 (IEEE 802.3, as zlib and PNG) of the bytes, as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** A non-negative integer in base62, most significant digit first, left-padded with `0`. */
export function encodeBase62(value: number, width: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('encodeBase62: bad value')
  let rest = value
  let digits = ''
  do {
    digits = BASE62_ALPHABET.charAt(rest % 62) + digits
    rest = Math.floor(rest / 62)
  } while (rest > 0)
  if (digits.length > width) throw new RangeError('encodeBase62: value too wide')
  return digits.padStart(width, '0')
}

const encoder = new TextEncoder()

/** The 6-character checksum of a key body (`zeespare_sk_` + the 43 random characters). */
export function checksumFor(body: string): string {
  return encodeBase62(crc32(encoder.encode(body)), API_KEY_CHECKSUM_CHARS)
}

/**
 * Whether a token is shaped like a ZeeSpare key and its checksum matches. Offline only: a key that
 * passes may still be unknown, revoked or expired.
 */
export function checkFormat(token: string): boolean {
  if (token.length !== API_KEY_LENGTH || !API_KEY_PATTERN.test(token)) return false
  const body = token.slice(0, -API_KEY_CHECKSUM_CHARS)
  return checksumFor(body) === token.slice(-API_KEY_CHECKSUM_CHARS)
}

/* ------------------------------------------------------------------------------------------ */
/* Bearer header                                                                                */
/* ------------------------------------------------------------------------------------------ */

export type BearerCredential =
  /** No Authorization header, an empty one or another scheme (Basic, …): 401 `unauthorized`. */
  | { kind: 'missing' }
  /** `Bearer` without a usable token: 401 `invalid_token`. */
  | { kind: 'malformed' }
  | { kind: 'token'; token: string }

/** RFC 6750 b64token. */
const B64_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/

/**
 * Reads `Authorization: Bearer <token>`. The scheme is case-insensitive; the token is one
 * b64token of at most 255 characters. Credentials in the query string are never read.
 */
export function parseBearer(header: string | null | undefined): BearerCredential {
  const value = header?.trim() ?? ''
  if (value === '') return { kind: 'missing' }
  const match = /^(\S+)(?:[ \t]+(.*))?$/.exec(value)
  const scheme = match?.[1] ?? ''
  if (scheme.toLowerCase() !== 'bearer') return { kind: 'missing' }
  const token = match?.[2]?.trim() ?? ''
  if (token === '' || token.length > API_LIMITS.tokenChars || !B64_TOKEN.test(token)) {
    return { kind: 'malformed' }
  }
  return { kind: 'token', token }
}

/* ------------------------------------------------------------------------------------------ */
/* Hashes                                                                                       */
/* ------------------------------------------------------------------------------------------ */

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** SHA-256 of the key's UTF-8 bytes as a `KeyHash` (`\x` + 64 hex digits). */
export async function hashApiKey(token: string): Promise<KeyHash> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return `\\x${toHex(new Uint8Array(digest))}` as KeyHash
}

export function isKeyHash(value: unknown): value is KeyHash {
  return typeof value === 'string' && KEY_HASH_PATTERN.test(value)
}

/** The 64 hex digits of a hash, without the `\x` (for a `text` parameter or a log). */
export function keyHashHex(hash: KeyHash): string {
  return hash.slice(2)
}

/**
 * The first hex digits of a hash: 8 identify a key in logs, 16 key the rate limiter. Never more
 * than 16, so the full hash never leaves the Worker except towards Postgres.
 */
export function keyHashPrefix(hash: KeyHash, length = 8): string {
  if (!Number.isInteger(length) || length < 1 || length > 16) {
    throw new RangeError('keyHashPrefix: length must be 1-16')
  }
  return keyHashHex(hash).slice(0, length)
}

/* ------------------------------------------------------------------------------------------ */
/* Generation                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export type RandomSource = (bytes: Uint8Array) => Uint8Array

const defaultRandom: RandomSource = (bytes) => crypto.getRandomValues(bytes)

/**
 * `length` uniformly random base62 characters: random bytes below 248 (4 × 62) are kept and
 * taken modulo 62, the others are drawn again (rejection sampling, no modulo bias).
 */
export function randomBase62(length: number, random: RandomSource = defaultRandom): string {
  let out = ''
  const buffer = new Uint8Array(Math.max(16, Math.ceil(length * 1.1)))
  while (out.length < length) {
    random(buffer)
    for (const byte of buffer) {
      if (byte >= 248) continue
      out += BASE62_ALPHABET.charAt(byte % 62)
      if (out.length === length) break
    }
  }
  return out
}

export type GeneratedApiKey = {
  /** The plaintext key, shown once. */
  token: string
  hash: KeyHash
  /** The same hash as 64 hex digits. */
  hashHex: string
  /** `zeespare_sk_` + the first 4 random characters (`api_keys.display_prefix`). */
  displayPrefix: string
  /** The last 4 characters of the key (`api_keys.last4`). */
  last4: string
}

/** A new key with its hash and display parts (Settings' createApiKey Server Action). */
export async function generateApiKey(
  random: RandomSource = defaultRandom,
): Promise<GeneratedApiKey> {
  const body = API_KEY_PREFIX + randomBase62(API_KEY_RANDOM_CHARS, random)
  const token = body + checksumFor(body)
  const hash = await hashApiKey(token)
  return {
    token,
    hash,
    hashHex: keyHashHex(hash),
    displayPrefix: token.slice(0, API_KEY_PREFIX.length + DISPLAY_PREFIX_CHARS),
    last4: token.slice(-4),
  }
}

/** How Settings shows a key: `zeespare_sk_AbCd…wxyz`. */
export function displayKey(displayPrefix: string, last4: string): string {
  return `${displayPrefix}…${last4}`
}
