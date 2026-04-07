'use client'

import { useState, useTransition, useRef, useCallback } from 'react'
import { ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarBloqueData, marcarBloqueCompleto } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'

export interface DatosField {
  slug: string
  label: string
  tipo: 'texto' | 'numero' | 'fecha' | 'toggle' | 'select' | 'imagen_clipboard'
  required: boolean
  options?: string[]
  opciones?: Array<{ value: string; label: string }>
}

interface BloqueDatosProps {
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  fields: DatosField[]
  onComplete?: () => void
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function BloqueDatos({
  negocioBloqueId,
  instancia,
  modo,
  fields,
  onComplete,
}: BloqueDatosProps) {
  const saved = (instancia?.data ?? {}) as Record<string, unknown>
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {}
    fields.forEach(f => {
      init[f.slug] = saved[f.slug] ?? (f.tipo === 'toggle' ? false : '')
    })
    return init
  })
  const [isPending, startTransition] = useTransition()
  const [pasteImgs, setPasteImgs] = useState<Record<string, string>>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function isComplete(vals: Record<string, unknown>) {
    return fields.filter(f => f.required).every(f => {
      const v = vals[f.slug]
      if (f.tipo === 'toggle') return true
      return v !== '' && v !== null && v !== undefined
    })
  }

  function scheduleAutoSave(newVals: Record<string, unknown>) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      startTransition(async () => {
        const complete = isComplete(newVals)
        let result
        if (complete) {
          result = await marcarBloqueCompleto(negocioBloqueId, newVals)
          if (!result.error && onComplete) onComplete()
        } else {
          result = await actualizarBloqueData(negocioBloqueId, newVals)
        }
        if (result.error) toast.error(result.error)
      })
    }, 800)
  }

  function handleChange(slug: string, value: unknown) {
    const next = { ...values, [slug]: value }
    setValues(next)
    scheduleAutoSave(next)
  }

  const handlePaste = useCallback((slug: string, e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    const file = item.getAsFile()
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      setPasteImgs(prev => ({ ...prev, [slug]: dataUrl }))
      handleChange(slug, dataUrl)
    }
    reader.readAsDataURL(file)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, negocioBloqueId])

  if (modo === 'visible') {
    return (
      <div className="space-y-2">
        {fields.map(f => {
          const v = saved[f.slug]
          return (
            <div key={f.slug} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium text-[#6B7280] uppercase tracking-wide">{f.label}</span>
              {f.tipo === 'toggle' ? (
                <span className={`text-xs font-medium ${v ? 'text-[#10B981]' : 'text-[#6B7280]'}`}>
                  {v ? 'Sí' : 'No'}
                </span>
              ) : f.tipo === 'imagen_clipboard' && v ? (
                <img src={v as string} alt={f.label} className="max-h-40 rounded-lg border border-[#E5E7EB] object-contain" />
              ) : f.tipo === 'numero' && v ? (
                <span className="text-xs text-[#1A1A1A] tabular-nums">{fmt(Number(v))}</span>
              ) : (
                <span className="text-xs text-[#1A1A1A]">{
                f.tipo === 'select' && f.opciones
                  ? f.opciones.find(o => o.value === v)?.label ?? (v as string) ?? '—'
                  : (v as string) ?? '—'
              }</span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {fields.map(f => (
        <div key={f.slug}>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">
            {f.label}
            {f.required && <span className="ml-0.5 text-red-500">*</span>}
          </label>

          {f.tipo === 'texto' && (
            <input
              type="text"
              value={(values[f.slug] as string) ?? ''}
              onChange={e => handleChange(f.slug, e.target.value)}
              disabled={isPending}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60"
            />
          )}

          {f.tipo === 'numero' && (
            <input
              type="number"
              value={(values[f.slug] as string) ?? ''}
              onChange={e => handleChange(f.slug, e.target.value ? Number(e.target.value) : '')}
              disabled={isPending}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60"
            />
          )}

          {f.tipo === 'fecha' && (
            <input
              type="date"
              value={(values[f.slug] as string) ?? ''}
              onChange={e => handleChange(f.slug, e.target.value)}
              disabled={isPending}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60"
            />
          )}

          {f.tipo === 'toggle' && (
            <label className="inline-flex cursor-pointer items-center gap-2">
              <div
                onClick={() => !isPending && handleChange(f.slug, !values[f.slug])}
                className={`relative h-5 w-9 rounded-full transition-colors ${values[f.slug] ? 'bg-[#10B981]' : 'bg-[#E5E7EB]'} ${isPending ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${values[f.slug] ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </div>
              <span className="text-xs text-[#1A1A1A]">{values[f.slug] ? 'Sí' : 'No'}</span>
            </label>
          )}

          {f.tipo === 'select' && (f.options || f.opciones) && (
            <select
              value={(values[f.slug] as string) ?? ''}
              onChange={e => handleChange(f.slug, e.target.value)}
              disabled={isPending}
              className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60"
            >
              <option value="">— Seleccionar —</option>
              {f.opciones
                ? f.opciones.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))
                : f.options?.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))
              }
            </select>
          )}

          {f.tipo === 'imagen_clipboard' && (
            <div
              onPaste={e => handlePaste(f.slug, e)}
              tabIndex={0}
              className="flex min-h-[80px] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-[#E5E7EB] bg-[#F9FAFB] p-3 focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
            >
              {pasteImgs[f.slug] || (values[f.slug] as string) ? (
                <img
                  src={(pasteImgs[f.slug] || values[f.slug]) as string}
                  alt={f.label}
                  className="max-h-32 rounded object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-[#6B7280]">
                  <ImageIcon className="h-5 w-5" />
                  <span className="text-[11px]">Pega una imagen con Ctrl+V / Cmd+V</span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {isPending && (
        <p className="text-[10px] text-[#6B7280]">Guardando...</p>
      )}
    </div>
  )
}
