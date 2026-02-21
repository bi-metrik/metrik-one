// ── Contact & Company constants (replicated from v2) ──

export const CONTACT_TYPES = ['Cliente', 'Proveedor', 'Promotor'] as const
export type ContactType = typeof CONTACT_TYPES[number]

export const CONTACT_SOURCES = [
  'Red Personal',
  'LinkedIn',
  'Referido',
  'Promotor',
  'Inbound/Web',
  'Redes Sociales',
  'Email',
  'Evento',
  'Alianza',
  'Otro',
] as const
export type ContactSource = typeof CONTACT_SOURCES[number]

export const PROMOTER_STATUSES = [
  { id: 'active', label: 'Activo', color: 'bg-emerald-500' },
  { id: 'inactive', label: 'Inactivo', color: 'bg-muted-foreground' },
  { id: 'suspended', label: 'Suspendido', color: 'bg-red-500' },
] as const

export const SECTORES_EMPRESA = [
  'Tecnología',
  'Consultoría',
  'Arquitectura',
  'Ingeniería',
  'Diseño',
  'Publicidad y Marketing',
  'Legal',
  'Contabilidad y Finanzas',
  'Salud',
  'Educación',
  'Construcción',
  'Comercio',
  'Manufactura',
  'Energía',
  'Transporte y Logística',
  'Telecomunicaciones',
  'Agroindustria',
  'Turismo y Hotelería',
  'Inmobiliario',
  'Entretenimiento',
  'ONG / Fundación',
  'Gobierno / Sector Público',
  'Otro',
] as const

// ── NIT formatting ──

/** Format Colombian NIT: 900123456 → 900.123.456-7 */
export function formatNit(nit: string, dv?: string | null): string {
  if (!nit) return ''
  const cleaned = nit.replace(/\D/g, '')
  const formatted = cleaned.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return dv ? `${formatted}-${dv}` : formatted
}

/** Format document number (alias for formatNit) */
export const formatDocumento = formatNit

/** Clean NIT to digits only */
export function cleanNit(nit: string): string {
  return nit.replace(/\D/g, '')
}

/** Auto-detect person type from company name */
export function detectarTipoCliente(nombre: string): 'juridica' | 'natural' | null {
  const upper = nombre.toUpperCase()
  const patronesPJ = [
    'S.A.S', 'SAS', 'S.A.', 'LTDA', 'E.U.', 'S.C.A', 'S.C.S',
    'S. EN C.', 'FUNDACIÓN', 'COOPERATIVA', 'CORPORACIÓN', 'E.S.P',
    'INC', 'LLC', 'CORP',
  ]
  if (patronesPJ.some(p => upper.includes(p))) return 'juridica'
  return null
}

/** Format COP currency */
export function formatCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}
