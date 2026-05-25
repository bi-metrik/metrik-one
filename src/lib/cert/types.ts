// Tipos del modulo Certificaciones con QR.
// Nota: las tablas cert_* aun no estan en database.ts (pendiente regenerar types).
// Estos tipos son la fuente local hasta que se regenere el schema tipado.

export type CertEstado = 'borrador' | 'publicado' | 'revocado'
export type CertOpcionMaterial = 'A' | 'C' | null

export interface CertLoteRow {
  id: string
  workspace_id: string
  cert_producto_id: string | null
  negocio_id: string | null
  numero_lote: string
  sku: string
  opcion_material: CertOpcionMaterial
  material_perfil: string | null
  material_calibre: string | null
  material_norma: string | null
  orientacion_instalacion: string | null
  cumple: boolean
  ratio_critico: number | null
  ratio_descripcion: string | null
  estado: CertEstado
  certificado_por: string | null
  certificado_para: string | null
  fecha_certificacion: string | null
  vigencia_meses: number
  fecha_vencimiento: string | null
  serie_desde: number | null
  serie_hasta: number | null
  created_at: string
  updated_at: string
}

export interface CertProductoRow {
  id: string
  workspace_id: string
  sku: string
  nombre: string | null
  serie: string | null
  producto_tipo: string | null
  rango_min_mm: number | null
  rango_max_mm: number | null
  altura_mm: number | null
  norma: string
  carga_n: number | null
  carga_lb: number | null
  criterio: string | null
  factor_seguridad: number | null
}

export interface CertDocumentoRow {
  tipo: string
  nombre: string | null
  public_url: string | null
}

// Config por workspace (workspaces.config_extra.cert) — server-only.
export interface CertFabricante {
  nombre: string
  nit?: string
  telefono?: string
  email?: string
  ciudad?: string
  logo_url?: string
}

export interface CertIngeniero {
  nombre: string          // "Mauricio Moreno Guzmán"
  titulo?: string         // "Ingeniero Mecánico"
  matricula?: string      // Matrícula profesional (COPNIA)
  email?: string
}

export interface CertConfig {
  fabricante?: CertFabricante
  ingeniero?: CertIngeniero
}

export interface CertPublica {
  lote: CertLoteRow
  producto: CertProductoRow | null
  documentos: CertDocumentoRow[]
  vigente: boolean
  diasParaVencer: number | null
  workspaceNombre: string | null
  negocioCodigo: string | null
  fabricante: CertFabricante | null
  ingeniero: CertIngeniero | null
}
