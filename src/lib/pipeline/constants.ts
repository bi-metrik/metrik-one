// Pipeline constants — aligned with METRIK_ONE_Spec_UI_CRM_Completa.md

// ── Etapas del pipeline (7 etapas, D33) ──────────────────────

export type EtapaPipeline =
  | 'lead_nuevo'
  | 'contacto_inicial'
  | 'discovery_hecha'
  | 'propuesta_enviada'
  | 'negociacion'
  | 'ganada'
  | 'perdida'

export const ETAPA_CONFIG: Record<EtapaPipeline, {
  label: string
  probabilidad: number
  chipClass: string
  dotClass: string
  order: number
}> = {
  lead_nuevo:       { label: 'Lead nuevo',       probabilidad: 10,  chipClass: 'bg-gray-100 text-gray-600',    dotClass: 'bg-gray-400',   order: 0 },
  contacto_inicial: { label: 'Contacto inicial', probabilidad: 20,  chipClass: 'bg-blue-100 text-blue-700',    dotClass: 'bg-blue-500',   order: 1 },
  discovery_hecha:  { label: 'Discovery hecha',  probabilidad: 40,  chipClass: 'bg-blue-200 text-blue-800',    dotClass: 'bg-blue-600',   order: 2 },
  propuesta_enviada:{ label: 'Propuesta enviada', probabilidad: 60,  chipClass: 'bg-yellow-100 text-yellow-700',dotClass: 'bg-yellow-500', order: 3 },
  negociacion:      { label: 'Negociacion',       probabilidad: 80,  chipClass: 'bg-orange-100 text-orange-700',dotClass: 'bg-orange-500', order: 4 },
  ganada:           { label: 'Ganada',            probabilidad: 100, chipClass: 'bg-green-100 text-green-700',  dotClass: 'bg-green-500',  order: 5 },
  perdida:          { label: 'Perdida',           probabilidad: 0,   chipClass: 'bg-red-100 text-red-700',      dotClass: 'bg-red-500',    order: 6 },
}

export const ETAPAS_ACTIVAS: EtapaPipeline[] = [
  'lead_nuevo', 'contacto_inicial', 'discovery_hecha', 'propuesta_enviada', 'negociacion'
]
export const ETAPAS_TERMINALES: EtapaPipeline[] = ['ganada', 'perdida']
export const TODAS_ETAPAS: EtapaPipeline[] = [...ETAPAS_ACTIVAS, ...ETAPAS_TERMINALES]

// ── Fuentes de adquisicion (D20, 8 opciones) ─────────────────

export const FUENTES_ADQUISICION = [
  { value: 'promotor', label: 'Promotor' },
  { value: 'referido', label: 'Referido' },
  { value: 'alianza', label: 'Alianza / Partner' },
  { value: 'red_social_organico', label: 'Red social (organico)' },
  { value: 'pauta_digital', label: 'Pauta digital (pagado)' },
  { value: 'contacto_directo', label: 'Contacto directo' },
  { value: 'evento', label: 'Evento / Networking' },
  { value: 'web_organico', label: 'Web / Organico' },
] as const

export type FuenteAdquisicion = typeof FUENTES_ADQUISICION[number]['value']

// ── Roles de contacto (D2) ───────────────────────────────────

export const ROLES_CONTACTO = [
  { value: 'promotor', label: 'Promotor' },
  { value: 'decisor', label: 'Decisor' },
  { value: 'influenciador', label: 'Influenciador' },
  { value: 'operativo', label: 'Operativo' },
] as const

export type RolContacto = typeof ROLES_CONTACTO[number]['value']

// ── Tipos de rubro (6 tipos, §4.6) ──────────────────────────

export const TIPOS_RUBRO = [
  { value: 'mo_propia', label: 'Mano de obra propia', unidadDefault: 'horas' },
  { value: 'mo_terceros', label: 'Mano de obra terceros', unidadDefault: 'horas' },
  { value: 'materiales', label: 'Materiales', unidadDefault: 'unidades' },
  { value: 'viaticos', label: 'Viaticos', unidadDefault: 'dias' },
  { value: 'software', label: 'Software y tecnologia', unidadDefault: 'licencias' },
  { value: 'servicios_prof', label: 'Servicios profesionales', unidadDefault: 'horas' },
] as const

