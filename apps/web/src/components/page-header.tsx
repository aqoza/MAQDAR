import { PageHeaderArt, type PageHeaderPattern } from '@/components/page-header-art'

/**
 * Page title, optional description and an optional actions slot (for example the editor-only
 * "New" button of a master-data list), which wraps below the title on narrow screens.
 */
export function PageHeader({
  title,
  description,
  actions,
  help,
  pattern,
  navigation,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  help?: React.ReactNode
  pattern?: PageHeaderPattern
  navigation?: React.ReactNode
}) {
  const heading = (
    <div className="page-heading-row flex flex-wrap items-start justify-between gap-3">
      <div className="page-heading-copy flex min-w-0 flex-col gap-1">
        <h1 className="text-page-title">{title}</h1>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {help || actions ? (
        <div className="page-actions flex max-w-full flex-wrap items-start gap-3">
          {help ? <div className="max-w-sm">{help}</div> : null}
          {actions}
        </div>
      ) : null}
    </div>
  )
  if (!pattern)
    return (
      <>
        {heading}
        {navigation}
      </>
    )
  return (
    <div className="page-banner" data-page-banner={pattern}>
      <PageHeaderArt pattern={pattern} />
      {heading}
      {navigation}
    </div>
  )
}
