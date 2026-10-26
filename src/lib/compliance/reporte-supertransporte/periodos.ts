/**
 * Reporte Supertransporte — el periodo que elige la oficial.
 *
 * Fuente normativa: CE Supertransporte 20265330000054 (06-may-2026), num. 5.3.1.3
 * (SARLAFT) / 5.3.2.2 (RMS), modificada por la CE 20265330000134 (06-ago-2026).
 *
 *   - Periodos trimestrales: ene–mar, abr–jun, jul–sep, oct–dic.
 *   - Plazo: 10 días CALENDARIO después del cierre del periodo.
 *   - Transición 2026: el esquema original de la CE 054 arrancaba con may–jul; la CE 134
 *     corrió el calendario. Por eso los tres primeros atajos son irregulares
 *     (may–jul, ago–sep, oct–dic) y desde 2027 son trimestres calendario.
 *
 * Decisión de Mauricio (2026-10-08): la oficial elige el periodo, el tablero no lo
 * decide por ella. Hay tres formas de elegirlo y las tres viajan en la URL:
 *
 *   ?periodo=2026-08_2026-09        un atajo regulatorio (con su fecha límite)
 *   ?meses=2026-08,2026-10           uno o varios meses sueltos
 *   ?desde=2026-08-01&hasta=2026-09-15   un rango libre
 *
 * Sin nada en la URL se abre el periodo que toca radicar: el primero cuya fecha límite
 * todavía no pasó.
 *
 * Puro: sin base, sin reloj propio (el "hoy" entra por parámetro, en hora de Bogotá).
 */

export type ModoPeriodo = 'atajo' | 'meses' | 'rango'

export interface AtajoRegulatorio {
  /** `AAAA-MM_AAAA-MM` (mes de inicio y mes de cierre). Es lo que viaja en `?periodo=`. */
  id: string
  /** "Ago–sep 2026". */
  etiqueta: string
  desde: string
  hasta: string
  /** Último día para radicar en VIGÍA: cierre + 10 días calendario. */
  fechaLimite: string
}

export interface PeriodoResuelto {
  modo: ModoPeriodo
  etiqueta: string
  /** Primer día incluido (AAAA-MM-DD, Bogotá). */
  desde: string
  /** Último día incluido (AAAA-MM-DD, Bogotá). */
  hasta: string
  /**
   * Meses que cubre la selección (AAAA-MM). En modo `meses` son SOLO los elegidos, que
   * pueden no ser contiguos; en los otros modos, todos los que toca el rango.
   */
  meses: string[]
  /** Solo para un atajo regulatorio. */
  fechaLimite: string | null
  /** Id del atajo, si la selección es uno. */
  atajoId: string | null
  /** El periodo todavía no cierra: las cifras van a cambiar. */
  enCurso: boolean
}

/** Parámetros de búsqueda tal como llegan a la página (o a la ruta del Excel). */
export type ParamsPeriodo = Record<string, string | string[] | undefined>

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Plazo de radicación en días calendario tras el cierre (CE 054 num. 5.3.1.3). */
export const DIAS_PLAZO_RADICACION = 10

/** Tope de meses que se aceptan en una selección. Más que eso no es un reporte. */
export const MAX_MESES_SELECCION = 36

/** Primer mes con atajo: el inicio del esquema de transición. */
const PRIMER_ATAJO_ANIO = 2026

// ─── Fechas sin zona ────────────────────────────────────────────────────────

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/
const RE_MES = /^(\d{4})-(\d{2})$/

/** Una fecha AAAA-MM-DD que existe en el calendario. */
export function esFechaValida(s: string | null | undefined): s is string {
  if (!s) return false
  const m = RE_FECHA.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === s
}

export function esMesValido(s: string | null | undefined): s is string {
  if (!s) return false
  const m = RE_MES.exec(s)
  if (!m) return false
  const mes = Number(m[2])
  return mes >= 1 && mes <= 12 && Number(m[1]) >= 2000 && Number(m[1]) <= 2100
}

/** Suma días a una fecha AAAA-MM-DD, en calendario puro (sin horario de verano). */
export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10)
}

/** Último día del mes AAAA-MM. */
export function finDeMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

