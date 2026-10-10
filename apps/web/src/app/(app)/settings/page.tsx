import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { assignableRoles, isAdminRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { InvitationsCard, type InvitationRow } from './invitations-card'
import { MembersCard, type LocationOption, type MemberRow } from './members-card'
import { OrganizationSettingsForm, type ReferenceOption } from './organization-settings-form'
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
    supabase.from('countries').select('code, name_en').order('name_en'),
  ])
  const currencies: ReferenceOption[] = currenciesResult.data ?? []
  const countries: ReferenceOption[] = countriesResult.data ?? []

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
