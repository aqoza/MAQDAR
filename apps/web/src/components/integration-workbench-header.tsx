import { getTranslations } from 'next-intl/server'
import { HelpDisclosure } from '@/components/help-disclosure'
import { IntegrationResultsHelp } from '@/components/integration-results-help'
import { PageHeader } from '@/components/page-header'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { integrationFamilies, type IntegrationFamily } from '@/lib/integration-workbench'

export async function IntegrationWorkbenchHeader({
  family = 'purchase',
}: {
  family?: IntegrationFamily
}) {
  const t = await getTranslations('IntegrationWorkbench')
  const configuration = integrationFamilies[family]
  const transfer = family === 'transfer'
  const network = family === 'network'
  return (
    <PageHeader
      pattern="replenishment"
      navigation={<ReplenishmentNav current={configuration.navigation} />}
      title={t(configuration.title)}
      description={t(configuration.context)}
      help={
        transfer || network ? (
          <HelpDisclosure>
            <p>{t(network ? 'networkMeaning' : 'transferMeaning')}</p>
            {network && <p>{t('networkAccess')}</p>}
            <p>{t('independence')}</p>
          </HelpDisclosure>
        ) : (
          <IntegrationResultsHelp
            event={family === 'event'}
            disposition={family === 'disposition'}
          />
        )
      }
    />
  )
}
