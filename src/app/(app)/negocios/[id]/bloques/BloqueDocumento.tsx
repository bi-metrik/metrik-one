'use client'

import { useState, useRef } from 'react'
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
  Copy,
  Check,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { procesarDocumento, actualizarCampoDocumento } from '@/lib/actions/documento-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'
import type { CampoExtraccion, CampoResultado } from '@/lib/ai/extract-fields'

// ── Types ────────────────────────────────────────────────────────────────────

interface BloqueDocumentoProps {
  negocioBloqueId: string
  negocioId: string
  workspaceId: string
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

type UploadState = 'empty' | 'uploading' | 'pending_confirm' | 'processing' | 'uploaded' | 'error'

const BUCKET = 've-documentos'

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

// ── Currency helpers ──────────────────────────────────────────────────────────

const fmtCOP = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

/** Parse a display string like "$1.500.000" or "1500000" to raw number string */
function parseCurrencyInput(display: string): string {
  // Remove $, spaces, dots (thousand sep)
  let cleaned = display.replace(/[$\s.]/g, '')
  // Comma as decimal separator
  cleaned = cleaned.replace(',', '.')
  const num = parseFloat(cleaned)
  if (isNaN(num)) return display // fallback: return as-is
  return String(Math.round(num))
}

/** Format a raw number string "1500000" to display "$1.500.000" */
function formatCurrencyDisplay(raw: string | null): string {
  if (!raw) return ''
  const num = parseFloat(raw)
  if (isNaN(num)) return raw
  return fmtCOP(num)
}

// ── Currency input ───────────────────────────────────────────────────────────

function CurrencyField({
  rawValue,
  onCommit,
  disabled,
  placeholder,
  className,
}: {
  rawValue: string | null
  onCommit: (rawValue: string) => void
  disabled: boolean
  placeholder?: string
  className: string
}) {
  const [display, setDisplay] = useState(() => formatCurrencyDisplay(rawValue))
  const [focused, setFocused] = useState(false)

  const handleFocus = () => {
    setFocused(true)
    // Show raw number for easier editing
    setDisplay(rawValue ?? '')
  }

  const handleBlur = () => {
    setFocused(false)
    const raw = parseCurrencyInput(display)
    setDisplay(formatCurrencyDisplay(raw))
    onCommit(raw)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={focused ? display : formatCurrencyDisplay(parseCurrencyInput(display))}
      onChange={e => setDisplay(e.target.value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  )
}

// ── Campos extraidos form ────────────────────────────────────────────────────

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
  const [saving, setSaving] = useState(false)

  const handleCommit = async (slug: string, value: string) => {
    onUpdate(slug, value)
    setSaving(true)
    const res = await actualizarCampoDocumento(
      negocioBloqueId,
      negocioId,
      slug,
      value,
      camposConfig,
    )
    setSaving(false)
    if (!res.success) toast.error(res.error ?? 'Error guardando campo')
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
          const isCurrency = config.tipo === 'currency'

          const baseClass = isManual
            ? 'border-red-200 bg-red-50/30'
            : campo.confidence >= 0.90
              ? 'border-green-200 bg-green-50/30'
              : 'border-amber-200 bg-amber-50/30'

          const inputClass = `w-full rounded-md border px-3 py-2 text-base transition-all placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60 ${baseClass} ${isCurrency ? 'tabular-nums text-right' : ''}`

          return (
            <div key={config.slug} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {config.label}
                  {config.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {campo && <ConfidenceBadge confidence={campo.confidence} />}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 min-w-0">
                  {isCurrency ? (
                    <CurrencyField
                      rawValue={campo?.value ?? null}
                      onCommit={val => handleCommit(config.slug, val)}
                      disabled={saving}
                      placeholder={isManual ? '$0' : undefined}
                      className={inputClass}
                    />
                  ) : (
                    <input
                      type="text"
                      defaultValue={campo?.value ?? ''}
                      onBlur={e => handleCommit(config.slug, e.target.value)}
                      placeholder={isManual ? 'Completar manualmente' : undefined}
                      disabled={saving}
                      className={inputClass}
                    />
                  )}
                </div>
                <CopyButton value={campo?.value} disabled={saving} />
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
  workspaceId,
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [pendingStoragePath, setPendingStoragePath] = useState<string | null>(null)

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
    setErrorMsg(null)

    try {
      // Upload directo a Supabase Storage desde el cliente
      const supabase = createClient()
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
      const storagePath = `${workspaceId}/negocios/${negocioId}/${negocioBloqueId}/documento.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file, {
          contentType: resolvedType || undefined,
          upsert: true,
        })

      if (uploadErr) {
        setUploadState('error')
        setErrorMsg(uploadErr.message)
        toast.error(`Error subiendo: ${uploadErr.message}`)
        return
      }

      // Go to confirmation state
      setPendingStoragePath(storagePath)
      setUploadState('pending_confirm')
    } catch (err) {
      setUploadState('error')
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      toast.error(`Error: ${msg}`)
    }
  }

  const handleConfirm = async () => {
    if (!pendingStoragePath || !fileName) return

    setUploadState('processing')

    try {
      // Pass old drive_file_id for deletion if replacing
      const oldDriveFileId = (saved.drive_file_id as string) ?? undefined
      const result = await procesarDocumento(
        negocioBloqueId,
        negocioId,
        pendingStoragePath,
        fileName,
        oldDriveFileId || undefined,
      )

      if (!result.success) {
        setUploadState('error')
        setErrorMsg(result.error ?? 'Error procesando documento')
        toast.error(result.error ?? 'Error procesando documento')
        return
      }

      setDriveUrl(result.drive_url ?? null)
      if (result.campos) {
        setCampos(result.campos)
      }
      setUploadState('uploaded')
      setPendingStoragePath(null)

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
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      toast.error(`Error: ${msg}`)
    }
  }

  const handleCancelConfirm = async () => {
    // Clean up the Storage file
    if (pendingStoragePath) {
      try {
        const supabase = createClient()
        await supabase.storage.from(BUCKET).remove([pendingStoragePath])
      } catch {
        // ignore cleanup errors
      }
    }
    setPendingStoragePath(null)
    setFileName(saved.file_name as string ?? null)
    setUploadState(saved.drive_url ? 'uploaded' : 'empty')
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {camposConfig
              .filter(c => !camposVisibles || camposVisibles.includes(c.slug))
              .map(config => {
                const campo = campos[config.slug]
                if (!campo?.value) return null
                const displayValue = config.tipo === 'currency'
                  ? formatCurrencyDisplay(campo.value)
                  : campo.value
                return (
                  <div key={config.slug} className="space-y-1">
                    <label className="block text-xs font-medium text-muted-foreground">
                      {config.label}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <div className={`flex-1 min-w-0 rounded-md border bg-muted/30 px-3 py-2 text-base text-foreground break-words ${config.tipo === 'currency' ? 'tabular-nums' : ''}`}>
                        {displayValue}
                      </div>
                      <CopyButton value={campo.value} />
                    </div>
                  </div>
                )
              })}
          </div>
        )}
        {camposConfig.length === 0 && camposVisibles && Object.keys(campos).length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {camposVisibles.map(slug => {
              const campo = campos[slug]
              if (!campo?.value) return null
              const displayLabel = slug.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
              return (
                <div key={slug} className="space-y-1">
                  <label className="block text-xs font-medium text-muted-foreground">
                    {displayLabel}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-0 rounded-md border bg-muted/30 px-3 py-2 text-base text-foreground break-words">
                      {campo.value}
                    </div>
                    <CopyButton value={campo.value} />
                  </div>
                </div>
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
            <p className="text-[11px] text-blue-500">Subiendo archivo...</p>
          </div>
        </div>
      )}

      {uploadState === 'pending_confirm' && (
        <div className="flex w-full items-center gap-3 rounded-lg border-2 border-solid border-blue-300 bg-blue-50/30 p-4">
          <FileText className="h-5 w-5 text-blue-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-blue-800 truncate block">
              {fileName}
            </span>
            <p className="text-[11px] text-blue-500">
              Archivo listo. Confirma para {camposConfig.length > 0 ? 'procesar con IA y subir a Drive' : 'subir a Drive'}.
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleCancelConfirm}
              className="rounded-md border border-blue-300 bg-white px-2.5 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
            >
              Procesar
            </button>
          </div>
        </div>
      )}

      {uploadState === 'processing' && (
        <div className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4">
          <Sparkles className="h-5 w-5 animate-pulse text-primary shrink-0" />
          <div>
            <span className="text-sm font-medium text-primary">{label}</span>
            <p className="text-[11px] text-primary/70">
              {camposConfig.length > 0 ? 'Procesando con IA...' : 'Guardando en Drive...'}
            </p>
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
          onClick={() => { setUploadState('empty'); fileRef.current?.click() }}
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
            <p className="text-[11px] text-red-500">
              {errorMsg ?? 'Error al subir'}. Toca para intentar de nuevo.
            </p>
          </div>
        </button>
      )}

      {/* Campos AI — se muestran siempre que haya config + archivo,
          aunque la extracción AI haya fallado (permite llenar manual). */}
      {camposConfig.length > 0 && uploadState === 'uploaded' && (
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
