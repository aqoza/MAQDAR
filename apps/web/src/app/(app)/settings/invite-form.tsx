'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import type { Role } from '@/lib/auth/roles'
import { idleState } from '@/lib/forms'
import { inviteMember } from './actions'
import { ActiveOrganizationField } from '@/components/active-organization'

/** E-mail plus role; `roles` is what the signed-in admin may grant (owners only by owners). */
export function InviteForm({ roles }: { roles: Role[] }) {
  const t = useTranslations('InviteMembers')
  const tRoles = useTranslations('Roles')
  const [state, formAction, pending] = useActionState(inviteMember, idleState)
  const values = state.values ?? {}
  const errors = state.fieldErrors ?? {}
  const defaultRole: Role = roles.includes('planner') ? 'planner' : (roles[0] ?? 'viewer')

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <ActiveOrganizationField />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Field className="flex-1" data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="invite-email">{t('email')}</FieldLabel>
          <Input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            required
            defaultValue={values.email ?? ''}
            aria-invalid={errors.email ? true : undefined}
          />
          <FieldError>{errors.email}</FieldError>
        </Field>
        <Field className="sm:w-48" data-invalid={errors.role ? true : undefined}>
          <FieldLabel htmlFor="invite-role">{t('role')}</FieldLabel>
          <NativeSelect
            id="invite-role"
            name="role"
            className="w-full"
            defaultValue={values.role ?? defaultRole}
            aria-invalid={errors.role ? true : undefined}
          >
            {roles.map((role) => (
              <NativeSelectOption key={role} value={role}>
                {tRoles(role)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError>{errors.role}</FieldError>
        </Field>
        <div className="flex flex-col gap-2 sm:pt-[1.625rem]">
          <Button type="submit" disabled={pending}>
            {t('send')}
          </Button>
        </div>
      </div>
      {state.message ? (
        <p
          role={state.status === 'error' ? 'alert' : 'status'}
          className={state.status === 'error' ? 'text-destructive text-sm' : 'text-sm'}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
