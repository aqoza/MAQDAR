/**
 * Search folding, mirroring `app.normalize_search(text)` in the master_data_completion migration
 * character for character. The database stores `search_text = app.normalize_search(code || ' ' ||
 * name_en || ' ' || name_ar …)`; the web app folds the query the same way and matches each token
 * with LIKE. Shared fixtures (search.test.ts and the pgTAP test) keep the two in step: change both
 * or neither (changing the SQL requires rewriting every search_text column).
 *
 * Steps, in the SQL order: NFKC, lower case (the database uses ICU, like String#toLowerCase),
 * delete Arabic diacritics U+064B–U+065F and U+0670, translate alef variants to ا, ى to ي, ة to ه,
 * Arabic-Indic and extended digits to ASCII, delete tatweel, then turn every run of characters
 * that is not a-z, 0-9, U+00E0–U+024F or U+0621–U+064A into one space and trim.
 *
 * Pure module with no imports, so Vitest can load it.
 */

// Code points are spelled out: combining marks and Arabic letters are invisible or reorder when
// written literally (and Prettier turns \u escapes back into literal characters).
const char = (codePoint: number) => String.fromCodePoint(codePoint)
const range = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, index) => char(first + index))

const ALEF = char(0x0627)
const YEH = char(0x064a)
const HEH = char(0x0647)

/** Arabic marks U+064B–U+065F (fathatan … ) and superscript alef U+0670. */
const DIACRITICS = new RegExp(`[${char(0x064b)}-${char(0x065f)}${char(0x0670)}]`, 'g')

// translate(…, 'أإآٱىة٠…٩۰…۹ـ', 'اااايه0…90…9'): tatweel (U+0640), the last "from" character,
// has no counterpart, so translate() deletes it.
const TRANSLATION = new Map<string, string>([
  [char(0x0623), ALEF], // alef with hamza above
  [char(0x0625), ALEF], // alef with hamza below
  [char(0x0622), ALEF], // alef with madda above
  [char(0x0671), ALEF], // alef wasla
  [char(0x0649), YEH], // alef maksura
  [char(0x0629), HEH], // teh marbuta
  ...range(0x0660, 0x0669).map((digit, index): [string, string] => [digit, String(index)]),
  ...range(0x06f0, 0x06f9).map((digit, index): [string, string] => [digit, String(index)]),
  [char(0x0640), ''], // tatweel
])

/**
 * Everything except a-z, 0-9, à … ɏ (U+00E0–U+024F, accented Latin) and the Arabic letters
 * hamza … yeh (U+0621–U+064A).
 */
const SEPARATORS = new RegExp(
  `[^a-z0-9${char(0x00e0)}-${char(0x024f)}${char(0x0621)}-${char(0x064a)}]+`,
  'g',
)

/** The TypeScript twin of app.normalize_search(). */
export function normalizeSearch(value: string | null | undefined): string {
  const lowered = (value ?? '').normalize('NFKC').toLowerCase().replace(DIACRITICS, '')
  let translated = ''
  for (const character of lowered) {
    const replacement = TRANSLATION.get(character)
    translated += replacement === undefined ? character : replacement
  }
  return translated.replace(SEPARATORS, ' ').trim()
}

/** At most this many tokens are AND-ed together; more would only slow the filter scan down. */
export const MAX_SEARCH_TOKENS = 5

/**
 * The query's normalized tokens, de-duplicated, in order. They contain only letters and digits
 * (never `%`, `_`, `\` or `*`), so `%token%` needs no escaping and survives PostgREST's `*` rewrite.
 */
export function searchTokens(query: string | null | undefined, max = MAX_SEARCH_TOKENS): string[] {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean)
  return [...new Set(tokens)].slice(0, max)
}

/** LIKE patterns for the tokens, for `.like('search_text', pattern)` per token. */
export function searchPatterns(
  query: string | null | undefined,
  max = MAX_SEARCH_TOKENS,
): string[] {
  return searchTokens(query, max).map((token) => `%${token}%`)
}
