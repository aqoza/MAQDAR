import { getTranslations } from 'next-intl/server'
import { TableScrollRegion } from './table-scroll-region'
import {
  forecastEvidenceReferences,
  type ForecastExplanationEvidence,
} from '@/lib/forecast-explainer'
type ForecastField =
  | keyof ForecastExplanationEvidence['forecast_context']
  | keyof ForecastExplanationEvidence['uncertainty']
  | keyof ForecastExplanationEvidence['held_out_coverage']
  | keyof ForecastExplanationEvidence['backtest_windows']['windows'][number]
  | keyof ForecastExplanationEvidence['model_comparison']['scores'][number]
type ForecastModel = ForecastExplanationEvidence['forecast_context']['selected_model']
type ForecastStatus = ForecastExplanationEvidence['held_out_coverage']['status']
export async function ForecastExplainerEvidence({
  evidence,
}: {
  evidence: ForecastExplanationEvidence
}) {
  const t = await getTranslations('ForecastExplainer'),
    common = await getTranslations('PolicyExplainer'),
    forecasting = await getTranslations('Forecasting')
  const field = (key: string, value: unknown) => (
    <div key={key} className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{t(`fields.${key as ForecastField}`)}</dt>
      <dd className="break-words tabular-nums [overflow-wrap:anywhere]">
        {value == null ? (
          t('missing')
        ) : key === 'status' ? (
          t(`statuses.${value as ForecastStatus}`)
        ) : (
          <bdi>{String(value)}</bdi>
        )}
      </dd>
    </div>
  )
  return (
    <section className="min-w-0 space-y-3 workspace-panel" aria-labelledby="evidence-title">
      <h2 id="evidence-title" className="text-section-title">
        {common('evidenceTitle')}
      </h2>
      <p>
        {common('unit')}: <bdi>{evidence.unit}</bdi>
      </p>
      <p className="text-xs text-muted-foreground">{common('projection')}</p>
      {forecastEvidenceReferences.map((reference) => (
        <details
          key={reference}
          id={`evidence-${reference}`}
          className="scroll-mt-4 min-w-0 rounded-md border p-3"
          open={reference === 'forecast_context'}
        >
          <summary className="min-h-11 cursor-pointer font-medium md:min-h-0">
            {t(`references.${reference}`)}
          </summary>
          <div className="mt-3 min-w-0 space-y-3">
            {reference === 'forecast_context' && (
              <dl className="grid gap-2">
                {Object.entries(evidence.forecast_context).map(([key, value]) =>
                  field(
                    key,
                    key === 'selected_model'
                      ? forecasting(`models.${value as ForecastModel}`)
                      : value,
                  ),
                )}
              </dl>
            )}
            {reference === 'model_comparison' && (
              <>
                <p className="text-xs">{t('comparisonNote')}</p>
                <TableScrollRegion label={t('references.model_comparison')}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        {['model', 'rmse', 'mae', 'bias'].map((key) => (
                          <th key={key} className="p-2 text-start text-xs font-medium">
                            {t(`fields.${key as ForecastField}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {evidence.model_comparison.scores.map((row) => (
                        <tr key={row.model} className="border-t">
                          <td className="p-2">{forecasting(`models.${row.model}`)}</td>
                          {[row.rmse, row.mae, row.bias].map((value, i) => (
                            <td key={i} className="p-2 tabular-nums">
                              <bdi>{value}</bdi>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScrollRegion>
                {evidence.model_comparison.unavailable_models.length > 0 && (
                  <div>
                    <h3 className="text-subsection-title">{t('excluded')}</h3>
                    <ul className="space-y-1">
                      {evidence.model_comparison.unavailable_models.map((row) => (
                        <li key={row.model}>
                          {forecasting(`models.${row.model}`)}: {t(`reasons.${row.reason}`)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            {reference === 'backtest_windows' && (
              <div className="space-y-3">
                {evidence.backtest_windows.windows.map((window, i) => (
                  <dl key={i} className="grid gap-2 border-b pb-2">
                    {Object.entries(window).map(([key, value]) => field(key, value))}
                  </dl>
                ))}
              </div>
            )}
            {reference === 'uncertainty' && (
              <dl className="grid gap-2">
                {Object.entries(evidence.uncertainty).map(([key, value]) => field(key, value))}
              </dl>
            )}
            {reference === 'held_out_coverage' && (
              <>
                <p className="text-xs">{t('coverageNote')}</p>
                <dl className="grid gap-2">
                  {Object.entries(evidence.held_out_coverage).map(([key, value]) =>
                    field(
                      key,
                      key === 'model' && value
                        ? forecasting(`models.${value as ForecastModel}`)
                        : value,
                    ),
                  )}
                </dl>
              </>
            )}
            {reference === 'forecast_limits' && (
              <>
                <p>{t('stockNote')}</p>
                {evidence.forecast_limits.driver_conditioned && <p>{t('driverNote')}</p>}
              </>
            )}
          </div>
        </details>
      ))}
    </section>
  )
}
