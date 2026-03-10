'use client'

import { useRef, useState, useTransition } from 'react'
import { Upload, Loader2, ShieldCheck, Shield, Check, FileText, CheckCircle2, XCircle, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { uploadAndParseRUTFiscal, confirmRutFiscalProfile, updateFiscalExtended } from './actions'
import type { RutParseResult } from '@/lib/rut/types'
import { getConfidenceTier } from '@/lib/rut/types'
import type { FiscalProfile } from '@/types/database'

type ViewState = 'summary' | 'upload' | 'processing' | 'review' | 'manual'

interface Props {
  fiscalProfile: FiscalProfile | null
  onClose: () => void
}

export default function PerfilFiscalExtended({ fiscalProfile, onClose }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()
  const [view, setView] = useState<ViewState>(
    fiscalProfile?.is_complete || fiscalProfile?.is_estimated ? 'summary' : 'upload'
  )
  const [parsed, setParsed] = useState<RutParseResult | null>(null)
  const [rutUrl, setRutUrl] = useState<string | null>(fiscalProfile?.rut_documento_url || null)
  const [editedFields, setEditedFields] = useState<Record<string, string | boolean>>({})

  // Manual edit fields
  const [nit, setNit] = useState(fiscalProfile?.nit || '')
  const [razonSocial, setRazonSocial] = useState(fiscalProfile?.razon_social || '')
  const [direccionFiscal, setDireccionFiscal] = useState(fiscalProfile?.direccion_fiscal || '')
  const [emailFacturacion, setEmailFacturacion] = useState(fiscalProfile?.email_facturacion || '')

  const isConfigured = fiscalProfile?.is_complete || fiscalProfile?.is_estimated

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setView('processing')
    const fd = new FormData()
    fd.append('rut', file)

    startTransition(async () => {
      const res = await uploadAndParseRUTFiscal(fd)
      if (res.success && res.data) {
        setParsed(res.data)
        setRutUrl(res.rutUrl || null)
        const initial: Record<string, string | boolean> = {}
        if (res.data.nit.value) initial.nit = res.data.nit.value
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
        setView('review')
      } else {
        toast.error(res.error || 'Error procesando el RUT')
        setView('upload')
      }
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  const handleConfirm = () => {
    startTransition(async () => {
      const fields: Record<string, string | boolean | number | undefined> = {
        ...editedFields,
        rut_documento_url: rutUrl || undefined,
        rut_confianza_ocr: parsed?.overall_confidence,
      }

      const res = await confirmRutFiscalProfile(fields)
      if (res.success) {
        toast.success('Perfil fiscal actualizado desde RUT')
        setView('summary')
        router.refresh()
      } else {
        toast.error(res.error || 'Error guardando datos')
      }
    })
  }

  const handleSaveManual = () => {
    startTransition(async () => {
      const res = await updateFiscalExtended({
        nit: nit.trim() || undefined,
        razon_social: razonSocial.trim() || undefined,
        direccion_fiscal: direccionFiscal.trim() || undefined,
        email_facturacion: emailFacturacion.trim() || undefined,
      })
      if (res.success) {
        toast.success('Datos de facturacion actualizados')
        setView('summary')
        router.refresh()
      } else {
        toast.error(res.error || 'Error')
      }
    })
  }

  const setField = (key: string, value: string | boolean) => {
    setEditedFields(prev => ({ ...prev, [key]: value }))
  }

  // ── Summary view ────────────────────────────────────────
  if (view === 'summary' && isConfigured) {
    const fp = fiscalProfile!
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Perfil fiscal</h3>
            {fp.rut_verificado && (
              <div className="flex items-center gap-1 mt-1">
                <ShieldCheck className="h-3 w-3 text-green-500" />
                <span className="text-xs text-green-600">Verificado por RUT</span>
              </div>
            )}
            {fp.is_estimated && !fp.rut_verificado && (
              <div className="flex items-center gap-1 mt-1">
                <Shield className="h-3 w-3 text-amber-500" />
                <span className="text-xs text-amber-600">Algunos valores son estimados</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('upload')}
              className="text-xs text-primary hover:underline"
            >
              {fp.rut_verificado ? 'Resubir RUT' : 'Subir RUT'}
            </button>
            <button
              onClick={() => setView('manual')}
              className="text-xs text-muted-foreground hover:underline"
            >
              Editar
            </button>
          </div>
        </div>

        <div className="space-y-1.5 rounded-lg border p-3">
          <SummaryRow label="NIT" value={fp.nit} />
          <SummaryRow label="Razon social" value={fp.razon_social} />
          <SummaryRow label="Tipo persona" value={fp.person_type === 'persona_juridica' ? 'Persona Juridica' : fp.person_type === 'persona_natural' ? 'Persona Natural' : fp.person_type} />
          <SummaryRow label="Regimen" value={fp.tax_regime === 'simple' ? 'Simple (SIMPLE)' : fp.tax_regime === 'ordinario' ? 'Ordinario' : fp.tax_regime} />
          <SummaryRow label="IVA" value={fp.iva_responsible ? 'Responsable (19%)' : fp.iva_responsible === false ? 'No responsable' : null} />
          <SummaryRow label="Autorretenedor" value={fp.self_withholder ? 'Si' : fp.self_withholder === false ? 'No' : null} />
          {fp.ica_city && <SummaryRow label="Ciudad ICA" value={`${fp.ica_city}${fp.ica_rate ? ` (${fp.ica_rate}\u2030)` : ''}`} />}
          <SummaryRow label="Direccion fiscal" value={fp.direccion_fiscal} />
          <SummaryRow label="Email facturacion" value={fp.email_facturacion || fp.email_fiscal} />
        </div>
      </div>
    )
  }

  // ── Processing view ─────────────────────────────────────
  if (view === 'processing') {
    return (
      <div className="rounded-lg border-2 border-dashed border-blue-200 bg-blue-50/30 p-6">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-sm font-medium text-blue-700">Analizando RUT con IA...</p>
          <p className="text-[10px] text-blue-500">Extrayendo datos fiscales del documento</p>
        </div>
      </div>
    )
  }

  // ── Review view (after OCR) ─────────────────────────────
  if (view === 'review' && parsed) {
    return (
      <div className="rounded-lg border-2 border-blue-200 bg-blue-50/20 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-sm font-bold text-blue-800">Datos extraidos del RUT</p>
              <p className="text-[10px] text-blue-600">
                Confianza: {Math.round(parsed.overall_confidence * 100)}%
                {parsed.nit_valid ? (
                  <span className="ml-2 inline-flex items-center gap-0.5 text-green-600">
                    <CheckCircle2 className="h-3 w-3" /> NIT valido
                  </span>
                ) : (
                  <span className="ml-2 inline-flex items-center gap-0.5 text-red-600">
                    <XCircle className="h-3 w-3" /> NIT no valido
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Datos fiscales</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <FieldRow label="NIT" field={parsed.nit} value={editedFields.nit as string} onChange={v => setField('nit', v)} />
            <FieldRow label="Tipo documento" field={parsed.tipo_documento} value={editedFields.tipo_documento as string} onChange={v => setField('tipo_documento', v)} />
            <FieldRow label="Tipo persona" field={parsed.tipo_persona} value={editedFields.tipo_persona as string} onChange={v => setField('tipo_persona', v)} />
            <FieldRow label="Regimen tributario" field={parsed.regimen_tributario} value={editedFields.regimen_tributario as string} onChange={v => setField('regimen_tributario', v)} />
            <BoolFieldRow label="Gran contribuyente" field={parsed.gran_contribuyente} value={editedFields.gran_contribuyente as boolean} onChange={v => setField('gran_contribuyente', v)} />
            <BoolFieldRow label="Agente retenedor" field={parsed.agente_retenedor} value={editedFields.agente_retenedor as boolean} onChange={v => setField('agente_retenedor', v)} />
            <BoolFieldRow label="Autorretenedor" field={parsed.autorretenedor} value={editedFields.autorretenedor as boolean} onChange={v => setField('autorretenedor', v)} />
            <BoolFieldRow label="Responsable IVA" field={parsed.responsable_iva} value={editedFields.responsable_iva as boolean} onChange={v => setField('responsable_iva', v)} />
          </div>
        </div>

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

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => { setView('upload'); setParsed(null) }}
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

  // ── Manual edit view ────────────────────────────────────
  if (view === 'manual') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Editar datos de facturacion</h3>
          <button onClick={() => setView(isConfigured ? 'summary' : 'upload')} className="text-xs text-muted-foreground hover:underline">
            Cancelar
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">NIT / CC</label>
            <input type="text" value={nit} onChange={e => setNit(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="900.123.456-7" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Razon social</label>
            <input type="text" value={razonSocial} onChange={e => setRazonSocial(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Mi Empresa SAS" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Direccion fiscal</label>
            <input type="text" value={direccionFiscal} onChange={e => setDireccionFiscal(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Cra 7 #45-12, Oficina 301" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Email facturacion</label>
            <input type="email" value={emailFacturacion} onChange={e => setEmailFacturacion(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="contabilidad@tuempresa.co" />
          </div>
        </div>

        <button onClick={handleSaveManual} disabled={isPending}
          className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Guardar
        </button>
      </div>
    )
  }

  // ── Upload view (default) ───────────────────────────────
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Perfil fiscal</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Sube tu RUT y llenamos todo automaticamente con IA.
        </p>
      </div>

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
        className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/20 py-6 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
      >
        <Upload className="h-8 w-8" />
        <span className="text-sm font-medium">Subir RUT</span>
        <span className="text-[10px]">PDF, JPG, PNG o WebP · Max 10MB</span>
      </button>

      <button
        onClick={() => setView('manual')}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-2.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
      >
        <Pencil className="h-3 w-3" />
        Llenar manualmente
      </button>
    </div>
  )
}

// ── Helper components ────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium">{value}</span>
    </div>
  )
}

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
