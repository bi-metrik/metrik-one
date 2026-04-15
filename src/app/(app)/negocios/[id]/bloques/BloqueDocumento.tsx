'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  FileText,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ExternalLink,
} from 'lucide-react'
import { uploadDocumento, actualizarCampoDocumento } from '@/lib/actions/documento-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'
import type { CampoExtraccion, CampoResultado } from '@/lib/ai/extract-fields'

// ── Types ────────────────────────────────────────────────────────────────────

interface BloqueDocumentoProps {
  negocioBloqueId: string
  negocioId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  configExtra: {
    label: string
    tipos_permitidos?: string[]
    max_size_mb?: number
    campos_extraccion?: CampoExtraccion[]
    campos_visibles?: string[]
  }
}

type UploadState = 'empty' | 'uploading' | 'processing_ai' | 'uploaded' | 'error'

// ── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 0.90) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-green-600">
        <CheckCircle2 className="h-3 w-3" />
        {Math.round(confidence * 100)}%
      </span>
    )
  }
  if (confidence >= 0.70) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
        <AlertTriangle className="h-3 w-3" />
        Verificar
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-red-500">
      <AlertTriangle className="h-3 w-3" />
      Manual
    </span>
  )
}

// ── Campos extraidos form ────────────────────────────────────────────────────

