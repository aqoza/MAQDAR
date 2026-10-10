'use client'

import { useTranslations } from 'next-intl'
import { useActionState, useState, type ChangeEvent } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { idleState } from '@/lib/forms'
import { createOrganization } from '@/lib/organizations/actions'
import { ORGANIZATION_NAME_MAX_LENGTH } from '@/lib/organizations/schemas'
import { SLUG_MAX_LENGTH, SLUG_PATTERN, slugify } from '@/lib/organizations/slug'

export type ReferenceOption = { code: string; name: string }

type Props = {
  currencies: ReferenceOption[]
  countries: ReferenceOption[]
  defaultCurrency: string
  defaultCountry: string
}

/**
 * Controlled form so the slug can follow the name until the user edits it (clearing the slug hands
 * control back). Initial values come from `state.values` so a no-JS submission re-fills the form.
 */
export function CreateOrganizationForm({
  currencies,
  countries,
  defaultCurrency,
  defaultCountry,
}: Props) {
  const t = useTranslations('Organizations.new')
  const [state, formAction, pending] = useActionState(createOrganization, idleState)
  const submitted = state.values ?? {}
  const [name, setName] = useState(submitted.name ?? '')
  const [slug, setSlug] = useState(submitted.slug ?? '')
  const [slugEdited, setSlugEdited] = useState(Boolean(submitted.slug))
  const [baseCurrency, setBaseCurrency] = useState(submitted.base_currency || defaultCurrency)
  const [homeCountry, setHomeCountry] = useState(submitted.home_country || defaultCountry)
  const [arabicEnabled, setArabicEnabled] = useState(submitted.arabic_enabled === 'on')
  const errors = state.fieldErrors ?? {}
  const invalid = (field: string) => (errors[field] ? true : undefined)

  function onNameChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value
    setName(next)
    if (!slugEdited) setSlug(slugify(next))
  }

  function onSlugChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value
    setSlug(next)
    // An emptied slug returns to being derived from the name.
    setSlugEdited(next !== '')
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.status === 'error' && state.message ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field data-invalid={invalid('name')}>
          <FieldLabel htmlFor="name">{t('name')}</FieldLabel>
          <Input
            id="name"
            name="name"
            value={name}
            onChange={onNameChange}
            placeholder={t('namePlaceholder')}
            maxLength={ORGANIZATION_NAME_MAX_LENGTH}
            autoComplete="organization"
            required
            aria-invalid={invalid('name')}
          />
          <FieldError>{errors.name}</FieldError>
        </Field>

        <Field data-invalid={invalid('slug')}>
          <FieldLabel htmlFor="slug">{t('slug')}</FieldLabel>
          <Input
            id="slug"
            name="slug"
            value={slug}
            onChange={onSlugChange}
            maxLength={SLUG_MAX_LENGTH}
            pattern={SLUG_PATTERN.source}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            dir="ltr"
            className="font-mono"
            aria-invalid={invalid('slug')}
          />
          <FieldDescription>{t('slugHint')}</FieldDescription>
          <FieldError>{errors.slug}</FieldError>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={invalid('base_currency')}>
            <FieldLabel htmlFor="base_currency">{t('baseCurrency')}</FieldLabel>
            <NativeSelect
              id="base_currency"
              name="base_currency"
              value={baseCurrency}
              onChange={(event) => setBaseCurrency(event.target.value)}
              className="w-full"
              aria-invalid={invalid('base_currency')}
            >
              {currencies.map((currency) => (
                <NativeSelectOption key={currency.code} value={currency.code}>
                  {`${currency.code} — ${currency.name}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError>{errors.base_currency}</FieldError>
          </Field>

          <Field data-invalid={invalid('home_country')}>
            <FieldLabel htmlFor="home_country">{t('homeCountry')}</FieldLabel>
            <NativeSelect
              id="home_country"
              name="home_country"
              value={homeCountry}
              onChange={(event) => setHomeCountry(event.target.value)}
              className="w-full"
              aria-invalid={invalid('home_country')}
            >
              {countries.map((country) => (
                <NativeSelectOption key={country.code} value={country.code}>
                  {`${country.code} — ${country.name}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError>{errors.home_country}</FieldError>
          </Field>
        </div>

        <Field orientation="horizontal">
          <Switch
            id="arabic_enabled"
            name="arabic_enabled"
            checked={arabicEnabled}
            onCheckedChange={(checked) => setArabicEnabled(checked)}
          />
          <FieldLabel htmlFor="arabic_enabled">{t('arabicEnabled')}</FieldLabel>
        </Field>
      </FieldGroup>

      <Button type="submit" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  )
}
