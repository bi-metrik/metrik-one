import { CalendarClock, CreditCard } from 'lucide-react'
import { formatCOP } from '@/lib/cobros/format'
import { NOTA_IVA_CDA } from '@/lib/valida-cda/redaccion-fiscal'
import { fechaCorta } from '@/lib/valida-cda/pago-pendiente'
import { fechasDePagoV15, textosPagoCuotaV15 } from '@/lib/valida-cda/plazos'
import type { LecturaPago } from '@/lib/valida-cda/pago-servidor'
import { PagarAhora } from './pagar-ahora'

/**
 * El próximo pago de la suscripción, arriba del Resumen de `/suscripcion`.
 *
 * Informa y ofrece pagar; no bloquea nada (la mora se maneja por la cláusula 11 de los Términos).
 * La página ya decidió que quien entra puede ver la plata (dueño, administrador o persona designada).
 *
 * El botón «Pagar en línea» sale solo con un enlace de pago vigente de la cuota
 * (`cobros.enlace_pago_url`, validado en `pago-pendiente.ts`); sin enlace se dice cuándo llega,
 * nunca un botón muerto. La tarjeta no nombra a ningún proveedor de pagos.
 *
 * Sin estado ni efectos: se pinta en el servidor.
 */
export function TarjetaPago({
  lectura,
  pagarAhora = false,
  rechazoTarjeta = null,
  avisoTarjeta = null,
  tarjetaActiva = null,
  transicion = null,
  hoy = null,
}: {
  lectura: LecturaPago
  /**
   * La vigencia de la v1.5 (`contextoSuscripcion().transicion`) y el día de hoy en Bogotá: con las dos, la
   * tarjeta dice la fecha de renovación («Paga antes del 23-dic») y desde cuándo queda Suspendida por pago,
   * no el vencimiento guardado (D7 del diseño del 4-nov).
   */
  transicion?: string | null
  hoy?: string | null
  /** Una suscripción sin enlace vigente: «Pagar ahora» pide el enlace ya (`pagarCuotaPendiente`). */
  pagarAhora?: boolean
  /** La respuesta del banco al cobrar la tarjeta guardada, si la rechazó. */
  rechazoTarjeta?: string | null
  /** El aviso de un CDA con pago automático cuyo cobro a la tarjeta no pasó (`textoFalloTarjeta`). */
  avisoTarjeta?: string | null
  /**
   * El resumen del pago automático de un CDA («Pago automático activo · tarjeta terminada en 4242 · …»). Sin
   * enlace vigente, eso es lo que se dice: la cuota la cobra la tarjeta, no llega un enlace.
   */
  tarjetaActiva?: string | null
}) {
  if (lectura.estado === 'no_disponible') {
    return (
      <p data-pago-cda="no_disponible" className="text-xs text-tinta-suave">
        No se pudo cargar tu próximo pago en este momento.
      </p>
    )
  }

  const { pago } = lectura
  // Sin cuotas registradas no hay nada que afirmar: ni «al día» ni un pago inventado.
  if (pago.estado === 'sin_cuotas') return null

  if (pago.estado === 'al_dia') {
    return (
      <p data-pago-cda="al_dia" className="rounded-lg border border-border bg-white p-4 text-sm text-tinta">
        Tu suscripción está al día. Las cuotas pagadas y sus facturas están en Pagos.
      </p>
    )
  }

  const parcial = pago.abonado > 0
  const fechasV15 = hoy ? fechasDePagoV15(pago, transicion) : null
  const v15 = fechasV15 && hoy ? textosPagoCuotaV15(fechasV15, hoy) : null
  const vencida = v15 ? v15.vencida : pago.vencida

  return (
    <section data-pago-cda="pendiente" className="rounded-lg border border-border bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <CreditCard className="mt-0.5 hidden h-5 w-5 shrink-0 text-acento sm:block" />
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold text-tinta">{vencida ? 'Pago vencido' : 'Tu próximo pago'}</h2>
            {pago.concepto && <p className="text-sm text-tinta">{pago.concepto}</p>}
            <p className="text-2xl font-bold text-tinta" data-monto>
              {formatCOP(pago.saldo)}
            </p>
            {parcial && (
              <p className="text-xs text-tinta-suave">
                Ya abonaste {formatCOP(pago.abonado)} de {formatCOP(pago.monto)}.
              </p>
            )}
            <p className="text-xs text-tinta-suave">{NOTA_IVA_CDA}</p>
            {avisoTarjeta && (
              <p data-aviso-tarjeta className="text-sm text-tinta">
                {avisoTarjeta}
              </p>
            )}
            {rechazoTarjeta && (
              <p data-rechazo-tarjeta className="text-sm text-tinta">
                El banco rechazó el cobro a tu tarjeta: {rechazoTarjeta}. No se cobró nada. Puedes pagar ahora con otro
                medio.
              </p>
            )}
            <p className={`flex items-center gap-1.5 text-sm ${vencida ? 'font-semibold text-amber-800' : 'text-tinta'}`}>
              <CalendarClock className="h-4 w-4 shrink-0" />
              {v15 ? v15.fecha : `${pago.vencida ? 'Venció el' : 'Vence el'} ${fechaCorta(pago.fechaVencimiento)}`}
            </p>
            {v15?.consecuencia && (
              <p data-consecuencia-pago className="text-sm text-tinta">
                {v15.consecuencia}
              </p>
            )}
          </div>
        </div>

        <div className="sm:shrink-0">
          {pago.enlacePago ? (
            <a
              href={pago.enlacePago}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center rounded-md bg-acento px-5 py-2.5 text-sm font-semibold text-white sm:w-auto"
            >
              Pagar en línea
            </a>
          ) : pagarAhora ? (
            <PagarAhora />
          ) : tarjetaActiva && !avisoTarjeta ? (
            <p className="max-w-xs text-sm text-tinta" data-cobra-tarjeta>
              {tarjetaActiva}
            </p>
          ) : (
            <p className="max-w-xs text-sm text-tinta-suave" data-sin-enlace>
              {pago.enlaceVencido
                ? 'El enlace de pago de esta cuota venció. MéTRIK te enviará uno nuevo.'
                : vencida
                  ? // Prometer el enlace «antes del» una fecha ya pasada no tiene sentido.
                    'MéTRIK te enviará el enlace de pago de esta cuota.'
                  : `El enlace de pago estará disponible antes del ${fechaCorta(fechasV15?.renovacion ?? pago.fechaVencimiento)}.`}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
