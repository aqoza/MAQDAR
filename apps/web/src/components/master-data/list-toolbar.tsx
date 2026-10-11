'use client'

import { SearchIcon, XIcon } from 'lucide-react'
import Form from 'next/form'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

export type ToolbarFilter = {
  param: string
  label: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
}

export type ListToolbarProps = {
  /** The list's path; the form submits a GET to it (next/form navigates client-side). */
  action: string
  searchable: boolean
  q: string
  searchPlaceholder?: string
  /** Current sort, direction and page size, carried through a search (defaults are omitted). */
  hidden: Record<string, string>
  filters: readonly ToolbarFilter[]
  /** Link that clears search and filters, when any is active. */
  clearHref?: string | null
  clearLabel?: string
}

/**
 * Search and filters as a plain GET form: the search submits on Enter (or the button), filters
 * submit on change. The page is not a field, so any change starts again at page 1. No client
 * state: the URL is the state and the server renders the rows.
 */
export function ListToolbar({
  action,
  searchable,
  q,
  searchPlaceholder,
  hidden,
  filters,
  clearHref,
  clearLabel,
}: ListToolbarProps) {
  const t = useTranslations('MasterDataClient')
  if (!searchable && filters.length === 0) return null

  return (
    <Form action={action} className="flex flex-wrap items-end gap-3" role="search">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {searchable ? (
        <div className="flex min-w-60 flex-1 items-center gap-2 sm:max-w-md">
          <label htmlFor="list-search" className="sr-only">
            {t('search')}
          </label>
          <Input
            key={q}
            id="list-search"
            type="search"
            name="q"
            defaultValue={q}
            maxLength={100}
            autoComplete="off"
            placeholder={searchPlaceholder ?? t('searchPlaceholder')}
          />
          <Button type="submit" variant="outline" size="icon" aria-label={t('search')}>
            <SearchIcon />
          </Button>
        </div>
      ) : null}
      {filters.map((filter) => (
        <div key={filter.param} className="flex flex-col gap-1">
          <label htmlFor={`filter-${filter.param}`} className="text-muted-foreground text-xs">
            {filter.label}
          </label>
          <NativeSelect
            key={filter.value}
            id={`filter-${filter.param}`}
            name={filter.param}
            defaultValue={filter.value}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            <NativeSelectOption value="">{t('all')}</NativeSelectOption>
            {filter.options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      ))}
      {clearHref ? (
        <Link
          href={clearHref}
          prefetch={false}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          <XIcon />
          {clearLabel}
        </Link>
      ) : null}
    </Form>
  )
}
