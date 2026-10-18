import { getTranslations } from 'next-intl/server'

export default async function DashboardLoading() {
  const t = await getTranslations('DashboardState')
  return (
    <div
      data-dashboard
      className="dashboard-workspace dashboard-loading"
      role="status"
      aria-label={t('loading')}
    >
      <div className="dashboard-hero">
        <span className="dashboard-skeleton" />
      </div>
      <div className="dashboard-filters dashboard-skeleton" />
      <div className="dashboard-metrics dashboard-skeleton" />
      <div className="dashboard-grid">
        <div className="dashboard-main-column">
          <div className="dashboard-panel dashboard-demand dashboard-skeleton" />
          <div className="dashboard-bottom-grid">
            <div className="dashboard-panel dashboard-locations dashboard-skeleton" />
            <div className="dashboard-panel dashboard-risk dashboard-skeleton" />
          </div>
        </div>
        <div className="dashboard-side-column">
          <div className="dashboard-panel dashboard-insights dashboard-skeleton" />
          <div className="dashboard-information dashboard-skeleton" />
        </div>
      </div>
      <span className="sr-only">{t('loading')}</span>
    </div>
  )
}
