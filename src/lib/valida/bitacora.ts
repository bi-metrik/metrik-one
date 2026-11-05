/**
 * La bitácora de consultas de Valida en un XLSX: todas las consultas del espacio, de la más vieja a la
 * más nueva, con lo que la cláusula 9.3 de los Términos del Plan CDA llama la evidencia (datos
 * consultados, resultado y el reporte con su código de verificación y su huella). Puro: arma filas.
 *
 * Es la «exportación de la bitácora» que la 11.2 deja abierta con la suscripción Suspendida por pago
 * (D5 del diseño del 4-nov-2026). La descarga la autoriza la misma puerta del historial
 * (`accesoValida()`), así que se puede en Activa y en Suspendida, y no en Cancelada.
 */

export interface FilaBitacora {
  created_at: string
  tipo: string
  tipo_persona: string
  nombre_consultado: string | null
  documento_tipo: string | null
  documento_numero: string | null
  severidad: string
  total_matches: number | null
  valida_consulta_id: string | null
  hash_reporte: string | null
  created_by: string | null
  negocio_id: string | null
}

export const ENCABEZADO_BITACORA = [
  'fecha_hora_bogota',
  'tipo',
  'tipo_persona',
  'nombre',
  'tipo_documento',
  'numero_documento',
  'severidad',
  'coincidencias',
  'codigo_verificacion',
  'huella_reporte',
  'consultado_por',
] as const

/** Instante ISO → 'YYYY-MM-DD HH:MM' en Bogotá (UTC−5, sin horario de verano). */
export function fechaHoraBogota(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t - 5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
}

const TIPO: Record<string, string> = { puntual: 'Puntual', masiva_item: 'Cargue' }

export function celdasBitacora(
  f: FilaBitacora,
  ctx: { usuarios: Map<string, string>; negocios: Map<string, string> | null },
): (string | number)[] {
  const celdas: (string | number)[] = [
    fechaHoraBogota(f.created_at),
    TIPO[f.tipo] ?? f.tipo,
    f.tipo_persona,
    f.nombre_consultado ?? '',
    f.documento_tipo ?? '',
    f.documento_numero ?? '',
    f.severidad,
    f.total_matches ?? 0,
    f.valida_consulta_id ?? '',
    f.hash_reporte ?? '',
    f.created_by ? (ctx.usuarios.get(f.created_by) ?? '') : '',
  ]
  if (ctx.negocios) celdas.push(f.negocio_id ? (ctx.negocios.get(f.negocio_id) ?? '') : '')
  return celdas
}

/** El nombre del archivo: `valida-bitacora-<espacio>-<día>.xlsx`. */
export function nombreArchivoBitacora(slug: string | null, hoy: string): string {
  const limpio = (slug ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return `valida-bitacora-${limpio ? `${limpio}-` : ''}${hoy}.xlsx`
}
