import { describe, expect, it } from 'vitest'
import {
  API_KEY_LENGTH,
  API_KEY_PATTERN,
  API_KEY_PREFIX,
  BASE62_ALPHABET,
  KEY_HASH_PATTERN,
  checkFormat,
  checksumFor,
  crc32,
  displayKey,
  encodeBase62,
  generateApiKey,
  hashApiKey,
  isKeyHash,
  keyHashHex,
  keyHashPrefix,
  parseBearer,
  randomBase62,
  type KeyHash,
} from './keys'

/**
 * Shared with supabase/tests/0022_api_keys.test.sql:
 * encode(sha256('maqdar_sk_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg27zRqD'::bytea), 'hex').
 */
const VECTOR_TOKEN = 'maqdar_sk_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg27zRqD'
const VECTOR_SHA256 = '57c5db9f1c461c47073a614bba4368a3902a3fa56525f94fa8fab6528f35efcb'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(bytes(''))).toBe(0)
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926)
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('encodeBase62', () => {
  it('pads, orders digits by value and refuses overflow', () => {
    expect(encodeBase62(0, 6)).toBe('000000')
    expect(encodeBase62(61, 2)).toBe('0z')
    expect(encodeBase62(62, 2)).toBe('10')
    expect(encodeBase62(0xffffffff, 6)).toBe('4gfFC3')
    expect(() => encodeBase62(62 ** 2, 2)).toThrow(RangeError)
    expect(() => encodeBase62(-1, 6)).toThrow(RangeError)
  })

  it('uses 0-9, A-Z, a-z in ascending order', () => {
    expect(BASE62_ALPHABET).toHaveLength(62)
    expect([...BASE62_ALPHABET].sort().join('')).toBe(BASE62_ALPHABET)
  })
})

describe('key format', () => {
  it('accepts the shared vector and its checksum', () => {
    expect(VECTOR_TOKEN).toHaveLength(API_KEY_LENGTH)
    expect(API_KEY_LENGTH).toBe(59)
    expect(checksumFor(VECTOR_TOKEN.slice(0, -6))).toBe('27zRqD')
    expect(checkFormat(VECTOR_TOKEN)).toBe(true)
  })

  it('refuses any single changed character, wrong prefixes and lengths', () => {
    for (let i = 0; i < VECTOR_TOKEN.length; i++) {
      const original = VECTOR_TOKEN.charAt(i)
      const replacement = original === 'A' ? 'B' : 'A'
      const changed = VECTOR_TOKEN.slice(0, i) + replacement + VECTOR_TOKEN.slice(i + 1)
      expect(checkFormat(changed), `position ${i}`).toBe(false)
    }
    expect(checkFormat(VECTOR_TOKEN.slice(0, -1))).toBe(false)
    expect(checkFormat(`${VECTOR_TOKEN}0`)).toBe(false)
    expect(checkFormat(VECTOR_TOKEN.replace('maqdar_sk_', 'maqdar_pk_'))).toBe(false)
    expect(checkFormat(VECTOR_TOKEN.replace('a', '-'))).toBe(false)
    expect(checkFormat('')).toBe(false)
  })
})

describe('generateApiKey', () => {
  it('produces well-formed, unique keys with matching display parts and hashes', async () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 10_000; i++) {
      const body = API_KEY_PREFIX + randomBase62(43)
      const token = body + checksumFor(body)
      expect(API_KEY_PATTERN.test(token)).toBe(true)
      expect(checkFormat(token)).toBe(true)
      tokens.add(token)
    }
    expect(tokens.size).toBe(10_000)

    const key = await generateApiKey()
    expect(checkFormat(key.token)).toBe(true)
    expect(key.token.startsWith(key.displayPrefix)).toBe(true)
    expect(key.displayPrefix).toMatch(/^maqdar_sk_[0-9A-Za-z]{4}$/)
    expect(key.last4).toMatch(/^[0-9A-Za-z]{4}$/)
    expect(key.token.endsWith(key.last4)).toBe(true)
    expect(key.hash).toBe(await hashApiKey(key.token))
    expect(key.hashHex).toBe(keyHashHex(key.hash))
    expect(displayKey(key.displayPrefix, key.last4)).toBe(`${key.displayPrefix}…${key.last4}`)
  })

  it('draws every character without bias from rejected bytes', () => {
    // Bytes 248-255 are rejected; 0, 61, 62 and 247 map to 0, z, 0 and z.
    let calls = 0
    const random = (buffer: Uint8Array) => {
      calls += 1
      buffer.fill(calls === 1 ? 250 : 0)
      buffer[0] = calls === 1 ? 255 : 61
      buffer[1] = calls === 1 ? 248 : 247
      buffer[2] = calls === 1 ? 249 : 62
      return buffer
    }
    const text = randomBase62(4, random)
    expect(text).toBe('zz00')
    expect(calls).toBe(2)
  })

  it('is deterministic for a given random source', async () => {
    const random = (buffer: Uint8Array) => buffer.fill(1)
    const key = await generateApiKey(random)
    expect(key.token).toBe(
      `maqdar_sk_${'1'.repeat(43)}${checksumFor(`maqdar_sk_${'1'.repeat(43)}`)}`,
    )
  })
})