function mesSiguiente(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

/** Los meses AAAA-MM que toca el rango [desde, hasta], en orden. */
export function mesesDelRango(desde: string, hasta: string): string[] {
  const out: string[] = []
  let mes = desde.slice(0, 7)
  const fin = hasta.slice(0, 7)
  while (mes <= fin && out.length <= MAX_MESES_SELECCION) {
    out.push(mes)
    mes = mesSiguiente(mes)
  }
  return out
}

/** Fecha límite de radicación de un periodo que cierra en `hasta`. */
export function fechaLimiteRadicacion(hasta: string): string {
  return sumarDias(hasta, DIAS_PLAZO_RADICACION)
}

/** "ago 2026". */
export function etiquetaMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  return `${MESES_CORTOS[m - 1]} ${y}`
}

/** "10 oct 2026". */
export function etiquetaFecha(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  return `${d} ${MESES_CORTOS[m - 1]} ${y}`
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function atajo(mesDesde: string, mesHasta: string): AtajoRegulatorio {
  const [y1, m1] = mesDesde.split('-').map(Number)
  const [y2, m2] = mesHasta.split('-').map(Number)
  const etiqueta = y1 === y2
    ? `${capitalizar(MESES_CORTOS[m1 - 1])}–${MESES_CORTOS[m2 - 1]} ${y2}`
    : `${capitalizar(MESES_CORTOS[m1 - 1])} ${y1}–${MESES_CORTOS[m2 - 1]} ${y2}`
  const hasta = finDeMes(mesHasta)
  return {
    id: `${mesDesde}_${mesHasta}`,
    etiqueta,
    desde: `${mesDesde}-01`,
    hasta,
    fechaLimite: fechaLimiteRadicacion(hasta),
  }
}

// ─── Atajos ────────────────────────────────────────────────────────────────

/**
 * Los atajos regulatorios, del más viejo al más nuevo, hasta el periodo que contiene
 * `hoy` inclusive (el que está en curso también se puede mirar, para seguimiento).
 *
 * Transición 2026 (CE 134): may–jul, ago–sep, oct–dic. Desde 2027, trimestres.
 */
export function atajosRegulatorios(hoy: string): AtajoRegulatorio[] {
  const lista: AtajoRegulatorio[] = [
    atajo(`${PRIMER_ATAJO_ANIO}-05`, `${PRIMER_ATAJO_ANIO}-07`),
    atajo(`${PRIMER_ATAJO_ANIO}-08`, `${PRIMER_ATAJO_ANIO}-09`),
    atajo(`${PRIMER_ATAJO_ANIO}-10`, `${PRIMER_ATAJO_ANIO}-12`),
  ]
  const anioHoy = Number(hoy.slice(0, 4))
  for (let y = PRIMER_ATAJO_ANIO + 1; y <= anioHoy; y++) {
    for (const [a, b] of [['01', '03'], ['04', '06'], ['07', '09'], ['10', '12']]) {
      const t = atajo(`${y}-${a}`, `${y}-${b}`)
      if (t.desde > hoy) break
      lista.push(t)
    }
  }
  // Los tres de la transición van siempre, aunque alguno no haya empezado: son el
  // calendario que la oficial ya conoce. Los trimestres solo hasta el que está en curso.
  return lista
}

/**
 * El atajo que toca radicar: el primero cuya fecha límite no ha pasado. Si todos pasaron
 * (no debería: siempre hay uno en curso), el último.
 */
export function atajoPorDefecto(hoy: string): AtajoRegulatorio {
  const lista = atajosRegulatorios(hoy)
  return lista.find((t) => t.fechaLimite >= hoy) ?? lista[lista.length - 1]
}

// ─── Leer y escribir la URL ────────────────────────────────────────────────

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function desdeAtajo(t: AtajoRegulatorio, hoy: string): PeriodoResuelto {
  return {
    modo: 'atajo',
    etiqueta: t.etiqueta,
    desde: t.desde,
    hasta: t.hasta,
    meses: mesesDelRango(t.desde, t.hasta),
    fechaLimite: t.fechaLimite,
    atajoId: t.id,
    enCurso: t.hasta >= hoy,
  }
}

/** Un atajo por id, aunque sea viejo o no esté en la lista visible (enlace compartido). */
function atajoPorId(id: string): AtajoRegulatorio | null {
  const m = /^(\d{4}-\d{2})_(\d{4}-\d{2})$/.exec(id)
  if (!m || !esMesValido(m[1]) || !esMesValido(m[2]) || m[1] > m[2]) return null
  // Solo ids que corresponden a un periodo regulatorio real: los tres de la transición
  // o un trimestre calendario desde 2027. Cualquier otro par es un rango, no un atajo.
  const [y1, mm1] = m[1].split('-').map(Number)
  const [y2, mm2] = m[2].split('-').map(Number)
  const transicion = y1 === PRIMER_ATAJO_ANIO && y2 === PRIMER_ATAJO_ANIO &&
    ((mm1 === 5 && mm2 === 7) || (mm1 === 8 && mm2 === 9) || (mm1 === 10 && mm2 === 12))
  const trimestre = y1 > PRIMER_ATAJO_ANIO && y1 === y2 && (mm1 - 1) % 3 === 0 && mm2 === mm1 + 2
  if (!transicion && !trimestre) return null
  return atajo(m[1], m[2])
}

/**
 * Lee el periodo de la URL. Precedencia: `periodo` > `meses` > `desde`/`hasta`. Lo que no
 * se pueda leer cae al atajo que toca radicar: un enlace roto abre el reporte, no un error.
 */
export function resolverPeriodo(params: ParamsPeriodo, hoy: string): PeriodoResuelto {
  const idAtajo = primero(params.periodo)
  if (idAtajo) {
    const t = atajoPorId(idAtajo)
    if (t) return desdeAtajo(t, hoy)
  }

  const mesesRaw = primero(params.meses)
  if (mesesRaw) {
    const meses = [...new Set(mesesRaw.split(',').map((s) => s.trim()).filter(esMesValido))]
      .sort()
      .slice(0, MAX_MESES_SELECCION)
    if (meses.length > 0) {
      const desde = `${meses[0]}-01`
      const hasta = finDeMes(meses[meses.length - 1])
      return {
        modo: 'meses',
        etiqueta: meses.length === 1
          ? capitalizar(etiquetaMes(meses[0]))
          : meses.map(etiquetaMes).join(', '),
        desde,
        hasta,
        meses,
        fechaLimite: null,
        atajoId: null,
        enCurso: hasta >= hoy,
      }
    }
  }

  const desde = primero(params.desde)
  const hasta = primero(params.hasta)
  if (esFechaValida(desde) && esFechaValida(hasta) && desde <= hasta) {
    const meses = mesesDelRango(desde, hasta)
    if (meses.length <= MAX_MESES_SELECCION) {
      return {
        modo: 'rango',
        etiqueta: `${etiquetaFecha(desde)} – ${etiquetaFecha(hasta)}`,
        desde,
        hasta,
        meses,
        fechaLimite: null,
        atajoId: null,
        enCurso: hasta >= hoy,
      }
    }
  }

  return desdeAtajo(atajoPorDefecto(hoy), hoy)
}

/** Los parámetros que reproducen la selección (sin la pestaña). */
export function paramsDePeriodo(p: PeriodoResuelto): Record<string, string> {
  if (p.modo === 'atajo' && p.atajoId) return { periodo: p.atajoId }
  if (p.modo === 'meses') return { meses: p.meses.join(',') }
  return { desde: p.desde, hasta: p.hasta }
}

/** ¿La fecha (AAAA-MM-DD, Bogotá) cae dentro de la selección? */
export function fechaEnPeriodo(fecha: string, p: PeriodoResuelto): boolean {
  if (fecha < p.desde || fecha > p.hasta) return false
  if (p.modo === 'meses') return p.meses.includes(fecha.slice(0, 7))
  return true
}

/**
 * El tramo de un mes que cae dentro de la selección. En un rango libre el primer y el
 * último mes pueden quedar recortados; el detalle mes a mes lo tiene que decir.
 */
export function tramoDelMes(mes: string, p: PeriodoResuelto): { desde: string; hasta: string } {
  const ini = `${mes}-01`
  const fin = finDeMes(mes)
  return { desde: ini < p.desde ? p.desde : ini, hasta: fin > p.hasta ? p.hasta : fin }
}
