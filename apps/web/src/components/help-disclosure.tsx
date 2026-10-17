import { useTranslations } from 'next-intl'

/** Background explanation only: keep action requirements, errors and warnings outside. */
export function HelpDisclosure({ children, label }: { children: React.ReactNode; label?: string }) {
  const t = useTranslations('Common')
  return (
    <details className="help-disclosure text-sm">
      <summary className="w-fit cursor-pointer rounded-sm py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {label ?? t('methodDetails')}
      </summary>
      <div className="max-w-prose space-y-2 pb-2 text-muted-foreground">{children}</div>
    </details>
  )
}
