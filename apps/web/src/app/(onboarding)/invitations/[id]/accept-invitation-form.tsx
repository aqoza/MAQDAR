'use client'

import { useActionState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { idleState } from '@/lib/forms'
import { acceptInvitation } from '@/lib/organizations/actions'
import { cn } from '@/lib/utils'

type Props = {
  invitationId: string
  /** Translated button label (Invitations.accept on the invitation page, Organizations.accept on the hub). */
  label: string
  size?: 'default' | 'sm'
  className?: string
}

/**
 * Posts the hidden invitation id to acceptInvitation(); success redirects to the dashboard, an RPC
 * error (expired, wrong address, already a member) is shown inline.
 */
export function AcceptInvitationForm({ invitationId, label, size = 'default', className }: Props) {
  const [state, formAction, pending] = useActionState(acceptInvitation, idleState)

  return (
    <form action={formAction} className={cn('flex flex-col gap-3', className)}>
      <input type="hidden" name="invitationId" value={invitationId} />
      {state.status === 'error' && state.message ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" size={size} disabled={pending} className="self-start">
        {label}
      </Button>
    </form>
  )
}
