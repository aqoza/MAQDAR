'use client'

import { Dialog } from '@base-ui/react/dialog'
import { CircleHelp, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

/** Portalled guidance keeps the workbench layout stable when opened. */
export function IntegrationResultsHelp() {
  const t = useTranslations('IntegrationWorkbench')
  return (
    <Dialog.Root>
      <Dialog.Trigger className="inline-flex cursor-pointer items-center gap-2 rounded-sm py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <CircleHelp className="size-4" aria-hidden="true" />
        {t('help.title')}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-transparent" />
        <Dialog.Popup className="fixed inset-y-0 end-0 z-50 flex w-full max-w-[35rem] flex-col border-s bg-background text-foreground shadow-xl">
          <div className="relative mx-6 shrink-0 border-b py-6 pe-10 sm:mx-8">
            <Dialog.Title className="text-2xl font-semibold text-primary">
              {t('help.title')}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              {t('title')}
            </Dialog.Description>
            <Dialog.Close
              aria-label={t('help.close')}
              className="absolute top-5 end-0 cursor-pointer rounded-md p-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-5" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 py-6 text-sm leading-relaxed sm:px-8">
            <p>{t('help.intro')}</p>
            <section className="space-y-2">
              <h2 className="text-base font-semibold text-primary">{t('help.statusTitle')}</h2>
              <p>{t('help.statusBody')}</p>
              <div className="mt-4 space-y-1 rounded-lg border bg-accent/50 p-4">
                <p className="font-semibold text-primary">{t('help.noReportTitle')}</p>
                <p>{t('help.noReportBody')}</p>
              </div>
            </section>
            {(['labels', 'filter', 'histories', 'selection'] as const).map((section) => (
              <section className="space-y-2" key={section}>
                <h2 className="text-base font-semibold text-primary">
                  {t(`help.${section}Title`)}
                </h2>
                <p>{t(`help.${section}Body`)}</p>
              </section>
            ))}
          </div>
          <div className="mx-6 flex shrink-0 justify-end border-t py-4 sm:mx-8">
            <Dialog.Close className="cursor-pointer rounded-md border border-primary px-6 py-2 text-sm font-medium text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {t('help.close')}
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
