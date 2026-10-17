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
import { ActiveOrganizationField } from '@/components/active-organization'
import { type AppLocale, type NumberingSystem, appLocales, numberingSystems } from '@/i18n/config'
import { idleState } from '@/lib/forms'
import { updateOrganizationSettings, updatePreferences } from './actions'

export type ReferenceOption = { code: string; name_en: string }

// Selects are keyed by their default value: React does not re-apply a changed defaultValue to a
// mounted <select>, and the form reset after an action would restore the value it mounted with.
// A new key remounts the select with the saved (or re-submitted) value.

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
  const baseCurrency = values.base_currency ?? organization.base_currency
  const homeCountry = values.home_country ?? organization.home_country

  return (
    <form action={formAction} className="flex flex-col gap-4">
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
              key={baseCurrency}
              defaultValue={baseCurrency}
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
              key={homeCountry}
              defaultValue={homeCountry}
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
            key={organization.arabic_enabled ? 'on' : 'off'}
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

export type TimeZoneOption = { value: string; label: string }

export type OrganizationPreferencesFormProps = {
  organization: {
    arabic_enabled: boolean
    default_locale: AppLocale
    time_zone: string | null
    numbering_system: NumberingSystem
  }
  /** countries.timezone of the home country, shown on the "follow home country" option. */
  homeTimeZone: string
  /** The zones update_organization_preferences accepts (country zones, then UTC). */
  timeZones: TimeZoneOption[]
}

/**
 * Owner/admin form over update_organization_preferences. An empty time zone follows the home
 * country; Arabic can only become the default language while it is enabled (the server enforces
 * both, the disabled option only explains it).
 */
export function OrganizationPreferencesForm({
  organization,
  homeTimeZone,
  timeZones,
}: OrganizationPreferencesFormProps) {
  const t = useTranslations('Settings.preferences')
  const tCommon = useTranslations('Common')
  const [state, formAction, pending] = useActionState(updatePreferences, idleState)
  const values = state.values ?? {}
  const errors = state.fieldErrors ?? {}
  const defaultLocale = values.default_locale ?? organization.default_locale
  const numberingSystem = values.numbering_system ?? organization.numbering_system
  const timeZone = values.time_zone ?? organization.time_zone ?? ''

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <ActiveOrganizationField />
      <FieldGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={errors.default_locale ? true : undefined}>
            <FieldLabel htmlFor="preferences-locale">{t('defaultLocale')}</FieldLabel>
            <NativeSelect
              id="preferences-locale"
              name="default_locale"
              className="w-full"
              key={defaultLocale}
              defaultValue={defaultLocale}
              aria-describedby="preferences-locale-hint"
              aria-invalid={errors.default_locale ? true : undefined}
            >
              {appLocales.map((locale) => (
                <NativeSelectOption
                  key={locale}
                  value={locale}
                  lang={locale}
                  disabled={locale === 'ar' && !organization.arabic_enabled}
                >
                  {t(`locales.${locale}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription id="preferences-locale-hint">
              {organization.arabic_enabled
                ? t('defaultLocaleHint')
                : `${t('defaultLocaleHint')} ${t('defaultLocaleArabicOff')}`}
            </FieldDescription>
            <FieldError>{errors.default_locale}</FieldError>
          </Field>
          <Field data-invalid={errors.numbering_system ? true : undefined}>
            <FieldLabel htmlFor="preferences-numbering">{t('numberingSystem')}</FieldLabel>
            <NativeSelect
              id="preferences-numbering"
              name="numbering_system"
              className="w-full"
              key={numberingSystem}
              defaultValue={numberingSystem}
              aria-describedby="preferences-numbering-hint"
              aria-invalid={errors.numbering_system ? true : undefined}
            >
              {numberingSystems.map((numbering) => (
                <NativeSelectOption key={numbering} value={numbering}>
                  {t(`numbering.${numbering}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription id="preferences-numbering-hint">
              {t('numberingSystemHint')}
            </FieldDescription>
            <FieldError>{errors.numbering_system}</FieldError>
          </Field>
        </div>
        <Field data-invalid={errors.time_zone ? true : undefined}>
          <FieldLabel htmlFor="preferences-time-zone">{t('timeZone')}</FieldLabel>
          <NativeSelect
            id="preferences-time-zone"
            name="time_zone"
            className="w-full"
            key={timeZone}
            defaultValue={timeZone}
            aria-describedby="preferences-time-zone-hint"
            aria-invalid={errors.time_zone ? true : undefined}
          >
            <NativeSelectOption value="">
              {t('timeZoneHome', { zone: homeTimeZone })}
            </NativeSelectOption>
            {timeZones.map((zone) => (
              <NativeSelectOption key={zone.value} value={zone.value}>
                {zone.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription id="preferences-time-zone-hint">{t('timeZoneHint')}</FieldDescription>
          <FieldError>{errors.time_zone}</FieldError>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? tCommon('saving') : t('save')}
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
