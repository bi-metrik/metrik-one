import { CreditCard, TimerReset } from 'lucide-react'
import { formatCOP } from '@/lib/cobros/format'
import { fechaDiaMes, textoBannerTrial } from '@/lib/radar/acceso'
import type { PagoDelRadar } from '@/lib/radar/acceso-servidor'

/**
 * El banner de prueba, arriba de la pantalla del Radar y siempre visible (bloque G de la spec,
 * pedido de Mauricio el 2026-09-28).
 *
 * Tres cosas que no son de estilo:
 *
 *   1. **El contador llega calculado del servidor** (`diasRestantes`), desde la aceptación de los
 *      términos y en horario de Bogotá. Aquí no se resta ninguna fecha: un reloj de navegador mal
 *      puesto —o movido a propósito— no puede regalar ni quitar días de prueba. Es lo único de este
 *      componente que es seguridad.
 *   2. **Días completos, sin cuenta atrás al segundo.** El cobro es por día; un cronómetro obliga a
 *      refrescar para que no mienta y mete presión inventada.
 *   3. **El precio que se muestra es el del enlace**: el saldo de LA cuota del cliente ($15.000 con
 *      el descuento de fundador de Fabri), no la tarifa de lista. Un banner que diga un número y un
 *      enlace que cobre otro es una reclamación esperando.
 *
 * No se puede cerrar: no es publicidad, es el plazo que corre. En pantalla angosta ocupa una línea
 * de texto y el botón debajo, sin empujar la tabla.
 *
 * Sin estado ni efectos: se pinta en el servidor. El vencido no se pinta aquí — ahí el módulo entero
 * pasa a `RadarCerrado`, que es el mismo régimen del bloque C y no un banner más.
 */
export function BannerTrial({ diasRestantes, pago }: { diasRestantes: number; pago: PagoDelRadar | null }) {
  const ultimoDia = diasRestantes <= 1
  return (
    <section
      data-radar="banner-trial"
      data-dias={diasRestantes}
      className={`flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
        ultimoDia ? 'border-amber-300 bg-amber-50' : 'border-acento-borde bg-acento-tinte'
      }`}
    >
      <p className={`flex items-start gap-2 text-sm text-tinta ${ultimoDia ? 'font-semibold' : ''}`}>
        <TimerReset className="mt-0.5 h-4 w-4 shrink-0 text-acento" />
        <span>
          {textoBannerTrial(diasRestantes)}
          {pago && (
            <span className="font-normal text-tinta-suave">
              {' '}
              Después, {formatCOP(pago.saldo)} al mes; la primera cuota vence el {fechaDiaMes(pago.vence)}.
            </span>
          )}
        </span>
      </p>
      {pago?.enlace ? (
        <a
          href={pago.enlace}
          target="_blank"
          rel="noopener noreferrer"
          data-enlace-pago
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <CreditCard className="h-4 w-4" />
          Activar el Radar
        </a>
      ) : null}
    </section>
  )
}
