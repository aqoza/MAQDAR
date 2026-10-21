'use client'

import { useRef, useState } from 'react'
import Form from 'next/form'
import Link from 'next/link'
import { Search, X } from 'lucide-react'
import { LocationCodeInput } from '@/components/master-data/location-code-input'
import { ForecastFilterForm } from '@/components/forecast-filter-form'
import { PAGE_SIZES, type ListParams } from '@/lib/master-data/list-params'
import { forecastQualityResetHref } from '@/lib/forecast-quality-navigation'
import styles from './forecast-quality.module.css'

type Option = { value: string; label: string }
type FilterLabels = {
  search: string
  searchPlaceholder: string
  clearSearch: string
  location: string
  locationPlaceholder: string
  result: string
  all: string
  filter: string
  reset: string
  searchScope: string
  moreFilters: string
  activeFilters: string
  model: string
  method: string
}

export function ForecastQualityFilters({
  params,
  embedded,
  labels,
  statuses,
  models,
  methods,
}: {
  params: ListParams
  embedded: boolean
  labels: FilterLabels
  statuses: Option[]
  models: Option[]
  methods: Option[]
}) {
  const [search, setSearch] = useState(params.q)
  const searchInput = useRef<HTMLInputElement>(null)
  const advancedCount =
    Number(Boolean(params.filters.model)) + Number(Boolean(params.filters.method))

  return (
    <ForecastFilterForm onReset={() => setSearch('')}>
      <Form action={embedded ? '/forecasts' : '/forecasts/quality'} className={styles.filters}>
        {embedded && <input type="hidden" name="tab" value="quality" />}
        <input type="hidden" name="size" value={params.size} />
        <input type="hidden" name="dir" value={params.dir} />
        <div className={styles.primaryFilters}>
          <div className={styles.field}>
            <label htmlFor="quality-item-search">{labels.search}</label>
            <span className={styles.searchBox}>
              <Search aria-hidden="true" />
              <input
                id="quality-item-search"
                ref={searchInput}
                name="q"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                maxLength={100}
                placeholder={labels.searchPlaceholder}
                autoComplete="off"
                aria-describedby="quality-search-scope"
              />
              {search && (
                <button
                  type="button"
                  className={styles.clear}
                  aria-label={labels.clearSearch}
                  onClick={() => {
                    setSearch('')
                    searchInput.current?.focus()
                  }}
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
          <div className={styles.field}>
            <label htmlFor="quality-location">{labels.location}</label>
            <LocationCodeInput
              id="quality-location"
              name="location"
              defaultValue={params.filters.location ?? ''}
              includeInactive
              placeholder={labels.locationPlaceholder}
              aria-describedby="quality-search-scope"
            />
          </div>
          <SelectField
            name="status"
            label={labels.result}
            defaultValue={params.filters.status ?? ''}
            allLabel={labels.all}
            options={statuses}
          />
          <button className={styles.apply}>{labels.filter}</button>
          <Link
            data-forecast-filter-reset
            className={styles.reset}
            href={forecastQualityResetHref(embedded)}
          >
            {labels.reset}
          </Link>
        </div>
        <p id="quality-search-scope" className="mt-2 text-xs text-muted-foreground">
          {labels.searchScope}
        </p>
        <details
          className={styles.advanced}
          open={advancedCount > 0 ? true : undefined}
          data-testid="quality-more-filters"
        >
          <summary>
            {labels.moreFilters}
            {advancedCount > 0 && <span className="ms-2">{labels.activeFilters}</span>}
          </summary>
          <div className={styles.advancedFields}>
            <SelectField
              name="model"
              label={labels.model}
              defaultValue={params.filters.model ?? ''}
              allLabel={labels.all}
              options={models}
            />
            <SelectField
              name="method"
              label={labels.method}
              defaultValue={params.filters.method ?? ''}
              allLabel={labels.all}
              options={methods}
            />
          </div>
        </details>
      </Form>
    </ForecastFilterForm>
  )
}

function SelectField({
  name,
  label,
  defaultValue,
  allLabel,
  options,
}: {
  name: string
  label: string
  defaultValue: string
  allLabel: string
  options: Option[]
}) {
  return (
    <label className={styles.field}>
      {label}
      <select name={name} defaultValue={defaultValue} className={styles.input}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Display changes submit the applied filters, independently of unsaved filter edits. */
export function ForecastQualityDisplay({
  params,
  embedded,
  labels,
}: {
  params: ListParams
  embedded: boolean
  labels: {
    displaySettings: string
    size: string
    order: string
    newest: string
    oldest: string
    updateDisplay: string
  }
}) {
  return (
    <Form
      action={embedded ? '/forecasts' : '/forecasts/quality'}
      className={styles.displaySettings}
      aria-label={labels.displaySettings}
    >
      {embedded && <input type="hidden" name="tab" value="quality" />}
      <input type="hidden" name="q" value={params.q} />
      {Object.entries(params.filters).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor="quality-page-size" className="text-xs text-muted-foreground">
        {labels.size}
      </label>
      <select
        id="quality-page-size"
        name="size"
        defaultValue={params.size}
        className={styles.input}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {PAGE_SIZES.map((size) => (
          <option key={size}>{size}</option>
        ))}
      </select>
      <label htmlFor="quality-order" className="sr-only">
        {labels.order}
      </label>
      <select
        id="quality-order"
        name="dir"
        defaultValue={params.dir}
        className={styles.input}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="desc">{labels.newest}</option>
        <option value="asc">{labels.oldest}</option>
      </select>
      <noscript>
        <button className={styles.reset}>{labels.updateDisplay}</button>
      </noscript>
    </Form>
  )
}