export type TipoRubro = typeof TIPOS_RUBRO[number]['value']

// ── Categorias de gasto (9, spec §4.10) ─────────────────────

export const CATEGORIAS_GASTO = [
  { value: 'materiales', label: 'Materiales' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'alimentacion', label: 'Alimentacion' },
  { value: 'servicios_profesionales', label: 'Servicios profesionales' },
  { value: 'software', label: 'Software' },
  { value: 'arriendo', label: 'Arriendo' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'capacitacion', label: 'Capacitacion' },
  { value: 'otros', label: 'Otros' },
] as const

export type CategoriaGasto = typeof CATEGORIAS_GASTO[number]['value']

// ── Razones de perdida ──────────────────────────────────────

export const RAZONES_PERDIDA = [
  { value: 'precio', label: 'Precio muy alto' },
  { value: 'timing', label: 'No es el momento' },
  { value: 'competencia', label: 'Eligieron a otro' },
  { value: 'sin_presupuesto', label: 'No tienen presupuesto' },
  { value: 'ghosting', label: 'No me respondieron' },
  { value: 'no_era_para_mi', label: 'No era para mi perfil' },
] as const

// ── Sectores colombianos ────────────────────────────────────

export const SECTORES_EMPRESA = [
  'Tecnologia',
  'Consultoria',
  'Ingenieria',
  'Arquitectura',
  'Diseno',
  'Construccion',
  'Educacion',
  'Salud',
  'Legal',
  'Contabilidad',
  'Marketing',
  'Comunicaciones',
  'Energia',
  'Agroindustria',
  'Manufactura',
  'Transporte',
  'Comercio',
  'Inmobiliario',
  'Financiero',
  'Gobierno',
  'ONG / Fundaciones',
  'Entretenimiento',
  'Otro',
] as const

// ── Estados de cotizacion (D48, D49) ────────────────────────

export type EstadoCotizacion = 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'vencida'

export const ESTADO_COTIZACION_CONFIG: Record<EstadoCotizacion, {
  label: string
  chipClass: string
  immutable: boolean
}> = {
  borrador:  { label: 'Borrador',  chipClass: 'bg-gray-100 text-gray-600',    immutable: false },
  enviada:   { label: 'Enviada',   chipClass: 'bg-blue-100 text-blue-700',    immutable: true },
  aceptada:  { label: 'Aceptada',  chipClass: 'bg-green-100 text-green-700',  immutable: true },
  rechazada: { label: 'Rechazada', chipClass: 'bg-red-100 text-red-700',      immutable: true },
  vencida:   { label: 'Vencida',   chipClass: 'bg-yellow-100 text-yellow-700',immutable: true },
}

// ── Estados de proyecto ─────────────────────────────────────

export type EstadoProyecto = 'en_ejecucion' | 'pausado' | 'cerrado'

export const ESTADO_PROYECTO_CONFIG: Record<EstadoProyecto, {
  label: string
  chipClass: string
}> = {
  en_ejecucion: { label: 'En ejecucion', chipClass: 'bg-blue-100 text-blue-700' },
  pausado:      { label: 'Pausado',       chipClass: 'bg-yellow-100 text-yellow-700' },
  cerrado:      { label: 'Cerrado',       chipClass: 'bg-green-100 text-green-700' },
}

// ── Tipo persona ────────────────────────────────────────────

export const TIPOS_PERSONA = [
  { value: 'natural', label: 'Persona Natural' },
  { value: 'juridica', label: 'Persona Juridica' },
] as const

export const REGIMENES_TRIBUTARIOS = [
  { value: 'comun', label: 'Regimen Comun' },
  { value: 'simple', label: 'Regimen Simple' },
  { value: 'no_responsable', label: 'No Responsable de IVA' },
] as const
