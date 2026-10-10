import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isRole } from '@/lib/auth/roles'
import { switchOrganization } from '@/lib/organizations/actions'
import { getActiveContext } from '@/lib/organizations/context'
import { rpcErrorKey } from '@/lib/rpc-errors'
import { AcceptInvitationForm } from '../invitations/[id]/accept-invitation-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Organizations')
  return { title: t('title') }
}

/**
 * The hub: every organization the user belongs to, with an Open button that mints a token for it,
 * plus the invitations waiting for this e-mail address. `?error=<SQLSTATE>` (set by
 * switchOrganization on failure) is shown once through the RpcErrors namespace.
 */
export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const context = await getActiveContext()
  if (!context) redirect('/login')
  const { error } = await searchParams

  const [t, tRoles, tRpc, format] = await Promise.all([
    getTranslations('Organizations'),
    getTranslations('Roles'),
    getTranslations('RpcErrors'),
    getFormatter(),
  ])
  const roleLabel = (role: string) => (isRole(role) ? tRoles(role) : role)

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title={t('title')} description={t('description')} />
        <Button render={<Link href="/organizations/new" />} nativeButton={false}>
          {t('create')}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{tRpc(rpcErrorKey({ code: error }))}</AlertDescription>
        </Alert>
      ) : null}

      {context.organizations.length === 0 ? (
        <EmptyState title={t('empty')} description={t('emptyHint')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {context.organizations.map((organization) => (
            <li key={organization.id}>
              <Card size="sm">
                <CardContent className="flex flex-wrap items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{organization.name}</span>
                      <Badge variant="secondary">{roleLabel(organization.role)}</Badge>
                      {organization.is_active ? <Badge>{t('active')}</Badge> : null}
                    </div>
                    <span className="text-muted-foreground truncate font-mono text-xs" dir="ltr">
                      {organization.slug}
                    </span>
                  </div>
                  <form action={switchOrganization.bind(null, organization.id)}>
                    <Button
                      type="submit"
                      size="sm"
                      variant={organization.is_active ? 'default' : 'outline'}
                    >
                      {t('open')}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="pending-invitations">
        <div className="flex flex-col gap-1">
          <h2 id="pending-invitations" className="text-lg font-semibold tracking-tight">
            {t('pendingTitle')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t('pendingDescription', { email: context.email ?? '' })}
          </p>
        </div>
        {context.invitations.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noPending')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {context.invitations.map((invitation) => (
              <li key={invitation.id}>
                <Card size="sm">
                  <CardHeader>
                    <CardTitle>{invitation.organization_name}</CardTitle>
                    <CardDescription>
                      {t('invitedAs', {
                        role: roleLabel(invitation.role),
                        inviter: invitation.invited_by_email,
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-muted-foreground text-xs">
                      {t('expires', {
                        date: format.dateTime(new Date(invitation.expires_at), 'short'),
                      })}
                    </span>
                    <AcceptInvitationForm
                      invitationId={invitation.id}
                      label={t('accept')}
                      size="sm"
                    />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
