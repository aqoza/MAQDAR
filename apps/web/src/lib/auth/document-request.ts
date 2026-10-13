/**
 * Whether a request is a top-level document navigation (a link the user followed or a page
 * typed into the address bar) rather than a fetch. Browsers send `Sec-Fetch-Mode: navigate` on
 * navigations; without Fetch Metadata, an `Accept` that asks for HTML counts. A signed-out
 * navigation to an API download (error report, original, template) is then sent to sign in,
 * while fetches keep getting a JSON 401 they can handle. Pure, so Vitest covers it.
 */
export function isDocumentNavigation(headers: Pick<Headers, 'get'>): boolean {
  const mode = headers.get('sec-fetch-mode')
  if (mode) return mode === 'navigate'
  return (headers.get('accept') ?? '').toLowerCase().includes('text/html')
}
