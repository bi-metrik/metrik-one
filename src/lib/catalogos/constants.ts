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
  lead_nuevo:       { label: 'Por contactar',       probabilidad: 10,  chipClass: 'bg-gray-100 text-gray-600',    dotClass: 'bg-gray-400',   order: 0 },
  contacto_inicial: { label: 'Primer contacto', probabilidad: 20,  chipClass: 'bg-blue-100 text-blue-700',    dotClass: 'bg-blue-500',   order: 1 },
  discovery_hecha:  { label: 'Necesidad clara',  probabilidad: 40,  chipClass: 'bg-blue-200 text-blue-800',    dotClass: 'bg-blue-600',   order: 2 },
  propuesta_enviada:{ label: 'Propuesta presentada', probabilidad: 60,  chipClass: 'bg-yellow-100 text-yellow-700',dotClass: 'bg-yellow-500', order: 3 },
  negociacion:      { label: 'Negociación',       probabilidad: 80,  chipClass: 'bg-orange-100 text-orange-700',dotClass: 'bg-orange-500', order: 4 },
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
  { value: 'red_social_organico', label: 'Red social (orgánico)' },
  { value: 'pauta_digital', label: 'Pauta digital (pagado)' },
  { value: 'contacto_directo', label: 'Contacto directo' },
  { value: 'evento', label: 'Evento / Networking' },
  { value: 'web_organico', label: 'Web / Orgánico' },
] as const

export type FuenteAdquisicion = typeof FUENTES_ADQUISICION[number]['value']

// ── Origen del negocio ───────────────────────────────────────
//
// FUENTE ÚNICA del catálogo de `negocios.origen`. Si hay que agregar, quitar o
// renombrar un origen, se hace AQUÍ y en ningún otro sitio: no hay CHECK en la
// base de datos ni copia en la UI (el formulario, el badge de la tarjeta y el
// filtro del listado leen esta lista).
//
// NO es lo mismo que FUENTES_ADQUISICION (arriba), que describe cómo se
// consiguió un CONTACTO. El origen responde de dónde vino el NEGOCIO y es la
// base del cálculo de comisiones, por eso vive en columna propia y se captura
// obligatoriamente al crearlo. Un negocio tiene un solo origen.
//
// `alianza` es el único que exige contraparte concreta: el formulario pide
// además el aliado (negocios.aliado_id) y solo se ofrece en workspaces con el
// módulo `aliados` activo.
//
// `chipClass` es el token del badge en la tarjeta del listado (paleta MeTRIK,
// no Tailwind genérico). El azul de `meta` es el de la marca Facebook, que ya
// se usaba en el marcador de leads de Meta.
export const ORIGENES_NEGOCIO = [
  { value: 'meta', label: 'Meta (Facebook / Instagram)', chipClass: 'bg-[#1877F2]/10 text-[#1877F2]' },
  { value: 'alianza', label: 'Alianza', chipClass: 'bg-[#8B5CF6]/10 text-[#7C3AED]' },
  { value: 'referido', label: 'Referido', chipClass: 'bg-[#10B981]/10 text-[#059669]' },
  { value: 'promotor', label: 'Promotor', chipClass: 'bg-[#F59E0B]/10 text-[#B45309]' },
  { value: 'contacto_directo', label: 'Contacto directo', chipClass: 'bg-[#F5F4F2] text-[#6B7280]' },
  { value: 'evento', label: 'Evento / Networking', chipClass: 'bg-[#0EA5E9]/10 text-[#0284C7]' },
  { value: 'web_organico', label: 'Web / Orgánico', chipClass: 'bg-[#14B8A6]/10 text-[#0F766E]' },
  { value: 'otro', label: 'Otro', chipClass: 'bg-[#F5F4F2] text-[#6B7280]' },
] as const

export type OrigenNegocio = typeof ORIGENES_NEGOCIO[number]['value']

/** Origen que exige elegir un aliado concreto (negocios.aliado_id). */
export const ORIGEN_ALIANZA: OrigenNegocio = 'alianza'

/** ¿El valor pertenece al catálogo? Usado por la validación server-side. */
export function esOrigenNegocioValido(value: unknown): value is OrigenNegocio {
  return ORIGENES_NEGOCIO.some((o) => o.value === value)
}

export function origenNegocioConfig(value: string | null | undefined) {
  if (!value) return null
  return ORIGENES_NEGOCIO.find((o) => o.value === value) ?? null
}

/** Etiqueta legible; si el valor no está en el catálogo, se muestra tal cual. */
export function origenNegocioLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return origenNegocioConfig(value)?.label ?? value
}

// ── Roles de contacto (D2) ───────────────────────────────────

export const ROLES_CONTACTO = [
  { value: 'promotor', label: 'Promotor' },
  { value: 'decisor', label: 'Decisor' },
  { value: 'influenciador', label: 'Influenciador' },
  { value: 'operativo', label: 'Operativo' },
] as const

export type RolContacto = typeof ROLES_CONTACTO[number]['value']

