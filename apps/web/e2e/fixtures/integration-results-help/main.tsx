import React from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { IntegrationResultsHelp } from '../../../src/components/integration-results-help'
import messages from '../../../messages/en.json'
import '../../../src/app/globals.css'

// Exercise the production drawer independently of authentication and database fixtures.
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="en" messages={messages}>
    <main className="p-6">
      <IntegrationResultsHelp />
      <label className="block">
        Supplier code
        <input className="border" />
      </label>
      <p>93 package/system results</p>
    </main>
  </NextIntlClientProvider>,
)
