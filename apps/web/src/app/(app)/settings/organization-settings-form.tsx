'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { idleState } from '@/lib/forms'
import { updateOrganizationSettings } from './actions'
import { ActiveOrganizationField } from '@/components/active-organization'

export type ReferenceOption = { code: string; name_en: string }

export type OrganizationSettingsFormProps = {
  organization: {
    name: string
    slug: string
    base_currency: string
    home_country: string
    arabic_enabled: boolean
  }
  currencies: ReferenceOption[]
  countries: ReferenceOption[]
}

/** Owner/admin form over update_organization_settings. The slug is shown but cannot change. */
export function OrganizationSettingsForm({
  organization,
  currencies,
  countries,
}: OrganizationSettingsFormProps) {
  const t = useTranslations('Settings.organization')
  const tCommon = useTranslations('Common')
  const [state, formAction, pending] = useActionState(updateOrganizationSettings, idleState)
  const values = state.values ?? {}
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <ActiveOrganizationField />
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="organization-name">{t('name')}</FieldLabel>
          <Input
            id="organization-name"
            name="name"
            required
            maxLength={200}
            autoComplete="organization"
            defaultValue={values.name ?? organization.name}
            aria-invalid={errors.name ? true : undefined}
          />
          <FieldError>{errors.name}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="organization-slug">{t('slug')}</FieldLabel>
          <Input id="organization-slug" value={organization.slug} readOnly disabled />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={errors.base_currency ? true : undefined}>
            <FieldLabel htmlFor="organization-currency">{t('baseCurrency')}</FieldLabel>
            <NativeSelect
              id="organization-currency"
              name="base_currency"
              className="w-full"
              defaultValue={values.base_currency ?? organization.base_currency}
              aria-invalid={errors.base_currency ? true : undefined}
            >
              {currencies.map((currency) => (
                <NativeSelectOption key={currency.code} value={currency.code}>
                  {`${currency.code} · ${currency.name_en}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError>{errors.base_currency}</FieldError>
          </Field>
          <Field data-invalid={errors.home_country ? true : undefined}>
            <FieldLabel htmlFor="organization-country">{t('homeCountry')}</FieldLabel>
            <NativeSelect
              id="organization-country"
              name="home_country"
              className="w-full"
              defaultValue={values.home_country ?? organization.home_country}
              aria-invalid={errors.home_country ? true : undefined}
            >
              {countries.map((country) => (
                <NativeSelectOption key={country.code} value={country.code}>
                  {country.name_en}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError>{errors.home_country}</FieldError>
          </Field>
        </div>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="organization-arabic">{t('arabicEnabled')}</FieldLabel>
            <FieldDescription>{t('arabicEnabledHint')}</FieldDescription>
          </FieldContent>
          <Switch
            id="organization-arabic"
            name="arabic_enabled"
            defaultChecked={organization.arabic_enabled}
          />
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? tCommon('saving') : tCommon('save')}
        </Button>
        {state.message ? (
          <p
            role={state.status === 'error' ? 'alert' : 'status'}
            className={state.status === 'error' ? 'text-destructive text-sm' : 'text-sm'}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  )
}
