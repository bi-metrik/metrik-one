'use client'

/**
 * Panel lateral con los negocios detrás de una de las dos cifras de segundo pago
 * (SOE-002).
 *
 * Hermano de `VentasDrawer`, con la misma forma en pantalla. No lo reusa porque aquel
 * abre las ventas DEL mes, y el "2º pago recibido este mes" viene sobre todo de ventas de
 * meses anteriores: filtrado por mes de venta, la lista nunca sumaría la cifra. Aquí no se
 * consulta nada: la lista llega con la cifra, así que es exactamente la que sumó.
 */

import { useEffect } from 'react'
import { X, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import {
  TITULO_SEGUNDO_PAGO,
  notaSegundoPago,
  type CifraSegundoPago,
  type SegundoPagoMes,
} from '@/lib/tableros/segundo-pago'

const CARBON = 'var(--tinta)'
const GRIS = 'var(--tinta-suave)'
const BORDE = '#E5E7EB'
const OCRE = '#92400E'

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

/** '2026-08-05' → '05/08'. Desde las partes: `new Date('YYYY-MM-DD')` cae un día antes en Colombia. */
function fmtDia(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : '—'
}

/** '2026-07-22' → 'Jul 26'. */
function fmtMes(iso: string | null): string {
  if (!iso) return '—'
  const [a, m] = iso.split('-')
  const i = Number(m) - 1
  return MESES_CORTOS[i] ? `${MESES_CORTOS[i]} ${a.slice(2)}` : '—'
}

export function SegundoPagoDrawer({
  datos,
  cifra,
  onClose,
}: {
  datos: SegundoPagoMes
  cifra: CifraSegundoPago
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const bloque = cifra === 'recibido' ? datos.recibido : datos.de_ventas_del_mes
  const casos = bloque.detalle

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
              <h2 className="text-sm font-bold" style={{ color: CARBON }}>
                {TITULO_SEGUNDO_PAGO[cifra]} · {MESES_ES[datos.mes - 1]} {datos.anio}
              </h2>
              <p className="mt-0.5 text-[11px]" style={{ color: GRIS }}>
                {notaSegundoPago(cifra, datos.umbral_migaja)}
              </p>
              {cifra === 'recibido' && datos.recibido.total > 0 && (
                <p className="mt-1 text-[11px]" style={{ color: GRIS }}>
                  {fmtCOP(datos.recibido.de_ventas_del_mes)} de ventas de este mes ·{' '}
                  {fmtCOP(datos.recibido.de_ventas_anteriores)} de ventas de meses anteriores
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 hover:bg-papel"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" style={{ color: GRIS }} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {casos.length === 0 ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>
                No hay casos aquí.
              </p>
            ) : (
              <ul className="space-y-2">
                {casos.map(c => (
                  <li key={c.negocio_id}>
                    <Link
                      href={`/negocios/${c.negocio_id}`}
                      className="block rounded-lg border p-3 transition-colors hover:bg-[#F9FAFB]"
                      style={{ borderColor: BORDE }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold" style={{ color: CARBON }}>
                            {c.codigo && (
                              <span className="mr-1.5 font-mono" style={{ color: GRIS }}>
                                {c.codigo}
                              </span>
                            )}
                            {c.nombre}
                          </p>
                          <p className="mt-0.5 truncate text-[11px]" style={{ color: GRIS }}>
                            {c.responsable ?? 'Sin comercial'}
                          </p>
                        </div>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: BORDE }} />
                      </div>

                      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]">
                        <span className="flex items-baseline gap-1">
                          <span style={{ color: '#9CA3AF' }}>Venta</span>
                          <span className="font-medium tabular-nums" style={{ color: CARBON }}>
                            {fmtMes(c.fecha_venta)}
                          </span>
                        </span>
                        <span className="flex items-baseline gap-1">
                          <span style={{ color: '#9CA3AF' }}>2º pago</span>
                          <span className="font-medium tabular-nums" style={{ color: CARBON }}>
                            {fmtDia(c.fecha_pago)}
                          </span>
                        </span>
                        <span
                          className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                          style={{ backgroundColor: '#FEF3C7', color: OCRE }}
                          title="Segundo tramo del honorario, sin IVA"
                        >
                          {fmtCOP(c.valor)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {casos.length > 0 && (
            <div className="shrink-0 border-t px-4 py-2 text-[11px]" style={{ borderColor: BORDE, color: GRIS }}>
              {casos.length} caso{casos.length === 1 ? '' : 's'} · {fmtCOP(bloque.total)} sin IVA
            </div>
          )}
        </div>
      </div>
    </>
  )
}
