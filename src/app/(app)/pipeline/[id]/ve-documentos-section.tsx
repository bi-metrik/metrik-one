'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import DocUploadSlot, { SlotState } from './doc-upload-slot'
import {
  getUploadUrlDocumentoVe,
  confirmarUploadDocumentoVe,
  actualizarVehiculoEnUpme,
  procesarDocumentoVe,
  actualizarCamposVehiculo,
  type DocumentoSlug,
  type VeDocumentoState,
  type CamposVehiculo,
} from '@/lib/actions/ve-documentos'
import { createClient } from '@/lib/supabase/client'

// ── Definicion de documentos ───────────────────────────────

const DOCS_SIEMPRE: { slug: DocumentoSlug; label: string }[] = [
  { slug: 'cedula', label: 'Cedula' },
  { slug: 'factura', label: 'Factura' },
  { slug: 'rut', label: 'RUT' },
  { slug: 'soporte_upme', label: 'Soporte pago UPME' },
]

const DOCS_CONDICIONALES: { slug: DocumentoSlug; label: string }[] = [
  { slug: 'ficha_tecnica', label: 'Ficha Tecnica' },
  { slug: 'cert_emisiones', label: 'Cert. de Emisiones' },
]

// ── Props ──────────────────────────────────────────────────

interface Props {
  oportunidadId: string
  vehiculoEnUpme: boolean | null
  documentosActuales: VeDocumentoState[]
  camposVehiculo: CamposVehiculo | null
}

// ── Dot indicator ──────────────────────────────────────────

function Dot({ state }: { state: 'uploaded' | 'pending' | 'error' }) {
  if (state === 'uploaded') return <span className="text-green-500 text-xs">●</span>
  if (state === 'error') return <span className="text-red-500 text-xs">!</span>
  return <span className="text-muted-foreground/40 text-xs">○</span>
}

// ── Campos del vehiculo ────────────────────────────────────

interface CamposVehiculoFormProps {
  oportunidadId: string
  campos: CamposVehiculo
  onChange: (updated: CamposVehiculo) => void
  highlighted: boolean
}

