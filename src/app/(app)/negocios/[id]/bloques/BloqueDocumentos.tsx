'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Circle, Download, Copy, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { marcarBloqueCompleto } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'
import {
  getUploadUrlDocumentoNegocio,
  confirmarUploadDocumentoNegocio,
  procesarDocumentoNegocio,
  actualizarCamposNegocioBloque,
  type CamposExtraidos,
} from '@/lib/actions/ve-documentos-negocio'
import DocUploadSlot from './DocUploadSlot'
import type { SlotState } from './DocUploadSlot'

export interface DocumentoConfig {
  slug: string
  label: string
  required: boolean
}

interface BloqueDocumentosProps {
  negocioBloqueId: string
  negocioId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  documentos: DocumentoConfig[]
}

// Campos con label para mostrar en el formulario
const CAMPOS_LABELS: Partial<Record<keyof CamposExtraidos, string>> = {
  nombre_propietario: 'Nombre propietario',
  numero_identificacion: 'N° identificación',
  marca: 'Marca',
  linea: 'Línea',
  modelo: 'Modelo (año)',
  tecnologia: 'Tecnología',
  tipo: 'Tipo vehículo',
  numero_cus: 'Número CUS (UPME)',
  telefono_propietario: 'Teléfono',
  municipio_propietario: 'Municipio',
  correo_propietario: 'Correo',
  direccion_propietario: 'Dirección fiscal',
}

// Slugs que disparan procesamiento AI (los 4 documentos de radicación)
const SLUGS_CON_AI = ['factura', 'cedula', 'soporte_upme', 'rut']

// ── Formulario de campos extraídos ────────────────────────────────────────────

