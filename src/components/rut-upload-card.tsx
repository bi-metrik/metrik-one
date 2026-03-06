'use client'

import { useRef, useState, useTransition } from 'react'
import { Upload, Loader2, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { uploadAndParseRUT, confirmRutData } from '@/app/(app)/directorio/actions'
import type { RutParseResult, RutEmpresaUpdate } from '@/lib/rut/types'
import { getConfidenceTier } from '@/lib/rut/types'

type CardState = 'idle' | 'processing' | 'review' | 'done'

type UploadResult = { success: boolean; data?: RutParseResult; rutUrl?: string; error?: string }
type ConfirmResult = { success: boolean; error?: string }

interface Props {
  empresaId?: string
  // Alternative flow via callbacks (for mi-negocio / fiscal_profiles)
  onUploadAndParse?: (fd: FormData) => Promise<UploadResult>
  onConfirm?: (fields: RutEmpresaUpdate) => Promise<ConfirmResult>
  currentRutUrl?: string | null
  currentRutVerificado?: boolean | null
  currentRutFecha?: string | null
  onComplete?: () => void
}

export default function RutUploadCard({ empresaId, onUploadAndParse, onConfirm: onConfirmProp, currentRutUrl, currentRutVerificado, currentRutFecha, onComplete }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<CardState>(currentRutVerificado ? 'done' : 'idle')
  const [isPending, startTransition] = useTransition()
  const [parsed, setParsed] = useState<RutParseResult | null>(null)
  const [rutUrl, setRutUrl] = useState<string | null>(currentRutUrl || null)
  const [editedFields, setEditedFields] = useState<Record<string, string | boolean>>({})

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setState('processing')
    const fd = new FormData()
    fd.append('rut', file)

    startTransition(async () => {
      const res = onUploadAndParse
        ? await onUploadAndParse(fd)
        : await uploadAndParseRUT(empresaId!, fd)
      if (res.success && res.data) {
        setParsed(res.data)
        setRutUrl(res.rutUrl || null)
        // Pre-populate edited fields from parsed data
        const initial: Record<string, string | boolean> = {}
        if (res.data.nit.value) initial.numero_documento = res.data.nit.value
        if (res.data.tipo_documento.value) initial.tipo_documento = res.data.tipo_documento.value
        if (res.data.tipo_persona.value) initial.tipo_persona = res.data.tipo_persona.value
        if (res.data.regimen_tributario.value) initial.regimen_tributario = res.data.regimen_tributario.value
        if (res.data.gran_contribuyente.value !== null) initial.gran_contribuyente = res.data.gran_contribuyente.value
        if (res.data.agente_retenedor.value !== null) initial.agente_retenedor = res.data.agente_retenedor.value
        if (res.data.autorretenedor.value !== null) initial.autorretenedor = res.data.autorretenedor.value
        if (res.data.responsable_iva.value !== null) initial.responsable_iva = res.data.responsable_iva.value
        if (res.data.razon_social.value) initial.razon_social = res.data.razon_social.value
        if (res.data.direccion_fiscal.value) initial.direccion_fiscal = res.data.direccion_fiscal.value
        if (res.data.municipio.value) initial.municipio = res.data.municipio.value
        if (res.data.departamento.value) initial.departamento = res.data.departamento.value
        if (res.data.telefono.value) initial.telefono = res.data.telefono.value
        if (res.data.email_fiscal.value) initial.email_fiscal = res.data.email_fiscal.value
        if (res.data.actividad_ciiu.value) initial.actividad_ciiu = res.data.actividad_ciiu.value
        if (res.data.actividad_secundaria.value) initial.actividad_secundaria = res.data.actividad_secundaria.value
        if (res.data.fecha_inicio_actividades.value) initial.fecha_inicio_actividades = res.data.fecha_inicio_actividades.value
        setEditedFields(initial)
        setState('review')
      } else {
        toast.error(res.error || 'Error procesando el RUT')
        setState('idle')
      }
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  const handleConfirm = () => {
    startTransition(async () => {
      const fields: RutEmpresaUpdate = {
        numero_documento: editedFields.numero_documento as string || undefined,
        tipo_documento: editedFields.tipo_documento as string || undefined,
        tipo_persona: editedFields.tipo_persona as string || undefined,
        regimen_tributario: editedFields.regimen_tributario as string || undefined,
        gran_contribuyente: typeof editedFields.gran_contribuyente === 'boolean' ? editedFields.gran_contribuyente : undefined,
        agente_retenedor: typeof editedFields.agente_retenedor === 'boolean' ? editedFields.agente_retenedor : undefined,
        autorretenedor: typeof editedFields.autorretenedor === 'boolean' ? editedFields.autorretenedor : undefined,
        responsable_iva: typeof editedFields.responsable_iva === 'boolean' ? editedFields.responsable_iva : undefined,
        razon_social: editedFields.razon_social as string || undefined,
        direccion_fiscal: editedFields.direccion_fiscal as string || undefined,
        municipio: editedFields.municipio as string || undefined,
        departamento: editedFields.departamento as string || undefined,
        telefono: editedFields.telefono as string || undefined,
        email_fiscal: editedFields.email_fiscal as string || undefined,
        actividad_ciiu: editedFields.actividad_ciiu as string || undefined,
        actividad_secundaria: editedFields.actividad_secundaria as string || undefined,
        fecha_inicio_actividades: editedFields.fecha_inicio_actividades as string || undefined,
        rut_documento_url: rutUrl || undefined,
        rut_confianza_ocr: parsed?.overall_confidence,
      }

      const res = onConfirmProp
        ? await onConfirmProp(fields)
        : await confirmRutData(empresaId!, fields)
      if (res.success) {
        toast.success('Datos del RUT confirmados')
        setState('done')
        router.refresh()
        onComplete?.()
      } else {
        toast.error(res.error || 'Error guardando datos')
      }
    })
  }

  const setField = (key: string, value: string | boolean) => {
    setEditedFields(prev => ({ ...prev, [key]: value }))
  }

  // ── Render states ────────────────────────────────────────

  if (state === 'done') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50/30 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-sm font-medium text-green-800">RUT verificado</p>
              {currentRutFecha && (
                <p className="text-[10px] text-green-600">
                  Cargado el {new Date(currentRutFecha).toLocaleDateString('es-CO')}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => { setState('idle'); setParsed(null) }}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Reemplazar
          </button>
        </div>
      </div>
    )
  }

  if (state === 'processing') {
    return (
      <div className="rounded-lg border-2 border-dashed border-blue-200 bg-blue-50/30 p-6">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-sm font-medium text-blue-700">Analizando RUT con IA...</p>
          <p className="text-[10px] text-blue-500">Extrayendo datos del documento</p>
        </div>
      </div>
    )
  }

  if (state === 'review' && parsed) {
    return (
      <div className="rounded-lg border-2 border-blue-200 bg-blue-50/20 p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-sm font-bold text-blue-800">Datos extraidos del RUT</p>
              <p className="text-[10px] text-blue-600">
                Confianza general: {Math.round(parsed.overall_confidence * 100)}%
                {parsed.nit_valid ? (
                  <span className="ml-2 inline-flex items-center gap-0.5 text-green-600">
                    <CheckCircle2 className="h-3 w-3" /> NIT valido
                  </span>
                ) : (
                  <span className="ml-2 inline-flex items-center gap-0.5 text-red-600">
                    <XCircle className="h-3 w-3" /> NIT no valido (verificar)
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Hard gate fields (most important) */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Datos fiscales (requeridos)</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <FieldRow label="NIT" field={parsed.nit} value={editedFields.numero_documento as string} onChange={v => setField('numero_documento', v)} />
            <FieldRow label="Tipo documento" field={parsed.tipo_documento} value={editedFields.tipo_documento as string} onChange={v => setField('tipo_documento', v)} />
            <FieldRow label="Tipo persona" field={parsed.tipo_persona} value={editedFields.tipo_persona as string} onChange={v => setField('tipo_persona', v)} />
            <FieldRow label="Regimen tributario" field={parsed.regimen_tributario} value={editedFields.regimen_tributario as string} onChange={v => setField('regimen_tributario', v)} />
            <BoolFieldRow label="Gran contribuyente" field={parsed.gran_contribuyente} value={editedFields.gran_contribuyente as boolean} onChange={v => setField('gran_contribuyente', v)} />
            <BoolFieldRow label="Agente retenedor" field={parsed.agente_retenedor} value={editedFields.agente_retenedor as boolean} onChange={v => setField('agente_retenedor', v)} />
            <BoolFieldRow label="Autorretenedor" field={parsed.autorretenedor} value={editedFields.autorretenedor as boolean} onChange={v => setField('autorretenedor', v)} />
            <BoolFieldRow label="Responsable IVA" field={parsed.responsable_iva} value={editedFields.responsable_iva as boolean} onChange={v => setField('responsable_iva', v)} />
          </div>
        </div>

        {/* Identity fields */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Datos de identidad</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <FieldRow label="Razon social" field={parsed.razon_social} value={editedFields.razon_social as string} onChange={v => setField('razon_social', v)} />
            <FieldRow label="Direccion fiscal" field={parsed.direccion_fiscal} value={editedFields.direccion_fiscal as string} onChange={v => setField('direccion_fiscal', v)} />
            <FieldRow label="Municipio" field={parsed.municipio} value={editedFields.municipio as string} onChange={v => setField('municipio', v)} />
            <FieldRow label="Departamento" field={parsed.departamento} value={editedFields.departamento as string} onChange={v => setField('departamento', v)} />
            <FieldRow label="Telefono" field={parsed.telefono} value={editedFields.telefono as string} onChange={v => setField('telefono', v)} />
            <FieldRow label="Email fiscal" field={parsed.email_fiscal} value={editedFields.email_fiscal as string} onChange={v => setField('email_fiscal', v)} />
            <FieldRow label="Actividad CIIU" field={parsed.actividad_ciiu} value={editedFields.actividad_ciiu as string} onChange={v => setField('actividad_ciiu', v)} />
            <FieldRow label="Fecha inicio" field={parsed.fecha_inicio_actividades} value={editedFields.fecha_inicio_actividades as string} onChange={v => setField('fecha_inicio_actividades', v)} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => { setState('idle'); setParsed(null) }}
            className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? 'Guardando...' : 'Confirmar datos'}
          </button>
        </div>
      </div>
    )
  }

  // ── idle state ───────────────────────────────────────────
  return (
    <div className="rounded-lg border-2 border-dashed border-muted-foreground/20 p-4">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        onChange={handleFileUpload}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={isPending}
        className="flex w-full flex-col items-center gap-2 py-3 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Upload className="h-8 w-8" />
        <span className="text-sm font-medium">Subir RUT</span>
        <span className="text-[10px]">PDF, JPG, PNG o WebP · Max 10MB</span>
      </button>
    </div>
  )
}

// ── Helper components ────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const tier = getConfidenceTier(confidence)
  const pct = Math.round(confidence * 100)
  if (tier === 'auto') return <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-medium text-green-700">{pct}%</span>
  if (tier === 'review') return <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">{pct}%</span>
  return <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-700">{pct}%</span>
}

function FieldRow({ label, field, value, onChange }: {
  label: string
  field: { value: string | null; confidence: number }
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1.5">
        <label className="text-[10px] font-medium text-muted-foreground">{label}</label>
        {field.value !== null && <ConfidenceBadge confidence={field.confidence} />}
      </div>
      <input
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={field.value === null ? 'No detectado' : undefined}
        className={`w-full rounded-md border bg-background px-2.5 py-1.5 text-sm ${
          field.confidence < 0.7 && field.value !== null ? 'border-amber-300' : ''
        }`}
      />
    </div>
  )
}

function BoolFieldRow({ label, field, value, onChange }: {
  label: string
  field: { value: boolean | null; confidence: number }
  value: boolean | undefined
  onChange: (v: boolean) => void
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1.5">
        <label className="text-[10px] font-medium text-muted-foreground">{label}</label>
        {field.value !== null && <ConfidenceBadge confidence={field.confidence} />}
      </div>
      <select
        value={value === undefined ? '' : value.toString()}
        onChange={e => onChange(e.target.value === 'true')}
        className={`w-full rounded-md border bg-background px-2.5 py-1.5 text-sm ${
          field.confidence < 0.7 && field.value !== null ? 'border-amber-300' : ''
        }`}
      >
        <option value="">Sin definir</option>
        <option value="true">Si</option>
        <option value="false">No</option>
      </select>
    </div>
  )
}
