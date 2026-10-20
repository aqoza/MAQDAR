'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { ActiveOrganizationField } from '@/components/active-organization'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { idleState } from '@/lib/forms'
import { isRole, type Role } from '@/lib/auth/roles'
import { parseInvitationEmails, type OnboardingStatus } from '@/lib/organizations/onboarding'
import { cancelOnboarding, enqueueInvitations } from './actions'

export function BulkInvitations({ status, roles }: { status: OnboardingStatus; roles: Role[] }) {
  const t = useTranslations('Onboarding')
  const tRoles = useTranslations('Roles')
  const format = useFormatter()
  const router = useRouter()
  const batchId = useRef<string | null>(null)
  const [recipients, setRecipients] = useState('')
  const [fileError, setFileError] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const fileVersion = useRef(0)
  const [state, action, pending] = useActionState(
    async (previous: typeof idleState, data: FormData) => {
      batchId.current ??= crypto.randomUUID()
      data.set('batch_id', batchId.current)
      const result = await enqueueInvitations(previous, data)
      if (result.status === 'success') {
        batchId.current = null
        setRecipients('')
        setConfirmed(false)
      }
      return result
    },
    idleState,
  )
  const working = status.batches.some((batch) => batch.pending > 0)
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => router.refresh(), 15000)
    return () => clearInterval(timer)
  }, [working, router])
  let count = 0
  try {
    count = parseInvitationEmails(recipients).length
  } catch {
    /* Shown in the preview and validated again by the action. */
  }

  return (
    <section
      aria-labelledby="bulk-invitation-title"
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <div>
        <h3 id="bulk-invitation-title" className="text-subsection-title">
          {t('title')}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">{t('description')}</p>
      </div>
      {status.enabled ? (
        <form action={action} className="flex flex-col gap-3">
          <ActiveOrganizationField />
          <Label htmlFor="bulk-file">{t('file')}</Label>
          <Input
            id="bulk-file"
            type="file"
            accept=".csv,text/csv,text/plain"
            disabled={pending}
            onChange={async (event) => {
              const version = ++fileVersion.current
              setConfirmed(false)
              const file = event.target.files?.[0]
              if (!file) return
              if (file.size > 262144) {
                setFileError(true)
                setRecipients('')
                return
              }
              try {
                const text = await file.text()
                if (version === fileVersion.current) {
                  setRecipients(text)
                  setFileError(false)
                }
              } catch {
                if (version === fileVersion.current) setFileError(true)
              }
            }}
          />
          <Label htmlFor="bulk-emails">{t('recipients')}</Label>
          <textarea
            id="bulk-emails"
            name="recipients"
            value={recipients}
            onChange={(event) => {
              fileVersion.current++
              setRecipients(event.target.value)
              setFileError(false)
              setConfirmed(false)
            }}
            maxLength={262144}
            rows={5}
            required
            disabled={pending}
            className="border-input focus-visible:ring-ring w-full rounded-md border bg-transparent px-3 py-2 text-base focus-visible:ring-2 md:text-sm"
          />
          <p className="text-muted-foreground text-xs" role="status">
            {count
              ? t('preview', { count })
              : recipients.trim()
                ? t('invalidRecipients')
                : t('format')}
          </p>
          {fileError ? (
            <p role="alert" className="text-destructive text-sm">
              {t('invalidRecipients')}
            </p>
          ) : null}
          <Label htmlFor="bulk-role">{t('role')}</Label>
          <NativeSelect
            id="bulk-role"
            name="role"
            defaultValue="viewer"
            disabled={pending}
            onChange={() => setConfirmed(false)}
          >
            {roles
              .filter((role) => role !== 'owner')
              .map((role) => (
                <NativeSelectOption key={role} value={role}>
                  {tRoles(role)}
                </NativeSelectOption>
              ))}
          </NativeSelect>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="confirmed"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              required
              disabled={pending}
              className="mt-1"
            />
            {t('confirm')}
          </label>
          <Button type="submit" disabled={pending || !count || fileError || !confirmed}>
            {pending ? t('queuing') : t('queue')}
          </Button>
          {state.message ? (
            <p role={state.status === 'error' ? 'alert' : 'status'} className="text-sm">
              {state.message}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">{t('notEnabled')}</p>
      )}
      {status.issues.length ? (
        <div className="rounded border p-3">
          <h4 className="text-subsection-title">{t('issuesTitle')}</h4>
          <ul className="mt-2 space-y-2 text-sm">
            {status.issues.map((issue, index) => (
              <li key={`${issue.email}:${index}`}>
                <span className="break-all font-medium">{issue.email}</span>
                <p className="text-muted-foreground text-xs">
                  {t(
                    issue.result_code === 'delivery_unknown' ||
                      issue.result_code === 'lease_expired'
                      ? 'uncertainDelivery'
                      : 'failedDelivery',
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {status.batches.length ? (
        <ul className="divide-y" aria-label={t('progress')}>
          {status.batches.map((batch) => (
            <li key={batch.id} className="flex flex-col gap-2 py-3">
              <p className="text-muted-foreground text-xs">
                {t('batchLabel', {
                  date: format.dateTime(new Date(batch.created_at), 'short'),
                  role: isRole(batch.role) ? tRoles(batch.role) : batch.role,
                })}
              </p>
              <p className="text-sm" role="status">
                {t('batch', {
                  total: batch.total,
                  sent: batch.sent,
                  pending: batch.pending,
                  failed: batch.failed,
                  skipped: batch.skipped,
                })}
              </p>
              {batch.failed ? (
                <p className="text-muted-foreground text-xs">{t('reviewFailures')}</p>
              ) : null}
              <CancelBatch id={batch.id} remaining={batch.pending} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function CancelBatch({ id, remaining }: { id: string; remaining: number }) {
  const t = useTranslations('Onboarding')
  const [state, action, pending] = useActionState(cancelOnboarding, idleState)
  return (
    <div className="flex flex-col gap-2">
      {remaining > 0 ? (
        <form action={action}>
          <ActiveOrganizationField />
          <input type="hidden" name="batch_id" value={id} />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {t('cancel')}
          </Button>
        </form>
      ) : null}
      {state.message ? (
        <p role={state.status === 'error' ? 'alert' : 'status'} className="text-sm">
          {state.message}
        </p>
      ) : null}
    </div>
  )
}
