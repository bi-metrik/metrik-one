'use client'

/**
 * Panel lateral con los casos que se perdieron en el mes.
 *
 * Es la única cifra del panel comercial que representa un conjunto concreto de
 * casos y no abría nada. No pudo reusar `VentasDrawer` porque un negocio perdido
 * puede no tener ningún cobro, y entonces no existe en la vista de ventas: la
 * lista sale de su propia consulta, con el MISMO criterio que produce el número.
 */

import { useEffect, useState } from 'react'
import { X, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { getComercialPerdidosMes } from '../../equipo/comercial-actions'
import type { ComercialPerdido } from '../../equipo/comercial-types'
import { RAZONES_PERDIDA_NEGOCIO } from '@/lib/negocios/constants'
import { origenNegocioLabel } from '@/lib/catalogos/constants'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const OCRE = '#92400E'

/** '2026-08-05' → '05/08'. Se arma desde las partes: `new Date('YYYY-MM-DD')` se
 *  interpreta como UTC y en Colombia cae un día antes. */
function fmtDia(iso: string | null): string | null {
  if (!iso) return null
  const [, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : null
}

/** El catálogo manda: si el valor no está, se muestra tal cual en vez de callarlo. */
function razonLabel(razon: string | null): string {
  if (!razon) return 'sin motivo registrado'
  return RAZONES_PERDIDA_NEGOCIO.find(r => r.value === razon)?.label ?? razon
}

export function PerdidosDrawer({
  anio,
  mes,
  titulo,
  onClose,
}: {
  anio: number
  mes: number
  titulo: string
  onClose: () => void
}) {
  const [casos, setCasos] = useState<ComercialPerdido[] | null>(null)

  useEffect(() => {
    let vivo = true
    void getComercialPerdidosMes(anio, mes).then(r => {
      if (vivo) setCasos(r)
    })
    return () => {
      vivo = false
    }
  }, [anio, mes])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
                {titulo}
              </h2>
              <p className="mt-0.5 text-[11px]" style={{ color: GRIS }}>
                casos marcados como perdidos en el mes
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

          <div className="flex-1 overflow-y-auto p-3">
            {casos === null ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>
                Cargando…
              </p>
            ) : casos.length === 0 ? (
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
                            {c.etapa ? ` · se perdió en ${c.etapa}` : ''}
                          </p>
                        </div>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: BORDE }} />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span
                          className="rounded px-1.5 py-0.5 font-medium"
                          style={{
                            backgroundColor: c.razon ? '#FEF3C7' : '#F5F4F2',
                            color: c.razon ? OCRE : GRIS,
                          }}
                        >
                          {razonLabel(c.razon)}
                        </span>
                        <span style={{ color: GRIS }}>{fmtDia(c.fecha) ?? '—'}</span>
                      </div>

                      {c.detalle && (
                        <p className="mt-1.5 line-clamp-2 text-[11px]" style={{ color: GRIS }}>
                          {c.detalle}
                        </p>
                      )}

                      {/* El origen también importa en lo que se pierde: si una campaña
                          trae leads que no califican, se ve aquí antes que en el cierre. */}
                      <p className="mt-1.5 truncate text-[11px]" style={{ color: '#9CA3AF' }}>
                        {origenNegocioLabel(c.origen_declarado) ?? 'origen sin declarar'}
                        {c.tiene_rastro_meta
                          ? ` · ${c.campana ?? 'Meta sin campaña'}`
                          : ' · sin rastro de Meta'}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {casos !== null && casos.length > 0 && (
            <div className="shrink-0 border-t px-4 py-2 text-[11px]" style={{ borderColor: BORDE, color: GRIS }}>
              {casos.length} caso{casos.length === 1 ? '' : 's'} · más reciente primero
            </div>
          )}
        </div>
      </div>
    </>
  )
}
