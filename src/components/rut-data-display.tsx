'use client'

import { ShieldCheck } from 'lucide-react'

interface Props {
  nit?: string | null
  tipo_documento?: string | null
  tipo_persona?: string | null
  razon_social?: string | null
  regimen_tributario?: string | null
  gran_contribuyente?: boolean | null
  agente_retenedor?: boolean | null
  autorretenedor?: boolean | null
  responsable_iva?: boolean | null
  direccion_fiscal?: string | null
  municipio?: string | null
  departamento?: string | null
  telefono?: string | null
  email_fiscal?: string | null
  actividad_ciiu?: string | null
  actividad_secundaria?: string | null
  fecha_inicio_actividades?: string | null
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right text-sm">{value}</span>
    </div>
  )
}

function BoolRow({ label, value }: { label: string; value: boolean | null | undefined }) {
  if (value === null || value === undefined) return null
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${value ? 'text-green-600' : 'text-muted-foreground'}`}>
        {value ? 'Si' : 'No'}
      </span>
    </div>
  )
}

export default function RutDataDisplay(props: Props) {
  const hasAnyData = props.nit || props.razon_social || props.tipo_persona

  if (!hasAnyData) return null

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-green-600" />
        <h3 className="text-sm font-semibold">Datos fiscales (RUT)</h3>
      </div>

      <div className="divide-y">
        <Row label="NIT" value={props.nit} />
        <Row label="Tipo documento" value={props.tipo_documento} />
        <Row label="Tipo persona" value={props.tipo_persona === 'natural' ? 'Persona Natural' : props.tipo_persona === 'juridica' ? 'Persona Juridica' : props.tipo_persona} />
        <Row label="Razon social" value={props.razon_social} />
        <Row label="Regimen" value={props.regimen_tributario} />
        <BoolRow label="Gran contribuyente" value={props.gran_contribuyente} />
        <BoolRow label="Agente retenedor" value={props.agente_retenedor} />
        <BoolRow label="Autorretenedor" value={props.autorretenedor} />
        <BoolRow label="Responsable IVA" value={props.responsable_iva} />
        <Row label="Direccion fiscal" value={props.direccion_fiscal} />
        <Row label="Municipio" value={props.municipio} />
        <Row label="Departamento" value={props.departamento} />
        <Row label="Telefono" value={props.telefono} />
        <Row label="Email fiscal" value={props.email_fiscal} />
        <Row label="Actividad CIIU" value={props.actividad_ciiu} />
        <Row label="Actividad secundaria" value={props.actividad_secundaria} />
        <Row label="Inicio actividades" value={props.fecha_inicio_actividades} />
      </div>
    </div>
  )
}
