import { describe, expect, it } from 'vitest'
import {
  createTextDecoder,
  decodeBlob,
  decodeBytes,
  detectEncoding,
  hasReplacementCharacters,
  isEncodingChoice,
  isValidUtf8,
  sniffBom,
} from './encoding'

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0))

/** UTF-16 code units as bytes, little or big endian (what Excel's "Unicode Text" writes). */
function utf16(text: string, endian: 'le' | 'be'): number[] {
  const bytes: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index)
    const [low, high] = [unit & 0xff, unit >> 8]
    bytes.push(...(endian === 'le' ? [low, high] : [high, low]))
  }
  return bytes
}

// "فلتر زيت" (oil filter) and "الرياض" (Riyadh) in Windows-1256, as Arabic Excel saves CSV.
const OIL_FILTER_1256 = [0xdd, 0xe1, 0xca, 0xd1, 0x20, 0xd2, 0xed, 0xca]
const RIYADH_1256 = [0xc7, 0xe1, 0xd1, 0xed, 0xc7, 0xd6]
const WINDOWS_1256_CSV = new Uint8Array([
  ...ascii('item_code,name_ar,city\r\nP-1,'),
  ...OIL_FILTER_1256,
  0x2c,
  ...RIYADH_1256,
  0x0d,
  0x0a,
])

// Excel "Unicode Text (*.txt)": UTF-16LE with a byte-order mark, tab-delimited, CRLF.
const UNICODE_TEXT = new Uint8Array([
  0xff,
  0xfe,
  ...utf16('item_code\tname_ar\r\nP-1\tفلتر\r\n', 'le'),
])

// "CSV UTF-8 (Comma delimited)": a UTF-8 byte-order mark and CRLF line endings.
const UTF8_BOM_CSV = new Uint8Array([
  0xef,
  0xbb,
  0xbf,
  ...new TextEncoder().encode('item_code,name_ar\r\nP-1,فلتر زيت\r\n'),
])

