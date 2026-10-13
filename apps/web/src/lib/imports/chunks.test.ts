import { describe, expect, it } from 'vitest'
import {
  ChunkBuilder,
  chunkBody,
  chunkLimitsFor,
  firstMissingRow,
  halveChunk,
  sanitizeCell,
  splitChunk,
  utf8Length,
  type Chunk,
  type ChunkIssue,
} from './chunks'

function build(
  rows: number,
  limits: { maxRows: number; maxBytes: number },
  cells: (row: number) => (string | null)[] = (row) => [`P-${row}`, null, ''],
) {
  const builder = new ChunkBuilder(cells(1).length, limits)
  const chunks: Chunk[] = []
  for (let row = 1; row <= rows; row += 1) {
    const done = builder.add(row, cells(row))
    if (done) chunks.push(done)
  }
  const last = builder.flush()
  if (last) chunks.push(last)
  return chunks
}

describe('chunkLimitsFor', () => {
  it('uses the contract stage rows and 1 MB, and only tightens them', () => {
    expect(chunkLimitsFor('items')).toEqual({ maxRows: 5_000, maxBytes: 1_000_000 })
    expect(chunkLimitsFor('demand_history')).toEqual({ maxRows: 10_000, maxBytes: 1_000_000 })
    expect(chunkLimitsFor('demand_history', { maxRows: 2_500 })).toEqual({
      maxRows: 2_500,
      maxBytes: 1_000_000,
    })
    expect(chunkLimitsFor('items', { maxRows: 50_000, maxBytes: 5_000_000 })).toEqual({
      maxRows: 5_000,
      maxBytes: 1_000_000,
    })
    expect(chunkLimitsFor('items', { maxRows: 0 }).maxRows).toBe(1)
  })
})

describe('utf8Length', () => {
  it('counts UTF-8 bytes like TextEncoder', () => {
    for (const text of ['', 'abc', 'فلتر زيت', '€', '😀 a', '["P-1",null,""]', 'éࠀ']) {
      expect(utf8Length(text), text).toBe(new TextEncoder().encode(text).length)
    }
  })
})

describe('ChunkBuilder', () => {
  it('encodes rows as [row_no, cells…] with null and ""', () => {
    const [chunk] = build(2, { maxRows: 10, maxBytes: 1_000_000 })
    expect(chunk).toBeDefined()
    expect(chunkBody(chunk!)).toBe('[[1,"P-1",null,""],[2,"P-2",null,""]]')
    expect(chunk!.bytes).toBe(utf8Length(chunkBody(chunk!)))
    expect(JSON.parse(chunkBody(chunk!))).toEqual([
      [1, 'P-1', null, ''],
      [2, 'P-2', null, ''],
    ])
  })

  it('caps rows per chunk and keeps row numbers contiguous', () => {
    const chunks = build(12_345, { maxRows: 5_000, maxBytes: 1_000_000 })
    expect(chunks.map((chunk) => [chunk.firstRow, chunk.lastRow])).toEqual([
      [1, 5000],
      [5001, 10000],
      [10001, 12345],
    ])
    expect(chunks.every((chunk) => chunk.rows.length <= 5_000)).toBe(true)
    expect(firstMissingRow(chunks)).toBe(12_346)
  })

  it('caps the UTF-8 bytes of each body', () => {
    const arabic = (row: number) => [`P-${row}`, 'فلتر زيت محرك '.repeat(20), String(row)]
    const chunks = build(5_000, { maxRows: 20_000, maxBytes: 100_000 }, arabic)
    expect(chunks.length).toBeGreaterThan(5)
    let next = 1
    for (const chunk of chunks) {
      const body = chunkBody(chunk)
      expect(chunk.bytes).toBe(new TextEncoder().encode(body).length)
      expect(chunk.bytes).toBeLessThanOrEqual(100_000)
      expect(chunk.firstRow).toBe(next)
      expect(JSON.parse(body).map((row: unknown[]) => row[0])).toEqual(
        Array.from({ length: chunk.rows.length }, (_, index) => chunk.firstRow + index),
      )
      next = chunk.lastRow + 1
    }
    expect(next).toBe(5_001)
  })

  it('fills a chunk up to the byte cap exactly', () => {
    // Each row "[n,"xxxxxxxx"]" is 14 bytes for n < 10; body = 2 + 14k + (k - 1).
    const chunks = build(9, { maxRows: 100, maxBytes: 2 + 14 * 3 + 2 }, () => ['xxxxxxxx'])
    expect(chunks.map((chunk) => chunk.rows.length)).toEqual([3, 3, 3])
    expect(chunks.every((chunk) => chunk.bytes === 46)).toBe(true)
  })

  it('starts from a later row when staging resumes', () => {
    const builder = new ChunkBuilder(1, { maxRows: 2, maxBytes: 1_000 }, { startRow: 41 })
    expect(builder.expectedRow).toBe(41)
    expect(builder.add(41, ['a'])).toBeNull()
    expect(builder.add(42, ['b'])).toBeNull()
    expect(builder.add(43, ['c'])).toMatchObject({ firstRow: 41, lastRow: 42 })
    expect(builder.flush()).toMatchObject({ firstRow: 43, lastRow: 43 })
    expect(builder.flush()).toBeNull()
  })

  it('refuses gaps, wrong widths and rows larger than a chunk', () => {
    const builder = new ChunkBuilder(2, { maxRows: 10, maxBytes: 50 })
    expect(() => builder.add(2, ['a', 'b'])).toThrow(/contiguous/)
    expect(() => builder.add(1, ['a'])).toThrow(/cells/)
    expect(() => builder.add(1, ['a', 'x'.repeat(60)])).toThrow(/exceeds/)
  })

  it('cuts overlong cells and repairs characters jsonb refuses', () => {
    const issues: Array<[ChunkIssue, number, number]> = []
    const builder = new ChunkBuilder(
      3,
      { maxRows: 10, maxBytes: 1_000_000 },
      {
        report: (issue, row, column) => issues.push([issue, row, column]),
      },
    )
    builder.add(1, ['x'.repeat(4_500), 'a\u0000b', `c${String.fromCharCode(0xd800)}`])
    const [row] = JSON.parse(chunkBody(builder.flush()!)) as [number, string, string, string][]
    expect(row![1]).toHaveLength(4_000)
    expect(row![2]).toBe('ab')
    expect(row![3]).toBe('c�')
    expect(issues).toEqual([
      ['cell_truncated', 1, 0],
      ['invalid_characters', 1, 1],
      ['invalid_characters', 1, 2],
    ])
  })
})

