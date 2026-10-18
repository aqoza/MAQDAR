import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { HelpSidePanel } from './help-side-panel'

/** Keep the existing method copy on the server and share the approved drawer presentation. */
function MethodHelp({ description, children }: { description: string; children: ReactNode }) {
  const t = useTranslations('Common')
  return (
    <HelpSidePanel title={t('methodDetails')} description={description} closeLabel={t('close')}>
      {children}
    </HelpSidePanel>
  )
}

export function RedistributionDraftsHelp() {
  const t = useTranslations('Redistribution')
  return (
    <MethodHelp description={t('title')}>
      <p>{t('asOf')}</p>
      <p>{t('noReservation')}</p>
    </MethodHelp>
  )
}

export function StockLocatorHelp() {
  const t = useTranslations('StockLocator')
  return (
    <MethodHelp description={t('title')}>
      <p>{t('stockHelp')}</p>
      <p>{t('distanceHelp')}</p>
      <p>{t('historyHelp')}</p>
      <p>{t('relationshipHelp')}</p>
      <p>{t('substituteHelp')}</p>
    </MethodHelp>
  )
}

export function PurchaseReviewHelp() {
  const t = useTranslations('PurchaseReview')
  return (
    <MethodHelp description={t('title')}>
      <p>{t('description')}</p>
    </MethodHelp>
  )
}

export function PurchaseHandoffsHelp() {
  const t = useTranslations('PurchaseHandoffs')
  return (
    <MethodHelp description={t('title')}>
      <p>{t('description')}</p>
    </MethodHelp>
  )
}

export function PurchaseBatchesHelp() {
  const t = useTranslations('HandoffBatches')
  return (
    <MethodHelp description={t('title')}>
      <p>{t('description')}</p>
    </MethodHelp>
  )
}
