'use client'

import { useState, useTransition, useRef, useCallback, useEffect } from 'react'
import { ImageIcon, Search, FileText, ExternalLink, Download, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarBloqueData, marcarBloqueCompleto } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'
import { consultarEpayco } from '@/lib/actions/epayco-actions'
import type { EpaycoDesglose } from '@/lib/epayco'
import { templatesAGenerar, TEMPLATE_NAMES, type ProductosContratados } from '@/lib/afi/template-mapping'
import { SECCIONALES_DIAN, mapCiudadASeccional, getSeccionalBySlug } from '@/lib/dian/seccionales'

export interface DatosField {
  slug: string
  label: string
  tipo: 'texto' | 'numero' | 'fecha' | 'toggle' | 'checkbox' | 'select' | 'radio' | 'imagen_clipboard' | 'documentos_preview' | 'doc_link' | 'plantilla'
  required?: boolean
  options?: string[]
  opciones?: Array<{ value: string; label: string }>
  default?: unknown
  // plantilla: texto readonly con placeholders {{slug}} que se sustituyen por el
  // valor de otros campos del bloque (ej. cuerpo de correo a la DIAN). Con copiar.
  template?: string
  // select con opciones del catálogo de seccionales DIAN: se auto-selecciona según
  // la ciudad y, al cambiar, actualiza el campo `correo_seccional` con su buzón.
  opciones_fuente?: 'seccionales_dian'
  // Campo de escritura que ALIMENTA condiciones/herencia de otros bloques (ej.
  // ciudad_venta). Al salir del campo (blur) revalida para resincronizar el resto.
  revalida?: boolean
  // Solo renderizar si el field referenciado cumple la condicion
  showIf?: { field: string; equals: unknown }
  // doc_link: enlace de solo lectura a un archivo cargado en otro bloque
  doc_link?: {
    source_bloque_nombre: string
    source_etapa_orden: number
    _resolved?: { drive_url: string | null; file_name: string | null }
  }
}

interface BloqueDatosProps {
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  fields: DatosField[]
  requireConfirm?: boolean
  confirmLabel?: string
  onComplete?: () => void
  epaycoLookup?: { triggerField: string; fill: Record<string, string> }
  autoFillDefaults?: Record<string, unknown>
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

function CopyValueButton({ value }: { value: string | number | null | undefined }) {
  const [copied, setCopied] = useState(false)
  const text = value === null || value === undefined || value === '' ? null : String(value)
  const canCopy = text !== null
  const handleCopy = async () => {
    if (!canCopy) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      toast.error('No se pudo copiar')
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!canCopy}
      title={canCopy ? 'Copiar' : 'Sin valor'}
      className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-[#6B7280] hover:bg-[#F5F4F2] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[#10B981]" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

// Resuelve {{slug}} en la plantilla con el valor del campo correspondiente del bloque.
// Si falta un valor, deja un marcador legible [slug] para que el operador lo complete.
function resolverPlantilla(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, slug: string) => {
    const v = values[slug]
    return v !== null && v !== undefined && v !== '' ? String(v) : `[${slug}]`
  })
}

function PlantillaCorreo({ field, values }: { field: DatosField; values: Record<string, unknown> }) {
  const [copied, setCopied] = useState(false)
  const texto = resolverPlantilla(field.template ?? '', values)
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      toast.error('No se pudo copiar')
    }
  }
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB]">
      <div className="flex items-center justify-between border-b border-[#E5E7EB] px-3 py-1.5">
        <span className="text-[10px] font-medium text-[#6B7280] uppercase tracking-wide">{field.label}</span>
        <button
          type="button"
          onClick={copiar}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#10B981] hover:bg-[#F0FDF4] transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words px-3 py-2 text-xs text-[#1A1A1A] font-sans leading-relaxed">{texto}</pre>
    </div>
  )
}

