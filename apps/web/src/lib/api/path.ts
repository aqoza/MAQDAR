/**
 * Whether a pathname belongs to the REST API (`/api/v1` and everything below it, never
 * `/api/v1x` or `/api/v10`). `src/proxy.ts` returns early for these paths, as a backstop to its
 * matcher: the API authenticates with API keys and never touches the cookie session.
 *
 * Standalone on purpose (no imports), so the proxy bundle does not pull in the contract;
 * `src/proxy.test.ts` checks the prefix equals `API_BASE_PATH` of `resources.ts`.
 */
export const API_V1_PREFIX = '/api/v1'

export function isApiV1Path(pathname: string): boolean {
  return pathname === API_V1_PREFIX || pathname.startsWith(`${API_V1_PREFIX}/`)
}
