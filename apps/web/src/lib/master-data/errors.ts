import { errorHintField, violatedConstraint, type RpcErrorLike } from '../rpc-errors'
import type { EntityDefinition, MasterDataErrorKey } from './types'

/**
 * How a failed insert, update or delete is shown: next to a field, as a form message from
 * MasterData.errors, or as the generic RpcErrors text for its SQLSTATE. Pure, so Vitest can load it.
 */
export type ErrorPlacement =
  | { scope: 'field'; field: string; key: MasterDataErrorKey }
  | { scope: 'form'; key: MasterDataErrorKey }
  | { scope: 'rpc' }

type ConstraintSource = Pick<
  EntityDefinition,
  'table' | 'fields' | 'constraintFields' | 'constraintMessages'
>

/**
 * The form field a constraint belongs to: the definition's explicit map first, then the names
 * PostgreSQL generates (`<table>_<field>_check`, `<table>_<field>_fkey`,
 * `<table>_organization_id_<field>_key`, `<table>_organization_id_<field>_fkey`).
 */
export function fieldForConstraint(
  definition: ConstraintSource,
  constraint: string,
): string | null {
  const names = new Set(definition.fields.map((field) => field.name))
  const explicit = definition.constraintFields?.[constraint]
  if (explicit) return names.has(explicit) ? explicit : null
  const { table } = definition
  for (const name of names) {
    if (
      constraint === `${table}_${name}_check` ||
      constraint === `${table}_${name}_fkey` ||
      constraint === `${table}_organization_id_${name}_key` ||
      constraint === `${table}_organization_id_${name}_fkey`
    ) {
      return name
    }
  }
  return null
}

const CONSTRAINT_KEYS: Record<string, MasterDataErrorKey> = {
  '23503': 'missingReference',
  '23514': 'invalid',
  '23P01': 'overlap',
}

/** Placement for an insert or update error. */
export function placeWriteError(
  definition: ConstraintSource & Pick<EntityDefinition, 'hintMessages'>,
  error: RpcErrorLike,
): ErrorPlacement {
  const code = error?.code ?? ''
  if (code === '23505') {
    const constraint = violatedConstraint(error)
    const field = constraint ? fieldForConstraint(definition, constraint) : null
    const own = constraint ? definition.constraintMessages?.[constraint] : undefined
    if (field) {
      return { scope: 'field', field, key: own ?? (field === 'code' ? 'codeTaken' : 'duplicate') }
    }
    return { scope: 'form', key: 'duplicate' }
  }
  const constraintKey = CONSTRAINT_KEYS[code]
  if (constraintKey) {
    const constraint = violatedConstraint(error)
    const field = constraint ? fieldForConstraint(definition, constraint) : null
    const own = constraint ? definition.constraintMessages?.[constraint] : undefined
    if (field) return { scope: 'field', field, key: own ?? constraintKey }
    // A check without a known field reads better as the generic 23514 text.
    return code === '23514' ? { scope: 'rpc' } : { scope: 'form', key: constraintKey }
  }
  if (code === 'MQ422') {
    const hint = errorHintField(error)
    if (hint && definition.fields.some((field) => field.name === hint)) {
      return { scope: 'field', field: hint, key: definition.hintMessages?.[hint] ?? 'invalid' }
    }
  }
  return { scope: 'rpc' }
}

/** Placement for a delete error: rows still referenced, or with demand history, stay. */
export function placeDeleteError(error: RpcErrorLike): ErrorPlacement {
  switch (error?.code) {
    case 'MQ409':
      return { scope: 'form', key: 'hasDemand' }
    case '23503':
      return { scope: 'form', key: 'inUse' }
    default:
      return { scope: 'rpc' }
  }
}
