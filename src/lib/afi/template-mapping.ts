// Mapeo templates ↔ productos contratados.
// Determina que subset de los 25 templates se genera segun la seleccion.

export type SarlaftRegimen = 'ampliado' | 'simplificado' | 'ninguno'

export interface ProductosContratados {
  sarlaft_regimen?: SarlaftRegimen
  ptee?: boolean
  oficial?: boolean
  seguimiento?: boolean
  // Compat hacia atras: schema previo con flags individuales
  sarlaft_simplificado?: boolean
  sarlaft_ampliado?: boolean
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
const OFICIAL_CODES = ['AC-SAR-AMP-008']  // Acta designacion oficial — solo cuando contrata Oficial
const CONTRATO_CODE = ['CT-SAR-CLIENTE']  // El contrato armado modular vivira con este codigo

export function templatesAGenerar(productos: ProductosContratados): string[] {
  const codes: string[] = []

  // Resolver regimen — soporta schema nuevo y legacy
  const regimen = productos.sarlaft_regimen
    ?? (productos.sarlaft_ampliado ? 'ampliado' : productos.sarlaft_simplificado ? 'simplificado' : 'ninguno')

  if (regimen === 'simplificado') codes.push(...SARLAFT_RMS_CODES)
  if (regimen === 'ampliado') codes.push(...SARLAFT_AMP_CODES)
  if (productos.ptee) codes.push(...PTEE_CODES)
  if (productos.oficial) codes.push(...OFICIAL_CODES)
  // Seguimiento por si solo no agrega documentos nuevos — el seguimiento es servicio recurrente.
  // El contrato armado se manejara en una fase posterior.

  return Array.from(new Set(codes))
}

// Conteo y catalogo legible de documentos a generar — para preview en UI
export const TEMPLATE_NAMES: Record<string, string> = {
  'MA-SAR-RMS-001': 'Manual SARLAFT — Régimen Simplificado',
  'FO-SAR-RMS-002': 'Anexo 2 — Formato Conocimiento Contraparte (RMS)',
  'PR-SAR-RMS-003': 'Anexo 3 — Metodología Segmentación (RMS)',
  'PR-SAR-RMS-004': 'Anexo 4 — Procedimiento Debida Diligencia (RMS)',
  'PR-SAR-RMS-005': 'Anexo 5 — Procedimiento Conocimiento Contrapartes (RMS)',
  'PR-SAR-RMS-006': 'Anexo 6 — Procedimiento Reporte ROS (RMS)',
  'FO-SAR-RMS-007': 'Anexo 7 — Formato Reporte Operación Sospechosa (RMS)',
  'MA-SAR-AMP-001': 'Manual SARLAFT — Régimen Ampliado',
  'PR-SAR-AMP-002': 'Anexo 2 — Procedimiento Reporte ROS (AMP)',
  'FO-SAR-AMP-003': 'Anexo 3 — Formato Conocimiento Contraparte (AMP)',
  'CL-SAR-AMP-004': 'Anexo 4 — Cláusulas SARLAFT (AMP)',
  'PR-SAR-AMP-005': 'Anexo 5 — Procedimiento Conocimiento Contrapartes (AMP)',
  'PR-SAR-AMP-006': 'Anexo 6 — Procedimiento Debida Diligencia (AMP)',
  'PR-SAR-AMP-007': 'Anexo 7 — Metodología Segmentación (AMP)',
  'AC-SAR-AMP-008': 'Anexo 8 — Acta Designación Oficial de Cumplimiento',
  'FO-SAR-AMP-009': 'Anexo 9 — Formato Reporte Operación Sospechosa (AMP)',
  'AN-SAR-AMP-010': 'Anexo 10 — Orden de Trabajo RTM',
  'CO-SAR-AMP-011': 'Anexo 11 — Código de Conducta',
  'MA-PTE-001': 'Manual PTEE',
  'GU-PTE-002': 'Anexo 2 — Guía Conflictos de Interés (PTEE)',
  'DC-PTE-003': 'Anexo 3 — Declaración Intereses Privados (PTEE)',
  'DC-PTE-004': 'Anexo 4 — Declaración Conflicto de Interés (PTEE)',
  'CT-SAR-CLIENTE': 'Contrato AFI ↔ Cliente',
  'CT-SAR-RMS-PTE': 'Contrato Implementación SARLAFT Simplificado + PTEE',
  'CT-SAR-AMP-PTE': 'Contrato Implementación SARLAFT Ampliado + PTEE + Oficial',
  'PP-SGN-001': 'Propuesta de Servicios de Cumplimiento Normativo',
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
