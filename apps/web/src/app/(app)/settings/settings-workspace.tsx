'use client'

import {
  Building2,
  ChevronDown,
  KeyRound,
  Languages,
  LockKeyhole,
  Mail,
  Search,
  SlidersHorizontal,
  UsersRound,
  X,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import styles from './settings-workspace.module.css'

const icons = {
  'policy-explainer': SlidersHorizontal,
  organization: Building2,
  preferences: SlidersHorizontal,
  members: UsersRound,
  invitations: Mail,
  'api-keys': KeyRound,
  password: LockKeyhole,
  language: Languages,
}
const groups = ['workspace', 'access', 'account'] as const

export type SettingsSection = {
  key: keyof typeof icons
  group: (typeof groups)[number]
  label: string
  searchText: string
  panel: ReactNode
}

/** Panels come from the server and remain mounted, preserving form/action state between sections. */
export function SettingsWorkspace({ sections }: { sections: SettingsSection[] }) {
  const t = useTranslations('Settings.navigation')
  const id = useId()
  const params = useSearchParams()
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuToggle = useRef<HTMLButtonElement>(null)
  const selected = sections.find((section) => section.key === params.get('section')) ?? sections[0]
  const filter = query.trim().normalize('NFKC').toLocaleLowerCase()
  const visible = sections.filter((section) =>
    `${section.label} ${section.searchText}`.normalize('NFKC').toLocaleLowerCase().includes(filter),
  )
  const tabbable = visible.find((section) => section.key === selected.key) ?? visible[0]
  const SelectedIcon = icons[selected.key]

  function selectSection(key: SettingsSection['key'], closeMenu: boolean) {
    // Consecutive key events can arrive before useSearchParams reflects the last history push.
    const next = new URLSearchParams(window.location.search)
    const current = sections.find((section) => section.key === next.get('section')) ?? sections[0]
    if (key !== current.key) {
      next.set('section', key)
      window.history.pushState(null, '', `?${next.toString()}`)
    }
    if (closeMenu) {
      setMenuOpen(false)
      if (window.matchMedia('(width < 1100px)').matches) menuToggle.current?.focus()
    }
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % visible.length
        break
      case 'ArrowUp':
        next = (index - 1 + visible.length) % visible.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = visible.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    selectSection(visible[next].key, false)
    document.getElementById(`${id}-tab-${visible[next].key}`)?.focus()
  }

  return (
    <div className={styles.workspace} data-settings-workspace>
      <aside className={styles.menu}>
        <button
          ref={menuToggle}
          type="button"
          className={styles.menuToggle}
          aria-label={t('chooseSection', { section: selected.label })}
          aria-expanded={menuOpen}
          aria-controls={`${id}-menu`}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <SelectedIcon aria-hidden="true" />
          <span>{selected.label}</span>
          <ChevronDown aria-hidden="true" />
        </button>
        <div id={`${id}-menu`} className={styles.menuContents} data-open={menuOpen}>
          <div className={styles.search}>
            <Search aria-hidden="true" />
            <Input
              type="search"
              aria-label={t('searchLabel')}
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('')
                if (event.key === 'Enter' && visible[0]) {
                  event.preventDefault()
                  selectSection(visible[0].key, true)
                }
              }}
            />
            {query ? (
              <button type="button" aria-label={t('clearSearch')} onClick={() => setQuery('')}>
                <X aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div role="tablist" aria-label={t('label')} aria-orientation="vertical">
            {groups.map((group) => {
              const entries = visible.filter((section) => section.group === group)
              if (entries.length === 0) return null
              return (
                <div
                  key={group}
                  className={styles.group}
                  role="group"
                  aria-labelledby={`${id}-${group}`}
                >
                  <p id={`${id}-${group}`} className={styles.groupLabel}>
                    {t(`groups.${group}`)}
                  </p>
                  {entries.map((section) => {
                    const Icon = icons[section.key]
                    return (
                      <button
                        key={section.key}
                        type="button"
                        role="tab"
                        id={`${id}-tab-${section.key}`}
                        aria-controls={`${id}-panel-${section.key}`}
                        aria-selected={selected.key === section.key}
                        tabIndex={tabbable?.key === section.key ? 0 : -1}
                        className={styles.sectionLink}
                        data-settings-section={section.key}
                        onClick={() => selectSection(section.key, true)}
                        onKeyDown={(event) => onTabKeyDown(event, visible.indexOf(section))}
                      >
                        <Icon aria-hidden="true" />
                        <span>{section.label}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {visible.length === 0 ? (
            <p className={styles.noResults} role="status">
              {t('noResults')}
            </p>
          ) : null}
        </div>
      </aside>
      <div className={styles.panels}>
        {sections.map((section) => (
          <div
            key={section.key}
            role="tabpanel"
            id={`${id}-panel-${section.key}`}
            aria-label={section.label}
            className={styles.panel}
            hidden={selected.key !== section.key}
            tabIndex={0}
          >
            {section.panel}
          </div>
        ))}
      </div>
    </div>
  )
}
