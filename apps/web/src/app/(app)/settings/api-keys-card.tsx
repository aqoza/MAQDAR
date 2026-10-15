'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'
import { ActiveOrganizationField } from '@/components/active-organization'
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
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { idleState, type ActionState } from '@/lib/forms'
import { revokeApiKey } from './actions'
import { ApiKeyForm } from './api-key-form'
import type { ApiKeyRow, ApiKeyStatus, ScopeOption } from './api-keys'

export type ApiKeysCardProps = {
  keys: ApiKeyRow[]
  scopes: ScopeOption[]
  expiryDays: readonly number[]
  defaultExpiryDays: number
  /** Unrevoked, unexpired keys, and the most an organization may have. */
  activeCount: number
  maxActive: number
  /** The machine-readable API description and the human documentation. */
  openApiHref: string
  docsHref: string
}

/**
 * Admin-only: the organization's REST API keys. Create one (shown once), see what each can do,
 * when it was last used and whether it still works, and revoke it. Rows come from the page, which
 * decides each status on the server.
 */
export function ApiKeysCard({
  keys,
  scopes,
  expiryDays,
  defaultExpiryDays,
  activeCount,
  maxActive,
  openApiHref,
  docsHref,
}: ApiKeysCardProps) {
  const t = useTranslations('ApiKeys')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">{t('creatorRule')}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <a
              href={docsHref}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              {t('docs')}
            </a>
            <a
              href={openApiHref}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              {t('openApi')}
            </a>
          </p>
        </div>
        <ApiKeyForm
          scopes={scopes}
          expiryDays={expiryDays}
          defaultExpiryDays={defaultExpiryDays}
          limitReached={activeCount >= maxActive}
          maxActive={maxActive}
        />
        <Separator />
        <section className="flex flex-col gap-3" aria-labelledby="api-keys-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="api-keys-heading" className="text-sm font-medium">
              {t('list.heading')}
            </h3>
            <p className="text-muted-foreground text-xs">
              {t('activeCount', { count: activeCount, max: maxActive })}
            </p>
          </div>
          {keys.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('list.none')}</p>
          ) : (
            <ApiKeysTable keys={keys} />
          )}
        </section>
      </CardContent>
    </Card>
  )
}

function ApiKeysTable({ keys }: { keys: ApiKeyRow[] }) {
  const t = useTranslations('ApiKeys')
  const format = useFormatter()
  const date = (value: string) => (
    <time dateTime={value} title={format.dateTime(new Date(value), 'long')}>
      {format.dateTime(new Date(value), 'short')}
    </time>
  )

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('list.name')}</TableHead>
          <TableHead>{t('list.key')}</TableHead>
          <TableHead>{t('list.scopes')}</TableHead>
          <TableHead>{t('list.created')}</TableHead>
          <TableHead>{t('list.lastUsed')}</TableHead>
          <TableHead>{t('list.expires')}</TableHead>
          <TableHead>{t('list.status')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('list.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => (
          <TableRow key={key.id}>
            <TableCell className="font-medium">
              <bdi>{key.name}</bdi>
            </TableCell>
            <TableCell>
              <bdi dir="ltr" className="font-mono text-xs">
                {key.display}
              </bdi>
            </TableCell>
            <TableCell className="whitespace-normal">
              <div className="flex min-w-40 flex-wrap gap-1">
                {key.scopes.map((scope) => (
                  <Badge key={scope.value} variant="outline" title={scope.value}>
                    {t(`scopes.${scope.key}.badge`)}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex flex-col">
                {date(key.created_at)}
                <span className="text-muted-foreground text-xs">
                  {key.creator ? <bdi>{key.creator}</bdi> : t('list.formerMember')}
                </span>
              </div>
            </TableCell>
            <TableCell className={key.last_used_at ? undefined : 'text-muted-foreground'}>
              {key.last_used_at ? date(key.last_used_at) : t('list.never')}
            </TableCell>
            <TableCell>{date(key.expires_at)}</TableCell>
            <TableCell className="whitespace-normal">
              <StatusBadge status={key.status} />
            </TableCell>
            <TableCell className="text-end">
              {key.revoked_at ? null : <RevokeApiKeyDialog apiKey={key} />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function StatusBadge({ status }: { status: ApiKeyStatus }) {
  const t = useTranslations('ApiKeys.status')
  switch (status.kind) {
    case 'active':
      return <Badge variant="secondary">{t('active')}</Badge>
    case 'expiresSoon':
      return <Badge variant="outline">{t('expiresSoon', { days: status.days })}</Badge>
    case 'expired':
      return (
        <Badge variant="outline" className="text-muted-foreground">
          {t('expired')}
        </Badge>
      )
    case 'revoked':
      return (
        <Badge variant="outline" className="text-muted-foreground">
          {t('revoked')}
        </Badge>
      )
    case 'creatorInactive':
      return (
        <Badge variant="destructive" className="h-auto whitespace-normal">
          {t('creatorInactive')}
        </Badge>
      )
  }
}

/** Revoking is immediate and final: the next request with the key gets 401. */
function RevokeApiKeyDialog({ apiKey }: { apiKey: ApiKeyRow }) {
  const t = useTranslations('ApiKeys.revoke')
  const tCommon = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData): Promise<ActionState> => {
      const result = await revokeApiKey(previous, formData)
      if (result.status === 'success') setOpen(false)
      return result
    },
    idleState,
  )

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm" aria-label={t('buttonLabel', { name: apiKey.name })} />
        }
      >
        {t('button')}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title', { name: apiKey.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('description')}</AlertDialogDescription>
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
            <input type="hidden" name="id" value={apiKey.id} />
            <AlertDialogAction
              type="submit"
              variant="destructive"
              disabled={pending}
              className="w-full"
            >
              {t('confirm')}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
