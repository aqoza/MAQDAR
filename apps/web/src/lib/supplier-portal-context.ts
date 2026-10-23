import 'server-only'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSessionClaims } from '@/lib/auth/session'
import { requestSite } from '@/lib/workspaces/request'
import { workspaceAllows } from '@/lib/workspaces/hosts'
import { supplierPortalsSchema } from './supplier-portal'
export const getSupplierPortals = cache(async () => {
  if (!(await getSessionClaims())) return []
  const db = await createClient()
  const { data, error } = await db.rpc('my_supplier_portals')
  if (error) throw new Error('Supplier access unavailable')
  const { workspace } = await requestSite()
  return supplierPortalsSchema
    .parse(data)
    .filter((g) => workspaceAllows(workspace, g.organization_id))
})
export async function requireSupplierPortal(id: string) {
  const grant = (await getSupplierPortals()).find((g) => g.id === id)
  if (!grant) notFound()
  return grant
}
