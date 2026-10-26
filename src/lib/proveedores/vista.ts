/**
 * Lo que viaja al navegador de un proveedor (lista y ficha). PURO: de las filas de la base a lo
 * que se pinta, sin rutas del bucket ni datos bancarios.
 */
import type { EspacioProveedor, TarifaCanal, TipoProveedor } from './tipos'
import { estadoTarifario, semaforo, tarifariosEfectivos, type EstadoTarifario, type Semaforo, type VigenciaTarifario } from './vigencia'

/** La fila de `fotos_perfiles` que lee la pantalla. */
export interface FilaProveedor {
  id: string
  tipo: EspacioProveedor
  clave: string
  nombre: string
  ciudad: string | null
  tipo_proveedor: TipoProveedor
  pais: string | null
  estrellas: number | null
  web: string | null
  contacto_nombre: string | null
  celular: string | null
  celular_original: string | null
  correo: string | null
  telefono: string | null
  direccion: string | null
  notas: string | null
  etiquetas: string[] | null
  tarifas_mayorista: boolean
  responsable_tarifas_id: string | null
  comprado_via_id: string | null
  origen: 'cotizacion' | 'importacion' | 'manual'
  origen_ref: string | null
  // Migración 20261019130000.
  departamento: string | null
  destino: string | null
  iva_declarado: boolean | null
  iva_incluido: boolean | null
  tarifa_canal: TarifaCanal | null
  tarifas_solicitadas_at: string | null
}

export const COLUMNAS_PROVEEDOR =
  'id, tipo, clave, nombre, ciudad, tipo_proveedor, pais, estrellas, web, contacto_nombre, celular, celular_original, correo, telefono, direccion, notas, etiquetas, tarifas_mayorista, responsable_tarifas_id, comprado_via_id, origen, origen_ref, departamento, destino, iva_declarado, iva_incluido, tarifa_canal, tarifas_solicitadas_at'

export interface FilaTarifario {
  id: string
  proveedor_id: string
  ref: string | null
  nombre_archivo: string | null
  bytes: number | null
  mime: string | null
  vigente_desde: string | null
  vigente_hasta: string | null
  vigencia_inferida: boolean
  temporada: string | null
  notas: string | null
  subido_por: string | null
  subido_at: string
}

export const COLUMNAS_TARIFARIO =
  'id, proveedor_id, ref, nombre_archivo, bytes, mime, vigente_desde, vigente_hasta, vigencia_inferida, temporada, notas, subido_por, subido_at'

export interface ProveedorEnLista {
  id: string
  nombre: string
  tipoProveedor: TipoProveedor
  ciudad: string | null
  /** La ciudad como va en la llave (para filtrar sin tildes). La de la ficha, no la de la llave vieja. */
  ciudadClave: string
  destino: string | null
  /** Lo que le falta para poder cotizar (`faltasDeFicha`). Vacío = completa. */
  faltas: string[]
  /** La «ciudad» es un departamento colombiano (`ciudadDeFichaEsDepartamento`): el filtro la pone aparte. */
  ciudadEsDepartamento: boolean
  estrellas: number | null
  etiquetas: string[]
  responsableId: string | null
  semaforo: Semaforo
  /** El último «hasta» de los tarifarios que cuentan. */
  hasta: string | null
  /** El semáforo sale del tarifario del mayorista («se compra a través de»). */
  delMayorista: boolean
  miniatura: string | null
  /**
   * Las tarifas que se pueden citar (`tarifasCitables`, el MISMO criterio del buscador de la
   * cotización): con extracción revisada, y si hay un borrador más nuevo («por revisar»).
   */
  tarifas: { citable: boolean; porRevisar: boolean; hasta: string | null }
}

export interface TarifarioVista {
  id: string
  nombreArchivo: string | null
  tieneArchivo: boolean
  bytes: number | null
  desde: string | null
  hasta: string | null
  inferida: boolean
  temporada: string | null
  notas: string | null
  estado: EstadoTarifario
  subidoPor: string | null
  subidoAt: string
}

export function vigenciaDeFila(t: Pick<FilaTarifario, 'vigente_desde' | 'vigente_hasta'>): VigenciaTarifario {
  return { desde: t.vigente_desde, hasta: t.vigente_hasta }
}

export function tarifarioVista(t: FilaTarifario, hoy: string, nombres: Map<string, string>): TarifarioVista {
  return {
    id: t.id,
    nombreArchivo: t.nombre_archivo,
    tieneArchivo: !!t.ref,
    bytes: t.bytes,
    desde: t.vigente_desde,
    hasta: t.vigente_hasta,
    inferida: t.vigencia_inferida,
    temporada: t.temporada,
    notas: t.notas,
    estado: estadoTarifario(vigenciaDeFila(t), hoy),
    subidoPor: t.subido_por ? nombres.get(t.subido_por) ?? null : null,
    subidoAt: t.subido_at,
  }
}

/** Semáforo y último «hasta» de un proveedor, con el respaldo del mayorista. */
export function estadoDeProveedor(
  p: Pick<FilaProveedor, 'id' | 'comprado_via_id'>,
  porProveedor: Map<string, VigenciaTarifario[]>,
  hoy: string,
): { semaforo: Semaforo; hasta: string | null; delMayorista: boolean } {
  const propios = porProveedor.get(p.id) ?? []
  const deVia = p.comprado_via_id ? porProveedor.get(p.comprado_via_id) ?? [] : null
  const { tarifarios, delMayorista } = tarifariosEfectivos(propios, deVia)
  const hastas = tarifarios.map((t) => t.hasta).filter((h): h is string => !!h).sort()
  return { semaforo: semaforo(tarifarios, hoy), hasta: hastas[hastas.length - 1] ?? null, delMayorista }
}

/** ¿Es de los que la asesora tiene que pedir? (filtro «mis tarifarios por renovar»). */
export function porRenovar(s: Semaforo): boolean {
  return s === 'vencido' || s === 'por_vencer'
}
