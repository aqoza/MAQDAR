'use client'

import { useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { PlanningRefresh } from '@/components/planning-controls'
import styles from '@/components/forecast-workspace.module.css'

type Run = {
  id: string
  location: string
  code: string
  kind: string
  status: string
  statusLabel: string
  window: string
  requested: string
  requestedAt: string
  inspectLabel: string
  evidence: ReactNode
}
type Labels = Record<
  | 'recent'
  | 'details'
  | 'search'
  | 'status'
  | 'allStatuses'
  | 'location'
  | 'window'
  | 'requested'
  | 'empty'
  | 'noMatch'
  | 'reset'
  | 'selectRun'
  | 'refresh'
  | 'historyNote',
  string
>

/** Filters only the server-authorized latest 20 runs; evidence stays server-rendered. */
export function ForecastRunBrowser({
  runs,
  active,
  statuses,
  labels,
}: {
  runs: Run[]
  active: boolean
  statuses: { value: string; label: string }[]
  labels: Labels
}) {
  const initialView = { search: '', status: 'all', id: runs[0]?.id, latest: runs[0]?.id }
  const [savedView, setView] = useState(initialView)
  // A newly queued run must remain visible even if the previous view was filtered.
  const view = savedView.latest === runs[0]?.id ? savedView : initialView
  const { search, status } = view
  const query = search.trim().toLocaleLowerCase()
  const filtered = runs.filter(
    (run) =>
      (status === 'all' || run.status === status) &&
      `${run.location} ${run.code} ${run.kind} ${run.id}`.toLocaleLowerCase().includes(query),
  )
  // A newly queued run becomes selected after the server refresh; ordinary refreshes keep selection.
  const preferred = view.id
  const selected = filtered.find((run) => run.id === preferred) ?? filtered[0]
  return (
    <div className={styles.columns}>
      <section className={styles.runsPanel} aria-labelledby="run-history-title">
        <div className={styles.panelHeading}>
          <h2 id="run-history-title" className="text-section-title">
            {labels.recent}
          </h2>
          <div className={styles.filters}>
            <label className={styles.search}>
              <span className="sr-only">{labels.search}</span>
              <Search aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setView({ ...view, search: event.target.value })}
                placeholder={labels.search}
              />
            </label>
            <label>
              <span className="sr-only">{labels.status}</span>
              <select
                value={status}
                onChange={(event) => setView({ ...view, status: event.target.value })}
              >
                <option value="all">{labels.allStatuses}</option>
                {statuses.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <PlanningRefresh active={active} label={labels.refresh} compact />
          </div>
        </div>
        {filtered.length ? (
          <div className={styles.tableScroll} role="region" aria-label={labels.recent} tabIndex={0}>
            <table aria-label={labels.recent}>
              <thead>
                <tr>
                  <th scope="col">{labels.location}</th>
                  <th scope="col">{labels.window}</th>
                  <th scope="col">{labels.status}</th>
                  <th scope="col">{labels.requested}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((run) => (
                  <tr key={run.id} data-selected={run.id === selected?.id}>
                    <td>
                      <button
                        className={styles.runName}
                        aria-pressed={run.id === selected?.id}
                        aria-label={run.inspectLabel}
                        aria-controls="run-detail"
                        onClick={() => setView({ ...view, id: run.id })}
                      >
                        {run.location}
                      </button>
                      <span className={styles.runKind}>{run.kind}</span>
                    </td>
                    <td>{run.window}</td>
                    <td>
                      <span className={styles.statusBadge} data-status={run.status}>
                        {run.statusLabel}
                      </span>
                    </td>
                    <td>
                      <time dateTime={run.requestedAt}>{run.requested}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty} role="status">
            <p>{runs.length ? labels.noMatch : labels.empty}</p>
          </div>
        )}
        <div className={styles.tableFooter}>
          <p>{labels.historyNote}</p>
          {(search || status !== 'all') && (
            <button
              onClick={() => {
                setView({ ...view, search: '', status: 'all' })
              }}
            >
              {labels.reset}
            </button>
          )}
        </div>
      </section>
      <section className={styles.detailPanel} aria-labelledby="run-detail-title">
        <div className={styles.panelHeading}>
          <h2 id="run-detail-title" className="text-section-title">
            {labels.details}
          </h2>
        </div>
        <div id="run-detail" className={styles.detailBody}>
          {selected ? (
            <>
              <span className={styles.statusBadge} data-status={selected.status}>
                {selected.statusLabel}
              </span>
              <h3 className="text-subsection-title">{selected.location}</h3>
              <p className={styles.runMeta}>
                {selected.kind} · {selected.code}
              </p>
              <dl className={styles.historyWindow}>
                <dt>{labels.window}</dt>
                <dd>{selected.window}</dd>
              </dl>
              {selected.evidence}
            </>
          ) : (
            <p className={styles.empty}>{runs.length ? labels.selectRun : labels.empty}</p>
          )}
        </div>
      </section>
    </div>
  )
}
