'use client'

import type { Database } from '@maqdar/shared/database.types'
import { useFormatter, useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { RoleBadge } from '@/components/role-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { isRole, type Role } from '@/lib/auth/roles'
import { idleState, type ActionState } from '@/lib/forms'
import { resendInvitation, revokeInvitation } from './actions'
import { InviteForm } from './invite-form'
import { ActiveOrganizationField } from '@/components/active-organization'

export type InvitationRow = Pick<
  Database['public']['Tables']['organization_invitations']['Row'],
  'id' | 'email' | 'role' | 'created_at' | 'last_sent_at' | 'expires_at' | 'send_count'
>

export type InvitationsCardProps = {
  invitations: InvitationRow[]
  roles: Role[]
}

/** Admin-only: send invitations and manage the ones still pending. */
export function InvitationsCard({ invitations, roles }: InvitationsCardProps) {
  const t = useTranslations('InviteMembers')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <InviteForm roles={roles} />
        <Separator />
        <section className="flex flex-col gap-3" aria-labelledby="pending-invitations-heading">
          <h3 id="pending-invitations-heading" className="text-sm font-medium">
            {t('pending')}
          </h3>
          {invitations.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('none')}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {invitations.map((invitation) => (
                <li key={`${invitation.id}:${invitation.last_sent_at}`}>
                  <PendingInvitation invitation={invitation} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null
  return (
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      className={
        state.status === 'error' ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'
      }
    >
      {state.message}
    </p>
  )
}

function PendingInvitation({ invitation }: { invitation: InvitationRow }) {
  const t = useTranslations('InviteMembers')
  const format = useFormatter()
  const [resendState, resendAction, resending] = useActionState(resendInvitation, idleState)
  const [revokeState, revokeAction, revoking] = useActionState(revokeInvitation, idleState)
  const busy = resending || revoking
  const message = resendState.message ? resendState : revokeState

  return (
    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{invitation.email}</span>
          {isRole(invitation.role) ? <RoleBadge role={invitation.role} variant="outline" /> : null}
        </div>
        <p className="text-muted-foreground text-xs">
          <span>
            {t('sentAt', { date: format.dateTime(new Date(invitation.last_sent_at), 'short') })}
          </span>
          <span aria-hidden="true"> · </span>
          <span>
            {t('expiresAt', { date: format.dateTime(new Date(invitation.expires_at), 'short') })}
          </span>
        </p>
        <FormMessage state={message} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <form action={resendAction}>
          <ActiveOrganizationField />
          <input type="hidden" name="invitation_id" value={invitation.id} />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {t('resend')}
          </Button>
        </form>
        <form action={revokeAction}>
          <ActiveOrganizationField />
          <input type="hidden" name="invitation_id" value={invitation.id} />
          <Button type="submit" size="sm" variant="ghost" disabled={busy}>
            {t('revoke')}
          </Button>
        </form>
      </div>
    </div>
  )
}
