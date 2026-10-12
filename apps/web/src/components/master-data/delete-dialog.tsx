'use client'

import { Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { ActiveOrganizationField } from '@/components/active-organization'
import { FormMessage } from '@/components/master-data/form-message'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { idleState } from '@/lib/forms'
import { deleteEntity } from '@/lib/master-data/actions'

export type DeleteDialogProps = {
  entity: string
  id: string
  /** e.g. "Delete FLT-100?" (translated on the server). */
  title: string
  /** What else goes with it, or why it may be refused (the entity's deleteWarning). */
  description: string
}

/** Confirm, then delete through deleteEntity; refusals (in use, demand history) show inline. */
export function DeleteDialog({ entity, id, title, description }: DeleteDialogProps) {
  const t = useTranslations('MasterDataClient')
  const [state, formAction, pending] = useActionState(deleteEntity, idleState)

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
        <Trash2Icon aria-hidden="true" />
        {t('delete')}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {state.status === 'error' ? <FormMessage state={state} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('cancel')}</AlertDialogCancel>
          <form action={formAction}>
            <ActiveOrganizationField />
            <input type="hidden" name="entity" value={entity} />
            <input type="hidden" name="id" value={id} />
            <AlertDialogAction
              type="submit"
              variant="destructive"
              disabled={pending}
              className="w-full"
            >
              {pending ? t('deleting') : t('delete')}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
