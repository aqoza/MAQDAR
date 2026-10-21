'use client'

import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { BarChart3, Layers, Package, Search, ShieldCheck, TrendingUp } from 'lucide-react'
import styles from './forecast-workspace.module.css'

const icons = [Search, BarChart3, ShieldCheck, Package, TrendingUp, Layers]

export function ForecastTabs({
  label,
  tabs,
  panels,
  header,
  initialTab,
  navigationKey = '',
}: {
  label: string
  tabs: { key: string; label: string }[]
  panels: ReactNode[]
  header?: ReactNode
  initialTab?: string
  navigationKey?: string
}) {
  const id = useId()
  const initialIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === initialTab),
  )
  const [view, setView] = useState({ selected: initialIndex, source: navigationKey })
  // Local tab switches keep mounted form drafts. A new URL restores its requested tab,
  // including quality search, pagination and browser back/forward navigation.
  const selected = view.source === navigationKey ? view.selected : initialIndex
  const setSelected = (index: number) => setView({ selected: index, source: navigationKey })

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = (index + (rtl ? -1 : 1) + tabs.length) % tabs.length
        break
      case 'ArrowLeft':
        next = (index + (rtl ? 1 : -1) + tabs.length) % tabs.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = tabs.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    setSelected(next)
    document.getElementById(`${id}-tab-${tabs[next].key}`)?.focus()
  }

  const navigation = (
    <div className={styles.workflows} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const Icon = icons[index]
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.key}`}
            aria-controls={`${id}-panel-${tab.key}`}
            aria-selected={selected === index}
            tabIndex={selected === index ? 0 : -1}
            className={`${styles.workflow} ${selected === index ? styles.selected : ''}`}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <Icon aria-hidden="true" />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
  return (
    <>
      {header ? (
        <div className="page-banner" data-page-banner="forecasts">
          {header}
          {navigation}
        </div>
      ) : (
        navigation
      )}
      {tabs.map((tab, index) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${id}-panel-${tab.key}`}
          aria-labelledby={`${id}-tab-${tab.key}`}
          hidden={selected !== index}
          tabIndex={0}
        >
          {panels[index]}
        </div>
      ))}
    </>
  )
}
