'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'

type ItemOption = { code: string; name_en: string }

export type ItemCodeInputProps = Omit<React.ComponentProps<typeof Input>, 'list' | 'onChange'>

const MIN_QUERY = 2
const DEBOUNCE_MS = 250

/**
 * A part-code text input with suggestions from `GET /api/lookup/items?q=` in a native datalist.
 * Requests are debounced and the previous one is aborted, so typing costs at most one request per
 * pause. The server resolves the submitted code; this only helps the user find it. Never uses the
 * browser Supabase client.
 */
export function ItemCodeInput(props: ItemCodeInputProps) {
  const listId = `${useId()}-items`
  const [options, setOptions] = useState<ItemOption[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      request.current?.abort()
    },
    [],
  )

  function lookup(value: string) {
    if (timer.current) clearTimeout(timer.current)
    const query = value.trim()
    if (query.length < MIN_QUERY) {
      request.current?.abort()
      setOptions([])
      return
    }
    timer.current = setTimeout(async () => {
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller
      try {
        const response = await fetch(`/api/lookup/items?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        if (!response.ok) return
        const body = (await response.json()) as { items?: unknown }
        if (!controller.signal.aborted && Array.isArray(body.items)) {
          setOptions(body.items as ItemOption[])
        }
      } catch {
        // Aborted by a newer keystroke, offline, or redirected to sign-in: no suggestions.
      }
    }, DEBOUNCE_MS)
  }

  return (
    <>
      <Input
        {...props}
        list={listId}
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => lookup(event.currentTarget.value)}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name_en}
          </option>
        ))}
      </datalist>
    </>
  )
}
