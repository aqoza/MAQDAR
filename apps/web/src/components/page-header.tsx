/**
 * Page title, optional description and an optional actions slot (for example the editor-only
 * "New" button of a master-data list), which wraps below the title on narrow screens.
 */
export function PageHeader({
  title,
  description,
  actions,
  help,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  help?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
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
}
