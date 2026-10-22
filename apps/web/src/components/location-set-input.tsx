'use client'
import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { codeSchema } from '@/lib/master-data/schemas'
const field = 'min-w-0 w-full rounded-md border bg-background px-3 py-2'
const button =
  'min-h-11 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50'
export function LocationSetInput({
  codes,
  setCodes,
  locations,
  disabled,
}: {
  codes: string[]
  setCodes: (codes: string[]) => void
  locations: { code: string; name: string }[]
  disabled: boolean
}) {
  const t = useTranslations('RegionalStock'),
    listId = useId()
  const [candidate, setCandidate] = useState('')
  const validCode = codeSchema().safeParse(candidate)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 flex-1 gap-1 text-sm">
          {t('location_code')}
          <input
            className={field}
            list={listId}
            value={candidate}
            maxLength={64}
            disabled={disabled || codes.length === 20}
            onChange={(e) => setCandidate(e.target.value)}
          />
        </label>
        <datalist id={listId}>
          {locations.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </datalist>
        <button
          type="button"
          className={button}
          disabled={
            disabled ||
            !validCode.success ||
            codes.includes(candidate.trim()) ||
            codes.length === 20
          }
          onClick={() => {
            setCodes([...codes, candidate.trim()])
            setCandidate('')
          }}
        >
          {t('add')}
        </button>
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {t('count', { count: codes.length })}
      </p>
      <ul className="flex flex-wrap gap-2">
        {codes.map((code) => (
          <li
            key={code}
            className="flex max-w-full items-center gap-2 rounded-md border ps-3 text-sm"
          >
            <bdi className="break-all">{code}</bdi>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCodes(codes.filter((c) => c !== code))}
              aria-label={t('remove', { code })}
              className="min-h-11 px-3 underline"
            >
              {t('removeShort')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