function CamposExtraidos({
  negocioBloqueId,
  negocioId,
  campos,
  camposConfig,
  onUpdate,
}: {
  negocioBloqueId: string
  negocioId: string
  campos: Record<string, CampoResultado>
  camposConfig: CampoExtraccion[]
  onUpdate: (slug: string, value: string) => void
}) {
  const [isPending, startTransition] = useTransition()

  const handleBlur = (slug: string, value: string) => {
    onUpdate(slug, value)
    startTransition(async () => {
      const res = await actualizarCampoDocumento(
        negocioBloqueId,
        negocioId,
        slug,
        value,
        camposConfig,
      )
      if (!res.success) toast.error(res.error ?? 'Error guardando campo')
    })
  }

  return (
    <div className="border-t pt-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Campos extraídos
      </p>
      <div className="space-y-1.5">
        {camposConfig.map(config => {
          const campo = campos[config.slug]
          const isManual = !campo || campo.manual || campo.value === null

          return (
            <div key={config.slug} className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-[11px] font-medium text-muted-foreground truncate">
                {config.label}
                {config.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <div className="flex-1 min-w-0">
                {isManual ? (
                  <input
                    type="text"
                    defaultValue={campo?.value ?? ''}
                    onBlur={e => handleBlur(config.slug, e.target.value)}
                    placeholder="Completar manualmente"
                    disabled={isPending}
                    className="w-full rounded-md border border-red-200 bg-red-50/30 px-2.5 py-1.5 text-sm transition-all placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
                  />
                ) : (
                  <input
                    type="text"
                    defaultValue={campo.value ?? ''}
                    onBlur={e => handleBlur(config.slug, e.target.value)}
                    disabled={isPending}
                    className={`w-full rounded-md border px-2.5 py-1.5 text-sm transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60 ${
                      campo.confidence >= 0.90
                        ? 'border-green-200 bg-green-50/30'
                        : 'border-amber-200 bg-amber-50/30'
                    }`}
                  />
                )}
              </div>
              <div className="w-16 shrink-0 text-right">
                {campo && <ConfidenceBadge confidence={campo.confidence} />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function BloqueDocumento({
  negocioBloqueId,
  negocioId,
  instancia,
  modo,
  configExtra,
}: BloqueDocumentoProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const saved = (instancia?.data ?? {}) as Record<string, unknown>

  const label = configExtra.label ?? 'Documento'
  const camposConfig = configExtra.campos_extraccion ?? []
  const camposVisibles = configExtra.campos_visibles ?? null
  const maxSizeMb = configExtra.max_size_mb ?? 20

  const [uploadState, setUploadState] = useState<UploadState>(() => {
    if (saved.drive_url) return 'uploaded'
    return 'empty'
  })

  const [driveUrl, setDriveUrl] = useState<string | null>((saved.drive_url as string) ?? null)
  const [fileName, setFileName] = useState<string | null>((saved.file_name as string) ?? null)
  const [campos, setCampos] = useState<Record<string, CampoResultado>>(() => {
    return (saved.campos as Record<string, CampoResultado>) ?? {}
  })

  // ── Handler upload ──────────────────────────────────────────────────────

  const handleFileSelected = async (file: File) => {
    const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

    if (file.size > maxSizeMb * 1024 * 1024) {
      toast.error(`Archivo demasiado grande. Max ${maxSizeMb}MB`)
      return
    }

    const resolvedType = file.type || (() => {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      const map: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
      return map[ext] ?? ''
    })()

    if (resolvedType && !ALLOWED.includes(resolvedType)) {
      toast.error('Solo PDF, JPG, PNG o WebP')
      return
    }

    setUploadState('uploading')
    setFileName(file.name)

    try {
      const formData = new FormData()
      formData.append('file', file)

      // Switch to AI processing state if there are fields to extract
      const aiTimeout = camposConfig.length > 0
        ? setTimeout(() => setUploadState('processing_ai'), 1500)
        : null

      const result = await uploadDocumento(negocioBloqueId, negocioId, formData)
      if (aiTimeout) clearTimeout(aiTimeout)

      if (!result.success) {
        setUploadState('error')
        toast.error(result.error ?? 'Error subiendo documento')
        return
      }

      setDriveUrl(result.drive_url ?? null)
      if (result.campos) {
        setCampos(result.campos)
      }
      setUploadState('uploaded')

      if (camposConfig.length > 0 && result.campos) {
        const hasManual = Object.values(result.campos).some(c => c.manual)
        if (hasManual) {
          toast.info('Algunos campos requieren verificación manual')
        } else {
          toast.success(`Datos extraídos de ${label}`)
        }
      } else {
        toast.success(`${label} subido correctamente`)
      }

      router.refresh()
    } catch (err) {
      setUploadState('error')
      toast.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleCampoUpdate = (slug: string, value: string) => {
    setCampos(prev => ({
      ...prev,
      [slug]: { value: value || null, confidence: 1.0, manual: true },
    }))
  }

  // ── Modo visible ────────────────────────────────────────────────────────

  if (modo === 'visible') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
          <span className="text-xs font-medium">{label}</span>
          {driveUrl && (
            <a
              href={driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Ver en Drive
            </a>
          )}
        </div>
        {camposConfig.length > 0 && Object.keys(campos).length > 0 && (
          <div className="ml-5.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {camposConfig
              .filter(c => !camposVisibles || camposVisibles.includes(c.slug))
              .map(config => {
                const campo = campos[config.slug]
                if (!campo?.value) return null
                return (
                  <span key={config.slug} className="text-[11px] text-muted-foreground">
                    {config.label}: <span className="text-foreground">{campo.value}</span>
                  </span>
                )
              })}
          </div>
        )}
        {camposConfig.length === 0 && camposVisibles && Object.keys(campos).length > 0 && (
          <div className="ml-5.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {camposVisibles.map(slug => {
              const campo = campos[slug]
              if (!campo?.value) return null
              const displayLabel = slug.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
              return (
                <span key={slug} className="text-[11px] text-muted-foreground">
                  {displayLabel}: <span className="text-foreground">{campo.value}</span>
                </span>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Modo editable ───────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Upload zone */}
      {uploadState === 'empty' && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) { handleFileSelected(f); e.target.value = '' }
            }}
            className="hidden"
          />
          <Upload className="h-5 w-5 shrink-0" />
          <div className="text-left">
            <span className="text-sm font-medium">{label}</span>
            <p className="text-[11px] text-muted-foreground/60">
              PDF, JPG, PNG o WebP — max {maxSizeMb}MB
            </p>
          </div>
        </button>
      )}

      {uploadState === 'uploading' && (
        <div className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-blue-200 bg-blue-50/30 p-4">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500 shrink-0" />
          <div>
            <span className="text-sm font-medium text-blue-700">{label}</span>
            <p className="text-[11px] text-blue-500">Subiendo a Drive...</p>
          </div>
        </div>
      )}

      {uploadState === 'processing_ai' && (
        <div className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4">
          <Sparkles className="h-5 w-5 animate-pulse text-primary shrink-0" />
          <div>
            <span className="text-sm font-medium text-primary">{label}</span>
            <p className="text-[11px] text-primary/70">Analizando documento con IA...</p>
          </div>
        </div>
      )}

      {uploadState === 'uploaded' && (
        <div className="flex w-full items-center gap-3 rounded-lg border-2 border-solid border-green-300 bg-green-50/30 p-4">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) { handleFileSelected(f); e.target.value = '' }
            }}
            className="hidden"
          />
          <FileText className="h-5 w-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-green-800 truncate block">
              {fileName ?? label}
            </span>
            {driveUrl && (
              <a
                href={driveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-green-600 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Ver en Drive
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-green-300 bg-white px-2 py-0.5 text-[10px] font-medium text-green-700 hover:bg-green-50 shrink-0"
          >
            Reemplazar
          </button>
        </div>
      )}

      {uploadState === 'error' && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-red-300 bg-red-50/30 p-4 transition-colors hover:border-red-400"
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) { handleFileSelected(f); e.target.value = '' }
            }}
            className="hidden"
          />
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
          <div className="text-left">
            <span className="text-sm font-medium text-red-600">{label}</span>
            <p className="text-[11px] text-red-500">Error al subir. Toca para intentar de nuevo.</p>
          </div>
        </button>
      )}

      {/* Campos AI */}
      {camposConfig.length > 0 && uploadState === 'uploaded' && Object.keys(campos).length > 0 && (
        <CamposExtraidos
          negocioBloqueId={negocioBloqueId}
          negocioId={negocioId}
          campos={campos}
          camposConfig={camposConfig}
          onUpdate={handleCampoUpdate}
        />
      )}
    </div>
  )
}
