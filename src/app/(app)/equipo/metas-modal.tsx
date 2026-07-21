'use client'

import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import type { ComercialResumenRow, MetaComercial } from './comercial-types'
import { MESES_ES } from './comercial-types'
import { guardarMetaComercial } from './comercial-actions'

const GREEN = '#059669'

function nombreCorto(s: string): string {
  return s.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}

interface FilaMeta {
  staffId: string | null
  etiqueta: string
  metaNumVentas: string
  metaValor: string
}

interface Props {
  anio: number
  mes: number
  equipo: ComercialResumenRow[]
  metasIniciales: MetaComercial[]
  onClose: () => void
}

export default function MetasModal({ anio, mes, equipo, metasIniciales, onClose }: Props) {
  const [pending, startTransition] = useTransition()

  function metaDe(staffId: string | null): MetaComercial | undefined {
    return metasIniciales.find((m) => m.staff_id === staffId)
  }

  // Fila global + una por responsable real (excluye el bucket sin-responsable: no se le fija meta).
  const inicial: FilaMeta[] = [
    {
      staffId: null,
      etiqueta: 'Meta global del equipo',
      metaNumVentas: metaDe(null)?.meta_num_ventas?.toString() ?? '',
      metaValor: metaDe(null)?.meta_valor?.toString() ?? '',
    },
    ...equipo
      .filter((v) => !v.sin_responsable && v.responsable_id)
      .map((v) => ({
        staffId: v.responsable_id,
        etiqueta: nombreCorto(v.nombre),
        metaNumVentas: metaDe(v.responsable_id)?.meta_num_ventas?.toString() ?? '',
        metaValor: metaDe(v.responsable_id)?.meta_valor?.toString() ?? '',
      })),
  ]

  const [filas, setFilas] = useState<FilaMeta[]>(inicial)

  function actualizar(idx: number, campo: 'metaNumVentas' | 'metaValor', valor: string) {
    setFilas((prev) => prev.map((f, i) => (i === idx ? { ...f, [campo]: valor } : f)))
  }

  function guardar(fila: FilaMeta) {
    startTransition(async () => {
      const res = await guardarMetaComercial({
        staffId: fila.staffId,
        anio,
        mes,
        metaNumVentas: fila.metaNumVentas ? Number(fila.metaNumVentas) : null,
        metaValor: fila.metaValor ? Number(fila.metaValor) : null,
      })
      if (res.ok) toast.success(`Meta guardada: ${fila.etiqueta}`)
      else toast.error(res.error ?? 'No se pudo guardar')
    })
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">Metas comerciales</h3>
            <p className="text-xs text-gray-500">{MESES_ES[mes - 1]} {anio}. Numero de ventas y valor (sin IVA).</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            {filas.map((fila, idx) => (
              <div key={fila.staffId ?? 'global'} className="rounded-xl border border-gray-100 p-3">
                <p className="mb-2 text-sm font-semibold text-gray-800">{fila.etiqueta}</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-gray-500"># ventas</span>
                    <input
                      type="number" min={0} inputMode="numeric"
                      value={fila.metaNumVentas}
                      onChange={(e) => actualizar(idx, 'metaNumVentas', e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                      placeholder="0"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-gray-500">Valor sin IVA</span>
                    <input
                      type="number" min={0} inputMode="numeric"
                      value={fila.metaValor}
                      onChange={(e) => actualizar(idx, 'metaValor', e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                      placeholder="0"
                    />
                  </label>
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => guardar(fila)}
                    disabled={pending}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    style={{ backgroundColor: GREEN }}
                  >
                    Guardar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
