import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { DeleteDialog } from '@/components/master-data/delete-dialog'
import { EntityForm } from '@/components/master-data/entity-form'
import type { FieldSpec } from '@/components/master-data/field-control'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { isEditorRole } from '@/lib/auth/roles'
import { displayName } from '@/lib/format'
import { formValuesFromRow } from '@/lib/master-data/form-values'
import { firstParam, isUuid, type RawSearchParams } from '@/lib/master-data/list-params'
import {
  getEntityTranslator,
  optionalMessage,
  type LooseTranslator,
} from '@/lib/master-data/messages'
import { fetchRow, loadOptions, optionSourcesOf, type SelectOption } from '@/lib/master-data/query'
import { getEntity, type EntityKey } from '@/lib/master-data/registry'
import type { FieldDef, FormValue, OptionSourceKey } from '@/lib/master-data/types'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'

type EditScreenProps = {
  entity: EntityKey
  /** The `[id]` segment; absent on `/new`. */
  id?: string
  searchParams?: Promise<RawSearchParams>
}

function emptyValue(field: FieldDef): FormValue {
  if (field.kind === 'switch') return false
  if (field.kind === 'weekdays') return []
  return ''
}

function fieldOptions(
  field: FieldDef,
  t: LooseTranslator,
  options: Partial<Record<OptionSourceKey, SelectOption[]>>,
): SelectOption[] | undefined {
  if (!field.options) return undefined
  if (field.options.source === 'enum') {
    return field.options.values.map((value) => {
      const key = `options.${field.name}.${value}`
      return { value, label: t.has(key) ? t(key) : value }
    })
  }
  return options[field.options.source] ?? []
}

/**
 * New and edit page of any registered entity. `/new` is not found for non-editors; `/<id>` loads
 * the row of the active organization (a malformed or foreign id is not found) and renders it
 * read-only for viewers, approvers and branch users. Labels and options are resolved here.
 */
export async function EditScreen({ entity, id, searchParams }: EditScreenProps) {
  const context = await getActiveContext()
  if (!context) redirect('/login')
  if (!context.active) redirect('/organizations')
  const organizationId = context.active.id
  const definition = getEntity(entity)
  const canEdit = isEditorRole(context.role)

  if (id === undefined && !canEdit) notFound()
  if (id !== undefined && !isUuid(id)) notFound()

  const supabase = await createClient()
  const row = id ? await fetchRow(supabase, definition, organizationId, id.toLowerCase()) : null
  if (id && !row) notFound()

  const [t, tForm, locale, raw] = await Promise.all([
    getEntityTranslator(definition.namespace),
    getTranslations('MasterData.form'),
    getLocale(),
    searchParams ?? Promise.resolve({} as RawSearchParams),
  ])
  const options = await loadOptions(
    supabase,
    optionSourcesOf(definition, 'fields'),
    organizationId,
    locale,
  )

  const values: Record<string, FormValue> = row
    ? (definition.toForm?.(row) ?? formValuesFromRow(definition.fields, row))
    : (definition.defaults?.({ organization: context.active }) ?? {})

  const fields: FieldSpec[] = definition.fields.map((field) => ({
    name: field.name,
    kind: field.kind,
    label: t(`fields.${field.name}`),
    hint: field.hint ? optionalMessage(t, `hints.${field.name}`) : undefined,
    required: field.required,
    maxLength: field.maxLength,
    wide: field.wide,
    options:
      field.excludeSelf && row
        ? fieldOptions(field, t, options)?.filter((option) => option.value !== String(row.id))
        : fieldOptions(field, t, options),
    defaultValue: values[field.name] ?? emptyValue(field),
  }))

  const code = row ? definition.titleOf(row) : ''
  const name = row
    ? displayName(row as { name_en?: string; name_ar?: string | null }, locale)
    : null
  const created = firstParam(raw.notice) === 'created'

  return (
    <>
      <PageHeader
        pattern={definition.area}
        title={row ? <bdi dir="ltr">{code}</bdi> : t('newTitle')}
        description={
          row ? (
            name && name.primary !== '—' ? (
              <span lang={name.primaryLang} dir={name.primaryLang === 'ar' ? 'rtl' : undefined}>
                {name.primary}
              </span>
            ) : (
              t('title')
            )
          ) : (
            t('description')
          )
        }
        actions={
          <>
            {entity === 'suppliers' && id && ['owner', 'admin'].includes(context.role ?? '') ? (
              <Link
                className="underline"
                href={`/suppliers/portal-access?supplier=${encodeURIComponent(code)}`}
              >
                {(await getTranslations('SupplierPortal'))('accessTitle')}
              </Link>
            ) : null}
            {row && canEdit ? (
              <DeleteDialog
                entity={definition.key}
                id={String(row.id)}
                title={tForm('deleteTitle', { name: code })}
                description={optionalMessage(t, 'deleteWarning') ?? tForm('deleteWarning')}
              />
            ) : null}
          </>
        }
        back={
          <Link
            href={definition.basePath}
            prefetch={false}
            className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
            {tForm('backToList')}
          </Link>
        }
      />
      {created ? (
        <Alert role="status">
          <AlertDescription>{tForm('created')}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent>
          <EntityForm
            entity={definition.key}
            id={row ? String(row.id) : undefined}
            updatedAt={row ? String(row.updated_at) : undefined}
            fields={fields}
            canEdit={canEdit}
            readOnlyNotice={tForm('readOnly')}
          />
        </CardContent>
      </Card>
    </>
  )
}
