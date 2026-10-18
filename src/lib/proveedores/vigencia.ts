/**
 * La vigencia de los tarifarios de un proveedor (Mauricio, 2026-10-18). PURO.
 *
 * Cada tarifario puede traer `desde` y `hasta` (fechas `YYYY-MM-DD`, opcionales). De ahí sale:
 *   · el estado de cada tarifario HOY: vigente / por vencer (≤ 30 días) / vencido / sin fechas;
 *   · el semáforo del proveedor (el mejor de sus tarifarios, o «sin tarifario»);
 *   · el aviso de la tarjeta de la cotización: ¿algún tarifario cubre las fechas del VIAJE?
 *
 * Un hotel comprado a través de un mayorista (Europa) sin tarifario propio usa los del mayorista.
 * El aviso es informativo: no frena cotizar.
 */

export type EstadoTarifario = 'vigente' | 'por_vencer' | 'vencido' | 'sin_fechas'
export type Semaforo = EstadoTarifario | 'sin_tarifario'

export const DIAS_POR_VENCER = 30

export interface VigenciaTarifario {
  desde: string | null
  hasta: string | null
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

/** Días desde 1970 de una fecha `YYYY-MM-DD` (sin zona: es una fecha de calendario). `null` si no es fecha. */
function dia(f: string | null | undefined): number | null {
  const m = FECHA.exec((f ?? '').slice(0, 10))
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : Math.floor(t / 86_400_000)
}

/** Hoy en Colombia como `YYYY-MM-DD` (la referencia del sistema es Bogotá, decisión 2026-09-27). */
export function hoyBogota(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10)
}

export function estadoTarifario(t: VigenciaTarifario, hoy: string): EstadoTarifario {
  const h = dia(t.hasta)
  const d = dia(t.desde)
  const n = dia(hoy) ?? 0
  if (h === null && d === null) return 'sin_fechas'
  if (h === null) return 'vigente'
  if (h < n) return 'vencido'
  if (h - n <= DIAS_POR_VENCER) return 'por_vencer'
  return 'vigente'
}

const ORDEN: Record<EstadoTarifario, number> = { vigente: 0, por_vencer: 1, sin_fechas: 2, vencido: 3 }

/** El semáforo de un proveedor: el mejor estado de sus tarifarios. */
export function semaforo(tarifarios: readonly VigenciaTarifario[], hoy: string): Semaforo {
  if (tarifarios.length === 0) return 'sin_tarifario'
  return tarifarios.map((t) => estadoTarifario(t, hoy)).sort((a, b) => ORDEN[a] - ORDEN[b])[0]
}