function CopyButton({ value, disabled }: { value: string | null | undefined; disabled?: boolean }) {
  const [copied, setCopied] = useState(false)
  const canCopy = !!value && !disabled

  const handleCopy = async () => {
    if (!canCopy) return
    try {
      await navigator.clipboard.writeText(String(value))
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
      className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent transition-colors"
    >
      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function CamposForm({
  negocioBloqueId,
  campos,
  onChange,
}: {
  negocioBloqueId: string
  campos: CamposExtraidos
  onChange: (updated: CamposExtraidos) => void
}) {
  const [isPending, startTransition] = useTransition()

  const handleBlur = (key: keyof CamposExtraidos, value: string) => {
    const updated = { ...campos, [key]: value || undefined }
    onChange(updated)
    startTransition(async () => {
      await actualizarCamposNegocioBloque(negocioBloqueId, { [key]: value || undefined })
    })
  }

  const keys = Object.keys(CAMPOS_LABELS) as (keyof CamposExtraidos)[]

  return (
    <div className="border-t pt-3 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Datos extraídos
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {keys.map(key => (
          <div key={key} className="space-y-1">
            <label className="block text-xs font-medium text-muted-foreground">
              {CAMPOS_LABELS[key]}
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                defaultValue={campos[key] ?? ''}
                onBlur={e => handleBlur(key, e.target.value)}
                placeholder="—"
                disabled={isPending}
                className="flex-1 min-w-0 rounded-md border bg-background px-3 py-2 text-base transition-all disabled:opacity-60"
              />
              <CopyButton value={campos[key]} disabled={isPending} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function BloqueDocumentos({
  negocioBloqueId,
  negocioId,
  instancia,
  modo,
  documentos,
}: BloqueDocumentosProps) {
  const router = useRouter()
  const saved = (instancia?.data ?? {}) as Record<string, unknown>
  const savedDocs = (saved.docs as Record<string, string>) ?? {}

  // Estado de slots
  const [slotStates, setSlotStates] = useState<Record<string, SlotState>>(() => {
    const m: Record<string, SlotState> = {}
    documentos.forEach(d => {
      m[d.slug] = savedDocs[d.slug] ? 'uploaded' : 'empty'
    })
    return m
  })

  const [fileNames, setFileNames] = useState<Record<string, string | undefined>>(() => {
    const m: Record<string, string | undefined> = {}
    Object.entries(savedDocs).forEach(([slug, url]) => {
      const parts = url.split('/')
      m[slug] = parts[parts.length - 1]?.split('?')[0]
    })
    return m
  })

  const [processingSlots, setProcessingSlots] = useState<Set<string>>(new Set())

  // Track URLs subidas en esta sesión para no perderlas en marcarBloqueCompleto
  const [, setUploadedUrls] = useState<Record<string, string>>({})

  // Ref para tracking confiable de slugs subidos (evita timing issues de setState)
  const uploadedSlugsRef = useRef<Set<string>>(new Set(
    documentos.filter(d => savedDocs[d.slug]).map(d => d.slug)
  ))

  const [campos, setCampos] = useState<CamposExtraidos>(() => {
    const c: CamposExtraidos = {}
    const keys = Object.keys(CAMPOS_LABELS) as (keyof CamposExtraidos)[]
    keys.forEach(k => {
      if (saved[k] !== undefined) c[k] = saved[k] as string
    })
    return c
  })

  // Conteo para badge
  const uploadedCount = documentos.filter(d => slotStates[d.slug] === 'uploaded').length

  // ── Handler de upload ──────────────────────────────────────────────────────

  const resolveFileType = (f: File): string => {
    if (f.type) return f.type
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    const map: Record<string, string> = {
      pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp',
    }
    return map[ext] ?? ''
  }

  const handleFileSelected = async (slug: string, file: File) => {
    const MAX_SIZE = 20 * 1024 * 1024
    const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

    if (file.size > MAX_SIZE) { toast.error('Archivo demasiado grande. Max 20MB'); return }
    const resolvedType = resolveFileType(file)
    if (resolvedType && !ALLOWED.includes(resolvedType)) {
      toast.error('Solo PDF, JPG, PNG o WebP'); return
    }

    setSlotStates(prev => ({ ...prev, [slug]: 'uploading' }))

    try {
      // 1. Obtener URL firmada
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
      const uploadInfo = await getUploadUrlDocumentoNegocio(negocioBloqueId, negocioId, slug, ext)
      if (!uploadInfo.success || !uploadInfo.path || !uploadInfo.token) {
        setSlotStates(prev => ({ ...prev, [slug]: 'error' }))
        toast.error(uploadInfo.error ?? 'Error obteniendo URL de subida')
        return
      }

      // 2. Subir a Supabase Storage
      const supabase = createClient()
      const { error: uploadError } = await supabase.storage
        .from('ve-documentos')
        .uploadToSignedUrl(uploadInfo.path, uploadInfo.token, file, {
          contentType: file.type || 'application/octet-stream',
        })
      if (uploadError) {
        setSlotStates(prev => ({ ...prev, [slug]: 'error' }))
        toast.error(`Error al subir: ${uploadError.message}`)
        return
      }

      // 3. Confirmar y guardar URL en bloque data
      const confirmRes = await confirmarUploadDocumentoNegocio(negocioBloqueId, slug, uploadInfo.path)
      if (!confirmRes.success) {
        setSlotStates(prev => ({ ...prev, [slug]: 'error' }))
        toast.error(confirmRes.error ?? 'Error guardando documento')
        return
      }

      setFileNames(prev => ({ ...prev, [slug]: file.name }))
      const currentUrl = confirmRes.url ?? ''
      setUploadedUrls(prev => ({ ...prev, [slug]: currentUrl }))

      // 4. Auto-completar si todos los requeridos están subidos
      // Usar ref (síncrono) en vez de setState callback (puede ser batched en React 18)
      uploadedSlugsRef.current.add(slug)
      setSlotStates(prev => ({ ...prev, [slug]: 'uploaded' as SlotState }))

      const shouldComplete = documentos
        .filter(d => d.required)
        .every(d => uploadedSlugsRef.current.has(d.slug))

      if (shouldComplete && instancia?.estado !== 'completo') {
        // No pasar docs del cliente — el servidor ya tiene todos via confirmarUploadDocumentoNegocio
        const res = await marcarBloqueCompleto(negocioBloqueId, {})
        if (res.error) toast.error(res.error)
        else router.refresh()
      }

      // 5. AI processing para slugs conocidos
      if (SLUGS_CON_AI.includes(slug)) {
        setProcessingSlots(prev => new Set([...prev, slug]))
        const procRes = await procesarDocumentoNegocio(negocioBloqueId, slug)
        setProcessingSlots(prev => { const n = new Set(prev); n.delete(slug); return n })
        if (procRes.success && procRes.data && Object.keys(procRes.data).length > 0) {
          setCampos(prev => ({ ...prev, ...procRes.data }))
          const docLabel = documentos.find(d => d.slug === slug)?.label ?? slug
          toast.success(`Datos extraídos de ${docLabel}`)
        }
      }
    } catch (err) {
      setSlotStates(prev => ({ ...prev, [slug]: 'error' }))
      toast.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Modo visible ───────────────────────────────────────────────────────────

  if (modo === 'visible') {
    return (
      <div className="space-y-2">
        {documentos.map(doc => {
          const url = savedDocs[doc.slug]
          return (
            <div key={doc.slug} className="flex items-center gap-2">
              {url ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#10B981]" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
              )}
              <span className={`text-xs ${url ? '' : 'text-muted-foreground'}`}>{doc.label}</span>
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto">
                  <Download className="h-3.5 w-3.5 text-[#10B981]" />
                </a>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Modo editable ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Badge conteo */}
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums">
          {uploadedCount}/{documentos.length}
        </span>
        {uploadedCount === documentos.length && (
          <span className="text-[11px] text-green-600 font-medium">Todos subidos</span>
        )}
      </div>

      {/* Grid de slots */}
      <div className="grid grid-cols-2 gap-2">
        {documentos.map(doc => (
          <DocUploadSlot
            key={doc.slug}
            label={doc.label}
            state={slotStates[doc.slug] ?? 'empty'}
            fileName={fileNames[doc.slug]}
            isProcessingAi={processingSlots.has(doc.slug)}
            onFileSelected={file => handleFileSelected(doc.slug, file)}
          />
        ))}
      </div>

      {/* Campos extraídos por AI */}
      <CamposForm
        negocioBloqueId={negocioBloqueId}
        campos={campos}
        onChange={setCampos}
      />
    </div>
  )
}
