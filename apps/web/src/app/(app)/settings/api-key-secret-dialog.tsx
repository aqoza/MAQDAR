'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * Shows a newly created key once. Mounted only while the create action's state holds the key, so
 * every new key gets a fresh dialog; "Done" (or Escape) calls `onDone`, which drops the key from
 * that state. The key is never put in a form, the URL or browser storage: the dialog is portaled
 * outside the create form and the input has no name.
 */
export function ApiKeySecretDialog({
  secret,
  name,
  onDone,
}: {
  secret: string
  name: string
  onDone: () => void
}) {
  const t = useTranslations('ApiKeys.secret')
  const inputRef = useRef<HTMLInputElement>(null)
  const [copy, setCopy] = useState<CopyState>('idle')

  async function copyKey() {
    try {
      // Undefined outside a secure context (plain http other than localhost): the catch handles it.
      await navigator.clipboard.writeText(secret)
      setCopy('copied')
    } catch {
      setCopy('failed')
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onDone()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title', { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              readOnly
              value={secret}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              aria-label={t('label')}
              className="font-mono text-xs md:text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button type="button" variant="outline" size="sm" onClick={copyKey}>
              {copy === 'copied' ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <CopyIcon aria-hidden="true" />
              )}
              {copy === 'copied' ? t('copied') : t('copy')}
            </Button>
          </div>
          <p
            role={copy === 'failed' ? 'alert' : 'status'}
            className={
              copy === 'failed' ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'
            }
          >
            {copy === 'failed' ? t('copyFailed') : copy === 'copied' ? t('copiedHint') : null}
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogAction type="button" onClick={onDone}>
            {t('done')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
