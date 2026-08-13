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
  Download,
  Copy,
  Check,
  Pencil,
  HelpCircle,
  CalendarClock,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { procesarDocumento, actualizarCampoDocumento, reprocesarDocumento } from '@/lib/actions/documento-actions'
import { useFileDrop } from '@/hooks/use-file-drop'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { puedeCorregirDocumentos } from '@/lib/roles'
import SelectorCausa from '@/components/negocios/selector-causa'
import { LABEL_CAUSA, nuevaSesionId, type CausaCorreccion } from '@/lib/correcciones/causas'
import type { NegocioBloque } from '../../negocio-v2-actions'
import type { CampoExtraccion, CampoResultado, CampoEdicion } from '@/lib/ai/extract-fields'

// ── Types ────────────────────────────────────────────────────────────────────

interface BloqueDocumentoProps {
  negocioBloqueId: string
  negocioId: string
  workspaceId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  /** El usuario es responsable de ESTE negocio. Habilita al ejecutor a corregir
   *  los campos de sus documentos (el servidor ya lo permite vía guardEditarBloque). */
  esResponsable?: boolean
  /** Rol del usuario actual — habilita la corrección gerencial de campos
   *  extraídos en modo visible (etapas posteriores). */
  userRole?: string
  configExtra: {
    label: string
    tipos_permitidos?: string[]
    max_size_mb?: number
    campos_extraccion?: CampoExtraccion[]
    campos_visibles?: string[]
    // Opt-in: permite editar manualmente los campos extraídos incluso en modo
    // readonly (etapas posteriores). Necesario cuando el dato de UPME difiere del
    // extraído y el operador debe corregirlo sin reprocesar el documento. Sin este
    // flag, el modo visible es 100% readonly (comportamiento histórico).
    editar_extraidos?: boolean
    /** Opt-in: en modo visible (etapas posteriores), un rol gerencial
     *  (owner/admin/supervisor) puede corregir TODOS los campos extraídos
     *  (no solo los de alerta_revision). Cada corrección queda marcada. */
    corregir_campos_gerencial?: boolean
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

// ── Marca de edición manual (trazabilidad: quién + cuándo) ────────────────────

function EdicionBadge({ edicion }: { edicion: CampoEdicion }) {
  let fecha = ''
  try {
    fecha = new Date(edicion.editado_en).toLocaleDateString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch {
    fecha = edicion.editado_en
  }
  return (
    <span
      title={`Editado a mano por ${edicion.editado_por_nombre} · ${fecha}`}
      className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
    >
      <Pencil className="h-3 w-3" />
      Editado · {edicion.editado_por_nombre}
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
                <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  {config.label}
                  {config.required && <span className="text-red-500 ml-0.5">*</span>}
                  {config.alerta_revision && (
                    <InfoTooltip text="Dato extraído por IA. Verifícalo contra el documento original y corrígelo si difiere de lo registrado en UPME." />
                  )}
                </label>
                <div className="flex items-center gap-2">
                  {config.alerta_revision && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                      <AlertTriangle className="h-3 w-3" />
                      Revisar
                    </span>
                  )}
                  {campo?.edicion
                    ? <EdicionBadge edicion={campo.edicion} />
                    : campo && <ConfidenceBadge confidence={campo.confidence} />}
                </div>
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

// ── Campo extraído editable en modo visible (opt-in editar_extraidos) ────────
// Reusa actualizarCampoDocumento: persiste el valor como manual (confidence 1.0).
// Usado cuando el operador, en una etapa posterior, debe corregir un dato que
// difiere de UPME sin reprocesar el documento.

function EditableCampoVisible({
  negocioBloqueId,
  negocioId,
  config,
  campo,
  camposConfig,
  onUpdate,
  correccion,
}: {
  negocioBloqueId: string
  negocioId: string
  config: CampoExtraccion
  campo: CampoResultado | undefined
  camposConfig: CampoExtraccion[]
  onUpdate: (slug: string, value: string) => void
  /** Causa + sesión cuando el bloque es de una etapa ya superada. */
  correccion?: { causa: string; sesion_id: string }
}) {
  const [saving, setSaving] = useState(false)
  const isCurrency = config.tipo === 'currency'

  const handleCommit = async (value: string) => {
    onUpdate(config.slug, value)
    setSaving(true)
    const res = await actualizarCampoDocumento(
      negocioBloqueId,
      negocioId,
      config.slug,
      value,
      camposConfig,
      correccion,
    )
    setSaving(false)
    if (!res.success) toast.error(res.error ?? 'Error guardando campo')
    else toast.success('Valor actualizado')
  }

  const inputClass =
    `w-full rounded-md border border-amber-200 bg-amber-50/30 px-3 py-2 text-base transition-all placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60 ${isCurrency ? 'tabular-nums text-right' : ''}`

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 min-w-0">
        {isCurrency ? (
          <CurrencyField
            rawValue={campo?.value ?? null}
            onCommit={handleCommit}
            disabled={saving}
            placeholder="$0"
            className={inputClass}
          />
        ) : (
          <input
            type="text"
            defaultValue={campo?.value ?? ''}
            onBlur={e => handleCommit(e.target.value)}
            disabled={saving}
            className={inputClass}
          />
        )}
      </div>
      <CopyButton value={campo?.value} disabled={saving} />
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
  userRole,
  configExtra,
  esResponsable,
}: BloqueDocumentoProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const saved = (instancia?.data ?? {}) as Record<string, unknown>

  const label = configExtra.label ?? 'Documento'
  const camposConfig = configExtra.campos_extraccion ?? []
  const camposVisibles = configExtra.campos_visibles ?? null
  const maxSizeMb = configExtra.max_size_mb ?? 20
  const editarExtraidos = configExtra.editar_extraidos === true
  // Corrección en modo visible (opt-in por config `corregir_campos_gerencial`).
  // Dos perfiles la tienen:
  //  - roles gerenciales (owner/admin/supervisor), que corrigen cualquier caso;
  //  - el EJECUTOR RESPONSABLE del negocio, sobre sus propios documentos.
  // El servidor valida ambos por la misma puerta (`guardEditarBloque`: el área
  // debe cubrir el stage y, si es operator, debe ser responsable). Antes la
  // pantalla solo dejaba pasar a los gerenciales, así que el comercial cargaba la
  // factura, veía el dato mal extraído y no tenía cómo corregirlo.
  const corregirGerencial = configExtra.corregir_campos_gerencial === true
  const puedeCorregirVisible = puedeCorregirDocumentos(userRole) || esResponsable === true
  // Causa de la corrección, elegida en un clic y compartida por todos los campos del
  // bloque: corregir tres campos del mismo documento por el mismo motivo es UNA
  // corrección, no tres. `sesionDoc` es lo que las agrupa en el registro.
  const [causaDoc, setCausaDoc] = useState<CausaCorreccion | null>(null)
  const sesionDoc = useRef<string | null>(null)

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
  const [reprocessing, setReprocessing] = useState(false)
  const [extractionStatus, setExtractionStatus] = useState<'ok' | 'failed' | 'no_key' | null>(
    () => (saved._extraction_status as 'ok' | 'failed' | 'no_key' | undefined) ?? null,
  )

  const handleReprocesar = async () => {
    setReprocessing(true)
    try {
      const res = await reprocesarDocumento(negocioBloqueId, negocioId)
      if (!res.success) {
        toast.error(res.error ?? 'Error reprocesando')
        return
      }
      if (res.campos) setCampos(res.campos)
      setExtractionStatus('ok')
      toast.success('Documento reprocesado con IA')
      router.refresh()
    } finally {
      setReprocessing(false)
    }
  }

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

    // Aviso antes de perder correcciones manuales: `procesarDocumento` reemplaza
    // `data.campos` COMPLETO con lo que extraiga la IA del archivo nuevo (no hace
    // merge — es lo correcto: el caso de uso real es "quedó cargada la factura
    // equivocada, subo la correcta", donde preservar campos del documento viejo
    // sería peor). Lo que faltaba era avisar.
    const camposCorregidos = Object.values(campos).filter(c => c?.manual === true).length
    if (camposCorregidos > 0) {
      const plural = camposCorregidos === 1
        ? 'Este documento tiene 1 campo corregido a mano.'
        : `Este documento tiene ${camposCorregidos} campos corregidos a mano.`
      if (!confirm(`${plural} Al reemplazarlo se perderán esas correcciones. ¿Continuar?`)) {
        return
      }
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
      setExtractionStatus(result.extraction_status ?? null)
      setUploadState('uploaded')
      setPendingStoragePath(null)

      if (camposConfig.length > 0 && result.extraction_status === 'failed') {
        toast.error('La extracción con IA falló. Reintenta o completa los campos manualmente.')
      } else if (camposConfig.length > 0 && result.campos) {
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

  // Drop de archivo (modo editable): suelta sobre la zona = mismo flujo que el
  // file picker. Inactivo mientras se sube/procesa para no pisar una carga en
  // curso. Declarado antes de cualquier return condicional (rules-of-hooks).
  const dropDisabled = uploadState === 'uploading' || uploadState === 'processing' || uploadState === 'pending_confirm'
  const fileDrop = useFileDrop({
    onFiles: files => handleFileSelected(files[0]),
    disabled: dropDisabled,
  })

  // ── Modo visible ────────────────────────────────────────────────────────

  if (modo === 'visible') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {driveUrl ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs font-medium">{label}</span>
          {driveUrl ? (
            <div className="ml-auto flex items-center gap-1.5">
              <a
                href={driveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-0.5 text-[11px] text-primary hover:bg-primary/5"
              >
                <ExternalLink className="h-3 w-3" />
                Ver
              </a>
              <a
                href={driveUrl}
                download
                className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-0.5 text-[11px] text-primary hover:bg-primary/5"
              >
                <Download className="h-3 w-3" />
                Descargar
              </a>
            </div>
          ) : (
            <span className="ml-auto text-[11px] text-muted-foreground italic">Sin archivo</span>
          )}
        </div>
        {/* La causa se elige antes de habilitar la edición, igual que en los bloques de
            datos: el servidor la exige cuando el bloque es de una etapa ya superada. */}
        {corregirGerencial && puedeCorregirVisible && !causaDoc && (
          <SelectorCausa
            onElegir={c => { sesionDoc.current = nuevaSesionId(); setCausaDoc(c) }}
            onCancelar={() => setCausaDoc(null)}
          />
        )}
        {corregirGerencial && puedeCorregirVisible && causaDoc && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2">
            <span className="text-[11px] text-[#92400E]">
              Corrigiendo ({LABEL_CAUSA[causaDoc]}). Queda registrado con tu nombre y con lo que decía antes.
            </span>
            <button
              type="button"
              onClick={() => { setCausaDoc(null); sesionDoc.current = null }}
              className="shrink-0 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-[#92400E] border border-[#FDE68A] hover:bg-[#FEF3C7] transition-colors"
            >
              Listo
            </button>
          </div>
        )}
        {camposConfig.length > 0 && Object.keys(campos).length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {camposConfig
              .filter(c => !camposVisibles || camposVisibles.includes(c.slug))
              .map(config => {
                const campo = campos[config.slug]
                // Editable en modo readonly de una etapa posterior por dos vías:
                //  (a) histórica: campo alerta_revision en bloque con editar_extraidos
                //      (corrección de datos que difieren de UPME, cualquier autorizado);
                //  (b) gerencial: owner/admin/supervisor corrigen TODOS los campos
                //      (opt-in corregir_campos_gerencial). El resto es solo lectura.
                // Sin causa elegida, la corrección gerencial no habilita el input: el
                // servidor la rechazaría de todos modos, y es mejor no ofrecer un campo
                // que va a fallar al guardar.
                const editable =
                  (editarExtraidos && config.alerta_revision === true) ||
                  (corregirGerencial && puedeCorregirVisible && !!causaDoc)
                if (!editable && !campo?.value) return null
                const displayValue = config.tipo === 'currency'
                  ? formatCurrencyDisplay(campo?.value ?? null)
                  : campo?.value
                return (
                  <div key={config.slug} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-medium text-muted-foreground">
                        {config.label}
                      </label>
                      <div className="flex items-center gap-1.5">
                        {config.alerta_revision && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            <AlertTriangle className="h-3 w-3" />
                            Revisar
                          </span>
                        )}
                        {campo?.edicion
                          ? <EdicionBadge edicion={campo.edicion} />
                          : campo && !campo.manual && <ConfidenceBadge confidence={campo.confidence} />}
                      </div>
                    </div>
                    {editable ? (
                      <EditableCampoVisible
                        correccion={causaDoc && sesionDoc.current
                          ? { causa: causaDoc, sesion_id: sesionDoc.current }
                          : undefined}
                        negocioBloqueId={negocioBloqueId}
                        negocioId={negocioId}
                        config={config}
                        campo={campo}
                        camposConfig={camposConfig}
                        onUpdate={handleCampoUpdate}
                      />
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <div className={`flex-1 min-w-0 rounded-md border bg-muted/30 px-3 py-2 text-base text-foreground break-words ${config.tipo === 'currency' ? 'tabular-nums' : ''}`}>
                          {displayValue}
                        </div>
                        <CopyButton value={campo?.value} />
                      </div>
                    )}
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
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs font-medium text-muted-foreground">
                      {displayLabel}
                    </label>
                    {!campo.manual && <ConfidenceBadge confidence={campo.confidence} />}
                  </div>
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
          {...fileDrop.dropProps}
          className={`flex w-full items-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors ${
            fileDrop.isDragging
              ? 'border-primary bg-primary/5 text-foreground'
              : 'border-muted-foreground/25 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground'
          }`}
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
              {fileDrop.isDragging
                ? 'Suelta el archivo aquí'
                : `Toca o arrastra — PDF, JPG, PNG o WebP — max ${maxSizeMb}MB`}
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
              {camposConfig.length > 0 ? 'Procesar' : 'Confirmar'}
            </button>
          </div>
        </div>
      )}

      {uploadState === 'processing' && (
        camposConfig.length > 0 ? (
          <div className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4">
            <Sparkles className="h-5 w-5 animate-pulse text-primary shrink-0" />
            <div>
              <span className="text-sm font-medium text-primary">{label}</span>
              <p className="text-[11px] text-primary/70">Procesando con IA...</p>
            </div>
          </div>
        ) : (
          <div className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-blue-200 bg-blue-50/30 p-4">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500 shrink-0" />
            <div>
              <span className="text-sm font-medium text-blue-700">{label}</span>
              <p className="text-[11px] text-blue-500">Guardando en Drive...</p>
            </div>
          </div>
        )
      )}

      {uploadState === 'uploaded' && (
        <div
          {...fileDrop.dropProps}
          className={`flex w-full items-center gap-3 rounded-lg border-2 p-4 transition-colors ${
            fileDrop.isDragging
              ? 'border-dashed border-primary bg-primary/5'
              : 'border-solid border-green-300 bg-green-50/30'
          }`}
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
          <div className="flex items-center gap-1.5 shrink-0">
            {camposConfig.length > 0 && (
              <button
                type="button"
                onClick={handleReprocesar}
                disabled={reprocessing}
                title="Reprocesar con IA"
                className="rounded-md border border-primary/30 bg-white px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/5 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {reprocessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {reprocessing ? 'Procesando…' : 'Reprocesar IA'}
              </button>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-green-300 bg-white px-2 py-0.5 text-[10px] font-medium text-green-700 hover:bg-green-50"
            >
              Reemplazar
            </button>
          </div>
        </div>
      )}

      {uploadState === 'error' && (
        <button
          type="button"
          onClick={() => { setUploadState('empty'); fileRef.current?.click() }}
          {...fileDrop.dropProps}
          className={`flex w-full items-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors ${
            fileDrop.isDragging
              ? 'border-primary bg-primary/5'
              : 'border-red-300 bg-red-50/30 hover:border-red-400'
          }`}
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

      {/* Banner: la extracción IA falló — reintentar o llenar manual.
          Señal visible para que el bloque no quede 'pendiente' en silencio. */}
      {camposConfig.length > 0 && uploadState === 'uploaded' && extractionStatus === 'failed' && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/50 p-3">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-red-700">La extracción con IA falló</p>
            <p className="mt-0.5 text-[11px] text-red-600">
              El archivo se cargó, pero no se pudieron extraer los datos. Reintenta la extracción
              o completa los campos requeridos manualmente para poder avanzar de etapa.
            </p>
          </div>
          <button
            type="button"
            onClick={handleReprocesar}
            disabled={reprocessing}
            className="shrink-0 inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {reprocessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {reprocessing ? 'Reintentando…' : 'Reintentar'}
          </button>
        </div>
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

      {/* Cross-check: validacion contra datos de otros bloques */}
      {uploadState === 'uploaded' && saved._cross_check ? (
        <CrossCheckPanel cross_check={saved._cross_check as CrossCheckPanelData} />
      ) : null}
    </div>
  )
}

// ── Cross-check panel ────────────────────────────────────────────────────────

type EstadoCheckPanel = 'ok' | 'falla' | 'no_comprobable'
type EstadoVigenciaPanel = 'vigente' | 'reemplazar' | 'esperar' | 'no_comprobable'
type CriterioVigenciaPanel = 'cita' | 'margen'

type CrossCheckPanelData = {
  passed: boolean
  // solo_alerta: la discrepancia se reporta como alerta (no bloquea el avance).
  solo_alerta?: boolean
  results: Array<{
    slug: string
    label: string
    expected: string
    extracted: string
    ok: boolean
    // Los tres campos siguientes son OPCIONALES a propósito: los `_cross_check` ya
    // guardados en `negocio_bloques.data` no los tienen, y esos bloques se siguen
    // pintando (no se recalculan solos). Si faltan, la fila cae al modo de dos
    // estados de siempre en vez de inventar un veredicto.
    estado?: EstadoCheckPanel
    vigencia?: EstadoVigenciaPanel
    pedir_desde?: string | null
    /**
     * Contra qué midió el servidor: la fecha de la cita, o el margen mínimo de vida
     * cuando todavía no hay cita. La frase cambia por completo entre los dos casos,
     * y deducirlo aquí por la ausencia de `pedir_desde` sería una inferencia frágil.
     */
    criterio?: CriterioVigenciaPanel
  }>
}

const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * 'YYYY-MM-DD' → "27 de agosto".
 *
 * Se arma desde las partes de la cadena y NO con `new Date('YYYY-MM-DD')`: esa forma
 * se interpreta como UTC y en Colombia (UTC-5) cae en el día anterior, así que la
 * pantalla mandaría a pedir el documento un día antes de lo que calculó el servidor.
 */
function fechaLegible(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const mes = MESES_ES[Number(m[2]) - 1]
  if (!mes) return iso
  return `${Number(m[3])} de ${mes}`
}

function CrossCheckPanel({ cross_check }: { cross_check: CrossCheckPanelData }) {
  // Un `_cross_check` viejo no trae `estado`; ahí `ok` sigue mandando. Uno nuevo sí,
  // y entonces distingue "falló" de "no se pudo comprobar" — que no es lo mismo y no
  // debe pintarse igual.
  const estadoDe = (r: CrossCheckPanelData['results'][number]): EstadoCheckPanel =>
    r.estado ?? (r.ok ? 'ok' : 'falla')

  const fallos = cross_check.results.filter(r => estadoDe(r) === 'falla')
  const sinComprobar = cross_check.results.filter(r => estadoDe(r) === 'no_comprobable')

  // Modo alerta: hay discrepancia pero NO bloquea (solo_alerta). Se muestra en ámbar
  // (revisar/corregir si aplica), no en rojo de bloqueo. Un check que no se pudo
  // comprobar tampoco bloquea, así que el panel entero se queda en ámbar.
  const esAlerta = (fallos.length > 0 && cross_check.solo_alerta === true)
    || (fallos.length === 0 && sinComprobar.length > 0)
  const todoBien = fallos.length === 0 && sinComprobar.length === 0
  const falloIconColor = esAlerta ? 'text-amber-600' : 'text-red-600'

  const encabezado = todoBien
    ? 'Certificado validado: los datos coinciden con el negocio.'
    : fallos.length === 0
      ? `Falta un dato para comprobar ${sinComprobar.length} campo(s). No bloquea el avance, pero tampoco está verificado.`
      : cross_check.solo_alerta === true
        ? `Alerta: ${fallos.length} de ${cross_check.results.length} campo(s) no coinciden con el negocio. Revisa y corrige el dato si aplica. No bloquea el avance.`
        : `Discrepancia detectada (${fallos.length} de ${cross_check.results.length}). Sube un nuevo certificado o resuelve con UPME.`

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        todoBien
          ? 'border-green-200 bg-green-50/40'
          : esAlerta
            ? 'border-amber-200 bg-amber-50/40'
            : 'border-red-200 bg-red-50/40'
      }`}
    >
      <div className="flex items-center gap-2">
        {todoBien ? (
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
        ) : (
          <AlertTriangle className={`h-4 w-4 shrink-0 ${esAlerta ? 'text-amber-600' : 'text-red-600'}`} />
        )}
        <p className={`text-xs font-semibold ${todoBien ? 'text-green-700' : esAlerta ? 'text-amber-700' : 'text-red-700'}`}>
          {encabezado}
        </p>
      </div>
      <div className="space-y-1.5">
        {cross_check.results.map(r => {
          const estado = estadoDe(r)
          const noComprobable = estado === 'no_comprobable'
          return (
            <div
              key={r.slug}
              className="flex items-start gap-2 rounded-md border border-border/50 bg-white px-2 py-1.5"
            >
              {estado === 'ok' ? (
                <Check className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
              ) : noComprobable ? (
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${falloIconColor}`} />
              )}
              <div className="flex-1 min-w-0 text-[11px]">
                <p className="font-medium text-foreground">{r.label}</p>
                <div className="grid grid-cols-2 gap-2 mt-0.5">
                  <div>
                    <span className="text-muted-foreground">Esperado: </span>
                    <span className="text-foreground break-words">{r.expected || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Certificado: </span>
                    <span className={estado === 'falla' ? 'text-red-700 font-medium' : 'text-foreground'}>
                      {r.extracted || '—'}
                    </span>
                  </div>
                </div>
                <NotaVigencia
                  vigencia={r.vigencia}
                  pedirDesde={r.pedir_desde}
                  criterio={r.criterio}
                  faltaExpedicion={!r.extracted?.trim()}
                  noComprobable={noComprobable}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * La línea accionable de un documento con fecha de caducidad.
 *
 * Los cuatro estados los decide el SERVIDOR contra la hora de Bogotá; aquí solo se
 * redactan. `esperar` existe porque decirle al comercial "pídelo" cuando un documento
 * expedido hoy también llegaría vencido a la cita es trabajo repetido: la fecha sale
 * calculada de la cita, nunca guardada, para que al reprogramarse no quede una fecha
 * congelada mandando a pedirlo el día equivocado.
 */
function NotaVigencia({
  vigencia,
  pedirDesde,
  criterio,
  faltaExpedicion,
  noComprobable,
}: {
  vigencia?: EstadoVigenciaPanel
  pedirDesde?: string | null
  criterio?: CriterioVigenciaPanel
  /** El documento no trajo fecha de expedición legible. Se deriva de la fila. */
  faltaExpedicion: boolean
  noComprobable: boolean
}) {
  // Sin cita el objetivo se mueve con el día, así que nunca hay nada que esperar y
  // no existe una fecha desde la cual pedirlo: la única frase posible es "pídelo ya".
  if (vigencia === 'reemplazar' && criterio === 'margen') {
    return (
      <p className="mt-1 flex items-start gap-1 text-[11px] text-red-700">
        <CalendarClock className="h-3 w-3 shrink-0 mt-0.5" />
        <span>
          Todavía no hay cita y a este certificado no le queda vigencia suficiente para
          el trámite. <strong>Pide uno nuevo al cliente.</strong>
        </span>
      </p>
    )
  }
  if (vigencia === 'esperar' && pedirDesde) {
    return (
      <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700">
        <CalendarClock className="h-3 w-3 shrink-0 mt-0.5" />
        <span>
          No sirve para la fecha de la cita. <strong>Pídelo a partir del {fechaLegible(pedirDesde)}</strong>
          {' '}— uno expedido hoy también llegaría vencido.
        </span>
      </p>
    )
  }
  if (vigencia === 'reemplazar') {
    return (
      <p className="mt-1 flex items-start gap-1 text-[11px] text-red-700">
        <CalendarClock className="h-3 w-3 shrink-0 mt-0.5" />
        <span>
          Vencido para la fecha de la cita. <strong>Pide el reemplazo al cliente ya</strong>
          {pedirDesde ? ` (uno expedido desde el ${fechaLegible(pedirDesde)} sirve).` : '.'}
        </span>
      </p>
    )
  }
  // `no_comprobable` se dice explícitamente en vez de callarlo: un campo sin marca se
  // lee como validado. **Cuál de los dos datos falta se DERIVA de la fila**, no se
  // asume: con el margen sin cita activo, lo que suele faltar ya no es la cita sino la
  // fecha de expedición, y afirmar la causa equivocada deja una pantalla que se ve
  // sana y manda a esperar algo que ya llegó.
  if (noComprobable) {
    return (
      <p className="mt-1 text-[11px] text-muted-foreground">
        {vigencia !== 'no_comprobable'
          ? 'Falta el dato de referencia para comprobarlo.'
          : !faltaExpedicion
            ? 'Aún no hay fecha de cita para comprobar la vigencia. Se revisará cuando la DIAN la asigne.'
            : 'No se pudo leer la fecha de expedición del documento. Corrígela para comprobar la vigencia.'}
      </p>
    )
  }
  return null
}
