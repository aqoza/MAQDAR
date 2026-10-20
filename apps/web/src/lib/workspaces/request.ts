import 'server-only'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { resolveSite } from './hosts'

/** Cloudflare preserves Host. Forwarded headers are never used to select a tenant. */
export const requestSite = cache(async () => {
  const requestHeaders = await headers()
  const host = requestHeaders.get('host')
  if (requestHeaders.get('x-forwarded-host') && requestHeaders.get('x-forwarded-host') !== host)
    notFound()
  const site = resolveSite(host)
  if (site.kind === 'unknown') notFound()
  return site
})
