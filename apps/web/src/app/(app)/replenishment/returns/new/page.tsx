import Link from 'next/link'
import { randomUUID } from 'node:crypto'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { DealerReturnForm } from '@/components/dealer-return-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { dealerReturnsPath } from '@/lib/dealer-returns'
export default async function NewDealerReturn() {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const [t, messages] = await Promise.all([getTranslations('DealerReturns'), getMessages()])
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('new')}
        description={t('description')}
        back={
          <Link href={dealerReturnsPath} className="underline">
            {t('title')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p>{t('limits')}</p>
            <p>{t('corrections')}</p>
          </HelpDisclosure>
        }
      />
      <NextIntlClientProvider
        messages={{
          DealerReturns: messages.DealerReturns,
          LocationLookup: messages.LocationLookup,
        }}
      >
        <DealerReturnForm organizationId={context.active.id} requestId={randomUUID()} />
      </NextIntlClientProvider>
    </div>
  )
}
