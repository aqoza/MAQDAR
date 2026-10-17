import { getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { isAdminRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import type { EntityName } from '@/lib/imports/contract'

export default async function AuditPage() {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!context.role || !isAdminRole(context.role)) notFound()
  const t = await getTranslations('Audit')
  const entityName = await getTranslations('ImportsClient.entities')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('audit_log')
    .select('id,occurred_at,actor_user_id,table_name,operation,row_count,record_id')
    .eq('organization_id', context.active.id)
    .order('occurred_at', { ascending: false })
    .order('id')
    .limit(100)
  if (error) throw new Error('Audit data unavailable')
  return (
    <div className="space-y-4">
      <h1 className="text-page-title">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      <div className="workspace-table overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              {(['time', 'actor', 'entity', 'operation', 'rows'] as const).map((key) => (
                <th key={key} className="p-2 text-start">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="whitespace-nowrap p-2">{row.occurred_at}</td>
                <td className="p-2 font-mono text-xs">{row.actor_user_id ?? t('system')}</td>
                <td className="p-2">{entityName(row.table_name as EntityName)}</td>
                <td className="p-2">{t(row.operation as 'INSERT' | 'UPDATE' | 'DELETE')}</td>
                <td className="p-2 tabular-nums">{row.row_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data?.length && <p>{t('empty')}</p>}
    </div>
  )
}
