'use client'

/**
 * «Así puedes pagar» en el paso «Revisar y enviar» (F2, PR 7; Noor §4.1, Vera C2 y F2-1).
 *
 * Lo mismo que sale en el PDF, debajo del total: el plan sugerido 80/15 sobre el total del
 * documento. Si la pantalla no puede saber ese total con certeza (sin el IVA sobre el ingreso
 * propio), dice la regla en palabras y que los montos van en el PDF: nunca unas cifras que no
 * sumen lo que el cliente va a leer.
 */

import { asiPuedesPagar, notaDeFila, reglaEnPalabras, TITULO_ASI_PUEDES_PAGAR, type EntradaAsiPuedesPagar } from '@/lib/viaje/asi-puedes-pagar'
import { pesos } from '@/lib/viaje/plan-pagos'

export default function AsiPuedesPagarPanel({
  entrada,
  total,
}: {
  entrada: EntradaAsiPuedesPagar
  /** El TOTAL del PDF; `null` si la pantalla no lo puede calcular igual. */
  total: number | null
}) {
  const plan = total !== null && total > 0 ? asiPuedesPagar(total, entrada) : null
  return (
    <div className="rounded-lg border p-3 text-xs" data-asi-puedes-pagar>
      <p className="font-semibold">{TITULO_ASI_PUEDES_PAGAR}</p>
      {plan?.filas ? (
        <>
          <ul className="mt-1.5 space-y-1">
            {plan.filas.map((f, i) => {
              const nota = notaDeFila(f, plan.pctMinimo, pesos)
              return (
                <li key={i} className="flex flex-wrap gap-x-2">
                  <span className="w-24 shrink-0 font-semibold tabular-nums">{pesos(f.monto)}</span>
                  <span className="min-w-0 flex-1">
                    {f.cuando}
                    {nota && <span className="text-muted-foreground"> · {nota}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-1.5 text-muted-foreground">
            Suma {pesos(plan.suma)}, el total del PDF. {plan.pie}
          </p>
        </>
      ) : (
        <p className="mt-1 text-muted-foreground">
          {plan?.regla ?? reglaEnPalabras(entrada.regla)}{' '}
          {total === null
            ? 'Los montos salen en el PDF, sobre su total.'
            : 'Sin fecha de salida no hay montos: se acuerdan al confirmar.'}
        </p>
      )}
    </div>
  )
}
