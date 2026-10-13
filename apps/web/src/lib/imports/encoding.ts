/**
 * Text encodings of imported CSV, TSV and TXT files. A byte-order mark decides first (UTF-8,
 * UTF-16LE, UTF-16BE); otherwise the bytes are tried as strict UTF-8 and, when that fails, read as
 * Windows-1256 (Arabic Excel exports). The user can override the guess. Decoding streams, so a
 * 50 MB file never needs a second copy as one string. Pure module (Encoding Standard
 * `TextDecoder` only): browsers, the parse worker, Workers and Node 24 (full ICU) all have it.
 */

export const ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1256', 'iso-8859-6'] as const

export type TextEncodingName = (typeof ENCODINGS)[number]

/** `auto` detects; anything else is a user override. */
export type EncodingChoice = 'auto' | TextEncodingName

export type DetectedEncoding = {
  encoding: TextEncodingName
  /** How it was decided. */
  source: 'bom' | 'utf8' | 'nul-pattern' | 'fallback' | 'override'
  /** Bytes of byte-order mark at the start (skipped when decoding). */
  bomLength: number
}

export function isEncodingChoice(value: unknown): value is EncodingChoice {
  return value === 'auto' || (ENCODINGS as readonly unknown[]).includes(value)
}

/** The encoding named by a byte-order mark, if the bytes start with one. */
export function sniffBom(
  bytes: Uint8Array,
): { encoding: 'utf-8' | 'utf-16le' | 'utf-16be'; length: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', length: 3 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', length: 2 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', length: 2 }
  }
  return null
}

/**
 * UTF-16 text without a byte-order mark: CSV text in single-byte encodings or UTF-8 never contains
 * NUL bytes, while ASCII-heavy UTF-16 has one in every other byte. Looks at the first 4 KB.
 */
function sniffUtf16WithoutBom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const length = Math.min(bytes.length, 4096) & ~1
  if (length < 4) return null
  let evenZeros = 0
  let oddZeros = 0
  for (let index = 0; index < length; index += 2) {
    if (bytes[index] === 0) evenZeros += 1
    if (bytes[index + 1] === 0) oddZeros += 1
  }
  const pairs = length / 2
  if (oddZeros > pairs * 0.3 && evenZeros < pairs * 0.05) return 'utf-16le'
  if (evenZeros > pairs * 0.3 && oddZeros < pairs * 0.05) return 'utf-16be'
  return null
}

/** True when the bytes are well-formed UTF-8 (checked in slices, nothing is kept). */
export function isValidUtf8(bytes: Uint8Array, sliceBytes = 1 << 20): boolean {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  try {
    for (let start = 0; start < bytes.length; start += sliceBytes) {
      const end = Math.min(start + sliceBytes, bytes.length)
      decoder.decode(bytes.subarray(start, end), { stream: end < bytes.length })
    }
    decoder.decode()
    return true
  } catch {
    return false
  }
}

/**
 * Decides the encoding of a file's bytes. An override wins (a matching byte-order mark is still
 * skipped); otherwise the order is BOM, UTF-16 without BOM, strict UTF-8, Windows-1256.
 */
export function detectEncoding(
  bytes: Uint8Array,
  choice: EncodingChoice = 'auto',
): DetectedEncoding {
  const bom = sniffBom(bytes)
  if (choice !== 'auto') {
    return {
      encoding: choice,
      source: 'override',
      bomLength: bom && bom.encoding === choice ? bom.length : 0,
    }
  }
  if (bom) return { encoding: bom.encoding, source: 'bom', bomLength: bom.length }
  const utf16 = sniffUtf16WithoutBom(bytes)
  if (utf16) return { encoding: utf16, source: 'nul-pattern', bomLength: 0 }
  if (isValidUtf8(bytes)) return { encoding: 'utf-8', source: 'utf8', bomLength: 0 }
  return { encoding: 'windows-1256', source: 'fallback', bomLength: 0 }
}

/**
 * A streaming decoder for the detected encoding. Bytes that cannot be decoded become U+FFFD
 * (never an exception), so a wrong override shows up in the preview instead of failing.
 */
export function createTextDecoder(detected: DetectedEncoding) {
  // ignoreBOM: the mark is skipped by offset (bomLength), so a second one stays visible as U+FEFF.
  const decoder = new TextDecoder(detected.encoding, { fatal: false, ignoreBOM: true })
  let skip = detected.bomLength
  return {
    /** Decodes the next slice; pass `last` for the final one (flushes split characters). */
    decode(bytes: Uint8Array, last = false): string {
      let view = bytes
      if (skip > 0) {
        const skipped = Math.min(skip, view.length)
        view = view.subarray(skipped)
        skip -= skipped
      }
      return decoder.decode(view, { stream: !last })
    },
  }
}

/** Decodes all bytes at once (previews and tests). Strips one leading U+FEFF left by the data. */
export function decodeBytes(
  bytes: Uint8Array,
  choice: EncodingChoice = 'auto',
): { text: string; encoding: DetectedEncoding } {
  const encoding = detectEncoding(bytes, choice)
  const text = createTextDecoder(encoding).decode(bytes, true)
  return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, encoding }
}

/** A blob read in byte slices (File and Blob in browsers, workers and Node 24). */
export type BlobLike = Pick<Blob, 'size' | 'slice'>

/**
 * Decodes a blob slice by slice. Each yielded string is the text of one slice (a character split
 * across slices is carried to the next), so memory stays at one slice however large the file is.
 * A single leading U+FEFF is dropped from the first piece.
 */
export async function* decodeBlob(
  blob: BlobLike,
  encoding: DetectedEncoding,
  sliceBytes = 1 << 20,
  onProgress?: (bytesRead: number) => void,
): AsyncGenerator<string, void, undefined> {
  const decoder = createTextDecoder(encoding)
  let first = true
  if (blob.size === 0) return
  for (let start = 0; start < blob.size; start += sliceBytes) {
    const end = Math.min(start + sliceBytes, blob.size)
    const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer())
    onProgress?.(end)
    let text = decoder.decode(bytes, end >= blob.size)
    if (first && text !== '') {
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      first = false
    }
    if (text !== '') yield text
  }
}

/** True when decoding produced replacement characters (likely the wrong encoding). */
export function hasReplacementCharacters(text: string): boolean {
  return text.includes('�')
}
