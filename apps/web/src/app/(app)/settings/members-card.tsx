'use client'

import type { Database } from '@maqdar/shared/database.types'
import { useFormatter, useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { RoleBadge } from '@/components/role-badge'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { assignableRoles, canManageMember, isRole, type Role } from '@/lib/auth/roles'
import { idleState, type ActionState } from '@/lib/forms'
import { removeMember, setMemberLocations, setMemberRole } from './actions'
import { ActiveOrganizationField } from '@/components/active-organization'

export type MemberRow = Database['public']['Functions']['organization_members']['Returns'][number]
export type LocationOption = Pick<
  Database['public']['Tables']['locations']['Row'],
  'id' | 'code' | 'name_en'
>

export type MembersCardProps = {
  members: MemberRow[]
  locations: LocationOption[]
  actorRole: Role
  currentUserId: string
  organizationName: string
}

/** Owner/admin view of the organization's members: role, branch scoping, removal and leaving. */
export function MembersCard({
  members,
  locations,
  actorRole,
  currentUserId,
  organizationName,
}: MembersCardProps) {
  const t = useTranslations('Members')
  const format = useFormatter()
  const roleOptions = assignableRoles(actorRole)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('email')}</TableHead>
              <TableHead>{t('role')}</TableHead>
              <TableHead>{t('since')}</TableHead>
              <TableHead>{t('locations')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('remove')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const memberRole = isRole(member.role) ? member.role : null
              const self = member.user_id === currentUserId
              const manageable =
                !self && memberRole !== null && canManageMember(actorRole, memberRole)
              return (
                <TableRow key={`${member.user_id}:${member.role}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{member.email}</span>
                      {self ? <Badge variant="outline">{t('you')}</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {manageable && memberRole ? (
                      <RoleForm member={member} role={memberRole} options={roleOptions} />
                    ) : memberRole ? (
                      <RoleBadge role={memberRole} />
                    ) : (
                      <span className="text-muted-foreground">{member.role}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.dateTime(new Date(member.created_at), 'short')}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {memberRole === 'branch_user' ? (
                      manageable || self ? (
                        <LocationsForm member={member} locations={locations} />
                      ) : (
                        <AssignedLocations member={member} locations={locations} />
                      )
                    ) : (
                      <span className="text-muted-foreground">{t('allLocations')}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    {self || manageable ? (
                      <RemoveMemberDialog
                        member={member}
                        self={self}
                        organizationName={organizationName}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
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

/** The role select submits on change; the row re-renders from the server afterwards. */
function RoleForm({ member, role, options }: { member: MemberRow; role: Role; options: Role[] }) {
  const t = useTranslations('Members')
  const tRoles = useTranslations('Roles')
  const [state, formAction, pending] = useActionState(setMemberRole, idleState)
  const choices = options.includes(role) ? options : [role, ...options]

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <ActiveOrganizationField />
      <input type="hidden" name="user_id" value={member.user_id} />
      <NativeSelect
        name="role"
        size="sm"
        aria-label={t('role')}
        defaultValue={role}
        disabled={pending}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {choices.map((choice) => (
          <NativeSelectOption key={choice} value={choice}>
            {tRoles(choice)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {state.fieldErrors?.role ? (
        <p role="alert" className="text-destructive text-xs">
          {state.fieldErrors.role}
        </p>
      ) : (
        <FormMessage state={state} />
      )}
    </form>
  )
}

function AssignedLocations({
  member,
  locations,
}: {
  member: MemberRow
  locations: LocationOption[]
}) {
  const t = useTranslations('Members')
  const assigned = locations.filter((location) => member.location_ids.includes(location.id))
  if (assigned.length === 0) {
    return <span className="text-muted-foreground">{t('noLocations')}</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {assigned.map((location) => (
        <Badge key={location.id} variant="outline" title={location.name_en}>
          {location.code}
        </Badge>
      ))}
    </div>
  )
}

/** One checkbox per organization location; branch users see only what is ticked here. */
function LocationsForm({ member, locations }: { member: MemberRow; locations: LocationOption[] }) {
  const t = useTranslations('Members')
  const tCommon = useTranslations('Common')
  const [state, formAction, pending] = useActionState(setMemberLocations, idleState)

  if (locations.length === 0) {
    return <span className="text-muted-foreground">{t('noLocations')}</span>
  }

  return (
    <form action={formAction} className="flex min-w-56 flex-col gap-2">
      <ActiveOrganizationField />
      <input type="hidden" name="user_id" value={member.user_id} />
      <fieldset
        aria-label={t('assignLocations')}
        className="flex max-h-40 flex-col gap-1.5 overflow-y-auto pe-2"
      >
        {locations.map((location) => (
          <Label key={location.id} className="font-normal">
            <input
              type="checkbox"
              name="location_ids"
              value={location.id}
              defaultChecked={member.location_ids.includes(location.id)}
              className="accent-primary size-4 shrink-0"
            />
            <span className="truncate">
              <span className="font-mono text-xs">{location.code}</span> {location.name_en}
            </span>
          </Label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="xs" variant="outline" disabled={pending}>
          {pending ? tCommon('saving') : tCommon('save')}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  )
}

/** Remove a colleague, or leave the organization yourself. The database keeps the last owner. */
function RemoveMemberDialog({
  member,
  self,
  organizationName,
}: {
  member: MemberRow
  self: boolean
  organizationName: string
}) {
  const t = useTranslations('Members')
  const tCommon = useTranslations('Common')
  const [state, formAction, pending] = useActionState(removeMember, idleState)
  const action = self ? t('leave') : t('remove')

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        {action}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {self
              ? t('leaveConfirmTitle', { organization: organizationName })
              : t('removeConfirmTitle', { email: member.email })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {self ? t('leaveConfirmDescription') : t('removeConfirmDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {state.status === 'error' && state.message ? (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tCommon('cancel')}</AlertDialogCancel>
          <form action={formAction}>
            <ActiveOrganizationField />
            <input type="hidden" name="user_id" value={member.user_id} />
            <AlertDialogAction
              type="submit"
              variant="destructive"
              disabled={pending}
              className="w-full"
            >
              {action}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
