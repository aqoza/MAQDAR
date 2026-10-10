'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { idleState } from '@/lib/forms'
import { completeInvite } from './actions'

export function AcceptInviteForm({ tokenHash, next }: { tokenHash: string; next: string | null }) {
  const t = useTranslations('Auth.invite')
  const [state, formAction, pending] = useActionState(completeInvite, idleState)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token_hash" value={tokenHash} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.status === 'error' && state.message ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {t('accept')}
      </Button>
    </form>
  )
}