describe('sniffBom', () => {
  it('names the encoding of a byte-order mark', () => {
    expect(sniffBom(UTF8_BOM_CSV)).toEqual({ encoding: 'utf-8', length: 3 })
    expect(sniffBom(UNICODE_TEXT)).toEqual({ encoding: 'utf-16le', length: 2 })
    expect(sniffBom(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toEqual({
      encoding: 'utf-16be',
      length: 2,
    })
    expect(sniffBom(WINDOWS_1256_CSV)).toBeNull()
    expect(sniffBom(new Uint8Array([0xef, 0xbb]))).toBeNull()
    expect(sniffBom(new Uint8Array())).toBeNull()
  })
})

describe('detectEncoding', () => {
  it('reads Windows-1256 Arabic when the bytes are not UTF-8', () => {
    expect(isValidUtf8(WINDOWS_1256_CSV)).toBe(false)
    expect(detectEncoding(WINDOWS_1256_CSV)).toEqual({
      encoding: 'windows-1256',
      source: 'fallback',
      bomLength: 0,
    })
    const { text } = decodeBytes(WINDOWS_1256_CSV)
    expect(text).toBe('item_code,name_ar,city\r\nP-1,فلتر زيت,الرياض\r\n')
  })

  it('reads UTF-16LE "Unicode Text" with its byte-order mark', () => {
    expect(Array.from(UNICODE_TEXT.slice(0, 6))).toEqual([0xff, 0xfe, 0x69, 0x00, 0x74, 0x00])
    const { text, encoding } = decodeBytes(UNICODE_TEXT)
    expect(encoding).toEqual({ encoding: 'utf-16le', source: 'bom', bomLength: 2 })
    expect(text).toBe('item_code\tname_ar\r\nP-1\tفلتر\r\n')
  })

  it('reads UTF-16BE with its byte-order mark', () => {
    const bytes = new Uint8Array([0xfe, 0xff, ...utf16('a,ب\n', 'be')])
    expect(decodeBytes(bytes)).toEqual({
      text: 'a,ب\n',
      encoding: { encoding: 'utf-16be', source: 'bom', bomLength: 2 },
    })
  })

  it('recognizes UTF-16 without a byte-order mark by its NUL bytes', () => {
    const le = new Uint8Array(utf16('item_code\tqty\r\nP-1\t5\r\n', 'le'))
    const be = new Uint8Array(utf16('item_code\tqty\r\nP-1\t5\r\n', 'be'))
    expect(detectEncoding(le).encoding).toBe('utf-16le')
    expect(detectEncoding(be).encoding).toBe('utf-16be')
    expect(decodeBytes(le).text).toBe('item_code\tqty\r\nP-1\t5\r\n')
  })

  it('strips the UTF-8 byte-order mark and keeps CRLF for the parser', () => {
    const { text, encoding } = decodeBytes(UTF8_BOM_CSV)
    expect(encoding).toEqual({ encoding: 'utf-8', source: 'bom', bomLength: 3 })
    expect(text).toBe('item_code,name_ar\r\nP-1,فلتر زيت\r\n')
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('accepts strict UTF-8 without a byte-order mark', () => {
    const bytes = new TextEncoder().encode('item_code,name_ar\nP-1,مرشح\n')
    expect(detectEncoding(bytes)).toEqual({ encoding: 'utf-8', source: 'utf8', bomLength: 0 })
    expect(detectEncoding(new Uint8Array())).toEqual({
      encoding: 'utf-8',
      source: 'utf8',
      bomLength: 0,
    })
  })

  it('treats a UTF-8 sequence cut by a slice boundary as valid', () => {
    const bytes = new TextEncoder().encode('ف'.repeat(10))
    expect(isValidUtf8(bytes, 3)).toBe(true)
    expect(isValidUtf8(new Uint8Array([0x41, 0xd9]), 1)).toBe(false)
  })

  it('honours an override and skips only a matching byte-order mark', () => {
    expect(detectEncoding(UTF8_BOM_CSV, 'utf-8')).toEqual({
      encoding: 'utf-8',
      source: 'override',
      bomLength: 3,
    })
    expect(detectEncoding(UTF8_BOM_CSV, 'windows-1256').bomLength).toBe(0)
    // ISO-8859-6: "فلتر" is e1 e4 ca d1.
    const iso = new Uint8Array([...ascii('n\n'), 0xe1, 0xe4, 0xca, 0xd1, 0x0a])
    expect(decodeBytes(iso, 'iso-8859-6').text).toBe('n\nفلتر\n')
  })

  it('shows replacement characters instead of failing on a wrong override', () => {
    const { text } = decodeBytes(WINDOWS_1256_CSV, 'utf-8')
    expect(hasReplacementCharacters(text)).toBe(true)
    expect(hasReplacementCharacters(decodeBytes(WINDOWS_1256_CSV).text)).toBe(false)
  })
})

describe('isEncodingChoice', () => {
  it('accepts the supported labels only', () => {
    for (const choice of ['auto', 'utf-8', 'utf-16le', 'utf-16be', 'windows-1256', 'iso-8859-6']) {
      expect(isEncodingChoice(choice)).toBe(true)
    }
    for (const choice of ['utf8', 'latin1', '', null]) expect(isEncodingChoice(choice)).toBe(false)
  })
})

describe('streaming decode', () => {
  it('carries characters split across slices', () => {
    const decoder = createTextDecoder({ encoding: 'utf-8', source: 'bom', bomLength: 3 })
    const pieces: string[] = []
    for (let index = 0; index < UTF8_BOM_CSV.length; index += 2) {
      const end = Math.min(index + 2, UTF8_BOM_CSV.length)
      pieces.push(decoder.decode(UTF8_BOM_CSV.subarray(index, end), end === UTF8_BOM_CSV.length))
    }
    expect(pieces.join('')).toBe('item_code,name_ar\r\nP-1,فلتر زيت\r\n')
  })

  it('decodes a blob slice by slice in every encoding', async () => {
    for (const bytes of [UTF8_BOM_CSV, UNICODE_TEXT, WINDOWS_1256_CSV]) {
      const blob = new Blob([bytes])
      const encoding = detectEncoding(bytes)
      const pieces: string[] = []
      for await (const piece of decodeBlob(blob, encoding, 3)) pieces.push(piece)
      expect(pieces.length).toBeGreaterThan(1)
      expect(pieces.join('')).toBe(decodeBytes(bytes).text)
    }
  })

  it('drops a single leading U+FEFF and yields nothing for an empty blob', async () => {
    const bytes = new TextEncoder().encode('﻿a,b\n')
    const pieces: string[] = []
    for await (const piece of decodeBlob(new Blob([bytes]), detectEncoding(bytes), 1)) {
      pieces.push(piece)
    }
    expect(pieces.join('')).toBe('a,b\n')
    const empty: string[] = []
    for await (const piece of decodeBlob(new Blob([]), detectEncoding(new Uint8Array()))) {
      empty.push(piece)
    }
    expect(empty).toEqual([])
  })
})
