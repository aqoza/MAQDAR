'use client'

import { Fragment } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { ItemCodeInput } from '@/components/master-data/item-code-input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { FieldKind, FormValue } from '@/lib/master-data/types'
import { cn } from '@/lib/utils'

/**
 * One resolved form field, built on the server by EditScreen from the entity definition: labels,
 * hints and option labels are already translated, so entity namespaces stay server-side.
 */
export type FieldSpec = {
  name: string
  kind: FieldKind
  label: string
  hint?: string
  required?: boolean
  maxLength?: number
  wide?: boolean
  options?: ReadonlyArray<{ value: string; label: string }>
  /** The stored value (edit) or the default (new). */
  defaultValue: FormValue
}

const ISO_WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const

/** ISO weekday d (1 = Monday) as a date: 2024-01-01 was a Monday. */
function weekdayDate(day: string): Date {
  return new Date(Date.UTC(2024, 0, Number(day)))
}

/**
 * Renders one field. `submitted` is the value re-filled after a failed submit (ActionState.values);
 * it wins over the stored or default value so the user's input is never lost.
 */
export function FieldControl({
  field,
  submitted,
  error,
}: {
  field: FieldSpec
  submitted?: string
  error?: string
}) {
  const t = useTranslations('MasterDataClient')
  const format = useFormatter()
  const id = `field-${field.name}`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const invalid = error ? true : undefined
  // Item codes always carry a hint (the generic one when the entity has none).
  const hasHint = Boolean(field.hint) || field.kind === 'itemCode'
  const describedBy = [hasHint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')
  const common = {
    id,
    name: field.name,
    'aria-invalid': invalid,
    'aria-describedby': describedBy || undefined,
    'aria-required': field.required || undefined,
  }
  const text = submitted ?? (typeof field.defaultValue === 'string' ? field.defaultValue : '')
  const hint = field.hint ? <FieldDescription id={hintId}>{field.hint}</FieldDescription> : null
  const fieldError = error ? <FieldError id={errorId}>{error}</FieldError> : null
  const span = cn(
    field.wide || field.kind === 'textarea' || field.kind === 'weekdays'
      ? 'sm:col-span-2'
      : undefined,
  )

  // React resets the form after every action, and every control resets to the value it mounted
  // with (Base UI's uncontrolled FieldControl also warns when defaultValue changes after mount), so
  // controls remount per submitted value; otherwise a failed submit would show the old value again.
  const remountKey = submitted === undefined ? 'initial' : `submitted:${submitted}`

  if (field.kind === 'switch') {
    const checked = submitted !== undefined ? submitted === 'on' : field.defaultValue === true
    return (
      <Field orientation="horizontal" data-invalid={invalid} className={span}>
        <FieldContent>
          <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
          {hint}
          {fieldError}
        </FieldContent>
        <Switch key={remountKey} {...common} defaultChecked={checked} />
      </Field>
    )
  }

  if (field.kind === 'weekdays') {
    const selected = new Set(
      submitted !== undefined
        ? submitted.split(',').filter(Boolean)
        : Array.isArray(field.defaultValue)
          ? field.defaultValue
          : [],
    )
    return (
      <FieldSet data-invalid={invalid} className={span} aria-describedby={describedBy || undefined}>
        <FieldLegend variant="label">{field.label}</FieldLegend>
        {hint}
        <div key={remountKey} className="flex flex-wrap gap-4">
          {ISO_WEEKDAYS.map((day) => (
            <Label key={day} className="font-normal">
              <Checkbox name={field.name} value={day} defaultChecked={selected.has(day)} />
              {format.dateTime(weekdayDate(day), { weekday: 'long', timeZone: 'UTC' })}
            </Label>
          ))}
        </div>
        {fieldError}
      </FieldSet>
    )
  }

  let control: React.ReactNode
  switch (field.kind) {
    case 'select': {
      const options = field.options ?? []
      const known = options.some((option) => option.value === text)
      return (
        <Field data-invalid={invalid} className={span}>
          <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
          <NativeSelect key={remountKey} {...common} defaultValue={text} className="w-full">
            {!field.required || text === '' ? (
              <NativeSelectOption value="">{t('none')}</NativeSelectOption>
            ) : null}
            {text !== '' && !known ? (
              <NativeSelectOption value={text}>{text}</NativeSelectOption>
            ) : null}
            {options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {hint}
          {fieldError}
        </Field>
      )
    }
    case 'textarea':
      control = <Textarea {...common} defaultValue={text} maxLength={field.maxLength} rows={3} />
      break
    case 'code':
      control = (
        <Input
          {...common}
          defaultValue={text}
          maxLength={field.maxLength}
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      )
      break
    case 'itemCode':
      control = (
        <ItemCodeInput {...common} defaultValue={text} maxLength={64} className="font-mono" />
      )
      break
    case 'nameAr':
      control = (
        <Input {...common} defaultValue={text} maxLength={field.maxLength} dir="rtl" lang="ar" />
      )
      break
    case 'date':
      control = <Input {...common} type="date" defaultValue={text} />
      break
    case 'integer':
    case 'decimal':
      control = (
        <Input
          {...common}
          defaultValue={text}
          inputMode={field.kind === 'integer' ? 'numeric' : 'decimal'}
          dir="ltr"
          autoComplete="off"
          className="tabular-nums"
        />
      )
      break
    case 'text':
    default:
      control = <Input {...common} defaultValue={text} maxLength={field.maxLength} />
  }

  return (
    <Field data-invalid={invalid} className={span}>
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      <Fragment key={remountKey}>{control}</Fragment>
      {field.kind === 'itemCode' && !field.hint ? (
        <FieldDescription id={hintId}>{t('itemCodeHint')}</FieldDescription>
      ) : (
        hint
      )}
      {fieldError}
    </Field>
  )
}
