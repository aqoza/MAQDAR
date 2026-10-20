'use server'
import { redirect } from 'next/navigation'
import { isWorkspaceSlug } from '@/lib/workspaces/hosts'
import { requestSite } from '@/lib/workspaces/request'

/** The user supplies a slug, never a redirect URL. Reserved/unknown slugs cannot redirect. */
export async function findWorkspace(
  _previous: { error: boolean },
  formData: FormData,
): Promise<{ error: boolean }> {
  const site = await requestSite()
  const slug = String(formData.get('workspace') ?? '')
    .trim()
    .toLowerCase()
  if (!isWorkspaceSlug(slug)) return { error: true }
  const origin = new URL(site.origin)
  const target =
    origin.hostname === 'localhost'
      ? `${origin.protocol}//${slug}.localhost${origin.port ? `:${origin.port}` : ''}`
      : `https://${slug}.zeespare.com`
  redirect(`${target}/login`)
}
