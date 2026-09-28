/**
 * La vista de la tabla del Radar: puntuar, excluir, filtrar y ordenar. Puro, para que el orden y el
 * conteo de la pantalla se prueben sin navegador.
 *
 * La referencia funcional es `metrik-data/dashboard/index.html` (aprobada por Noor), y de ahí salen
 * las reglas que no son obvias:
 *
 *   · **«Coincide» no es lo mismo que «fit alto».** Un proceso puede mencionar un tema del cliente y
 *     quedar en negativo porque la entidad lo compra como suministro. Eso se MUESTRA, no se
 *     esconde: el fit ordena y la coincidencia filtra.
 *   · **Las exclusiones se pueden apagar.** Son del perfil y el cliente tiene que poder ver qué le
 *     están sacando, o la lista miente por omisión.
 *   · **Los ocultos se van siempre**; los seguidos se pueden ver solos.
 *   · La búsqueda tiene operadores: `"frase exacta"`, `-excluir`, `uno|otro`, y el resto es Y.
 */

import { excluido, norm, puntuar, type Exclusiones, type Tema, type TemaAcertado } from './puntuar'
import { diasParaCierre } from './socrata'

export interface ProcesoBase {
  noticeUid: string
  referencia: string
  entidad: string
  departamento: string
  modalidad: string
  tipoContrato: string
  objeto: string
  valor: number
  fechaCierre: string | null
  duracion: string | null
  url: string | null
  sinRup: boolean
}

export interface ProcesoPuntuado extends ProcesoBase {
  fit: number
  hits: TemaAcertado[]
  /** Cruzó al menos un tema de peso positivo. */
  coincide: boolean
  /** Días para el cierre. `null` si el proceso no trae fecha. */
  dias: number | null
  /** La exclusión del perfil que lo saca, o `null`. */
  excluidoPor: string | null
  sigue: boolean
  oculto: boolean
}

/** Columnas por las que la tabla ordena. Son las de la referencia. */
export const COLUMNAS = ['dias', 'fit', 'entidad', 'departamento', 'tipoContrato', 'modalidad', 'sinRup', 'valor', 'objeto'] as const
export type Columna = (typeof COLUMNAS)[number]

export interface Orden {
  col: Columna
  asc: boolean
}

/** El orden inicial: el mejor fit primero, que es la razón de ser del Radar. */
export const ORDEN_INICIAL: Orden = { col: 'fit', asc: false }

/** Cuántas filas por página. El de la referencia. */
export const POR_PAGINA = 40

export interface Filtros {
  regiones: readonly string[]
  areas: readonly string[]
  min: number | null
  max: number | null
  q: string
  /** Cierra dentro de N días. `null` = cualquier fecha. */
  cierraEn: number | null
  soloSinRup: boolean
  soloCoincide: boolean
  aplicarExclusiones: boolean
  soloSeguidos: boolean
}

export const FILTROS_VACIOS: Filtros = {
  regiones: [],
  areas: [],
  min: null,
  max: null,
  q: '',
  cierraEn: null,
  soloSinRup: false,
  soloCoincide: false,
  // Encendidas por defecto, como en la referencia: el cliente dijo qué no le interesa.
  aplicarExclusiones: true,
  soloSeguidos: false,
}

/**
 * Puntúa todo el universo una vez. Es lo que se rehace cuando el cliente cambia un tema o un peso;
 * los filtros no obligan a volver a puntuar.
 */
export function puntuarTodos(
  procesos: readonly ProcesoBase[],
  p: {
    temas: readonly Tema[]
    senalFuerte: number
    exclusiones: Exclusiones | null
    seguidos: readonly string[]
    ocultos: readonly string[]
    hoy: string
  },
): ProcesoPuntuado[] {
  const seguidos = new Set(p.seguidos)
  const ocultos = new Set(p.ocultos)
  return procesos.map((x) => {
    const r = puntuar(x.objeto, p.temas, p.senalFuerte)
    return {
      ...x,
      fit: r.fit,
      hits: r.hits,
      coincide: r.pos,
      dias: diasParaCierre(x.fechaCierre, p.hoy),
      excluidoPor: excluido(x.objeto, p.exclusiones),
      sigue: seguidos.has(x.noticeUid),
      oculto: ocultos.has(x.noticeUid),
    }
  })
}

export interface Consulta {
  si: string[]
  no: string[]
  o: string[][]
}

