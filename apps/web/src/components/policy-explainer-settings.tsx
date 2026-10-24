import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { policyExplainerConfiguration } from '@/lib/claude-policy.server'
import { PolicyExplainerSettingsForm } from './policy-explainer-form'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
export async function PolicyExplainerSettings({ organizationId }: { organizationId: string }) {
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('PolicyExplainer'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('policy_explainer_settings')
    .select('enabled')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) throw new Error('Policy explainer settings unavailable')
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settingsTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <NextIntlClientProvider messages={{ PolicyExplainer: messages.PolicyExplainer }}>
          <PolicyExplainerSettingsForm
            organizationId={organizationId}
            enabled={data?.enabled ?? false}
            configured={Boolean(policyExplainerConfiguration())}
          />
        </NextIntlClientProvider>
      </CardContent>
    </Card>
  )
}
