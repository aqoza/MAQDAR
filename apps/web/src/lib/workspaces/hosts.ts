/** Explicitly provisioned domains only. DNS and a hostname never confer membership. */
export type Workspace = { slug: string; name: string; organizationId: string | null }
export type Site = {
  kind: 'public' | 'shared' | 'workspace' | 'unknown'
  origin: string
  workspace: Workspace | null
}

const PUBLIC_HOSTS = new Set(['zeespare.com', 'www.zeespare.com'])
const SHARED_HOSTS = new Set([
  'maqdar.org',
  'zeespare-web.aqozatechnologies.workers.dev',
  'maqdar-web.aqozatechnologies.workers.dev',
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Reject ambiguous authorities rather than normalizing attacker-controlled Host values. */
export function parseHost(value: string | null): string | null {
  if (!value || /[\s,/@\\?#%]/.test(value)) return null
  try {
    const url = new URL(`https://${value}`)
    return url.host.toLowerCase()
  } catch {
    return null
  }
}

export function resolveSite(
  host: string | null,
  configuredSite = process.env.NEXT_PUBLIC_SITE_URL,
  oteId = process.env.OTE_ORGANIZATION_ID,
): Site {
  const authority = parseHost(host)
  const unknown: Site = { kind: 'unknown', origin: 'https://zeespare.com', workspace: null }
  if (!authority) return unknown
  const workspace: Workspace = {
    slug: 'ote',
    name: 'OTEGROUP',
    // A missing deployment binding must deny access, never select an arbitrary organization.
    organizationId: oteId && UUID.test(oteId) ? oteId : null,
  }
  if (authority === 'ote.zeespare.com') {
    return { kind: 'workspace', origin: `https://${authority}`, workspace }
  }
  if (PUBLIC_HOSTS.has(authority)) {
    return { kind: 'public', origin: `https://${authority}`, workspace: null }
  }
  if (SHARED_HOSTS.has(authority)) {
    return { kind: 'shared', origin: `https://${authority}`, workspace: null }
  }
  // Local aliases are enabled only for a deployment explicitly configured for loopback.
  try {
    const configured = new URL(configuredSite ?? '')
    if (['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname)) {
      const port = configured.port ? `:${configured.port}` : ''
      if (authority === `ote.localhost${port}`) {
        return { kind: 'workspace', origin: `${configured.protocol}//${authority}`, workspace }
      }
      if (authority === configured.host) {
        return { kind: 'public', origin: configured.origin, workspace: null }
      }
    }
  } catch {
    // Invalid configuration cannot expand the trusted-host set.
  }
  return unknown
}

export function workspaceAllows(workspace: Workspace | null, organizationId: string): boolean {
  return workspace === null || workspace.organizationId === organizationId
}
