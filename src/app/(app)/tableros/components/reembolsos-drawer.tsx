'use client'

/**
 * Panel lateral con las devoluciones de dinero del mes (SOE-007).
 *
 * Hermano de `SegundoPagoDrawer`, con la misma forma en pantalla. Aquí no se consulta nada:
 * la lista llega con la cifra, así que es exactamente la que sumó. En Comercial abre además
 * el corte por vendedor, sumado de la misma lista.
 */

import { useEffect } from 'react'
import { X, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import {
  ETIQUETA_CIERRE,
  NOTA_REEMBOLSOS,
  reembolsosPorVendedor,
  type ReembolsosMes,
} from '@/lib/tableros/reembolsos'

const CARBON = 'var(--tinta)'
const GRIS = 'var(--tinta-suave)'
const BORDE = '#E5E7EB'
const ROJO = '#991B1B'

const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

/** '2026-10-08' → '08/10'. Desde las partes: `new Date('YYYY-MM-DD')` cae un día antes en Colombia. */
function fmtDia(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : '—'
}

export function ReembolsosDrawer({
  datos,
  porVendedor = false,
  onClose,
}: {
  datos: ReembolsosMes
  /** Abre arriba el corte por vendedor (Comercial). */
  porVendedor?: boolean
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const casos = datos.detalle
  const vendedores = porVendedor ? reembolsosPorVendedor(casos) : []

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
                Reembolsos · {MESES_ES[datos.mes - 1]} {datos.anio}
              </h2>
              <p className="mt-0.5 text-[11px]" style={{ color: GRIS }}>
                {NOTA_REEMBOLSOS}. Una venta a la que se le devolvió todo ya no cuenta en las ventas de su mes.
              </p>
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
            {vendedores.length > 0 && (
              <div className="mb-3 rounded-lg border p-3" style={{ borderColor: BORDE }}>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: GRIS }}>
                  Por vendedor
                </p>
                <ul className="space-y-1">
                  {vendedores.map((v) => (
                    <li key={v.responsable_id ?? 'sin'} className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="truncate" style={{ color: CARBON }}>{v.responsable}</span>
                      <span className="shrink-0 tabular-nums" style={{ color: GRIS }}>
                        {v.reembolsos} · <span style={{ color: ROJO }}>{fmtCOP(v.valor)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {casos.length === 0 ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>
                No hubo reembolsos este mes.
              </p>
            ) : (
              <ul className="space-y-2">
                {casos.map((c) => (
                  <li key={c.devolucion_id}>
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

                      <p className="mt-1.5 line-clamp-2 text-[11px]" style={{ color: CARBON }}>
                        {c.motivo}
                      </p>

                      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]">
                        <span className="flex items-baseline gap-1">
                          <span style={{ color: '#9CA3AF' }}>Devuelto</span>
                          <span className="font-medium tabular-nums" style={{ color: CARBON }}>
                            {fmtDia(c.fecha)}
                          </span>
                        </span>
                        <span style={{ color: GRIS }}>{ETIQUETA_CIERRE[c.cierre]}</span>
                        {c.venta_anulada && (
                          <span style={{ color: GRIS }} title="Se devolvió todo lo que pagó: no cuenta como venta">
                            · ya no es venta
                          </span>
                        )}
                        <span
                          className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                          style={{ backgroundColor: '#FEE2E2', color: ROJO }}
                          title={`Sin IVA. Salieron de la cuenta ${fmtCOP(c.monto)} con IVA.`}
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
              {casos.length} reembolso{casos.length === 1 ? '' : 's'} · {fmtCOP(datos.valor)} sin IVA ·{' '}
              {fmtCOP(datos.monto)} con IVA
            </div>
          )}
        </div>
      </div>
    </>
  )
}