// ── Status del contacto ───────────────────────────────────
//
// Estado de GESTIÓN comercial del contacto: lo marca la persona que lo trabaja,
// NO el sistema. Antes este campo se llamaba "segmento" y lo escribía solo el
// motor, derivándolo del ciclo de vida del negocio; esa sincronización se retiró
// (ver `sincronizarSegmentoContacto`, eliminada) porque un contador de intentos
// de contacto no se puede deducir del avance de un negocio.
//
// ⚠️ La COLUMNA de base de datos sigue llamándose `contactos.segmento`. Solo
// cambió el nombre visible y el juego de valores. No renombrar la columna sin
// tocar también el webhook de Meta (`config_extra.meta_leads.contacto.segmento_inicial`).
//
// Los tres primeros son una progresión de intentos: el color sube de intensidad
// con cada intento fallido de conectar.
export const STATUS_CONTACTO = [
  { value: 'primer_contacto', label: 'Primer contacto', chipClass: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  { value: 'segundo_contacto', label: 'Segundo contacto', chipClass: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  { value: 'tercer_contacto', label: 'Tercer contacto', chipClass: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  { value: 'conectado', label: 'Conectado', chipClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { value: 'no_contesto', label: 'No contestó', chipClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  { value: 'standby', label: 'Standby', chipClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'descartado', label: 'Descartado', chipClass: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300' },
] as const

export type StatusContacto = typeof STATUS_CONTACTO[number]['value']

const CHIP_STATUS_DESCONOCIDO = 'bg-[#F5F4F2] text-[#6B7280]'

/**
 * Resuelve label + chip de un status. Tolera valores que no están en la lista
 * (los cuatro legacy: sin_contactar/contactado/convertido/inactivo) para que
 * durante la ventana entre el despliegue del código y el backfill de datos la
 * pantalla muestre el valor crudo en gris en vez de una celda vacía.
 */
export function resolverStatusContacto(value: string | null | undefined): {
  label: string
  chipClass: string
} {
  if (!value) return { label: 'Sin definir', chipClass: CHIP_STATUS_DESCONOCIDO }
  const known = STATUS_CONTACTO.find(s => s.value === value)
  return known
    ? { label: known.label, chipClass: known.chipClass }
    : { label: value.replace(/_/g, ' '), chipClass: CHIP_STATUS_DESCONOCIDO }
}

// ── Tipos de rubro (6 tipos, §4.6) ──────────────────────────

export const TIPOS_RUBRO = [
  { value: 'mo_propia', label: 'Mano de obra propia', unidadDefault: 'horas' },
  { value: 'mo_terceros', label: 'Mano de obra terceros', unidadDefault: 'horas' },
  { value: 'materiales', label: 'Materiales', unidadDefault: 'unidades' },
  { value: 'viaticos', label: 'Viáticos', unidadDefault: 'dias' },
  { value: 'software', label: 'Software y tecnología', unidadDefault: 'licencias' },
  { value: 'servicios_prof', label: 'Servicios profesionales', unidadDefault: 'horas' },
] as const

export type TipoRubro = typeof TIPOS_RUBRO[number]['value']

// ── Categorias de gasto (9, spec §4.10) ─────────────────────

export const CATEGORIAS_GASTO = [
  { value: 'materiales', label: 'Materiales' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'alimentacion', label: 'Alimentación' },
  { value: 'servicios_profesionales', label: 'Servicios profesionales' },
  { value: 'software', label: 'Software' },
  { value: 'arriendo', label: 'Arriendo' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'capacitacion', label: 'Capacitación' },
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
  'Tecnología',
  'Consultoría',
  'Ingeniería',
  'Arquitectura',
  'Diseño',
  'Construcción',
  'Educación',
  'Salud',
  'Legal',
  'Contabilidad',
  'Marketing',
  'Comunicaciones',
  'Energía',
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

export type EstadoProyecto = 'en_ejecucion' | 'pausado' | 'cerrado' | 'entregado'

export const ESTADO_PROYECTO_CONFIG: Record<EstadoProyecto, {
  label: string
  chipClass: string
}> = {
  en_ejecucion: { label: 'En curso',    chipClass: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  pausado:      { label: 'Pausado',     chipClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  entregado:    { label: 'Entregado',   chipClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  cerrado:      { label: 'Cerrado',     chipClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
}

// ── Tipo persona ────────────────────────────────────────────

export const TIPOS_PERSONA = [
  { value: 'natural', label: 'Persona Natural' },
  { value: 'juridica', label: 'Persona Jurídica' },
] as const

export const REGIMENES_TRIBUTARIOS = [
  { value: 'comun', label: 'Régimen Común' },
  { value: 'simple', label: 'Régimen Simple' },
  { value: 'no_responsable', label: 'No Responsable de IVA' },
] as const

// ── Tipos de documento de identidad ──────────────────────────

export const TIPOS_DOCUMENTO = [
  { value: 'CC', label: 'Cédula de Ciudadanía' },
  { value: 'CE', label: 'Cédula de Extranjería' },
  { value: 'NIT', label: 'NIT' },
  { value: 'pasaporte', label: 'Pasaporte' },
  { value: 'PEP', label: 'PEP' },
] as const

export type TipoDocumento = typeof TIPOS_DOCUMENTO[number]['value']
