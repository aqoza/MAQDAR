/** The email template appends token_hash/type to these explicitly allow-listed paths. */
export function emailReturnPath(destination = '/dashboard'): string {
  if (destination === '/dashboard') return '/auth/email/dashboard'
  if (/^\/(?:invitations|supplier-portal)\/[0-9a-f-]{36}$/i.test(destination))
    return `/auth/email${destination}`
  throw new Error('Unsupported email destination')
}

export function emailDestination(parts: readonly string[]): string | null {
  if (parts.length === 1 && parts[0] === 'dashboard') return '/dashboard'
  if (
    parts.length === 2 &&
    (parts[0] === 'invitations' || parts[0] === 'supplier-portal') &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[1] ?? '')
  ) {
    return `/${parts[0]}/${parts[1]}`
  }
  return null
}
