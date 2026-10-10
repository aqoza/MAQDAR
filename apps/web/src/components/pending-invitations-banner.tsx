import { Mail } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/** Shown above the page content while the signed-in user has invitations waiting. */
export function PendingInvitationsBanner({ count }: { count: number }) {
  const t = useTranslations('Common')
  if (count <= 0) return null

  return (
    <Alert>
      <Mail />
      <AlertTitle>{t('pendingInvitations', { count })}</AlertTitle>
      <AlertDescription>
        <Link href="/organizations">{t('viewInvitations')}</Link>
      </AlertDescription>
    </Alert>
  )
}
