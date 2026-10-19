'use client'

import { useState } from 'react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { guardarPagosMulti } from '../../negocio-v2-actions'
import { useIntencion } from '@/hooks/use-intencion'
import { filaNueva, filasConId, type FilaMultiPago } from '@/lib/epayco/multi-pago-filas'
import type { NegocioBloque } from '../../negocio-v2-actions'
import AvisoHonorarioPendiente from './AvisoHonorarioPendiente'
import { FechaDelPago } from './FechaDelPago'
import { fechasDePagosMulti, type CobroMultiConFecha } from '@/lib/epayco/fecha-cobro-multi-pago'

export interface MultiPagoField {
  slug: string
  label: string
  tipo: 'texto' | 'numero'
  required: boolean
}

interface BloqueDatosMultiPagoProps {
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  fields: MultiPagoField[]
  onComplete?: () => void
  /**
   * El negocio no tiene el honorario confirmado. El cobro que crea «Guardar pagos» lo
   * rechazaría el trigger de `cobros`, así que la captura se cierra y el aviso llega antes
   * de teclear referencia y valor.
   */
  faltaHonorario?: boolean
  /**
   * Cobros del negocio. De aquí sale la fecha del PAGO de cada fila: el cobro con la misma
   * referencia y el mismo valor (ver `fechasDePagosMulti`).
   */
  cobros?: ReadonlyArray<CobroMultiConFecha>
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const nuevoId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `f-${Date.now()}-${Math.random().toString(36).slice(2)}`)

/**
 * Bloque «Pagos ePayco» con varias filas (`config_extra.es_multi_pago`).
 *
 * Sin autoguardado desde el 2026-10-19: cada pausa a mitad de una cifra creaba un cobro
 * real («150» de 1.500.000). Ahora las filas se editan en pantalla y se guardan con
 * «Guardar pagos», que muestra el resumen antes de escribir. Cada fila lleva un id estable
 * y, ya guardada, el cobro que la respalda: editarla corrige ese cobro y quitarla lo anula,
 * mientras la financiera no lo haya confirmado (lo decide el servidor, `guardarPagosMulti`).
 */
