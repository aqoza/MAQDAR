import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { signOut } from '@/lib/auth/actions'
import { isRole } from '@/lib/auth/roles'
import { requireClaims } from '@/lib/auth/session'
import { getActiveContext, type PendingInvitation } from '@/lib/organizations/context'
import { AcceptInvitationForm } from './accept-invitation-form'

type Props = { params: Promise<{ id: string }> }

/** my_invitations() only returns rows addressed to the signed-in e-mail, so a miss is a mismatch. */
async function findInvitation(id: string): Promise<PendingInvitation | null> {
  const context = await getActiveContext()
  return context?.invitations.find((invitation) => invitation.id === id) ?? null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const [invitation, t] = await Promise.all([findInvitation(id), getTranslations('Invitations')])
  return {
    title: invitation
      ? t('acceptTitle', { organization: invitation.organization_name })
      : t('mismatchTitle'),
  }
}

/**
 * Landing page of the invitation e-mail once the user is signed in. The invitation must be pending
 * and addressed to this account; otherwise the user is told to sign in with the invited address.
 */
export default async function InvitationPage({ params }: Props) {
  await requireClaims()
  const { id } = await params
  const [invitation, t, tRoles, tOrganizations, tCommon] = await Promise.all([
    findInvitation(id),
    getTranslations('Invitations'),
    getTranslations('Roles'),
    getTranslations('Organizations'),
    getTranslations('Common'),
  ])

  if (!invitation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{t('mismatchTitle')}</h1>
          </CardTitle>
          <CardDescription>{t('mismatchDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <form action={signOut}>
            <Button type="submit" variant="outline">
              {tCommon('signOut')}
            </Button>
          </form>
          <Button variant="ghost" render={<Link href="/organizations" />} nativeButton={false}>
            {tOrganizations('title')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const role = isRole(invitation.role) ? tRoles(invitation.role) : invitation.role

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t('acceptTitle', { organization: invitation.organization_name })}</h1>
        </CardTitle>
        <CardDescription>{t('acceptDescription', { role })}</CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptInvitationForm invitationId={invitation.id} label={t('accept')} />
      </CardContent>
    </Card>
  )
}