export default function BloqueDatos({
  negocioBloqueId,
  instancia,
  modo,
  fields,
  requireConfirm,
  confirmLabel,
  onComplete,
  epaycoLookup,
  autoFillDefaults,
}: BloqueDatosProps) {
  const saved = (instancia?.data ?? {}) as Record<string, unknown>
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {}
    fields.forEach(f => {
      const fallback = f.default !== undefined ? f.default : (f.tipo === 'toggle' ? false : '')
      init[f.slug] = saved[f.slug] ?? autoFillDefaults?.[f.slug] ?? fallback
      // Seccional DIAN: auto-seleccionar según la ciudad de venta si no hay valor guardado.
      if (f.opciones_fuente === 'seccionales_dian' && !saved[f.slug]) {
        const ciudad = (saved['ciudad_venta'] ?? autoFillDefaults?.['ciudad_venta']) as string | undefined
        const sec = mapCiudadASeccional(ciudad, 'natural')
        if (sec) init[f.slug] = sec.slug
      }
    })
    // Derivar el correo de la seccional inicial (si no fue editado a mano)
    const secField = fields.find(f => f.opciones_fuente === 'seccionales_dian')
    if (secField && init[secField.slug] && !saved['correo_seccional']) {
      const sec = getSeccionalBySlug(init[secField.slug] as string)
      if (sec) init['correo_seccional'] = sec.email
    }
    return init
  })
  const [isPending, startTransition] = useTransition()
  const [pasteImgs, setPasteImgs] = useState<Record<string, string>>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Guardado: estado pasivo + refs para flush al desmontar (cero pérdida de datos).
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const valuesRef = useRef(values)
  valuesRef.current = values
  const dirtyRef = useRef(false)
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      // Si quedó un borrador sin guardar (el usuario navegó sin blur), persistir ya.
      if (dirtyRef.current) {
        void actualizarBloqueData(negocioBloqueId, valuesRef.current, undefined, { revalidate: false })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ePayco lookup state
  const [epaycoDesglose, setEpaycoDesglose] = useState<EpaycoDesglose | null>(
    (saved._epayco_desglose as EpaycoDesglose | null) ?? null
  )
  const [epaycoLoading, setEpaycoLoading] = useState(false)
  const [epaycoError, setEpaycoError] = useState<string | null>(null)

  const epaycoFilledSlugs = epaycoLookup ? Object.keys(epaycoLookup.fill) : []

  async function handleEpaycoLookup() {
    if (!epaycoLookup) return
    const refValue = values[epaycoLookup.triggerField]
    if (!refValue) {
      setEpaycoError('Ingresa la referencia de pago primero')
      return
    }
    setEpaycoLoading(true)
    setEpaycoError(null)
    try {
      const result = await consultarEpayco(String(refValue))
      if (!result.success) {
        setEpaycoError(result.error)
        setEpaycoLoading(false)
        return
      }
      const desglose = result.data
      setEpaycoDesglose(desglose)
      // Auto-fill mapped fields
      const next = { ...values }
      for (const [fieldSlug, desgloseKey] of Object.entries(epaycoLookup.fill)) {
        const val = desglose[desgloseKey as keyof EpaycoDesglose]
        if (val !== undefined) next[fieldSlug] = val
      }
      next._epayco_desglose = desglose
      setValues(next)
      void persist(next, true)
    } catch {
      setEpaycoError('Error inesperado consultando ePayco')
    } finally {
      setEpaycoLoading(false)
    }
  }

  // Solo renderizar fields cuyo showIf se cumple (o que no tienen showIf)
  function visible(f: DatosField, vals: Record<string, unknown>) {
    if (!f.showIf) return true
    return vals[f.showIf.field] === f.showIf.equals
  }

  function isComplete(vals: Record<string, unknown>) {
    return fields.filter(f => f.required && visible(f, vals)).every(f => {
      const v = vals[f.slug]
      if (f.tipo === 'toggle') return true
      if (f.tipo === 'checkbox') return true
      if (f.tipo === 'documentos_preview') return true
      if (f.tipo === 'doc_link') return true
      if (f.tipo === 'plantilla') return true
      return v !== '' && v !== null && v !== undefined
    })
  }

  // Persistir los valores. `revalidate` solo cuando el cambio afecta a otros bloques
  // (toque, campo que dispara condición, o al completar). El borrador de escritura
  // libre va con revalidate=false → no re-renderiza ni roba el foco. NO usa
  // startTransition (que deshabilitaría el input). Feedback pasivo vía saveStatus.
  async function persist(vals: Record<string, unknown>, revalidate: boolean) {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    dirtyRef.current = false
    setSaveStatus('saving')
    const complete = isComplete(vals)
    let result: { error: string | null }
    if (complete && !requireConfirm) {
      const r = await marcarBloqueCompleto(negocioBloqueId, vals)
      if (!r.error && onComplete) onComplete()
      result = { error: r.error }
    } else {
      result = await actualizarBloqueData(negocioBloqueId, vals, undefined, { revalidate })
    }
    if (result.error) { toast.error(result.error); setSaveStatus('idle') }
    else { setSaveStatus('saved'); window.setTimeout(() => setSaveStatus('idle'), 1800) }
  }

  // Escritura libre: debounce LARGO de respaldo (el guardado principal es onBlur).
  function scheduleBorrador(vals: Record<string, unknown>) {
    dirtyRef.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void persist(vals, false) }, 2500)
  }

  function handleConfirm() {
    startTransition(async () => {
      const result = await marcarBloqueCompleto(negocioBloqueId, values)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(confirmLabel ? `${confirmLabel} registrado` : 'Datos confirmados')

      // Hooks AFI: el server action retorna flags para que el cliente dispare el endpoint correspondiente
      if (result.trigger_afi_generation && result.negocio_id) {
        const tid = toast.loading('Generando paquete documental… esto puede tardar 30-60s')
        try {
          const res = await fetch(`/api/afi/generar/${result.negocio_id}`, { method: 'POST' })
          const json = await res.json()
          toast.dismiss(tid)
          if (json.ok) {
            toast.success(`${json.docs_generados} documentos generados y subidos a Drive`)
          } else {
            toast.error(`Error: ${json.error ?? 'desconocido'}`)
          }
        } catch (e) {
          toast.dismiss(tid)
          toast.error(`Error al llamar motor: ${(e as Error).message}`)
        }
      }
      if (result.trigger_afi_contrato && result.negocio_id) {
        const tid = toast.loading('Armando contrato… esto puede tardar 15-30s')
        try {
          const res = await fetch(`/api/afi/contrato/${result.negocio_id}`, { method: 'POST' })
          const json = await res.json()
          toast.dismiss(tid)
          if (json.ok) {
            toast.success('Contrato generado y subido a Drive', {
              action: json.drive_url
                ? { label: 'Abrir', onClick: () => window.open(json.drive_url, '_blank') }
                : undefined,
            })
          } else {
            toast.error(`Error: ${json.error ?? 'desconocido'}`)
          }
        } catch (e) {
          toast.dismiss(tid)
          toast.error(`Error al llamar motor: ${(e as Error).message}`)
        }
      }

      if (onComplete) onComplete()
    })
  }

  // Escritura libre (texto/número): solo estado + borrador diferido. Sin revalidate
  // ni input deshabilitado → el foco nunca se pierde mientras se escribe.
  function handleTextChange(slug: string, value: unknown) {
    const next = { ...valuesRef.current, [slug]: value }
    setValues(next)
    scheduleBorrador(next)
  }

  // Salir de un campo de escritura → flush inmediato. Revalida solo si el campo
  // alimenta condiciones de otros bloques (f.revalida).
  function handleTextBlur(f: DatosField) {
    if (!dirtyRef.current) return
    void persist(valuesRef.current, !!f.revalida)
  }

  // Un toque (toggle/checkbox/select/radio/fecha): guardado inmediato + revalida
  // (puede cambiar condiciones/herencia). La seccional refresca su correo.
  function handleToggleChange(slug: string, value: unknown) {
    const next = { ...valuesRef.current, [slug]: value }
    const f = fields.find(ff => ff.slug === slug)
    if (f?.opciones_fuente === 'seccionales_dian') {
      next['correo_seccional'] = getSeccionalBySlug(value as string)?.email ?? ''
    }
    setValues(next)
    void persist(next, true)
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
      handleToggleChange(slug, dataUrl)
    }
    reader.readAsDataURL(file)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, negocioBloqueId])

  if (modo === 'visible') {
    // Para readonly, los campos sin data persistida deben mostrar el valor
    // de autoFillDefaults o, en su defecto, el `default` de config (igual que el
    // modo editable). Sin esto, un campo con solo `default` (sin auto_fill ni
    // data guardada) salía vacío en readonly mientras los auto_fill sí aparecían.
    const fieldDefaults: Record<string, unknown> = Object.fromEntries(
      fields.filter(f => f.default !== undefined).map(f => [f.slug, f.default])
    )
    const effective: Record<string, unknown> = { ...fieldDefaults, ...autoFillDefaults, ...saved }
    return (
      <div className="space-y-2">
        {fields.filter(f => visible(f, effective)).map(f => {
          const v = saved[f.slug] ?? autoFillDefaults?.[f.slug] ?? f.default
          if (f.tipo === 'documentos_preview') {
            return (
              <div key={f.slug}>
                <DocumentosPreview productos={saved as ProductosContratados} />
              </div>
            )
          }
          if (f.tipo === 'plantilla') {
            return <PlantillaCorreo key={f.slug} field={f} values={effective} />
          }
          if (f.tipo === 'doc_link') {
            const resolved = f.doc_link?._resolved
            return (
              <div key={f.slug} className="flex flex-col gap-0.5">
                <span className="text-[10px] font-medium text-[#6B7280] uppercase tracking-wide">{f.label}</span>
                {resolved?.drive_url ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-[#6B7280] shrink-0" />
                      <span className="text-xs text-[#1A1A1A] truncate">{resolved.file_name ?? f.label}</span>
                    </div>
                    <a
                      href={resolved.drive_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-[#059669] hover:underline shrink-0"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Ver
                    </a>
                  </div>
                ) : (
                  <span className="text-xs text-[#6B7280] italic">Aún no cargado</span>
                )}
              </div>
            )
          }
          const isCopyable = ['texto', 'numero', 'fecha', 'select', 'radio'].includes(f.tipo)
          const copyValue = f.tipo === 'select' || f.tipo === 'radio'
            ? (f.opciones?.find(o => o.value === v)?.label ?? (v as string | null))
            : (v as string | number | null | undefined)
          return (
            <div key={f.slug} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-[#6B7280] uppercase tracking-wide">{f.label}</span>
                {!!saved._epayco_desglose && epaycoLookup && epaycoFilledSlugs.includes(f.slug) && (
                  <span className="inline-flex items-center rounded bg-[#F0FDF4] px-1.5 py-0.5 text-[9px] font-medium text-[#10B981] border border-[#BBF7D0]">
                    ePayco verificado
                  </span>
                )}
              </div>
              {(f.tipo === 'toggle' || f.tipo === 'checkbox') ? (
                <span className={`text-xs font-medium ${v ? 'text-[#10B981]' : 'text-[#6B7280]'}`}>
                  {v ? 'Sí' : 'No'}
                </span>
              ) : f.tipo === 'imagen_clipboard' && v ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL desde clipboard paste, no optimizable por next/image
                <img src={v as string} alt={f.label} className="max-h-40 rounded-lg border border-[#E5E7EB] object-contain" />
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className={`flex-1 min-w-0 text-xs text-[#1A1A1A] break-words ${f.tipo === 'numero' ? 'tabular-nums' : ''}`}>{
                    f.tipo === 'numero' && v
                      ? fmt(Number(v))
                      : f.opciones_fuente === 'seccionales_dian' && v
                        ? getSeccionalBySlug(v as string)?.label ?? (v as string)
                        : (f.tipo === 'select' || f.tipo === 'radio') && f.opciones
                          ? f.opciones.find(o => o.value === v)?.label ?? (v as string) ?? '—'
                          : (v as string) ?? '—'
                  }</span>
                  {isCopyable && copyValue && <CopyValueButton value={copyValue} />}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const isTriggerField = (slug: string) => epaycoLookup?.triggerField === slug
  const isEpaycoFilled = (slug: string) => epaycoDesglose !== null && epaycoFilledSlugs.includes(slug)

  const inputBaseClass = 'w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60'
  const inputBg = (slug: string) => isEpaycoFilled(slug) ? 'bg-[#F9FAFB]' : 'bg-white'

  return (
    <div className="space-y-3">
      {/* Indicador de guardado pasivo (no roba atención: sin toasts por guardado) */}
      <div className="flex h-3 items-center justify-end">
        {saveStatus === 'saving' && <span className="text-[10px] text-[#6B7280]">Guardando…</span>}
        {saveStatus === 'saved' && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-[#10B981]"><Check className="h-3 w-3" />Guardado</span>
        )}
      </div>
      {fields.filter(f => visible(f, values)).map(f => (
        <div key={f.slug}>
          {f.tipo !== 'documentos_preview' && f.tipo !== 'plantilla' && (
            <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[#6B7280]">
              {f.label}
              {f.required && <span className="text-red-500">*</span>}
              {/* Dato traído de otra fuente y aún no editado a mano → badge "auto" */}
              {autoFillDefaults?.[f.slug] != null && saved[f.slug] === undefined && values[f.slug] === autoFillDefaults[f.slug] && (
                <span className="rounded bg-[#F5F4F2] px-1 py-px text-[8px] font-medium uppercase tracking-wide text-[#9CA3AF]">auto</span>
              )}
            </label>
          )}

          {f.tipo === 'plantilla' && (
            <PlantillaCorreo field={f} values={values} />
          )}

          {f.tipo === 'texto' && (
            isTriggerField(f.slug) ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={(values[f.slug] as string) ?? ''}
                  onChange={e => handleTextChange(f.slug, e.target.value)}
                  onBlur={() => handleTextBlur(f)}
                  className={`flex-1 ${inputBaseClass} bg-white`}
                />
                <button
                  onClick={handleEpaycoLookup}
                  disabled={epaycoLoading || isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#3B82F6] px-3 py-2 text-[10px] font-medium text-white hover:bg-[#2563EB] disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  {epaycoLoading ? (
                    'Consultando...'
                  ) : (
                    <><Search className="h-3 w-3" />Consultar</>
                  )}
                </button>
              </div>
            ) : (
              <input
                type="text"
                value={(values[f.slug] as string) ?? ''}
                onChange={e => handleTextChange(f.slug, e.target.value)}
                onBlur={() => handleTextBlur(f)}
                readOnly={isEpaycoFilled(f.slug)}
                className={`${inputBaseClass} ${inputBg(f.slug)}`}
              />
            )
          )}

          {f.tipo === 'numero' && (
            isTriggerField(f.slug) ? (
              <div className="flex gap-2">
                <input
                  type="number"
                  value={(values[f.slug] as string) ?? ''}
                  onChange={e => handleTextChange(f.slug, e.target.value ? Number(e.target.value) : '')}
                  onBlur={() => handleTextBlur(f)}
                  className={`flex-1 ${inputBaseClass} bg-white`}
                />
                <button
                  onClick={handleEpaycoLookup}
                  disabled={epaycoLoading || isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#3B82F6] px-3 py-2 text-[10px] font-medium text-white hover:bg-[#2563EB] disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  {epaycoLoading ? (
                    'Consultando...'
                  ) : (
                    <><Search className="h-3 w-3" />Consultar</>
                  )}
                </button>
              </div>
            ) : (
              <input
                type="number"
                value={(values[f.slug] as string) ?? ''}
                onChange={e => handleTextChange(f.slug, e.target.value ? Number(e.target.value) : '')}
                onBlur={() => handleTextBlur(f)}
                readOnly={isEpaycoFilled(f.slug)}
                className={`${inputBaseClass} ${inputBg(f.slug)}`}
              />
            )
          )}

          {f.tipo === 'fecha' && (
            <input
              type="date"
              value={(values[f.slug] as string) ?? ''}
              onChange={e => handleToggleChange(f.slug, e.target.value)}
              readOnly={isEpaycoFilled(f.slug)}
              disabled={isPending}
              className={`${inputBaseClass} ${inputBg(f.slug)}`}
            />
          )}

          {f.tipo === 'toggle' && (
            <label className="inline-flex cursor-pointer items-center gap-2">
              <div
                onClick={() => !isPending && handleToggleChange(f.slug, !values[f.slug])}
                className={`relative h-5 w-9 rounded-full transition-colors ${values[f.slug] ? 'bg-[#10B981]' : 'bg-[#E5E7EB]'} ${isPending ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${values[f.slug] ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </div>
              <span className="text-xs text-[#1A1A1A]">{values[f.slug] ? 'Sí' : 'No'}</span>
            </label>
          )}

          {f.tipo === 'checkbox' && (
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={!!values[f.slug]}
                onChange={e => handleToggleChange(f.slug, e.target.checked)}
                disabled={isPending}
                className="h-4 w-4 accent-[#10B981] disabled:opacity-60"
              />
              <span className="text-xs text-[#1A1A1A]">{values[f.slug] ? 'Sí' : 'No'}</span>
            </label>
          )}

          {f.tipo === 'doc_link' && (() => {
            const resolved = f.doc_link?._resolved
            if (!resolved?.drive_url) {
              return (
                <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
                  <p className="text-[11px] text-[#6B7280] italic">
                    {f.doc_link?.source_bloque_nombre ?? 'Documento'} aún no cargado
                  </p>
                </div>
              )
            }
            return (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-[#6B7280] shrink-0" />
                  <span className="text-xs text-[#1A1A1A] truncate">
                    {resolved.file_name ?? f.doc_link?.source_bloque_nombre ?? 'Documento'}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <a
                    href={resolved.drive_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[10px] font-medium text-[#1A1A1A] hover:border-[#10B981]/40 hover:text-[#059669]"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Ver
                  </a>
                  <a
                    href={resolved.drive_url}
                    download
                    className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[10px] font-medium text-[#1A1A1A] hover:border-[#10B981]/40 hover:text-[#059669]"
                  >
                    <Download className="h-3 w-3" />
                    Descargar
                  </a>
                </div>
              </div>
            )
          })()}

          {f.tipo === 'select' && (f.options || f.opciones || f.opciones_fuente === 'seccionales_dian') && (
            <select
              value={(values[f.slug] as string) ?? ''}
              onChange={e => handleToggleChange(f.slug, e.target.value)}
              disabled={isPending || isEpaycoFilled(f.slug)}
              className={`${inputBaseClass} ${inputBg(f.slug)}`}
            >
              <option value="">-- Seleccionar --</option>
              {f.opciones_fuente === 'seccionales_dian'
                ? SECCIONALES_DIAN.map(s => (
                    <option key={s.slug} value={s.slug}>{s.label}</option>
                  ))
                : f.opciones
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
                // eslint-disable-next-line @next/next/no-img-element -- data URL desde clipboard paste, no optimizable por next/image
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

          {f.tipo === 'radio' && (f.opciones || f.options) && (
            <div className="space-y-1.5">
              {(f.opciones ?? f.options?.map(o => ({ value: o, label: o })) ?? []).map(opt => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs hover:border-[#10B981]/50 transition-colors"
                >
                  <input
                    type="radio"
                    name={f.slug}
                    value={opt.value}
                    checked={values[f.slug] === opt.value}
                    onChange={() => handleToggleChange(f.slug, opt.value)}
                    disabled={isPending}
                    className="h-3.5 w-3.5 accent-[#10B981]"
                  />
                  <span className="text-[#1A1A1A]">{opt.label}</span>
                </label>
              ))}
            </div>
          )}

          {f.tipo === 'documentos_preview' && (
            <DocumentosPreview productos={values as ProductosContratados} />
          )}
        </div>
      ))}

      {/* ePayco error */}
      {epaycoError && (
        <p className="text-[11px] text-red-600 font-medium">{epaycoError}</p>
      )}

      {/* ePayco desglose summary card */}
      {epaycoDesglose && (
        <div className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 space-y-1">
          <p className="text-xs font-semibold text-[#10B981] flex items-center gap-1">
            <span>Transaccion verificada</span>
          </p>
          <p className="text-xs text-[#1A1A1A]">Pagador: {epaycoDesglose.pagador_nombre}</p>
          <p className="text-xs text-[#1A1A1A] tabular-nums">Monto bruto: {fmt(epaycoDesglose.monto_bruto)}</p>
          <p className="text-xs text-[#1A1A1A] tabular-nums">
            Comision ePayco: -{fmt(epaycoDesglose.total_descuentos)}
          </p>
          {(epaycoDesglose.comision > 0 || epaycoDesglose.iva_comision > 0 || epaycoDesglose.retefuente > 0 || epaycoDesglose.reteica > 0) && (
            <p className="text-[10px] text-[#6B7280] tabular-nums pl-2">
              {[
                epaycoDesglose.comision > 0 && `Comision: ${fmt(epaycoDesglose.comision)}`,
                epaycoDesglose.iva_comision > 0 && `IVA: ${fmt(epaycoDesglose.iva_comision)}`,
                epaycoDesglose.retefuente > 0 && `ReteFuente: -${fmt(epaycoDesglose.retefuente)}`,
                epaycoDesglose.reteica > 0 && `ReteICA: -${fmt(epaycoDesglose.reteica)}`,
              ].filter(Boolean).join(' + ')}
            </p>
          )}
          <p className="text-xs font-semibold text-[#1A1A1A] tabular-nums">
            Neto a recibir: {fmt(epaycoDesglose.monto_neto)}
          </p>
        </div>
      )}

      {/* Boton de confirmacion cuando require_confirm esta activo */}
      {requireConfirm && instancia?.estado !== 'completo' && (
        <button
          onClick={handleConfirm}
          disabled={isPending || !isComplete(values) || (!!epaycoLookup && !epaycoDesglose)}
          className="w-full rounded-lg bg-[#10B981] py-2 text-xs font-semibold text-white hover:bg-[#059669] disabled:opacity-40 transition-colors"
        >
          {isPending ? 'Confirmando...' : confirmLabel ?? 'Confirmar datos'}
        </button>
      )}
      {requireConfirm && instancia?.estado === 'completo' && (
        <p className="text-[11px] text-[#10B981] font-medium flex items-center gap-1">
          <span>Confirmado</span>
        </p>
      )}
      {isPending && !requireConfirm && (
        <p className="text-[10px] text-[#6B7280]">Guardando...</p>
      )}
    </div>
  )
}

function DocumentosPreview({ productos }: { productos: ProductosContratados }) {
  const codes = templatesAGenerar(productos)
  if (codes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-[#F9FAFB] p-3">
        <p className="text-[11px] text-[#6B7280]">Selecciona al menos un producto para ver los documentos a generar.</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 space-y-1.5">
      <p className="text-[11px] font-semibold text-[#10B981] flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5" />
        {codes.length} documento{codes.length === 1 ? '' : 's'} a generar
      </p>
      <ul className="space-y-0.5">
        {codes.map(c => (
          <li key={c} className="text-[11px] text-[#1A1A1A] flex gap-1.5">
            <span className="text-[#6B7280] tabular-nums">{c}</span>
            <span className="text-[#6B7280]">—</span>
            <span>{TEMPLATE_NAMES[c] ?? c}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