export default function BloqueDatosMultiPago({
  negocioBloqueId,
  instancia,
  modo,
  fields,
  onComplete,
  faltaHonorario = false,
  cobros = [],
}: BloqueDatosMultiPagoProps) {
  const saved = (instancia?.data ?? {}) as Record<string, unknown>
  const savedPagos = filasConId((saved.pagos ?? []) as Array<Partial<FilaMultiPago>>, nuevoId)

  const [pagos, setPagos] = useState<FilaMultiPago[]>(() =>
    savedPagos.length > 0 ? savedPagos : [filaNueva(nuevoId())]
  )
  const [sinGuardar, setSinGuardar] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const intencion = useIntencion()
  const [isPending, startTransition] = useTransitionTolerante()

  // Determinar labels from fields config
  const refLabel = fields.find(f => f.slug === 'referencia_epayco')?.label ?? 'Referencia ePayco'
  const valorLabel = fields.find(f => f.slug === 'valor_pago')?.label ?? 'Valor del pago'

  const incompletas = pagos.filter(r => !r.referencia_epayco.trim() || !(Number(r.valor_pago) > 0)).length
  const total = pagos.reduce((s, p) => s + (Number(p.valor_pago) || 0), 0)

  function updateRow(index: number, field: 'referencia_epayco' | 'valor_pago', value: string) {
    setSinGuardar(true)
    setPagos(prev => prev.map((p, i) => {
      if (i !== index) return p
      if (field === 'valor_pago') return { ...p, valor_pago: value ? Number(value) : '' as const }
      return { ...p, referencia_epayco: value }
    }))
  }

  function addRow() {
    setSinGuardar(true)
    setPagos(prev => [...prev, filaNueva(nuevoId())])
  }

  function removeRow(index: number) {
    if (pagos.length <= 1) return
    setSinGuardar(true)
    setPagos(prev => prev.filter((_, i) => i !== index))
  }

  function guardar() {
    startTransition(async () => {
      const result = await guardarPagosMulti(negocioBloqueId, pagos, intencion.clave())
      intencion.cerrar()
      if (result.error) {
        setConfirmando(false)
        toast.error(result.error)
        return
      }
      setConfirmando(false)
      setSinGuardar(false)
      toast.success('Pagos guardados')
      onComplete?.()
    })
  }

  // Modo visible: tabla read-only
  if (modo === 'visible') {
    if (savedPagos.length === 0) {
      return <p className="text-xs text-tinta-suave italic">Sin pagos registrados</p>
    }
    const fechasGuardadas = fechasDePagosMulti(savedPagos, cobros)
    return (
      <div className="space-y-1.5">
        {savedPagos.map((p, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] p-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-tinta">Ref: {p.referencia_epayco || '---'}</p>
              <FechaDelPago fecha={fechasGuardadas[i]} />
            </div>
            <span className="text-xs font-semibold text-tinta tabular-nums shrink-0">
              {p.valor_pago ? fmt(Number(p.valor_pago)) : '---'}
            </span>
          </div>
        ))}
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2 text-center">
          <p className="text-[10px] text-tinta-suave font-medium">Total</p>
          <p className="text-sm font-bold text-tinta tabular-nums">
            {fmt(savedPagos.reduce((s, p) => s + (Number(p.valor_pago) || 0), 0))}
          </p>
        </div>
      </div>
    )
  }

  // Modo editable: filas dinamicas
  const fechas = fechasDePagosMulti(pagos, cobros)
  return (
    <div className="space-y-3">
      {faltaHonorario && <AvisoHonorarioPendiente />}

      {pagos.map((pago, i) => (
        <div key={pago.id} className="flex items-start gap-2">
          <div className="flex-1 space-y-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-tinta-suave">
                {refLabel}
                <span className="ml-0.5 text-red-500">*</span>
              </label>
              <input
                type="text"
                value={pago.referencia_epayco}
                onChange={e => updateRow(i, 'referencia_epayco', e.target.value)}
                disabled={isPending || faltaHonorario}
                placeholder="Ej: REF-12345"
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-tinta focus:border-acento focus:outline-none focus:ring-2 focus:ring-acento/15 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-tinta-suave">
                {valorLabel}
                <span className="ml-0.5 text-red-500">*</span>
              </label>
              <input
                type="number"
                value={pago.valor_pago}
                onChange={e => updateRow(i, 'valor_pago', e.target.value)}
                disabled={isPending || faltaHonorario}
                placeholder="0"
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-tinta focus:border-acento focus:outline-none focus:ring-2 focus:ring-acento/15 disabled:opacity-60"
              />
            </div>
            <FechaDelPago fecha={fechas[i]} />
          </div>
          {pagos.length > 1 && (
            <button
              onClick={() => removeRow(i)}
              disabled={isPending}
              className="mt-6 shrink-0 rounded-lg p-1.5 text-tinta-suave hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
              title="Eliminar pago"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      <button
        onClick={addRow}
        disabled={isPending || faltaHonorario}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#E5E7EB] py-2 text-xs font-medium text-tinta-suave hover:border-acento hover:text-acento transition-colors disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        Agregar pago
      </button>

      {confirmando ? (
        <div className="space-y-2 rounded-lg border border-[#E5E7EB] bg-white p-3">
          <p className="text-[11px] font-semibold text-tinta">Revisa antes de guardar. Hasta que confirmes no se registra nada.</p>
          <ul className="divide-y divide-[#E5E7EB] text-xs">
            {pagos.map(p => (
              <li key={p.id} className="flex items-center justify-between py-1">
                <span className="text-tinta">Ref {p.referencia_epayco}</span>
                <span className="font-semibold tabular-nums text-tinta">{fmt(Number(p.valor_pago) || 0)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-[#E5E7EB] pt-1.5 text-xs">
            <span className="text-tinta-suave">Total</span>
            <span className="font-bold tabular-nums text-tinta">{fmt(total)}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmando(false)} disabled={isPending} className="rounded-lg px-3 py-1.5 text-xs font-medium text-tinta-suave disabled:opacity-40">Volver a editar</button>
            <button onClick={guardar} disabled={isPending} className="rounded-lg bg-acento px-3 py-1.5 text-xs font-semibold text-white hover:bg-acento-hover disabled:opacity-40">
              {isPending ? 'Guardando…' : 'Confirmar'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-tinta-suave">
            {incompletas > 0 ? `Completa ${incompletas === 1 ? 'la fila' : `${incompletas} filas`} para guardar` : sinGuardar ? 'Cambios sin guardar' : ''}
          </span>
          <button
            onClick={() => setConfirmando(true)}
            disabled={isPending || faltaHonorario || incompletas > 0 || !sinGuardar}
            className="rounded-lg bg-acento px-3 py-1.5 text-xs font-semibold text-white hover:bg-acento-hover disabled:opacity-40"
          >
            Guardar pagos
          </button>
        </div>
      )}
    </div>
  )
}
