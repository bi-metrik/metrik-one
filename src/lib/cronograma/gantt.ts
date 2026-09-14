/**
 * El Gantt del cronograma: de pasos con fechas a barras, semanas y tres KPIs.
 *
 * Es puro a propósito. Lo pintan dos superficies que no comparten nada más, la vista
 * expandida en pantalla y el PDF que se le manda al cliente, y las dos tienen que
 * decir exactamente lo mismo: si cada una calculara su propio desfase, el cliente
 * podría recibir un documento que no coincide con lo que Omar le muestra en la obra.
 *
 * Qué se compara con qué:
 *
 *   PLAN → el snapshot de la última versión publicada. Es el compromiso que el cliente
 *          recibió, no lo que está escrito ahora en la tabla.
 *   REAL → las fechas reales de hoy. El avance no corta versión, así que siempre se lee
 *          del paso vivo.
 *
 * Todas las fechas son `YYYY-MM-DD` y se operan como días UTC: no hay horas en un
 * cronograma de obra y mezclar zonas horarias corre las barras un día.
 */

export interface PasoParaGantt {
  id: string
  label: string
  responsable: string | null
  /** Del snapshot publicado (o del plan vivo si todavía no hay versión). */
  plan_inicio: string | null
  plan_fin: string | null
  real_inicio: string | null
  real_fin: string | null
  completado: boolean
}

export type EstadoPaso = 'completado' | 'en_curso' | 'atrasado' | 'pendiente' | 'sin_fecha'

export interface Tramo {
  inicio: string
  fin: string
}

export interface FilaGantt {
  id: string
  label: string
  responsable: string | null
  plan: Tramo | null
  /** Lo que pasó. Si arrancó y no ha terminado, llega hasta hoy. */
  real: Tramo | null
  /** Parte del real que cae después del fin planeado: se pinta aparte. */
  fueraDePlan: Tramo | null
  estado: EstadoPaso
  /** Días de atraso (+) o adelanto (-) contra el fin planeado. null si no hay con qué medir. */
  desfaseDias: number | null
}

export interface SemanaGantt {
  inicio: string
  etiqueta: string
}

export interface ModeloGantt {
  hoy: string
  /** Primer día visible (lunes) y último día visible (domingo). null si nada tiene fecha. */
  desde: string | null
  hasta: string | null
  totalDias: number
  semanas: SemanaGantt[]
  filas: FilaGantt[]
  kpis: {
    completados: number
    total: number
    avancePct: number
    entregaPlan: string | null
    entregaProyectada: string | null
    /** Días que la entrega se corre frente al plan: lo marca el pendiente más atrasado. */
    desfaseDias: number | null
  }
}

const DIA_MS = 86_400_000
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const aDia = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DIA_MS
const aIso = (dia: number): string => new Date(dia * DIA_MS).toISOString().slice(0, 10)

export const sumarDias = (iso: string, dias: number): string => aIso(aDia(iso) + dias)
export const diasEntre = (desde: string, hasta: string): number => aDia(hasta) - aDia(desde)

