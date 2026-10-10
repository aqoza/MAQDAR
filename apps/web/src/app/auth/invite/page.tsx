import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { AcceptInviteForm } from './accept-invite-form'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth.invite')
  return { title: t('title') }
}

/**
 * Public landing page of invitation e-mails. It never touches the token on GET: the button posts
 * to completeInvite (actions.ts), so a mail gateway prefetching the link cannot spend it.
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; next?: string }>
}) {
  const t = await getTranslations('Auth.invite')
  const { token_hash: tokenHash, next } = await searchParams

  return (
    <main className="bg-muted/40 flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          {tokenHash ? <p className="text-muted-foreground text-sm">{t('description')}</p> : null}
        </CardHeader>
        <CardContent>
          {tokenHash ? (
            <AcceptInviteForm tokenHash={tokenHash} next={next ?? null} />
          ) : (
            <Alert variant="destructive">
              <AlertDescription>{t('missingToken')}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
