const DEFAULT_PATH = '/dashboard'

/** Only same-origin absolute paths are allowed as post-login destinations. */
export function safeNextPath(candidate: string | null | undefined): string {
  if (!candidate) return DEFAULT_PATH
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return DEFAULT_PATH
  }
  return candidate
}
