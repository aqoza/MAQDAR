import { createRoot } from 'react-dom/client'
import { DirectionProvider } from '@base-ui/react/direction-provider'
import { NextIntlClientProvider } from 'next-intl'
import {
  RedistributionDraftsHelp,
  StockLocatorHelp,
  PurchaseReviewHelp,
  PurchaseHandoffsHelp,
  PurchaseBatchesHelp,
} from '../../../src/components/replenishment-workspace-help'
import messages from '../../../messages/en.json'
import '../../../src/app/globals.css'

const direction = new URLSearchParams(location.search).get('dir') === 'rtl' ? 'rtl' : 'ltr'
document.documentElement.dir = direction

const workspaces = [
  ['redistribution', messages.Redistribution.title, RedistributionDraftsHelp],
  ['locator', messages.StockLocator.title, StockLocatorHelp],
  ['review', messages.PurchaseReview.title, PurchaseReviewHelp],
  ['handoffs', messages.PurchaseHandoffs.title, PurchaseHandoffsHelp],
  ['batches', messages.HandoffBatches.title, PurchaseBatchesHelp],
] as const

// Exercise each production guidance component without requiring an authenticated database.
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider
    locale="en"
    messages={{
      Common: messages.Common,
      Redistribution: messages.Redistribution,
      StockLocator: messages.StockLocator,
      PurchaseReview: messages.PurchaseReview,
      PurchaseHandoffs: messages.PurchaseHandoffs,
      HandoffBatches: messages.HandoffBatches,
    }}
  >
    <DirectionProvider direction={direction}>
      <main className="space-y-4 p-6">
        <h1 className="text-page-title">Replenishment workspaces</h1>
        <form className="workspace-toolbar" onSubmit={(event) => event.preventDefault()}>
          <label className="grid gap-1">
            Search item code
            <input name="q" className="rounded-md border p-2" />
          </label>
        </form>
        {workspaces.map(([key, title, Help]) => (
          <header
            key={key}
            data-workspace={key}
            className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-accent/50 p-4"
          >
            <h2 className="text-section-title">{title}</h2>
            <Help />
          </header>
        ))}
      </main>
    </DirectionProvider>
  </NextIntlClientProvider>,
)
