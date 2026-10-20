import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fallbackTimeZone } from '@/i18n/config'
import { API_SCOPES } from '@/lib/api/auth'
import { API_LIMITS } from '@/lib/api/limits'
import { assignableRoles, isAdminRole } from '@/lib/auth/roles'
import {
  getActiveContext,
  type OrganizationSummary as Organization,
} from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import {
  directoryQuery,
  memberPageSchema,
  invitationPageSchema,
  onboardingStatusSchema,
  type OnboardingStatus,
} from '@/lib/organizations/onboarding'
import { ApiKeysCard } from './api-keys-card'
import {
  API_KEY_COLUMNS,
  isActiveApiKey,
  listedApiKeys,
  scopeOptions,
  toApiKeyRows,
  type ApiKeyRecord,
  type ApiKeyRow,
} from './api-keys'
import { InvitationsCard, type InvitationRow } from './invitations-card'
import { MembersCard, type LocationOption, type MemberRow } from './members-card'
import {
  OrganizationPreferencesForm,
  OrganizationSettingsForm,
  type ReferenceOption,
  type TimeZoneOption,
} from './organization-settings-form'
import { SetPasswordCard } from './set-password-card'
import { SettingsWorkspace, type SettingsSection } from './settings-workspace'

/** The REST API's description and documentation, linked from the API keys card. */
const OPENAPI_HREF = '/api/v1/openapi.json'
const API_DOCS_HREF = 'https://github.com/aqoza/MAQDAR/blob/main/docs/api.md'
/** Keys listed in Settings besides the active ones (at most 20), newest first. */
const API_KEYS_LISTED = 100

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings')
  return { title: t('title') }
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  let memberDirectory = { ...directoryQuery(params, 'members'), total: 0 }
  let invitationDirectory = { ...directoryQuery(params, 'invitations'), total: 0 }
  let onboarding: OnboardingStatus | undefined
  const context = await getActiveContext()
  if (!context) redirect('/login')
  if (!context.active) redirect('/organizations')
  const organization = context.active
  const admin = isAdminRole(context.role)

  const [t, tMembers, tInvitations, tApiKeys] = await Promise.all([
    getTranslations('Settings'),
    getTranslations('Members'),
    getTranslations('InviteMembers'),
    getTranslations('ApiKeys'),
  ])
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
  let apiKeys: ApiKeyRow[] = []
  let activeApiKeys = 0
  if (admin) {
    const now = new Date()
    const [
      membersResult,
      locationsResult,
      invitationsResult,
      apiKeysResult,
      activeKeysResult,
      onboardingResult,
    ] = await Promise.all([
      supabase.rpc('organization_members_page', {
        p_organization_id: organization.id,
        p_page: memberDirectory.page,
        p_search: memberDirectory.search,
      }),
      supabase
        .from('locations')
        .select('id, code, name_en')
        .eq('organization_id', organization.id)
        .order('code'),
      supabase.rpc('organization_invitations_page', {
        p_organization_id: organization.id,
        p_page: invitationDirectory.page,
        p_search: invitationDirectory.search,
      }),
      // Explicit columns: key_hash is not granted, so `*` would fail with 42501.
      supabase
        .from('api_keys')
        .select(API_KEY_COLUMNS)
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false })
        .limit(API_KEYS_LISTED),
      // Every active key, however old, so the count is exact and each one can be revoked.
      supabase
        .from('api_keys')
        .select(API_KEY_COLUMNS)
        .eq('organization_id', organization.id)
        .is('revoked_at', null)
        .gt('expires_at', now.toISOString())
        .order('created_at', { ascending: false })
        .limit(API_KEYS_LISTED),
      supabase.rpc('onboarding_status', { p_organization_id: organization.id }),
    ])
    if (membersResult.error || invitationsResult.error || onboardingResult.error)
      throw new Error('Unable to load workspace access management')
    const memberPage = memberPageSchema.parse(membersResult.data)
    const invitationPage = invitationPageSchema.parse(invitationsResult.data)
    onboarding = onboardingStatusSchema.parse(onboardingResult.data)
    members = memberPage.rows
    memberDirectory = { ...memberDirectory, total: memberPage.total, page: memberPage.page }
    invitationDirectory = {
      ...invitationDirectory,
      total: invitationPage.total,
      page: invitationPage.page,
    }
    locations = locationsResult.data ?? []
    invitations = invitationPage.rows
    const keyRecords: ApiKeyRecord[] = listedApiKeys(
      activeKeysResult.data ?? [],
      apiKeysResult.data ?? [],
    )
    // Creators are matched against the members just loaded: a creator who left or is no longer
    // an owner or admin marks the key as stopped (the API answers 401 creator_inactive).
    // Creator status must not depend on which Members page/search is currently displayed.
    const creatorIds = [
      ...new Set(keyRecords.map((key) => key.created_by).filter((id): id is string => id !== null)),
    ]
    const creators: MemberRow[] = []
    for (let offset = 0; offset < creatorIds.length; offset += 100) {
      const result = await supabase.rpc('organization_members_page', {
        p_organization_id: organization.id,
        p_user_ids: creatorIds.slice(offset, offset + 100),
      })
      if (result.error) throw new Error('Unable to load integration key creators')
      creators.push(...memberPageSchema.parse(result.data).rows)
    }
    apiKeys = toApiKeyRows(keyRecords, creators, now.getTime())
    activeApiKeys = keyRecords.filter((key) => isActiveApiKey(key, now.getTime())).length
  }

  const sections: SettingsSection[] = [
    {
      key: 'organization',
      group: 'workspace',
      label: t('organization.title'),
      searchText: (['name', 'slug', 'baseCurrency', 'homeCountry', 'arabicEnabled'] as const)
        .map((key) => t(`organization.${key}`))
        .join(' '),
      panel: (
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
      ),
    },
    {
      key: 'preferences',
      group: 'workspace',
      label: t('preferences.title'),
      searchText: [
        t('preferences.defaultLocale'),
        t('preferences.timeZone'),
        t('preferences.numberingSystem'),
      ].join(' '),
      panel: (
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
      ),
    },
    ...(admin && context.role
      ? ([
          {
            key: 'members',
            group: 'access',
            label: tMembers('title'),
            searchText: `${tMembers('email')} ${tMembers('role')} ${tMembers('locations')}`,
            panel: (
              <MembersCard
                directory={memberDirectory}
                members={members}
                locations={locations}
                actorRole={context.role}
                currentUserId={context.userId}
                organizationName={organization.name}
              />
            ),
          },
          {
            key: 'invitations',
            group: 'access',
            label: tInvitations('title'),
            searchText: [
              tInvitations('description'),
              tInvitations('email'),
              tInvitations('role'),
            ].join(' '),
            panel: (
              <InvitationsCard
                invitations={invitations}
                roles={assignableRoles(context.role)}
                directory={invitationDirectory}
                onboarding={onboarding}
              />
            ),
          },
          {
            key: 'api-keys',
            group: 'access',
            label: tApiKeys('title'),
            searchText: [
              tApiKeys('description'),
              tApiKeys('create.name'),
              tApiKeys('create.expiry'),
              tApiKeys('create.scopes'),
            ].join(' '),
            panel: (
              <ApiKeysCard
                keys={apiKeys}
                scopes={scopeOptions(API_SCOPES)}
                expiryDays={API_LIMITS.keyExpiryDays}
                defaultExpiryDays={API_LIMITS.defaultKeyExpiryDays}
                activeCount={activeApiKeys}
                maxActive={API_LIMITS.activeKeysPerOrganization}
                openApiHref={OPENAPI_HREF}
                docsHref={API_DOCS_HREF}
              />
            ),
          },
        ] satisfies SettingsSection[])
      : []),
    {
      key: 'password',
      group: 'account',
      label: t('navigation.password'),
      searchText: `${t('account.setPassword')} ${t('account.password')}`,
      panel: <SetPasswordCard email={context.email ?? ''} />,
    },
    {
      key: 'language',
      group: 'account',
      label: t('navigation.language'),
      searchText: t('language.description'),
      panel: (
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
      ),
    },
  ]

  return (
    <>
      <PageHeader pattern="settings" title={t('title')} description={t('description')} />
      <SettingsWorkspace key={organization.id} sections={sections} />
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
