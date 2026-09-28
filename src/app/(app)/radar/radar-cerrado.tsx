import { CalendarClock, CreditCard, Radar as RadarIcon } from 'lucide-react'
import { formatCOP } from '@/lib/cobros/format'
import { fechaDiaMes, type AccesoRadar } from '@/lib/radar/acceso'
import type { PagoDelRadar } from '@/lib/radar/acceso-servidor'

/**
 * Lo único que se ve cuando el Radar está cerrado por pago: qué pasó y el enlace para pagar.
 *
 * Decisión de Mauricio (2026-09-28): «para seguir usando el servicio tenga que pagar con el link».
 * Por eso aquí NO se pinta ni una convocatoria, ni el conteo, ni el puntaje: el valor del Radar es
 * la lista, y dejarla a medias sería dejar el producto abierto (ver la cabecera de `acceso.ts`,
 * donde se explica por qué a este módulo no le sirve el «solo lectura» de Clarity y Valida).
 *
 * Sin enlace vigente no hay botón muerto: se dice cuándo llega. El enlace lo genera el paso 6 del
 * cron diario hasta 7 días antes del vencimiento, así que en el caso normal ya existe cuando el
 * cliente llega aquí. La pantalla no nombra al proveedor de pagos.
 *
 * Sin estado ni efectos: se pinta en el servidor.
 */
export function RadarCerrado({
  acceso,
  pago,
}: {
  acceso: Extract<AccesoRadar, { estado: 'cerrado' }>
  pago: PagoDelRadar | null
}) {
  const porTrial = acceso.motivo === 'trial_vencido'
  return (
    <section data-radar="cerrado" data-motivo={acceso.motivo} className="rounded-xl border border-border bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <RadarIcon className="mt-0.5 hidden h-6 w-6 shrink-0 text-acento sm:block" />
        <div className="min-w-0 space-y-2">
          <h2 className="text-lg font-bold text-tinta">
            {porTrial ? 'Tu prueba del Radar terminó' : 'El Radar está cerrado por un pago pendiente'}
          </h2>
          <p className="text-sm text-tinta">
            {porTrial ? (
              <>
                La prueba venció el <strong>{fechaDiaMes(acceso.desde)}</strong>. Para seguir viendo las convocatorias
                de SECOP&nbsp;II cruzadas con tus temas, registra el pago de tu suscripción.
              </>
            ) : (
              <>
                Hay un pago de la suscripción vencido desde el <strong>{fechaDiaMes(acceso.desde)}</strong>. El Radar se
                reabre en cuanto se registre.
              </>
            )}
          </p>
          <p className="text-xs text-tinta-suave">
            Tus temas, tus pesos, tus exclusiones y los procesos que marcaste siguen guardados al menos 60 días: el
            pago los reactiva tal como quedaron. El cierre no borra nada.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-border bg-papel p-4">
        {pago ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-2xl font-bold text-tinta" data-monto>
                {formatCOP(pago.saldo)}
              </p>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
                <CalendarClock className="h-4 w-4 shrink-0" />
                Venció el {fechaDiaMes(pago.vence)}
              </p>
              <p className="text-xs text-tinta-suave">
                Suscripción mensual al Radar SECOP. Servicio de computación en la nube, excluido de IVA.
              </p>
            </div>
            {pago.enlace ? (
              <a
                href={pago.enlace}
                target="_blank"
                rel="noopener noreferrer"
                data-enlace-pago
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-acento px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
              >
                <CreditCard className="h-4 w-4" />
                Pagar en línea
              </a>
            ) : (
              <p data-sin-enlace className="max-w-xs text-xs text-tinta-suave">
                El enlace de pago se está generando: llega al correo de facturación de tu empresa y aparece aquí en la
                próxima revisión diaria. Si lo necesitas ya, escríbenos.
              </p>
            )}
          </div>
        ) : (
          <p data-sin-cuota className="text-sm text-tinta-suave">
            Todavía no está emitida la cuota de tu suscripción. Escríbenos y la generamos: el Radar se reabre con el
            pago registrado.
          </p>
        )}
      </div>
    </section>
  )
}