function CamposVehiculoForm({ oportunidadId, campos, onChange, highlighted }: CamposVehiculoFormProps) {
  const [isPending, startTransition] = useTransition()

  const handleBlur = (key: keyof CamposVehiculo, value: string) => {
    const updated = { ...campos, [key]: value || undefined }
    onChange(updated)
    startTransition(async () => {
      await actualizarCamposVehiculo(oportunidadId, { [key]: value || undefined })
    })
  }

  const fieldClass = `w-full rounded-md border bg-background px-2.5 py-1.5 text-sm transition-all ${
    highlighted ? 'border-green-400 bg-green-50/30' : ''
  } ${isPending ? 'opacity-60' : ''}`

  const vehiculoFields = [
    { key: 'marca' as const, label: 'Marca' },
    { key: 'linea' as const, label: 'Linea' },
    { key: 'modelo' as const, label: 'Modelo' },
    { key: 'tecnologia' as const, label: 'Tecnologia' },
    { key: 'tipo' as const, label: 'Tipo vehiculo' },
  ] as const

  const propietarioFields = [
    { key: 'nombre_propietario' as const, label: 'Nombre propietario' },
    { key: 'numero_identificacion' as const, label: 'N° identificacion' },
    { key: 'telefono_propietario' as const, label: 'Telefono' },
    { key: 'municipio_propietario' as const, label: 'Municipio' },
    { key: 'correo_propietario' as const, label: 'Correo' },
    { key: 'direccion_propietario' as const, label: 'Direccion' },
  ] as const

  const fiscalFields = [
    { key: 'tipo_persona_cliente' as const, label: 'Tipo persona' },
    { key: 'regimen_tributario_cliente' as const, label: 'Regimen tributario' },
  ] as const

  const hasFiscalData = campos.tipo_persona_cliente || campos.regimen_tributario_cliente
  const hasCusData = !!campos.numero_cus

  return (
    <div className="mt-3 space-y-3">
      {/* Datos del vehiculo */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {vehiculoFields.map(({ key, label }) => (
          <div key={key}>
            <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">{label}</label>
            <input
              type="text"
              defaultValue={campos[key] ?? ''}
              onBlur={e => handleBlur(key, e.target.value)}
              placeholder="—"
              className={fieldClass}
            />
          </div>
        ))}
      </div>
      {/* Datos del propietario */}
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Propietario</p>
        <div className="grid grid-cols-2 gap-2">
          {propietarioFields.map(({ key, label }) => (
            <div key={key}>
              <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">{label}</label>
              <input
                type="text"
                defaultValue={campos[key] ?? ''}
                onBlur={e => handleBlur(key, e.target.value)}
                placeholder="—"
                className={fieldClass}
              />
            </div>
          ))}
        </div>
      </div>
      {/* Numero CUS del soporte UPME */}
      {hasCusData && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">UPME</p>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Numero CUS</label>
            <input
              type="text"
              defaultValue={campos.numero_cus ?? ''}
              onBlur={e => handleBlur('numero_cus', e.target.value)}
              placeholder="—"
              className={fieldClass}
            />
          </div>
        </div>
      )}
      {/* Datos fiscales del cliente (del RUT) */}
      {hasFiscalData && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fiscal (RUT)</p>
          <div className="grid grid-cols-2 gap-2">
            {fiscalFields.map(({ key, label }) => (
              <div key={key}>
                <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">{label}</label>
                <input
                  type="text"
                  defaultValue={campos[key] ?? ''}
                  onBlur={e => handleBlur(key, e.target.value)}
                  placeholder="—"
                  className={fieldClass}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ───────────────────────────────────

export default function VeDocumentosSection({
  oportunidadId,
  vehiculoEnUpme: initialVehiculoEnUpme,
  documentosActuales,
  camposVehiculo: initialCamposVehiculo,
}: Props) {
  const router = useRouter()

  // Estado vehiculo_en_upme
  const [vehiculoEnUpme, setVehiculoEnUpme] = useState<boolean | null>(initialVehiculoEnUpme)
  const [upmeTransition, startUpmeTransition] = useTransition()

  // Estado de cada slot: mapa slug → estado
  const buildInitialSlotStates = (): Record<DocumentoSlug, SlotState> => {
    const m = {} as Record<DocumentoSlug, SlotState>
    const allSlugs: DocumentoSlug[] = [
      'cedula', 'factura', 'rut', 'soporte_upme', 'ficha_tecnica', 'cert_emisiones',
    ]
    for (const slug of allSlugs) {
      m[slug] = documentosActuales.find(d => d.slug === slug) ? 'uploaded' : 'empty'
    }
    return m
  }

  const buildInitialFileNames = (): Record<DocumentoSlug, string | undefined> => {
    const m = {} as Record<DocumentoSlug, string | undefined>
    for (const doc of documentosActuales) {
      // Extraer nombre del archivo de la URL
      const parts = doc.url.split('/')
      m[doc.slug] = parts[parts.length - 1]?.split('?')[0]
    }
    return m
  }

  const [slotStates, setSlotStates] = useState<Record<DocumentoSlug, SlotState>>(buildInitialSlotStates)
  const [fileNames, setFileNames] = useState<Record<DocumentoSlug, string | undefined>>(buildInitialFileNames)

  // Estado procesamiento AI por slot individual
  const [processingSlots, setProcessingSlots] = useState<Set<DocumentoSlug>>(new Set())
  const [camposVehiculo, setCamposVehiculo] = useState<CamposVehiculo | null>(initialCamposVehiculo)
  const [justProcessed, setJustProcessed] = useState(false)

  // Docs visibles
  const docsVisibles = vehiculoEnUpme === false
    ? [...DOCS_SIEMPRE, ...DOCS_CONDICIONALES]
    : DOCS_SIEMPRE

  // Conteo para el badge
  const uploadedCount = docsVisibles.filter(d => slotStates[d.slug] === 'uploaded').length
  const totalCount = docsVisibles.length

  // ── Handlers ───────────────────────────────────────────────

  const handleUpmeChange = (val: boolean) => {
    setVehiculoEnUpme(val)
    startUpmeTransition(async () => {
      const res = await actualizarVehiculoEnUpme(oportunidadId, val)
      if (!res.success) {
        toast.error(res.error ?? 'Error al guardar')
      }
    })
  }

  const resolveFileType = (f: File): string => {
    if (f.type) return f.type
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    const map: Record<string, string> = {
      pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp',
    }
    return map[ext] ?? ''
  }

  const handleFileSelected = async (slug: DocumentoSlug, file: File) => {
    const MAX_SIZE = 20 * 1024 * 1024
    const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

    if (file.size > MAX_SIZE) {
      toast.error('Archivo demasiado grande. Max 20MB')
      return
    }
    const resolvedType = resolveFileType(file)
    if (resolvedType && !ALLOWED.includes(resolvedType)) {
      toast.error('Solo PDF, JPG, PNG o WebP')
      return
    }

    setSlotStates(prev => ({ ...prev, [slug]: 'uploading' }))

    try {
      // Paso 1: Obtener URL firmada del servidor
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
      const uploadInfo = await getUploadUrlDocumentoVe(oportunidadId, slug, ext)
      if (!uploadInfo.success || !uploadInfo.path || !uploadInfo.token) {
        setSlotStates(prev => ({ ...prev, [slug]: 'error' }))
        toast.error(uploadInfo.error ?? 'Error obteniendo URL de subida')
        return
      }

      // Paso 2: Subir directamente a Supabase desde el browser
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

      // Paso 3: Confirmar y guardar URL en custom_data
      const confirmRes = await confirmarUploadDocumentoVe(oportunidadId, slug, uploadInfo.path)
      if (!confirmRes.success) {
        setSlotStates(prev => ({ ...prev, [slug]: 'error' }))
        toast.error(confirmRes.error ?? 'Error guardando documento')
        return
      }

      setSlotStates(prev => ({ ...prev, [slug]: 'uploaded' }))
      setFileNames(prev => ({ ...prev, [slug]: file.name }))
      router.refresh()

      // Auto-procesar documentos con contenido extraible por AI
      if (slug === 'factura' || slug === 'ficha_tecnica' || slug === 'cedula' || slug === 'rut' || slug === 'soporte_upme') {
        setProcessingSlots(prev => new Set([...prev, slug]))
        const procRes = await procesarDocumentoVe(oportunidadId, slug)
        setProcessingSlots(prev => { const n = new Set(prev); n.delete(slug); return n })
        if (procRes.success && procRes.data && Object.keys(procRes.data).length > 0) {
          setCamposVehiculo(prev => ({ ...(prev ?? {}), ...(procRes.data ?? {}) }))
          setJustProcessed(true)
          const docLabel = slug === 'factura' ? 'la factura' : slug === 'cedula' ? 'la cedula' : slug === 'rut' ? 'el RUT' : slug === 'soporte_upme' ? 'el soporte UPME' : 'la ficha tecnica'
          toast.success(`Datos extraidos de ${docLabel}`)
        } else if (!procRes.success) {
          toast.error(`No se pudo procesar ${slug}: ${procRes.error ?? 'error desconocido'}`)
        }
      }
    } catch (err) {
      setSlotStates(prev => ({ ...prev, [slug]: 'error' }))
      toast.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      console.error('[VeDocumentosSection] upload error:', err)
    }
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="rounded-lg border p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Documentos VE</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums">
            {uploadedCount}/{totalCount}
          </span>
        </div>
        {/* Progress dots */}
        <div className="flex items-center gap-1">
          {docsVisibles.map(doc => (
            <Dot
              key={doc.slug}
              state={
                slotStates[doc.slug] === 'uploaded'
                  ? 'uploaded'
                  : slotStates[doc.slug] === 'error'
                  ? 'error'
                  : 'pending'
              }
            />
          ))}
        </div>
      </div>

      {/* Toggle vehiculo_en_upme */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">
          Vehiculo en UPME?
        </p>
        <div className="inline-flex rounded-lg border overflow-hidden">
          <button
            type="button"
            onClick={() => handleUpmeChange(true)}
            disabled={upmeTransition}
            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
              vehiculoEnUpme === true
                ? 'bg-primary text-primary-foreground'
                : 'border-r hover:bg-accent'
            }`}
          >
            Si
          </button>
          <button
            type="button"
            onClick={() => handleUpmeChange(false)}
            disabled={upmeTransition}
            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
              vehiculoEnUpme === false
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-accent'
            }`}
          >
            No
          </button>
        </div>
      </div>

      {/* Slots siempre visibles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DOCS_SIEMPRE.map(doc => (
          <DocUploadSlot
            key={doc.slug}
            label={doc.label}
            state={slotStates[doc.slug]}
            fileName={fileNames[doc.slug]}
            isProcessingAi={processingSlots.has(doc.slug)}
            onFileSelected={file => handleFileSelected(doc.slug, file)}
          />
        ))}
      </div>

      {/* Slots condicionales — solo si vehiculo_en_upme === false */}
      <div
        className={`grid grid-cols-2 gap-2 overflow-hidden transition-all duration-300 ${
          vehiculoEnUpme === false
            ? 'max-h-40 opacity-100'
            : 'max-h-0 opacity-0 pointer-events-none'
        }`}
      >
        {DOCS_CONDICIONALES.map(doc => (
          <DocUploadSlot
            key={doc.slug}
            label={doc.label}
            state={slotStates[doc.slug]}
            fileName={fileNames[doc.slug]}
            isProcessingAi={processingSlots.has(doc.slug)}
            onFileSelected={file => handleFileSelected(doc.slug, file)}
          />
        ))}
      </div>

      {/* Campos del vehiculo */}
      {camposVehiculo && (
        <>
          <div className="border-t pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Datos del vehiculo
            </p>
          </div>
          <CamposVehiculoForm
            oportunidadId={oportunidadId}
            campos={camposVehiculo}
            onChange={setCamposVehiculo}
            highlighted={justProcessed}
          />
        </>
      )}
    </div>
  )
}
