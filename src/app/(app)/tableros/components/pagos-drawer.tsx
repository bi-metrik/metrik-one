'use client'

/**
 * Panel lateral con los pagos que entraron en un mes.
 *
 * Tercer hermano de `VentasDrawer` y `CasosDrawer`, y el unico cuya unidad NO es un
 * negocio: aqui cada fila es un cobro. Existe porque las dos barras de recaudo del
 * historico cuentan plata RECIBIDA en el mes, y esa plata viene de ventas de cualquier
 * mes anterior — la lista de ventas de agosto jamas sumaria la barra de recaudo de
 * agosto.
 *
 * Lo que la pantalla tenia que empezar a decir: de lo que entra, no todo es ingreso.
 * Cada peso se imputa a una franja (tramo 1 del honorario, tarifa UPME, tramo 2,
 * excedente) y solo los dos tramos son plata propia. En agosto de 2026 entraron
 * $45,3M de los que $25,1M eran tarifa de terceros; hasta esta version el grafico
 * pintaba los $45,3M como recaudo.
 */

import { useEffect, useState } from 'react'
import { X, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { getComercialPagosMes } from '../../equipo/comercial-actions'
import type { ComercialPagoMes } from '../../equipo/comercial-types'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const VERDE = '#059669'
const OCRE = '#92400E'
const AZUL = '#1D4ED8'

const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export interface MesSeleccionado {
  anio: number
  mes: number
}

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

/** '2026-08-05' → '05/08'. Se arma desde las partes: `new Date('YYYY-MM-DD')` se
 *  interpreta como UTC y en Colombia cae un dia antes. */
function fmtDia(iso: string | null): string | null {
  if (!iso) return null
  const [, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : null
}

/** 'Jun 26' a partir de una fecha de venta, para decir de que mes viene el abono. */
function mesDeVenta(iso: string | null): string | null {
  if (!iso) return null
  const [a, m] = iso.split('-')
  const i = Number(m) - 1
  return MESES_ES[i] ? `${MESES_ES[i].slice(0, 3)} ${a.slice(2)}` : null
}

export function PagosDrawer({
  periodo,
  onClose,
}: {
  periodo: MesSeleccionado
  onClose: () => void
}) {
  const [pagos, setPagos] = useState<ComercialPagoMes[] | null>(null)

  useEffect(() => {
    let vivo = true
    void getComercialPagosMes({ anio: periodo.anio, mes: periodo.mes }).then(r => {
      if (vivo) setPagos(r)
    })
    return () => {
      vivo = false
    }
  }, [periodo.anio, periodo.mes])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filas = pagos ?? []
  const suma = (f: (p: ComercialPagoMes) => number) => filas.reduce((s, p) => s + f(p), 0)
  const honorario = suma(p => p.honorario)
  const tramo1 = suma(p => p.a_tramo1)
  const tramo2 = suma(p => p.a_tramo2)
  const tarifa = suma(p => p.a_tarifa)
  const excedente = suma(p => p.excedente)
  const entro = suma(p => p.monto)

  // Un abono a una venta de OTRO mes es la razon de ser de este panel. Se cuenta para
  // poder decirlo con un numero en vez de dejar que se deduzca fila por fila.
  const deOtrosMeses = filas.filter(p => {
    if (!p.fecha_venta) return false
    const [a, m] = p.fecha_venta.split('-')
    return Number(a) !== periodo.anio || Number(m) !== periodo.mes
  }).length

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div className="fixed inset-y-0 right-0 z-[60] w-full max-w-md animate-in slide-in-from-right duration-200">
        <div className="flex h-full flex-col bg-white shadow-2xl">
          <div
            className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3"
            style={{ borderColor: BORDE }}
          >
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold" style={{ color: CARBON }}>
                Pagos · {MESES_ES[periodo.mes - 1]} {periodo.anio}
              </h2>
              <p className="mt-0.5 truncate text-[11px]" style={{ color: GRIS }}>
                lo que entró en el mes, sin importar de qué venta viene
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 hover:bg-[#F5F4F2]"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" style={{ color: GRIS }} />
            </button>
          </div>

          {/* El desglose va ARRIBA y no al pie: es la respuesta a "por que entraron
              $45M si la barra dice $20M", y esa pregunta se hace al abrir, no despues
              de bajar cincuenta filas. */}
          {pagos !== null && filas.length > 0 && (
            <div className="shrink-0 border-b px-4 py-3" style={{ borderColor: BORDE }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px]" style={{ color: GRIS }}>Honorario (es la barra)</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: VERDE }}>
                  {fmtCOP(honorario)}
                </span>
              </div>
              <div className="mt-1.5 space-y-1 text-[11px]">
                <Linea label="1er pago" valor={fmtCOP(tramo1)} color={VERDE} />
                {tramo2 > 0 && <Linea label="2º pago" valor={fmtCOP(tramo2)} color={OCRE} />}
                {tarifa > 0 && (
                  <Linea
                    label="Tarifa UPME (de terceros)"
                    valor={fmtCOP(tarifa)}
                    color={GRIS}
                    ayuda="Entró a la cuenta pero no es ingreso: se gira a la UPME"
                  />
                )}
                {excedente > 0 && (
                  <Linea
                    label="Excedente"
                    valor={fmtCOP(excedente)}
                    color={GRIS}
                    ayuda="Pagaron por encima del valor del negocio"
                  />
                )}
                <div className="flex items-baseline justify-between gap-2 border-t pt-1" style={{ borderColor: BORDE }}>
                  <span style={{ color: GRIS }}>Entró a la cuenta</span>
                  <span className="font-semibold tabular-nums" style={{ color: CARBON }}>{fmtCOP(entro)}</span>
                </div>
              </div>
              {deOtrosMeses > 0 && (
                <p className="mt-2 text-[11px]" style={{ color: AZUL }}>
                  {deOtrosMeses} de {filas.length} abonan a ventas de otros meses.
                </p>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3">
            {pagos === null ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>
                Cargando…
              </p>
            ) : filas.length === 0 ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>
                No entró ningún pago este mes.
              </p>
            ) : (
              <ul className="space-y-2">
                {filas.map(p => {
                  const mesVenta = mesDeVenta(p.fecha_venta)
                  const esDeOtroMes =
                    p.fecha_venta !== null &&
                    (Number(p.fecha_venta.split('-')[0]) !== periodo.anio ||
                      Number(p.fecha_venta.split('-')[1]) !== periodo.mes)
                  const fila = (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold" style={{ color: CARBON }}>
                            {p.codigo && (
                              <span className="mr-1.5 font-mono" style={{ color: GRIS }}>
                                {p.codigo}
                              </span>
                            )}
                            {p.nombre ?? 'Cobro sin negocio'}
                          </p>
                          <p className="mt-0.5 truncate text-[11px]" style={{ color: GRIS }}>
                            {fmtDia(p.fecha)}
                            {mesVenta && (
                              <span style={{ color: esDeOtroMes ? AZUL : GRIS }}>
                                {' · venta de '}{mesVenta}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs font-bold tabular-nums" style={{ color: CARBON }}>
                            {fmtCOP(p.monto)}
                          </p>
                          {p.honorario !== p.monto && (
                            <p className="text-[10px] tabular-nums" style={{ color: VERDE }}>
                              {fmtCOP(p.honorario)} honorario
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Solo las franjas con plata. Una fila de ceros diria "cero
                          tarifa" en cobros donde la tarifa ni siquiera aplica. */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {p.a_tramo1 > 0 && <Chip texto={`1er pago ${fmtCOP(p.a_tramo1)}`} color={VERDE} fondo="#ECFDF5" />}
                        {p.a_tramo2 > 0 && <Chip texto={`2º pago ${fmtCOP(p.a_tramo2)}`} color={OCRE} fondo="#FFFBEB" />}
                        {p.a_tarifa > 0 && <Chip texto={`Tarifa ${fmtCOP(p.a_tarifa)}`} color={GRIS} fondo="#F5F4F2" />}
                        {p.excedente > 0 && <Chip texto={`Excedente ${fmtCOP(p.excedente)}`} color={GRIS} fondo="#F5F4F2" />}
                      </div>
                    </>
                  )
                  return (
                    <li key={p.cobro_id}>
                      {p.negocio_id ? (
                        <Link
                          href={`/negocios/${p.negocio_id}`}
                          className="block rounded-lg border p-3 transition-colors hover:bg-[#F9FAFB]"
                          style={{ borderColor: BORDE }}
                        >
                          {fila}
                          <ExternalLink className="mt-1 h-3 w-3" style={{ color: BORDE }} />
                        </Link>
                      ) : (
                        // Sin negocio no hay a donde ir: se pinta igual pero sin enlace,
                        // en vez de un link que lleve a una pantalla en blanco.
                        <div className="rounded-lg border p-3" style={{ borderColor: BORDE }}>
                          {fila}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function Linea({ label, valor, color, ayuda }: { label: string; valor: string; color: string; ayuda?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2" title={ayuda}>
      <span style={{ color: GRIS }}>{label}</span>
      <span className="font-semibold tabular-nums" style={{ color }}>{valor}</span>
    </div>
  )
}

function Chip({ texto, color, fondo }: { texto: string; color: string; fondo: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
      style={{ backgroundColor: fondo, color }}
    >
      {texto}
    </span>
  )
}
