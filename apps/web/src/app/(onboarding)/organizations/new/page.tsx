import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireClaims } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { CreateOrganizationForm, type ReferenceOption } from './create-organization-form'

const DEFAULT_BASE_CURRENCY = 'SAR'
const DEFAULT_HOME_COUNTRY = 'SA'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Organizations.new')
  return { title: t('title') }
}

/** Guarantees the default code is selectable even when the reference table has not been seeded. */
function withDefault(options: ReferenceOption[], code: string): ReferenceOption[] {
  return options.some((option) => option.code === code)
    ? options
    : [{ code, name: code }, ...options]
}

export default async function NewOrganizationPage() {
  await requireClaims()
  const supabase = await createClient()
  const [currenciesResult, countriesResult, t, tCommon] = await Promise.all([
    supabase.from('currencies').select('code, name_en').order('code'),
    supabase.from('countries').select('code, name_en').order('name_en'),
    getTranslations('Organizations.new'),
    getTranslations('Common'),
  ])
  const currencies = withDefault(
    (currenciesResult.data ?? []).map((row) => ({ code: row.code, name: row.name_en })),
    DEFAULT_BASE_CURRENCY,
  )
  const countries = withDefault(
    (countriesResult.data ?? []).map((row) => ({ code: row.code, name: row.name_en })),
    DEFAULT_HOME_COUNTRY,
  )

  return (
    <>
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/organizations" />}
          nativeButton={false}
        >
          {tCommon('back')}
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{t('title')}</h1>
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateOrganizationForm
            currencies={currencies}
            countries={countries}
            defaultCurrency={DEFAULT_BASE_CURRENCY}
            defaultCountry={DEFAULT_HOME_COUNTRY}
          />
        </CardContent>
      </Card>
    </>
  )
}