describe('sanitizeCell', () => {
  it('counts characters, not UTF-16 units, and never splits a pair', () => {
    const emoji = '😀'.repeat(4_000)
    expect(sanitizeCell(emoji)).toEqual({ value: emoji })
    const cut = sanitizeCell('😀'.repeat(4_001))
    expect(cut.issue).toBe('cell_truncated')
    expect(Array.from(cut.value)).toHaveLength(4_000)
    expect(cut.value.isWellFormed()).toBe(true)
    expect(sanitizeCell('ok')).toEqual({ value: 'ok' })
  })
})

describe('splitting', () => {
  const [chunk] = build(7, { maxRows: 100, maxBytes: 1_000_000 })

  it('halves a chunk into contiguous halves with exact bytes', () => {
    const halves = halveChunk(chunk!)
    expect(halves).not.toBeNull()
    const [first, second] = halves!
    expect([first.firstRow, first.lastRow, second.firstRow, second.lastRow]).toEqual([1, 4, 5, 7])
    for (const half of halves!) {
      expect(half.bytes).toBe(utf8Length(chunkBody(half)))
    }
    expect([...first.rows, ...second.rows]).toEqual(chunk!.rows)
    expect(halveChunk(splitChunk(chunk!, 1)[0]!)).toBeNull()
  })

  it('splits into pieces of at most n rows', () => {
    expect(splitChunk(chunk!, 3).map((piece) => [piece.firstRow, piece.lastRow])).toEqual([
      [1, 3],
      [4, 6],
      [7, 7],
    ])
    expect(splitChunk(chunk!, 100)).toEqual([chunk])
  })
})

describe('firstMissingRow', () => {
  it('finds where staging resumes', () => {
    expect(firstMissingRow([])).toBe(1)
    expect(firstMissingRow([{ firstRow: 1, lastRow: 10 }])).toBe(11)
    expect(
      firstMissingRow([
        { firstRow: 11, lastRow: 20 },
        { firstRow: 1, lastRow: 10 },
        { firstRow: 31, lastRow: 40 },
      ]),
    ).toBe(21)
    expect(firstMissingRow([{ firstRow: 2, lastRow: 10 }])).toBe(1)
  })
})
