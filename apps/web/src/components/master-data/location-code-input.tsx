'use client'

import { useEffect, useRef, useState } from 'react'
import { Autocomplete } from '@base-ui/react/autocomplete'
import { MapPin, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { displayName } from '@/lib/format'
import type { LocationCodeOption } from '@/lib/master-data/location-codes'
import styles from './location-code-input.module.css'

export type LocationCodeInputProps = {
  id?: string
  name?: string
  defaultValue?: string
  required?: boolean
  disabled?: boolean
  includeInactive?: boolean
  placeholder?: string
  className?: string
  'aria-describedby'?: string
  onValueChange?: (code: string) => void
}

type LookupState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

const DEBOUNCE_MS = 250
const REQUEST_TIMEOUT_MS = 10_000
// Mirrors location codeSchema; HTML patterns use Unicode-v, which requires an escaped hyphen.
const LOCATION_CODE_PATTERN = String.raw`[A-Za-z0-9][A-Za-z0-9._\-]{0,63}`

function isLocationOption(value: unknown): value is LocationCodeOption {
  if (!value || typeof value !== 'object') return false
  const option = value as Record<string, unknown>
  return (
    typeof option.code === 'string' &&
    typeof option.name_en === 'string' &&
    (option.name_ar === null || typeof option.name_ar === 'string') &&
    typeof option.is_active === 'boolean'
  )
}

/**
 * Accessible suggestions fill the exact location code while preserving manually entered historical
 * codes. The server still resolves and authorizes readiness submissions; this control adds no
 * authority and never creates a browser Supabase client.
 */
export function LocationCodeInput({
  id,
  name = 'location_code',
  defaultValue = '',
  required = false,
  disabled = false,
  includeInactive = false,
  placeholder,
  className,
  'aria-describedby': describedBy,
  onValueChange,
}: LocationCodeInputProps) {
  const t = useTranslations('LocationLookup')
  const locale = useLocale()
  const [value, setValue] = useState(defaultValue)
  const [options, setOptions] = useState<LocationCodeOption[]>([])
  const [status, setStatus] = useState<LookupState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const generation = useRef(0)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      request.current?.abort()
      generation.current += 1
    },
    [],
  )

  function cancelLookup() {
    if (timer.current) clearTimeout(timer.current)
    request.current?.abort()
    generation.current += 1
  }

  function lookup(nextValue: string) {
    cancelLookup()
    const currentGeneration = generation.current
    setOptions([])
    setStatus('loading')
    timer.current = setTimeout(async () => {
      const controller = new AbortController()
      request.current = controller
      const timeout = setTimeout(() => {
        if (generation.current === currentGeneration) setStatus('error')
        controller.abort()
      }, REQUEST_TIMEOUT_MS)
      try {
        const params = new URLSearchParams({ q: nextValue.trim().slice(0, 100) })
        if (includeInactive) params.set('include_inactive', 'true')
        const response = await fetch(`/api/lookup/locations?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        if (!response.ok) throw new Error('lookup_failed')
        const body: unknown = await response.json()
        const locations =
          body && typeof body === 'object' && 'locations' in body ? body.locations : null
        if (!Array.isArray(locations) || !locations.every(isLocationOption)) {
          throw new Error('invalid_lookup_response')
        }
        if (!controller.signal.aborted && generation.current === currentGeneration) {
          setOptions(locations)
          setStatus(locations.length ? 'ready' : 'empty')
        }
      } catch {
        if (!controller.signal.aborted && generation.current === currentGeneration) {
          setStatus('error')
        }
      } finally {
        clearTimeout(timeout)
      }
    }, DEBOUNCE_MS)
  }

  const message = status === 'loading' || status === 'empty' || status === 'error' ? t(status) : ''

  return (
    <div className={`${styles.root}${className ? ` ${className}` : ''}`}>
      <Autocomplete.Root
        name={name}
        value={value}
        required={required}
        disabled={disabled}
        items={options}
        filter={null}
        itemToStringValue={(option) => option.code}
        openOnInputClick
        onOpenChange={(open, details) => {
          // Typing already queued the new value; the render's value may still be one edit behind.
          if (open) {
            if (
              details.reason !== 'input-change' &&
              details.reason !== 'clear-press' &&
              details.reason !== 'input-clear'
            ) {
              lookup(value)
            }
          } else {
            cancelLookup()
            setStatus('idle')
          }
        }}
        onValueChange={(nextValue, details) => {
          input.current?.setCustomValidity('')
          setValue(nextValue)
          onValueChange?.(nextValue)
          if (
            details.reason === 'item-press' ||
            details.reason === 'clear-press' ||
            details.reason === 'input-clear' ||
            details.reason === 'none'
          ) {
            cancelLookup()
            setOptions([])
            setStatus('idle')
          } else lookup(nextValue)
        }}
      >
        <Autocomplete.InputGroup className={styles.inputGroup}>
          <MapPin className={styles.icon} aria-hidden="true" />
          <Autocomplete.Input
            ref={input}
            id={id}
            className={styles.input}
            placeholder={placeholder ?? t('placeholder')}
            maxLength={100}
            pattern={LOCATION_CODE_PATTERN}
            onInput={(event) => event.currentTarget.setCustomValidity('')}
            onInvalid={(event) => {
              const target = event.currentTarget
              if (target.validity.patternMismatch || target.validity.tooLong) {
                target.setCustomValidity(t('invalidCode'))
              }
            }}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={describedBy}
            dir="auto"
          />
          <Autocomplete.Clear className={styles.clear} aria-label={t('clear')}>
            <X aria-hidden="true" />
          </Autocomplete.Clear>
        </Autocomplete.InputGroup>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {message}
        </div>
        <Autocomplete.Portal>
          <Autocomplete.Positioner className={styles.positioner} sideOffset={4} align="start">
            <Autocomplete.Popup className={styles.popup} aria-busy={status === 'loading'}>
              {message && <p className={styles.message}>{message}</p>}
              <Autocomplete.List className={styles.list} aria-label={t('listLabel')}>
                {(option: LocationCodeOption) => (
                  <Autocomplete.Item key={option.code} value={option} className={styles.option}>
                    <span className={styles.optionHeading}>
                      <bdi className={styles.code}>{option.code}</bdi>
                      {!option.is_active && (
                        <span className={styles.inactive}>{t('inactive')}</span>
                      )}
                    </span>
                    <span className={styles.name} dir="auto">
                      {displayName(option, locale).primary}
                    </span>
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </div>
  )
}
