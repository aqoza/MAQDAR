import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fallbackTimeZone } from '@/i18n/config'
import { assignableRoles, isAdminRole } from '@/lib/auth/roles'
import {
  getActiveContext,
  type OrganizationSummary as Organization,
} from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { InvitationsCard, type InvitationRow } from './invitations-card'
import { MembersCard, type LocationOption, type MemberRow } from './members-card'
import {
  OrganizationPreferencesForm,
  OrganizationSettingsForm,
  type ReferenceOption,
  type TimeZoneOption,
} from './organization-settings-form'
import { SetPasswordCard } from './set-password-card'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings')
  return { title: t('title') }
}

export default async function SettingsPage() {
  const context = await getActiveContext()
  if (!context) redirect('/login')
  if (!context.active) redirect('/organizations')
  const organization = context.active
  const admin = isAdminRole(context.role)

  const t = await getTranslations('Settings')
  const supabase = await createClient()

  const [currenciesResult, countriesResult] = await Promise.all([
    supabase.from('currencies').select('code, name_en').order('code'),
    supabase.from('countries').select('code, name_en, timezone').order('name_en'),
  ])
  const currencies: ReferenceOption[] = currenciesResult.data ?? []
  const countries: CountryOption[] = countriesResult.data ?? []
  const homeTimeZone =
    countries.find((country) => country.code === organization.home_country)?.timezone ??
    fallbackTimeZone
  const timeZones = timeZoneOptions(countries, organization.time_zone)

  let members: MemberRow[] = []
  let locations: LocationOption[] = []
  let invitations: InvitationRow[] = []
  if (admin) {
    const [membersResult, locationsResult, invitationsResult] = await Promise.all([
      supabase.rpc('organization_members', { p_organization_id: organization.id }),
      supabase
        .from('locations')
        .select('id, code, name_en')
        .eq('organization_id', organization.id)
        .order('code'),
      supabase
        .from('organization_invitations')
        .select('id, email, role, created_at, last_sent_at, expires_at, send_count')
        .eq('organization_id', organization.id)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
    ])
    members = membersResult.data ?? []
    locations = locationsResult.data ?? []
    invitations = invitationsResult.data ?? []
  }

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('organization.title')}</CardTitle>
          <CardDescription>{t('organization.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {admin ? (
            <OrganizationSettingsForm
              organization={organization}
              currencies={currencies}
              countries={countries}
            />
          ) : (
            <OrganizationSummary
              organization={organization}
              currencies={currencies}
              countries={countries}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('preferences.title')}</CardTitle>
          <CardDescription>{t('preferences.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {admin ? (
            <OrganizationPreferencesForm
              organization={organization}
              homeTimeZone={homeTimeZone}
              timeZones={timeZones}
            />
          ) : (
            <PreferencesSummary organization={organization} homeTimeZone={homeTimeZone} />
          )}
        </CardContent>
      </Card>

      {admin && context.role ? (
        <>
          <MembersCard
            members={members}
            locations={locations}
            actorRole={context.role}
            currentUserId={context.userId}
            organizationName={organization.name}
          />
          <InvitationsCard invitations={invitations} roles={assignableRoles(context.role)} />
        </>
      ) : null}

      <SetPasswordCard email={context.email ?? ''} />

      <Card>
        <CardHeader>
          <CardTitle>{t('language.title')}</CardTitle>
          <CardDescription>{t('language.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {organization.arabic_enabled ? (
            <LocaleSwitcher />
          ) : (
            <p className="text-muted-foreground text-sm">{t('language.disabled')}</p>
          )}
        </CardContent>
      </Card>
    </>
  )
}

/** Read-only view of the organization settings for members who cannot change them. */
async function OrganizationSummary({
  organization,
  currencies,
  countries,
}: {
  organization: {
    name: string
    slug: string
    base_currency: string
    home_country: string
    arabic_enabled: boolean
  }
  currencies: ReferenceOption[]
  countries: ReferenceOption[]
}) {
  const t = await getTranslations('Settings.organization')
  const currency = currencies.find((option) => option.code === organization.base_currency)
  const country = countries.find((option) => option.code === organization.home_country)
  const rows: Array<[string, string]> = [
    [t('name'), organization.name],
    [t('slug'), organization.slug],
    [
      t('baseCurrency'),
      currency ? `${currency.code} · ${currency.name_en}` : organization.base_currency,
    ],
    [t('homeCountry'), country ? country.name_en : organization.home_country],
    [t('arabicEnabled'), organization.arabic_enabled ? t('enabled') : t('disabled')],
  ]

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-sm">{t('readOnly')}</p>
    </div>
  )
}

type CountryOption = ReferenceOption & { timezone: string }

/**
 * The zones update_organization_preferences accepts: every distinct countries.timezone (labelled
 * with the countries that use it), then UTC. The current zone is kept even if it left the list.
 */
function timeZoneOptions(countries: CountryOption[], current: string | null): TimeZoneOption[] {
  const byZone = new Map<string, string[]>()
  for (const country of countries) {
    if (country.timezone === fallbackTimeZone) continue
    byZone.set(country.timezone, [...(byZone.get(country.timezone) ?? []), country.name_en])
  }
  const options = [...byZone.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([zone, names]) => ({ value: zone, label: `${zone} · ${names.join(', ')}` }))
  options.push({ value: fallbackTimeZone, label: fallbackTimeZone })
  if (current && !options.some((option) => option.value === current)) {
    options.push({ value: current, label: current })
  }
  return options
}

/** Read-only view of the display preferences for members who cannot change them. */
async function PreferencesSummary({
  organization,
  homeTimeZone,
}: {
  organization: Pick<Organization, 'default_locale' | 'time_zone' | 'numbering_system'>
  homeTimeZone: string
}) {
  const t = await getTranslations('Settings.preferences')
  const rows: Array<[string, string]> = [
    [t('defaultLocale'), t(`locales.${organization.default_locale}`)],
    [t('timeZone'), organization.time_zone ?? t('timeZoneHome', { zone: homeTimeZone })],
    [t('numberingSystem'), t(`numbering.${organization.numbering_system}`)],
  ]

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-sm">{t('readOnly')}</p>
    </div>
  )
}
