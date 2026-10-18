'use client'

import type { ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { CircleHelp, X } from 'lucide-react'

/** Accept translated content from the server without adding client message namespaces. */
export function HelpSidePanel({
  title,
  description,
  closeLabel,
  children,
}: {
  title: string
  description: string
  closeLabel: string
  children: ReactNode
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-sm py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0">
        <CircleHelp className="size-4" aria-hidden="true" />
        {title}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-transparent" />
        <Dialog.Popup className="fixed inset-y-0 end-0 z-50 flex w-full max-w-[35rem] flex-col border-s bg-background text-foreground shadow-xl">
          <div className="relative mx-6 shrink-0 border-b py-6 pe-12 sm:mx-8">
            <Dialog.Title className="text-page-title text-primary">{title}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              {description}
            </Dialog.Description>
            <Dialog.Close
              aria-label={closeLabel}
              className="absolute top-4 end-0 flex size-11 cursor-pointer items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-5" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 py-6 text-sm sm:px-8">
            {children}
          </div>
          <div className="mx-6 flex shrink-0 justify-end border-t py-4 sm:mx-8">
            <Dialog.Close className="min-h-11 cursor-pointer rounded-md border border-primary px-6 py-2 text-sm font-medium text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {closeLabel}
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