describe('hashApiKey', () => {
  it('equals the SHA-256 vector shared with pgTAP, as a bytea hex literal', async () => {
    const hash = await hashApiKey(VECTOR_TOKEN)
    expect(hash).toBe(`\\x${VECTOR_SHA256}`)
    expect(KEY_HASH_PATTERN.test(hash)).toBe(true)
    expect(isKeyHash(hash)).toBe(true)
    expect(isKeyHash(VECTOR_SHA256)).toBe(false)
    expect(keyHashHex(hash)).toBe(VECTOR_SHA256)
    expect(keyHashPrefix(hash)).toBe('57c5db9f')
    expect(keyHashPrefix(hash, 16)).toBe('57c5db9f1c461c47')
    expect(() => keyHashPrefix(hash, 17)).toThrow(RangeError)
    expect(JSON.stringify({ p_key_hash: hash })).toBe(`{"p_key_hash":"\\\\x${VECTOR_SHA256}"}`)
  })

  it('differs for different keys', async () => {
    const other = (await generateApiKey()).token
    expect(await hashApiKey(other)).not.toBe(await hashApiKey(VECTOR_TOKEN))
  })
})

describe('parseBearer', () => {
  it('reads a bearer token with any scheme case and surrounding space', () => {
    expect(parseBearer(`Bearer ${VECTOR_TOKEN}`)).toEqual({ kind: 'token', token: VECTOR_TOKEN })
    expect(parseBearer(`bearer   ${VECTOR_TOKEN}  `)).toEqual({
      kind: 'token',
      token: VECTOR_TOKEN,
    })
    expect(parseBearer(`BEARER\t${VECTOR_TOKEN}`)).toEqual({ kind: 'token', token: VECTOR_TOKEN })
  })

  it('treats no header and other schemes as missing credentials', () => {
    expect(parseBearer(null)).toEqual({ kind: 'missing' })
    expect(parseBearer(undefined)).toEqual({ kind: 'missing' })
    expect(parseBearer('')).toEqual({ kind: 'missing' })
    expect(parseBearer('   ')).toEqual({ kind: 'missing' })
    expect(parseBearer('Basic dXNlcjpwYXNz')).toEqual({ kind: 'missing' })
    expect(parseBearer(VECTOR_TOKEN)).toEqual({ kind: 'missing' })
  })

  it('refuses empty, spaced, over-long and non-b64token values', () => {
    expect(parseBearer('Bearer')).toEqual({ kind: 'malformed' })
    expect(parseBearer('Bearer   ')).toEqual({ kind: 'malformed' })
    expect(parseBearer('Bearer a b')).toEqual({ kind: 'malformed' })
    expect(parseBearer(`Bearer ${'a'.repeat(256)}`)).toEqual({ kind: 'malformed' })
    expect(parseBearer(`Bearer ${'a'.repeat(255)}`)).toEqual({
      kind: 'token',
      token: 'a'.repeat(255),
    })
    expect(parseBearer('Bearer "quoted"')).toEqual({ kind: 'malformed' })
    expect(parseBearer('Bearer abc,def')).toEqual({ kind: 'malformed' })
  })
})

describe('KeyHash brand', () => {
  it('cannot be built from a plain string without a cast', () => {
    // @ts-expect-error a plain string is not a KeyHash
    const hash: KeyHash = 'abc'
    expect(hash).toBe('abc')
  })
})