/** `06 oct`. Determinista: Intl cambia el cero a la izquierda entre entornos. */
export function fechaCorta(iso: string | null): string {
  if (!iso) return 'sin fecha'
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d} ${MESES[Number(m) - 1]}`
}

/** `06 oct 2026`. */
export function fechaCortaAno(iso: string | null): string {
  if (!iso) return 'sin fecha'
  return `${fechaCorta(iso)} ${iso.slice(0, 4)}`
}

/** Lunes de la semana de `iso`. */
function lunesDe(iso: string): string {
  const dia = aDia(iso)
  // 1970-01-01 fue jueves: (dia + 3) % 7 da 0 en lunes.
  const offset = (((dia + 3) % 7) + 7) % 7
  return aIso(dia - offset)
}

const valida = (iso: string | null | undefined): iso is string =>
  typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) && !Number.isNaN(aDia(iso))

/** Un tramo con las puntas al revés se ordena en vez de desaparecer. */
function tramo(a: string | null, b: string | null): Tramo | null {
  const ia = valida(a) ? a.slice(0, 10) : null
  const ib = valida(b) ? b.slice(0, 10) : null
  if (!ia && !ib) return null
  const x = ia ?? ib!
  const y = ib ?? ia!
  return x <= y ? { inicio: x, fin: y } : { inicio: y, fin: x }
}

function construirFila(p: PasoParaGantt, hoy: string): FilaGantt {
  const plan = tramo(p.plan_inicio, p.plan_fin)
  const inicioReal = valida(p.real_inicio) ? p.real_inicio.slice(0, 10) : null
  const finReal = valida(p.real_fin) ? p.real_fin.slice(0, 10) : null
  const terminado = p.completado || finReal !== null

  // Arrancado y sin terminar: la barra real llega hasta hoy, que es lo único cierto.
  let real: Tramo | null = null
  if (inicioReal && finReal) real = tramo(inicioReal, finReal)
  else if (inicioReal) real = tramo(inicioReal, !terminado && inicioReal <= hoy ? hoy : inicioReal)
  else if (finReal) real = tramo(finReal, finReal)

  let desfaseDias: number | null = null
  if (plan) {
    if (finReal) {
      desfaseDias = diasEntre(plan.fin, finReal)
    } else if (!terminado && plan.fin < hoy) {
      // Se le pasó la fecha y sigue abierto: el atraso crece con cada día.
      desfaseDias = diasEntre(plan.fin, hoy)
    } else if (!terminado && inicioReal) {
      // Arrancó corrido: si nada más cambia, termina corrido lo mismo.
      desfaseDias = Math.max(diasEntre(plan.inicio, inicioReal), 0)
    } else if (!terminado) {
      desfaseDias = 0
    }
  }

  let fueraDePlan: Tramo | null = null
  if (plan && real && real.fin > plan.fin) {
    fueraDePlan = { inicio: real.inicio > plan.fin ? real.inicio : sumarDias(plan.fin, 1), fin: real.fin }
  }

  let estado: EstadoPaso
  if (terminado) estado = 'completado'
  else if (!plan && !real) estado = 'sin_fecha'
  else if ((desfaseDias ?? 0) > 0) estado = 'atrasado'
  else if (inicioReal) estado = 'en_curso'
  else estado = 'pendiente'

  return {
    id: p.id,
    label: p.label?.trim() || 'Sin nombre',
    responsable: p.responsable,
    plan,
    real,
    fueraDePlan,
    estado,
    desfaseDias,
  }
}

export function construirGantt(pasos: PasoParaGantt[], hoy: string): ModeloGantt {
  const filas = pasos.map(p => construirFila(p, hoy))

  const fechas: string[] = []
  for (const f of filas) {
    if (f.plan) fechas.push(f.plan.inicio, f.plan.fin)
    if (f.real) fechas.push(f.real.inicio, f.real.fin)
  }
  fechas.sort()

  let desde: string | null = null
  let hasta: string | null = null
  const semanas: SemanaGantt[] = []
  if (fechas.length > 0) {
    desde = lunesDe(fechas[0])
    hasta = sumarDias(lunesDe(fechas[fechas.length - 1]), 6)
    for (let s = desde; s <= hasta; s = sumarDias(s, 7)) {
      semanas.push({ inicio: s, etiqueta: fechaCorta(s) })
    }
  }

  const completados = filas.filter(f => f.estado === 'completado').length
  const total = filas.length
  const finesPlan = filas.map(f => f.plan?.fin).filter(valida).sort()
  const entregaPlan = finesPlan.length > 0 ? finesPlan[finesPlan.length - 1] : null

  // El desfase del proyecto lo dicta lo que FALTA: un paso que terminó tarde ya no
  // atrasa nada por sí solo, pero uno abierto y corrido empuja todo lo que viene
  // después. No hay dependencias declaradas entre pasos, así que se asume la lectura de
  // una obra: el atraso del paso más corrido se traslada a la entrega.
  const pendientes = filas.filter(f => f.estado !== 'completado' && f.desfaseDias !== null)
  const atrasoPendiente = pendientes.length > 0 ? Math.max(0, ...pendientes.map(f => f.desfaseDias!)) : 0

  let entregaProyectada: string | null = entregaPlan ? sumarDias(entregaPlan, atrasoPendiente) : null
  for (const f of filas) {
    const fin = f.estado === 'completado' ? f.real?.fin ?? null : !f.plan ? f.real?.fin ?? null : null
    if (fin && (!entregaProyectada || fin > entregaProyectada)) entregaProyectada = fin
  }

  let desfaseDias: number | null = null
  if (pendientes.length > 0) desfaseDias = atrasoPendiente
  else if (entregaPlan && entregaProyectada) desfaseDias = diasEntre(entregaPlan, entregaProyectada)

  return {
    hoy,
    desde,
    hasta,
    totalDias: desde && hasta ? diasEntre(desde, hasta) + 1 : 0,
    semanas,
    filas,
    kpis: {
      completados,
      total,
      avancePct: total > 0 ? Math.round((completados / total) * 100) : 0,
      entregaPlan,
      entregaProyectada,
      desfaseDias,
    },
  }
}

/** Posición de un tramo en porcentaje del eje. El fin es inclusivo: un día ocupa un día. */
export function posicionTramo(t: Tramo, modelo: Pick<ModeloGantt, 'desde' | 'totalDias'>): { izquierda: number; ancho: number } {
  if (!modelo.desde || modelo.totalDias <= 0) return { izquierda: 0, ancho: 0 }
  const izquierda = (diasEntre(modelo.desde, t.inicio) / modelo.totalDias) * 100
  const ancho = ((diasEntre(t.inicio, t.fin) + 1) / modelo.totalDias) * 100
  return { izquierda, ancho }
}

/** "3 días de atraso", "A tiempo", "2 días adelantado". */
export function textoDesfase(dias: number | null): string {
  if (dias === null) return 'Sin fechas'
  if (dias === 0) return 'A tiempo'
  const n = Math.abs(dias)
  const unidad = n === 1 ? 'día' : 'días'
  return dias > 0 ? `${n} ${unidad} de atraso` : `${n} ${unidad} adelantado`
}

export const ETIQUETA_ESTADO: Record<EstadoPaso, string> = {
  completado: 'Terminado',
  en_curso: 'En curso',
  atrasado: 'Atrasado',
  pendiente: 'Por iniciar',
  sin_fecha: 'Sin fecha',
}
