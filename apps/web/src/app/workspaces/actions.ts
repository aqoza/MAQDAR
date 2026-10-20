'use server'
import { redirect } from 'next/navigation'
import { requestSite } from '@/lib/workspaces/request'

/** The user supplies a slug, never a redirect URL. Reserved/unknown slugs cannot redirect. */
export async function findWorkspace(
  _previous: { error: boolean },
  formData: FormData,
): Promise<{ error: boolean }> {
  const site = await requestSite()
  if (
    String(formData.get('workspace') ?? '')
      .trim()
      .toLowerCase() !== 'ote'
  )
    return { error: true }
  const origin = new URL(site.origin)
  const target =
    origin.hostname === 'localhost'
      ? `${origin.protocol}//ote.localhost${origin.port ? `:${origin.port}` : ''}`
      : 'https://ote.zeespare.com'
  redirect(`${target}/login`)
}
