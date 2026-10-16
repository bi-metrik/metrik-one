'use client'

import { useState } from 'react'
import Link from 'next/link'
import { RUTA_ACTIVAR_PLAN, type SaldoBolsa } from '@/lib/valida/corte-bolsa'
import type { PruebaEnPantalla } from '@/lib/valida-registro/prueba-en-pantalla'
import { CancelarPrueba, ClausulaCobro, TEXTO_PRUEBA_CANCELADA } from './cobro-prueba'

export type { PruebaEnPantalla }

/**
 * La franja ÚNICA de la prueba en `/valida` (Mauricio y Noor, 2026-10-16: «muy invasiva»). Reemplaza
 * los tres bloques de antes (el aviso de la tarjeta con «Cancelar prueba», la línea «Te quedan N
 * consultas de prueba. Vence el…» y la tarjeta «Comienza por aquí»):
 *
 *   línea 1  «10/10 consultas · hasta el 23 de octubre»     [Activar plan] [Cancelar prueba]
 *   debajo   la cláusula del cobro, con su texto exacto (`ClausulaCobro`).
 *
 * En el celular la franja ocupa como mucho dos líneas: el contador y la fecha arriba, las acciones
 * abajo. El contador es «restantes/total» y baja con cada consulta (lo baja `ValidaClient`).
 *
 * UNA sola fecha: la del fin de la prueba, que es la misma del cobro (`pruebaEnPantalla`).
 */

export function FranjaPrueba({ saldo, prueba }: { saldo: SaldoBolsa | null; prueba: PruebaEnPantalla }) {
  const [cancelada, setCancelada] = useState<string | null>(prueba.cobro?.estado === 'cancelado' ? TEXTO_PRUEBA_CANCELADA : null)
  const cobro = prueba.cobro
  const conContador = saldo !== null && saldo.compradas > 0

  return (
    <section data-franja-prueba className="rounded-lg border border-border bg-white px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex min-w-0 items-baseline gap-2 text-sm text-tinta-suave">
          {conContador && (
            <span data-contador-consultas={`${saldo.saldo}/${saldo.compradas}`} className="tabular-nums">
              <span className="text-lg font-bold text-acento">{saldo.saldo}</span>
              <span className="font-semibold text-tinta">/{saldo.compradas}</span>
            </span>
          )}
          <span>
            {conContador ? 'consultas de prueba' : 'Prueba gratis'}
            {prueba.finTexto && (
              <>
                {' · hasta el '}
                <span data-fin-prueba className="font-semibold text-tinta">
                  {prueba.finTexto}
                </span>
              </>
            )}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <Link
            href={RUTA_ACTIVAR_PLAN}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-acento px-4 text-sm font-semibold text-white"
          >
            Activar plan
          </Link>
          {cobro && cobro.estado === 'programado' && cobro.puedeCancelar && !cancelada && (
            <CancelarPrueba boton={cobro.boton} onCancelada={setCancelada} />
          )}
        </div>
      </div>
      {cobro && !cancelada && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          <ClausulaCobro fechaYHora={cobro.fechaYHora} fechaCorta={cobro.fechaCorta} precio={cobro.precio} />
        </div>
      )}
      {cancelada && (
        <p data-cobro-prueba="cancelado" className="mt-1.5 border-t border-border pt-1.5 text-xs text-tinta-suave">
          {cancelada}
        </p>
      )}
    </section>
  )
}
