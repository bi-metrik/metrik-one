'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownToLine, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ComercialResumenRow } from '../../equipo/comercial-types'
import { MESES_ES } from '../../equipo/comercial-types'
import {
  camposDe, copiarHaciaAdelante, filasCambiadas, filasVacias,
  type CampoMeta, type FilaMetaAnio,
} from '@/lib/metas/anio'
import { getMetasAnio, guardarMetasAnio } from '../metas-anio-actions'

/**
 * Metas del año completo, en una sola pantalla.
 *
 * Reemplaza al modal que editaba un mes a la vez. Ese no solo obligaba a repetir
 * la operación doce veces: recibía el mes desde el estado del tablero y las
 * cifras desde el servidor, cargadas solo para el mes en curso, así que navegar
 * a otro mes y guardar copiaba las metas de agosto encima de ese otro mes. Aquí
 * cada fila trae su mes y sus valores de la misma consulta, y no hay forma de
 * escribir en un mes distinto del que se está viendo.
 */

const GREEN = '#059669'

const ETIQUETA: Record<CampoMeta, string> = {
  metaLeads: 'Leads',
  metaLeadsCalificados: 'Calificados',
  metaNumVentas: '# ventas',
  metaValor: 'Valor sin IVA',
}

function nombreCorto(s: string): string {
  return s.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}

export default function MetasAnioModal({
  anioInicial,
  equipo,
  onClose,
}: {
  anioInicial: number
  equipo: ComercialResumenRow[]
  onClose: () => void
}) {
  const [anio, setAnio] = useState(anioInicial)
  const [staffId, setStaffId] = useState<string | null>(null)
  const [originales, setOriginales] = useState<FilaMetaAnio[]>(filasVacias())
  const [filas, setFilas] = useState<FilaMetaAnio[]>(filasVacias())
  const [cargando, setCargando] = useState(true)
  const [pending, startTransition] = useTransition()

  const alcance = { staffId }
  const campos = camposDe(alcance)
  const cambiadas = filasCambiadas(originales, filas, alcance)
  const vendedores = equipo.filter((v) => !v.sin_responsable && v.responsable_id)

  // Mismo patrón de carga que el resto de los paneles de esta pantalla: la
  // bandera `vivo` descarta la respuesta de un año que ya no se está mirando,
  // que llega tarde si alguien pasa rápido por varios.
  useEffect(() => {
    let vivo = true
    void getMetasAnio(anio, staffId).then((data) => {
      if (!vivo) return
      const nuevas = data?.filas ?? filasVacias()
      setOriginales(nuevas)
      setFilas(nuevas)
      setCargando(false)
      if (!data) toast.error('No se pudieron cargar las metas')
    })
    return () => { vivo = false }
  }, [anio, staffId])

  /**
   * Cambiar de año o de persona con ediciones sin guardar las perdería, así que
   * primero se pregunta. El estado de carga se marca aquí y no en el efecto:
   * quien dispara la recarga es este cambio.
   */
  function cambiarContexto(accion: () => void) {
    if (cambiadas.length > 0 && !confirm(`Hay ${cambiadas.length} mes(es) sin guardar. ¿Descartar?`)) return
    setCargando(true)
    accion()
  }

  function actualizar(mes: number, campo: CampoMeta, valor: string) {
    setFilas((prev) => prev.map((f) => (f.mes === mes ? { ...f, [campo]: valor } : f)))
  }

  function guardar() {
    startTransition(async () => {
      const res = await guardarMetasAnio({ anio, staffId, filas: cambiadas })
      if (!res.ok) { toast.error(res.error ?? 'No se pudo guardar'); return }
      toast.success(`${res.guardados} mes(es) guardado(s)`)
      setOriginales(filas)
    })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={() => cambiarContexto(onClose)}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-gray-100 px-5 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-gray-900">Metas del año</h3>
            <button
              onClick={() => cambiarContexto(onClose)}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 px-1">
              <button
                onClick={() => cambiarContexto(() => setAnio((a) => a - 1))}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
                aria-label="Año anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[3.5rem] text-center text-sm font-semibold text-gray-900">{anio}</span>
              <button
                onClick={() => cambiarContexto(() => setAnio((a) => a + 1))}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
                aria-label="Año siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <select
              value={staffId ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? null : e.target.value
                cambiarContexto(() => setStaffId(v))
              }}
              aria-label="Metas de"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 focus:border-emerald-400 focus:outline-none"
            >
              <option value="">Equipo (meta global)</option>
              {vendedores.map((v) => (
                <option key={v.responsable_id} value={v.responsable_id ?? ''}>
                  {nombreCorto(v.nombre)}
                </option>
              ))}
            </select>
          </div>

          {staffId !== null && (
            <p className="mt-2 text-xs text-gray-500">
              Leads y calificados se fijan para el equipo, no por persona.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {cargando ? (
            <p className="py-8 text-center text-sm text-gray-500">Cargando metas de {anio}…</p>
          ) : (
            <div className="space-y-2">
              {filas.map((fila) => {
                const editada = cambiadas.some((c) => c.mes === fila.mes)
                return (
                  <div
                    key={fila.mes}
                    className={`rounded-xl border p-3 transition-colors ${
                      editada ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-100'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-800">{MESES_ES[fila.mes - 1]}</p>
                      {fila.mes < 12 && (
                        <button
                          onClick={() => setFilas((prev) => copiarHaciaAdelante(prev, fila.mes, alcance))}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                          title={`Copiar ${MESES_ES[fila.mes - 1]} a los meses siguientes`}
                        >
                          <ArrowDownToLine className="h-3 w-3" />
                          Copiar a los siguientes
                        </button>
                      )}
                    </div>
                    <div className={`grid gap-2 ${campos.length > 2 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
                      {campos.map((campo) => (
                        <label key={campo} className="block">
                          <span className="mb-1 block text-[11px] font-medium text-gray-500">
                            {ETIQUETA[campo]}
                          </span>
                          <input
                            type="number" min={0} inputMode="numeric"
                            value={fila[campo]}
                            onChange={(e) => actualizar(fila.mes, campo, e.target.value)}
                            className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                            placeholder="—"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
          <p className="text-xs text-gray-500">
            {cambiadas.length === 0
              ? 'Sin cambios'
              : `${cambiadas.length} mes(es) por guardar`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => cambiarContexto(onClose)}
              className="rounded-lg px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              Cerrar
            </button>
            <button
              onClick={guardar}
              disabled={pending || cambiadas.length === 0}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: GREEN }}
            >
              {pending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
