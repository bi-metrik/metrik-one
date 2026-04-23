// Mapeo templates ↔ productos contratados.
// Determina que subset de los 25 templates se genera segun la seleccion.

export interface ProductosContratados {
  sarlaft_simplificado?: boolean
  sarlaft_ampliado?: boolean
  ptee?: boolean
}

const SARLAFT_RMS_CODES = [
  'MA-SAR-RMS-001', 'FO-SAR-RMS-002', 'PR-SAR-RMS-003', 'PR-SAR-RMS-004',
  'PR-SAR-RMS-005', 'PR-SAR-RMS-006', 'FO-SAR-RMS-007',
]
const SARLAFT_AMP_CODES = [
  'MA-SAR-AMP-001', 'PR-SAR-AMP-002', 'FO-SAR-AMP-003', 'CL-SAR-AMP-004',
  'PR-SAR-AMP-005', 'PR-SAR-AMP-006', 'PR-SAR-AMP-007', 'AC-SAR-AMP-008',
  'FO-SAR-AMP-009', 'AN-SAR-AMP-010', 'CO-SAR-AMP-011',
]
const PTEE_CODES = ['MA-PTE-001', 'GU-PTE-002', 'DC-PTE-003', 'DC-PTE-004']

export function templatesAGenerar(productos: ProductosContratados): string[] {
  const codes: string[] = []
  if (productos.sarlaft_simplificado) codes.push(...SARLAFT_RMS_CODES)
  if (productos.sarlaft_ampliado) codes.push(...SARLAFT_AMP_CODES)
  if (productos.ptee) codes.push(...PTEE_CODES)
  return Array.from(new Set(codes))
}

export interface RutExtraction {
  nit?: string
  dv?: string
  razon_social?: string
  direccion?: string
  ciudad?: string
  telefono?: string
  email?: string
  actividad_ciiu?: string
  representante_legal?: string
  representante_legal_cc?: string
}

export interface OficialData {
  oficial_nombre?: string
  oficial_cc?: string
  oficial_cargo?: string
}

export interface TemplateContext {
  EMPRESA_NOMBRE: string
  EMPRESA_NOMBRE_UPPER: string
  EMPRESA_NIT: string
  REP_LEGAL_NOMBRE: string
  OFICIAL_NOMBRE: string
  FECHA_EMISION: string
  VERSION_DOC: string
  NORMA_REF: string
  CODIGO_DOC: string
}

function formatNit(nit?: string, dv?: string): string {
  if (!nit) return '{{EMPRESA_NIT}}'
  const clean = nit.replace(/\D/g, '')
  if (!clean) return '{{EMPRESA_NIT}}'
  const formatted = clean.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return dv ? `${formatted}-${dv}` : formatted
}

function formatDateEs(): string {
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const d = new Date()
  return `${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`
}

export function buildContext(params: {
  rut: RutExtraction
  oficial?: OficialData
  codigo_doc: string
}): TemplateContext {
  const { rut, oficial, codigo_doc } = params
  const nombre = rut.razon_social || '{{EMPRESA_NOMBRE}}'
  return {
    EMPRESA_NOMBRE: nombre,
    EMPRESA_NOMBRE_UPPER: nombre.toUpperCase(),
    EMPRESA_NIT: formatNit(rut.nit, rut.dv),
    REP_LEGAL_NOMBRE: rut.representante_legal || '{{REP_LEGAL_NOMBRE}}',
    OFICIAL_NOMBRE: oficial?.oficial_nombre || '{{OFICIAL_NOMBRE}}',
    FECHA_EMISION: formatDateEs(),
    VERSION_DOC: '1.0',
    NORMA_REF: 'Resolucion 2328 de 2025 SPT',
    CODIGO_DOC: codigo_doc,
  }
}
