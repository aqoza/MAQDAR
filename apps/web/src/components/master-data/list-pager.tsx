import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination'
import {
  PAGE_SIZES,
  lastPage,
  listHref,
  type ListParams,
  type ListSpec,
} from '@/lib/master-data/list-params'
import { cn } from '@/lib/utils'

type PagerProps = {
  basePath: string
  spec: ListSpec
  params: ListParams
  total: number
}

/**
 * Total, "Page X of Y", rows-per-page links and first/previous/next/last links. Links never
 * prefetch: each prefetch would be a full server render of another page.
 */
export async function ListPager({ basePath, spec, params, total }: PagerProps) {
  const t = await getTranslations('MasterData.list')
  const pages = lastPage(total, params.size)
  const page = Math.min(params.page, pages)
  const pageLink = (target: number) => listHref(basePath, spec, params, { page: target })

  const steps: Array<{ label: string; icon: LucideIcon; target: number; enabled: boolean }> = [
    { label: t('first'), icon: ChevronsLeftIcon, target: 1, enabled: page > 1 },
    { label: t('previous'), icon: ChevronLeftIcon, target: page - 1, enabled: page > 1 },
    { label: t('next'), icon: ChevronRightIcon, target: page + 1, enabled: page < pages },
    { label: t('last'), icon: ChevronsRightIcon, target: pages, enabled: page < pages },
  ]

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground" aria-live="polite">
        {t('total', { count: total })} · {t('page', { page, pages })}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <nav aria-label={t('rowsPerPage')} className="flex items-center gap-1">
          <span className="text-muted-foreground me-1 text-xs" aria-hidden="true">
            {t('rowsPerPage')}
          </span>
          {PAGE_SIZES.map((size) => {
            const active = size === params.size
            return (
              <Link
                key={size}
                href={listHref(basePath, spec, params, { size })}
                prefetch={false}
                aria-current={active ? 'true' : undefined}
                className={buttonVariants({ variant: active ? 'outline' : 'ghost', size: 'xs' })}
              >
                {size}
              </Link>
            )
          })}
        </nav>
        <Pagination aria-label={t('pagination')} className="mx-0 w-auto">
          <PaginationContent>
            {steps.map((step) => {
              const Icon = step.icon
              const classes = cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))
              return (
                <PaginationItem key={step.label}>
                  {step.enabled ? (
                    <Link
                      href={pageLink(step.target)}
                      prefetch={false}
                      aria-label={step.label}
                      title={step.label}
                      className={classes}
                    >
                      <Icon className="rtl:rotate-180" aria-hidden="true" />
                    </Link>
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn(classes, 'pointer-events-none opacity-40')}
                    >
                      <Icon className="rtl:rotate-180" aria-hidden="true" />
                    </span>
                  )}
                </PaginationItem>
              )
            })}
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  )
}