/** `"frase exacta"`, `-excluye`, `uno|otro`; el resto es Y. */
export function parsearConsulta(q: string): Consulta {
  const tokens = (q.match(/"[^"]*"|\S+/g) ?? []).map((t) => t.replace(/"/g, '').trim()).filter(Boolean)
  const si: string[] = []
  const no: string[] = []
  const o: string[][] = []
  for (const t of tokens) {
    if (t.startsWith('-') && t.length > 1) no.push(norm(t.slice(1)))
    else if (t.includes('|')) o.push(t.split('|').map(norm).filter(Boolean))
    else si.push(norm(t))
  }
  return { si, no, o }
}

/** Contra qué busca el texto libre: objeto, entidad y referencia. */
function textoBuscable(x: ProcesoBase): string {
  return norm(`${x.objeto} ${x.entidad} ${x.referencia}`)
}

export function pasaFiltros(x: ProcesoPuntuado, f: Filtros, q: Consulta): boolean {
  // Un oculto se va siempre: el cliente dijo que no lo quiere ver.
  if (x.oculto) return false
  if (f.aplicarExclusiones && x.excluidoPor) return false
  if (f.soloSinRup && !x.sinRup) return false
  if (f.soloCoincide && !x.coincide) return false
  if (f.soloSeguidos && !x.sigue) return false
  if (f.regiones.length > 0 && !f.regiones.includes(x.departamento)) return false
  if (f.areas.length > 0 && !f.areas.includes(x.tipoContrato)) return false
  if (f.min !== null && x.valor < f.min) return false
  if (f.max !== null && x.valor > f.max) return false
  // Un proceso sin fecha de cierre no pasa un filtro por fecha: no se puede afirmar que cierre
  // dentro de N días. Sin el filtro sí aparece.
  if (f.cierraEn !== null && !(x.dias !== null && x.dias <= f.cierraEn)) return false
  if (f.q) {
    const u = textoBuscable(x)
    if (!q.si.every((w) => u.includes(w))) return false
    if (q.no.some((w) => u.includes(w))) return false
    if (!q.o.every((g) => g.some((w) => u.includes(w)))) return false
  }
  return true
}

function valorDeColumna(x: ProcesoPuntuado, col: Columna): number | string {
  switch (col) {
    case 'dias':
      // Sin fecha va al final en orden ascendente: es lo que menos se sabe, no lo más urgente.
      return x.dias ?? 99999
    case 'fit':
      return x.fit
    case 'valor':
      return x.valor
    case 'sinRup':
      return x.sinRup ? 1 : 0
    case 'entidad':
      return x.entidad
    case 'departamento':
      return x.departamento
    case 'tipoContrato':
      return x.tipoContrato
    case 'modalidad':
      return x.modalidad
    case 'objeto':
      return x.objeto
  }
}

/**
 * Ordena por la columna. El desempate es siempre `notice_uid`: sin él, dos procesos con el mismo
 * fit pueden intercambiarse entre renders y la tabla «se mueve sola».
 */
export function ordenar(xs: readonly ProcesoPuntuado[], orden: Orden): ProcesoPuntuado[] {
  const signo = orden.asc ? 1 : -1
  return [...xs].sort((a, b) => {
    const va = valorDeColumna(a, orden.col)
    const vb = valorDeColumna(b, orden.col)
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es')
    return c !== 0 ? c * signo : a.noticeUid.localeCompare(b.noticeUid)
  })
}

export interface Resumen {
  vigentes: number
  sinRup: number
  coinciden: number
  valorTotal: number
  /** Cierran en 5 días o menos. Es la urgencia real. */
  pronto: number
}

export function resumir(visibles: readonly ProcesoPuntuado[]): Resumen {
  return {
    vigentes: visibles.length,
    sinRup: visibles.filter((x) => x.sinRup).length,
    coinciden: visibles.filter((x) => x.coincide).length,
    valorTotal: visibles.reduce((a, x) => a + x.valor, 0),
    pronto: visibles.filter((x) => x.dias !== null && x.dias <= 5).length,
  }
}

/** Las opciones de un filtro de lista, con cuántos procesos tiene cada una, más frecuente primero. */
export function opcionesDe(procesos: readonly ProcesoBase[], campo: 'departamento' | 'tipoContrato'): { valor: string; n: number }[] {
  const m = new Map<string, number>()
  for (const x of procesos) {
    const k = x[campo] || 'No especificado'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m].map(([valor, n]) => ({ valor, n })).sort((a, b) => b.n - a.n || a.valor.localeCompare(b.valor, 'es'))
}

/**
 * Cuántos procesos del universo menciona un tema HOY. Es el dato que convierte la biblioteca en una
 * respuesta: «acrílico — 0 procesos» vale más que una casilla.
 */
export function conteoPorTema(procesos: readonly ProcesoBase[], tema: Tema, senalFuerte: number): number {
  let n = 0
  for (const x of procesos) if (puntuar(x.objeto, [tema], senalFuerte).hits.length > 0) n++
  return n
}
