/**
 * Traducción de lo que devuelven Valida y las RPC a las formas que pinta el módulo. Pura.
 */

import type {
  CobroDeServicio,
  DocumentoContractual,
  LlaveRecienEmitida,
  ServicioConPagos,
} from './resultados'

/**
 * La respuesta 201 de generar una llave. Sin `llave` o sin `key_id` NO es una emisión: devolver
 * «llave creada» sin la llave dejaría al cliente con una credencial que nunca podrá ver.
 */
export function mapearLlaveEmitida(datos: unknown): LlaveRecienEmitida | null {
  if (!datos || typeof datos !== 'object') return null
  const d = datos as Record<string, unknown>
  if (typeof d.llave !== 'string' || d.llave.length === 0) return null
  if (typeof d.key_id !== 'string' || typeof d.key_prefix !== 'string') return null
  return {
    keyId: d.key_id,
    keyPrefix: d.key_prefix,
    nombre: typeof d.nombre === 'string' ? d.nombre : '',
    llave: d.llave,
    regenerada: d.regenerada === true,
    anteriorDejaDeAutenticarEn:
      typeof d.anterior_deja_de_autenticar_en === 'string' ? d.anterior_deja_de_autenticar_en : null,
  }
}

/**
 * ¿El error de una RPC significa que la función no existe todavía? Pasa antes de aplicar la
 * migración: PostgREST responde PGRST202. Se distingue para decir «no disponible» y NO pintar
 * una lista vacía, que se leería como «no hay nada» (el `?? []` que ya costó caro en este repo).
 */
export function esFuncionAusente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true
  return /could not find the function/i.test(error.message ?? '')
}

interface FilaDocumento {
  documento_id: string
  slug: string
  titulo: string
  version: string
  texto_md: string
  pdf_sha256: string
  vigente_desde: string
  vigente_hasta: string | null
  aceptado_at: string | null
  aceptado_por: string | null
  aceptado_calidad: string | null
  aceptado_canal: string | null
}

export function mapearDocumentos(filas: readonly FilaDocumento[]): DocumentoContractual[] {
  return filas.map((f) => ({
    documentoId: f.documento_id,
    slug: f.slug,
    titulo: f.titulo,
    version: f.version,
    textoMd: f.texto_md,
    pdfSha256: f.pdf_sha256,
    vigenteDesde: f.vigente_desde,
    vigenteHasta: f.vigente_hasta,
    aceptadoAt: f.aceptado_at,
    aceptadoPor: f.aceptado_por,
    aceptadoCalidad: f.aceptado_calidad,
    // Sin aceptación el canal no se afirma: `null`, no 'modulo'.
    aceptadoCanal: f.aceptado_at
      ? f.aceptado_canal === 'whatsapp'
        ? 'whatsapp'
        : 'modulo'
      : null,
  }))
}

interface FilaServicio {
  servicio_contratado_id: string
  servicio_nombre: string
  estado: string
  vigente_desde: string
  vigente_hasta: string | null
  es_pagador: boolean | null
}

interface FilaCobro {
  cobro_id: string
  fecha: string | null
  concepto: string | null
  monto: number | string | null
  fuente: string | null
  estado: string
  recibo_numero: string | null
  recibo_origen: string | null
  recibo_path: string | null
}

/** Solo los servicios que el workspace PAGA: la plata de un contrato ajeno no se muestra. */
export function serviciosQuePaga(filas: readonly FilaServicio[]): FilaServicio[] {
  return filas.filter((f) => f.es_pagador === true)
}

export function mapearCobros(filas: readonly FilaCobro[]): CobroDeServicio[] {
  return filas.map((c) => ({
    cobroId: c.cobro_id,
    fecha: c.fecha,
    concepto: c.concepto ?? '',
    monto: Number(c.monto ?? 0),
    fuente: c.fuente,
    estado: c.estado === 'anulado' ? 'anulado' : c.estado === 'programado' ? 'programado' : 'pagado',
    reciboNumero: c.recibo_numero,
    reciboOrigen: c.recibo_origen,
    // Un recibo con número pero sin PDF propio (los de Siigo archivados en Drive) NO se ofrece
    // para descargar: aquí nunca sale un enlace de Drive (§5.4).
    reciboDescargable: typeof c.recibo_path === 'string' && c.recibo_path.length > 0,
  }))
}

export function armarServicioConPagos(servicio: FilaServicio, cobros: readonly FilaCobro[]): ServicioConPagos {
  return {
    servicioContratadoId: servicio.servicio_contratado_id,
    nombre: servicio.servicio_nombre,
    estado: servicio.estado,
    vigenteDesde: servicio.vigente_desde,
    vigenteHasta: servicio.vigente_hasta,
    cobros: mapearCobros(cobros),
  }
}
