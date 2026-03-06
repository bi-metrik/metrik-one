// ── RUT Data Display — Read-only grid of all RUT-extracted fields ──
// Used by empresa-360 and mi-negocio to show fiscal/identity data

import { Pencil } from 'lucide-react'

interface Props {
  // Core fiscal
  nit?: string | null
  tipo_documento?: string | null
  tipo_persona?: string | null
  razon_social?: string | null
  regimen_tributario?: string | null

  // Boolean flags
  gran_contribuyente?: boolean | null
  agente_retenedor?: boolean | null
  autorretenedor?: boolean | null
  responsable_iva?: boolean | null

  // Identity
  direccion_fiscal?: string | null
  municipio?: string | null
  departamento?: string | null
  telefono?: string | null
  email_fiscal?: string | null

  // Activity
  actividad_ciiu?: string | null
  actividad_secundaria?: string | null
  fecha_inicio_actividades?: string | null

  // Behavior
  onEdit?: () => void
}

const TIPO_DOC_LABELS: Record<string, string> = {
  CC: 'Cedula de Ciudadania',
  CE: 'Cedula de Extranjeria',
  NIT: 'NIT',
  pasaporte: 'Pasaporte',
  PEP: 'PEP',
}

const TIPO_PERSONA_LABELS: Record<string, string> = {
  natural: 'Persona Natural',
  juridica: 'Persona Juridica',
}

const REGIMEN_LABELS: Record<string, string> = {
  comun: 'Regimen Comun',
  responsable: 'Responsable de IVA',
  no_responsable: 'No Responsable de IVA',
  simple: 'Regimen Simple (SIMPLE)',
  ordinario: 'Regimen Ordinario',
}

function boolLabel(v: boolean | null | undefined): string {
  if (v === true) return 'Si'
  if (v === false) return 'No'
  return '---'
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium ${!value || value === '---' ? 'text-muted-foreground/50' : ''}`}>
        {value || '---'}
      </span>
    </div>
  )
}

export default function RutDataDisplay(props: Props) {
  const {
    nit, tipo_documento, tipo_persona, razon_social, regimen_tributario,
    gran_contribuyente, agente_retenedor, autorretenedor, responsable_iva,
    direccion_fiscal, municipio, departamento, telefono, email_fiscal,
    actividad_ciiu, actividad_secundaria, fecha_inicio_actividades,
    onEdit,
  } = props

  const hasAnyData = !!(nit || tipo_documento || tipo_persona || razon_social || regimen_tributario ||
    gran_contribuyente !== null && gran_contribuyente !== undefined ||
    agente_retenedor !== null && agente_retenedor !== undefined)

  if (!hasAnyData) return null

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Datos extraidos del RUT
        </p>
        {onEdit && (
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
          >
            <Pencil className="h-3 w-3" />
            Editar manualmente
          </button>
        )}
      </div>

      {/* Datos fiscales */}
      <div className="rounded-lg border p-3 space-y-0.5">
        <p className="text-[10px] font-medium text-muted-foreground mb-1">Datos fiscales</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <Row label="NIT" value={nit} />
          <Row label="Tipo documento" value={tipo_documento ? (TIPO_DOC_LABELS[tipo_documento] || tipo_documento) : null} />
          <Row label="Tipo persona" value={tipo_persona ? (TIPO_PERSONA_LABELS[tipo_persona] || tipo_persona) : null} />
          <Row label="Regimen tributario" value={regimen_tributario ? (REGIMEN_LABELS[regimen_tributario] || regimen_tributario) : null} />
          <Row label="Gran contribuyente" value={boolLabel(gran_contribuyente)} />
          <Row label="Agente retenedor" value={boolLabel(agente_retenedor)} />
          <Row label="Autorretenedor" value={boolLabel(autorretenedor)} />
          <Row label="Responsable IVA" value={boolLabel(responsable_iva)} />
        </div>
      </div>

      {/* Datos de identidad */}
      <div className="rounded-lg border p-3 space-y-0.5">
        <p className="text-[10px] font-medium text-muted-foreground mb-1">Datos de identidad</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <Row label="Razon social" value={razon_social} />
          <Row label="Actividad CIIU" value={actividad_ciiu} />
          <Row label="Direccion fiscal" value={direccion_fiscal} />
          <Row label="Actividad secundaria" value={actividad_secundaria} />
          <Row label="Municipio" value={municipio} />
          <Row label="Departamento" value={departamento} />
          <Row label="Telefono" value={telefono} />
          <Row label="Email fiscal" value={email_fiscal} />
          <Row label="Fecha inicio actividades" value={fecha_inicio_actividades} />
        </div>
      </div>
    </div>
  )
}
