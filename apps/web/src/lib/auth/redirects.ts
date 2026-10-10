const DEFAULT_PATH = '/dashboard'
const PROBE_ORIGIN = 'http://maqdar.invalid'
// Browsers strip ASCII tab and newline from URLs and treat backslashes like slashes, so
// "/\t/evil.example" or "/\\evil.example" would leave the site. Reject them outright.
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\\]/

/** Only same-origin absolute paths are allowed as post-login destinations. */
export function safeNextPath(candidate: string | null | undefined): string {
  if (!candidate) return DEFAULT_PATH
  if (
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    UNSAFE_CHARACTERS.test(candidate)
  ) {
    return DEFAULT_PATH
  }
  // Resolve against a probe origin the way a browser would and keep only the normalised path and
  // query; anything that resolves elsewhere is not a same-origin path.
  const url = parseUrl(candidate, PROBE_ORIGIN)
  if (!url || url.origin !== PROBE_ORIGIN) return DEFAULT_PATH
  const path = `${url.pathname}${url.search}`
  return path.startsWith('//') ? DEFAULT_PATH : path
}

/**
 * Like safeNextPath, but also accepts an absolute URL whose origin is `origin`, reduced to its
 * path and query. The e-mail templates put {{ .RedirectTo }} into `next`, which Supabase renders
 * as an absolute URL; another origin, an opaque scheme or an unparsable value falls back to the
 * dashboard, and the extracted path is re-checked so `https://site//evil` cannot slip through.
 */
export function safeDestination(candidate: string | null | undefined, origin: string): string {
  if (!candidate) return DEFAULT_PATH
  if (candidate.startsWith('/')) return safeNextPath(candidate)
  const url = parseUrl(candidate)
  const expected = parseUrl(origin)
  if (!url || !expected || url.origin === 'null' || url.origin !== expected.origin) {
    return DEFAULT_PATH
  }
  return safeNextPath(`${url.pathname}${url.search}`)
}

function parseUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}
