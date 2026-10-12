'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { ActionState } from '@/lib/forms'
import { invalidState, requireEditor, rpcErrorState } from '@/lib/organizations/guard'
import type { RpcErrorLike } from '@/lib/rpc-errors'
import { createClient } from '@/lib/supabase/server'
import { fieldErrorsFrom } from '@/lib/validation'
import { placeDeleteError, placeWriteError, type ErrorPlacement } from './errors'
import { inputFromFormData, submittedValues } from './form-values'
import { isUuid } from './list-params'
import { untyped } from './query'
import { getEntity, isEntityKey } from './registry'
import type { EntityDefinition } from './types'

/*
 * The only two Server Actions of the master-data screens. Each re-checks the session and the
 * editor role (requireEditor: organization from the session, stale-tab guard on the hidden
 * organization_id), picks the entity from the registry allow-list by the hidden `entity` field and
 * lets the database enforce every rule; what comes back is translated for the form.
 */

/** Entity and (optional) id from the hidden fields; null when either is malformed. */
function target(formData: FormData): { definition: EntityDefinition; id: string | null } | null {
  const key = formData.get('entity')
  if (!isEntityKey(key)) return null
  const raw = formData.get('id')
  const id = typeof raw === 'string' && raw !== '' ? raw.toLowerCase() : null
  if (id !== null && !isUuid(id)) return null
  return { definition: getEntity(key), id }
}

async function placedState(
  placement: ErrorPlacement,
  error: RpcErrorLike,
  values?: Record<string, string>,
): Promise<ActionState> {
  if (placement.scope === 'rpc') return { ...(await rpcErrorState(error)), values }
  const t = await getTranslations('MasterData.errors')
  const message = t(placement.key)
  const code = error?.code ?? placement.key
  return placement.scope === 'field'
    ? { status: 'error', fieldErrors: { [placement.field]: message }, values, code }
    : { status: 'error', message, values, code }
}

/**
 * Creates (no `id`) or updates a row. Updates are optimistic: the form carries `updated_at` exactly
 * as it was read, and a row changed since then is not overwritten.
 */
export async function saveEntity(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await requireEditor(formData)
  if (!guard.ok) return guard.state
  const { organizationId } = guard
  const resolved = target(formData)
  if (!resolved) return invalidState('invalid_entity')
  const { definition, id } = resolved
  const rawUpdatedAt = formData.get('updated_at')
  const expectedUpdatedAt = typeof rawUpdatedAt === 'string' ? rawUpdatedAt : ''
  if (id !== null && expectedUpdatedAt === '') return invalidState('missing_updated_at')

  const input = inputFromFormData(definition.fields, formData)
  const values = submittedValues(input)
  if (id !== null) values.updated_at = expectedUpdatedAt

  const parsed = definition.schema.safeParse(input)
  if (!parsed.success) {
    const t = await getTranslations('Validation')
    return { status: 'error', ...fieldErrorsFrom(parsed.error, t), values, code: 'validation' }
  }

  const supabase = await createClient()
  const converted = await definition.toRow(parsed.data, {
    supabase,
    organizationId,
    id,
    updatedAt: id === null ? null : expectedUpdatedAt,
  })
  if (!converted.ok) {
    const t = await getTranslations('MasterData.errors')
    const fieldErrors = Object.fromEntries(
      Object.entries(converted.fieldErrors).map(([field, key]) => [field, t(key)]),
    )
    return { status: 'error', fieldErrors, values, code: 'reference' }
  }

  const db = untyped(supabase)
  if (id === null) {
    const { data, error } = await db
      .from(definition.table)
      .insert({ ...converted.row, organization_id: organizationId })
      .select('id')
      .single()
    if (error || !data) return placedState(placeWriteError(definition, error), error, values)
    revalidatePath(definition.basePath, 'layout')
    redirect(`${definition.basePath}/${String(data.id)}?notice=created`)
  }

  const { data, error } = await db
    .from(definition.table)
    .update(converted.row)
    .eq('organization_id', organizationId)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select('id, updated_at')
    .maybeSingle()
  if (error) return placedState(placeWriteError(definition, error), error, values)
  if (!data) {
    // Nothing matched: changed by someone else since the form was loaded, or deleted.
    const { data: current } = await db
      .from(definition.table)
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', id)
      .maybeSingle()
    const t = await getTranslations('MasterData.errors')
    return current
      ? { status: 'error', message: t('conflict'), values, code: 'conflict' }
      : { status: 'error', message: t('notFound'), values, code: 'not_found' }
  }

  revalidatePath(definition.basePath, 'layout')
  const t = await getTranslations('MasterData.form')
  return {
    status: 'success',
    message: t('saved'),
    values: { ...values, updated_at: String(data.updated_at) },
    code: 'saved',
  }
}

/** Deletes one row of the active organization and returns to the list. */
export async function deleteEntity(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(formData)
  if (!guard.ok) return guard.state
  const { organizationId } = guard
  const resolved = target(formData)
  if (!resolved?.id) return invalidState('invalid_entity')
  const { definition, id } = resolved

  const supabase = await createClient()
  const { data, error } = await untyped(supabase)
    .from(definition.table)
    .delete()
    .eq('organization_id', organizationId)
    .eq('id', id)
    .select('id')
  if (error) return placedState(placeDeleteError(error), error)
  if (!data || data.length === 0) {
    const t = await getTranslations('MasterData.errors')
    return { status: 'error', message: t('notFound'), code: 'not_found' }
  }

  revalidatePath(definition.basePath, 'layout')
  redirect(`${definition.basePath}?notice=deleted`)
}
