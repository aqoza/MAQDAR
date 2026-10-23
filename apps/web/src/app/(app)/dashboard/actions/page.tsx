import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { DashboardNav } from '@/components/dashboard-nav'
import { HelpDisclosure } from '@/components/help-disclosure'
import { PlannerActionCentre } from '@/components/planner-action-centre'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { loadPlannerActions } from '@/lib/planner-actions-data'

export async function generateMetadata() {
  const t = await getTranslations('PlannerActions')
  return { title: t('title') }
}

export default async function PlannerActionsPage() {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [t, db] = await Promise.all([getTranslations('PlannerActions'), createClient()])
  const data = await loadPlannerActions(db, context.active.id)
  return (
    <div className="min-w-0 space-y-3">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        description={t('subtitle')}
        navigation={<DashboardNav current="actions" />}
        help={
          <HelpDisclosure label={t('about')}>
            <p>{t('coverage')}</p>
            <p>{t('readOnly')}</p>
          </HelpDisclosure>
        }
      />
      <PlannerActionCentre key={context.active.id} data={data} />
    </div>
  )
}
