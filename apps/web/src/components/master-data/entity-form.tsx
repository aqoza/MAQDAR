'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { ActiveOrganizationField } from '@/components/active-organization'
import { FieldControl, type FieldSpec } from '@/components/master-data/field-control'
import { FormMessage } from '@/components/master-data/form-message'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { idleState } from '@/lib/forms'
import { saveEntity } from '@/lib/master-data/actions'

export type EntityFormProps = {
  /** Registry key, sent back as the hidden `entity` field. */
  entity: string
  /** Present when editing. */
  id?: string
  /** `updated_at` exactly as read (a string, never a Date) for the optimistic update. */
  updatedAt?: string
  fields: readonly FieldSpec[]
  canEdit: boolean
  /** Shown to non-editors instead of the buttons. */
  readOnlyNotice?: string
}

/**
 * Create and edit form for any registered entity, validated on the server only (zod stays out of
 * the client bundle). Non-editors get the same fields disabled and no buttons; the action
 * re-checks the role and RLS stays the authority.
 */
export function EntityForm({
  entity,
  id,
  updatedAt,
  fields,
  canEdit,
  readOnlyNotice,
}: EntityFormProps) {
  const t = useTranslations('MasterDataClient')
  const [state, formAction, pending] = useActionState(saveEntity, idleState)
  const values = state.values ?? {}
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      <ActiveOrganizationField />
      <input type="hidden" name="entity" value={entity} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {id && updatedAt ? (
        <input type="hidden" name="updated_at" value={values.updated_at ?? updatedAt} />
      ) : null}
      <fieldset disabled={!canEdit} className="contents">
        <FieldGroup className="grid gap-5 sm:grid-cols-2">
          {fields.map((field) => (
            <FieldControl
              key={field.name}
              field={field}
              submitted={values[field.name]}
              error={errors[field.name]}
            />
          ))}
        </FieldGroup>
      </fieldset>
      {errors._form ? (
        <p role="alert" className="text-destructive text-sm">
          {errors._form}
        </p>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? t('saving') : id ? t('save') : t('create')}
          </Button>
          <FormMessage state={state} />
        </div>
      ) : readOnlyNotice ? (
        <p className="text-muted-foreground text-sm">{readOnlyNotice}</p>
      ) : null}
    </form>
  )
}