export const NOMBRE_SEMAFORO: Record<Semaforo, string> = {
  vigente: 'Vigente',
  por_vencer: 'Por vencer',
  vencido: 'Vencido',
  sin_fechas: 'Sin fechas',
  sin_tarifario: 'Sin tarifario',
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «2025-12-31» → «dic-2025». */
export function mesAnio(f: string | null | undefined): string {
  const m = FECHA.exec((f ?? '').slice(0, 10))
  return m ? `${MESES[Number(m[2]) - 1]}-${m[1]}` : ''
}

/** «2025-12-31» → «31 dic 2025». */
export function fechaCorta(f: string | null | undefined): string {
  const m = FECHA.exec((f ?? '').slice(0, 10))
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : ''
}

/** Lo que la tarjeta sabe del proveedor de un hotel o un tour. */
export interface ProveedorDeTarjeta {
  id: string
  nombre: string
  tarifarios: VigenciaTarifario[]
  /** «Se compra a través de»: el mayorista, con sus tarifarios. */
  via: { id: string; nombre: string; tarifarios: VigenciaTarifario[] } | null
}

export interface AvisoTarifario {
  texto: string
  /** Qué hacer, en llano: «Pide el tarifario 2026 al hotel». */
  accion: string
  /** La ficha que hay que abrir (la del mayorista cuando el aviso es por él). */
  proveedorId: string
  tono: 'gris' | 'ambar'
}

/**
 * El aviso de la tarjeta: ¿algún tarifario cubre el viaje (`inicio` a `fin`)? Sin fechas del viaje
 * se mira HOY. `null` = nada que decir (un tarifario lo cubre).
 *  · sin tarifarios (ni propio ni del mayorista) → «Sin tarifario»;
 *  · uno sin fechas y ninguno que cubra → «Tarifario sin fechas»;
 *  · todos terminan antes del viaje → «Tarifario vencido (hasta dic-2025)»;
 *  · si no, no cubre el viaje entero → «El tarifario no cubre estas fechas».
 */
export function avisoDeTarifario(
  p: ProveedorDeTarjeta,
  fechas: { inicio: string | null; fin: string | null } | null | undefined,
  hoy: string,
): AvisoTarifario | null {
  const propio = p.tarifarios.length > 0
  const usa = propio ? p.tarifarios : p.via?.tarifarios ?? []
  const quien = propio || !p.via ? { id: p.id, nombre: p.nombre, a: 'al proveedor' } : { id: p.via.id, nombre: p.via.nombre, a: `al mayorista ${p.via.nombre}` }
  const inicio = dia(fechas?.inicio) ?? dia(hoy) ?? 0
  const fin = Math.max(dia(fechas?.fin) ?? inicio, inicio)
  const anio = (fechas?.inicio && FECHA.test(fechas.inicio.slice(0, 10)) ? fechas.inicio.slice(0, 4) : hoy.slice(0, 4))
  const pide = `Pide el tarifario ${anio} ${quien.a}`
  if (usa.length === 0) {
    return { texto: 'Sin tarifario', accion: `${pide} y súbelo a su ficha`, proveedorId: quien.id, tono: 'gris' }
  }
  const cubre = usa.some((t) => {
    const d = dia(t.desde)
    const h = dia(t.hasta)
    if (d === null && h === null) return false
    return (d === null || d <= inicio) && (h === null || h >= fin)
  })
  if (cubre) return null
  const via = !propio && p.via ? ` (de ${p.via.nombre})` : ''
  if (usa.some((t) => dia(t.desde) === null && dia(t.hasta) === null)) {
    return { texto: `Tarifario sin fechas${via}`, accion: 'Revisa hasta cuándo vale y anótalo en la ficha', proveedorId: quien.id, tono: 'gris' }
  }
  const hastas = usa.map((t) => t.hasta).filter((h): h is string => dia(h) !== null).sort()
  const ultimo = hastas[hastas.length - 1] ?? null
  if (ultimo && (dia(ultimo) ?? 0) < inicio) {
    return { texto: `Tarifario vencido (hasta ${mesAnio(ultimo)})${via}`, accion: pide, proveedorId: quien.id, tono: 'ambar' }
  }
  return { texto: `El tarifario no cubre todas las fechas del viaje${via}`, accion: `Confirma la tarifa ${quien.a}`, proveedorId: quien.id, tono: 'ambar' }
}

/** El tarifario que usa la ficha para el semáforo: el propio o, si no tiene, el del mayorista. */
export function tarifariosEfectivos(propios: readonly VigenciaTarifario[], deVia: readonly VigenciaTarifario[] | null): { tarifarios: readonly VigenciaTarifario[]; delMayorista: boolean } {
  if (propios.length > 0 || !deVia) return { tarifarios: propios, delMayorista: false }
  return { tarifarios: deVia, delMayorista: deVia.length > 0 }
}

/**
 * Vigencia sugerida por el nombre del archivo («Tarifas 2025.pdf», «Tarifario 2026-2027»):
 * del 1-ene del primer año al 31-dic del último. Es una SUGERENCIA (se guarda marcada como inferida).
 */
export function vigenciaDeNombre(nombre: string | null | undefined): VigenciaTarifario | null {
  const texto = nombre ?? ''
  const anios = [...texto.matchAll(/(?<!\d)(20[2-3]\d)(?!\d)/g)].map((m) => Number(m[1]))
  // «2026-27»: el segundo año abreviado.
  for (const m of texto.matchAll(/(?<!\d)(20[2-3]\d)\s*[-/–]\s*(\d{2})(?!\d)/g)) anios.push(2000 + Number(m[2]))
  if (anios.length === 0) return null
  const a = Math.min(...anios)
  const b = Math.max(...anios)
  if (b - a > 2) return null
  return { desde: `${a}-01-01`, hasta: `${b}-12-31` }
}
