/**
 * Horas hábiles Colombia — espejo en TypeScript de la función SQL
 * `horas_habiles_entre(start, end)` (migración 20260519000001).
 *
 * ¿Por qué existe un espejo y no se llama al SQL? Porque el cálculo por negocio
 * no tiene hoy una vista ni un RPC que lo exponga: `v_negocios_etapa_vencimiento`
 * es agregada por etapa (COUNT + GROUP BY) y el RPC de perfil comercial está
 * acotado a un responsable. Calcular con `Date` a secas habría dado un número
 * distinto al de `/flujo` y `/equipo` (que descuentan fines de semana y festivos),
 * así que se replica el algoritmo exacto alimentándolo con la MISMA tabla
 * `festivos_colombia`: un solo calendario, una sola verdad.
 *
 * Si alguna vez se toca la función SQL, hay que tocar esta y su test.
 */

const DIA_MS = 86_400_000

/**
 * Algoritmo idéntico al SQL: horas calendario menos 24h por cada día
 * sábado/domingo/festivo en el rango [día(inicio), día(fin)).
 *
 * Los días se truncan en UTC para replicar `date_trunc('day', ts)` con la zona
 * horaria de la instancia Postgres (UTC).
 *
 * @param startIso instante inicial (timestamptz serializado)
 * @param endMs    instante final en epoch ms (un único "ahora" por request)
 * @param festivos fechas 'YYYY-MM-DD' de `festivos_colombia`
 */
export function horasHabilesEntre(startIso: string, endMs: number, festivos: Set<string>): number {
  const startMs = new Date(startIso).getTime()
  if (!Number.isFinite(startMs) || endMs <= startMs) return 0

  const totalHoras = (endMs - startMs) / 3_600_000
  const diaInicio = Math.floor(startMs / DIA_MS) * DIA_MS
  const diaFin = Math.floor(endMs / DIA_MS) * DIA_MS

  let noHabiles = 0
  for (let d = diaInicio; d < diaFin; d += DIA_MS) {
    const fecha = new Date(d)
    const dow = fecha.getUTCDay() // 0 = domingo, 6 = sábado
    if (dow === 0 || dow === 6 || festivos.has(fecha.toISOString().slice(0, 10))) {
      noHabiles += 1
    }
  }

  return Math.max(totalHoras - noHabiles * 24, 0)
}

// ── Jornada hábil declarada ────────────────────────────────────────────────
//
// Espejo en TypeScript de la función SQL `horas_habiles_jornada(...)`
// (migración 20260822000001). Si se toca una, hay que tocar la otra y su test.
//
// ⚠️ NO es lo mismo que `horasHabilesEntre` de arriba, y la diferencia importa:
//
//   · `horasHabilesEntre` resta 24 h por cada día no hábil del rango
//     **[día(inicio), día(fin))** — o sea, NO descuenta el último día. Un viernes
//     12:00 → sábado 12:00 le da 24 h hábiles cuando el sábado no se trabaja.
//     Es la definición que hoy alimenta el SLA de `/flujo` y `/equipo`; cambiarla
//     movería veredictos en esas pantallas y necesita su propia medición.
//   · Esta suma solo lo que cae DENTRO de la jornada de cada día hábil, así que
//     el mismo caso da 12 h. Se estrenó con el bono de operaciones, donde el
//     resultado es dinero y no un badge.
//
// Los días se cortan en **hora de Bogotá** (UTC-5, sin horario de verano), no en
// UTC: a las 7 p.m. de un viernes, UTC ya está en sábado, y ese corrimiento de
// cinco horas mueve el fin de semana entero dentro de una ventana de 72 h.

const OFFSET_BOGOTA_MS = 5 * 60 * 60 * 1000

export interface JornadaHabil {
  /** Hora de Bogotá en que arranca la jornada. 0 = medianoche. */
  inicioHora: number
  /** Hora de Bogotá en que termina. 24 = el día hábil completo. */
  finHora: number
  /** ¿El sábado cuenta como hábil? */
  sabadoHabil: boolean
}

/** El día hábil vale 24 h, como el SLA del resto del producto. Sábado no cuenta. */
export const JORNADA_DIA_COMPLETO: JornadaHabil = {
  inicioHora: 0,
  finHora: 24,
  sabadoHabil: false,
}

/** Número de día calendario en Bogotá (días enteros desde epoch). */
function diaBogota(ms: number): number {
  return Math.floor((ms - OFFSET_BOGOTA_MS) / DIA_MS)
}

/** 'YYYY-MM-DD' del día calendario en Bogotá. */
function isoDeDiaBogota(dia: number): string {
  return new Date(dia * DIA_MS).toISOString().slice(0, 10)
}

function esDiaHabil(dia: number, jornada: JornadaHabil, festivos: Set<string>): boolean {
  const dow = new Date(dia * DIA_MS).getUTCDay() // 0 = domingo, 6 = sábado
  if (dow === 0) return false
  if (dow === 6 && !jornada.sabadoHabil) return false
  return !festivos.has(isoDeDiaBogota(dia))
}

/**
 * Horas de jornada hábil entre dos instantes.
 *
 * Recorre día a día en Bogotá y suma solo el solape con la ventana declarada de
 * los días hábiles. Con la jornada de día completo (0–24) equivale a "horas
 * corridas menos 24 h por cada día no hábil", con el último día ya descontado.
 *
 * @param festivos fechas 'YYYY-MM-DD' de `festivos_colombia`. **Un año sin
 *   sembrar no lanza error: sus festivos cuentan como hábiles**, así que la
 *   cobertura de esa tabla es parte del criterio, no un detalle de datos.
 */
export function horasHabilesEnJornada(
  desdeMs: number,
  hastaMs: number,
  festivos: Set<string>,
  jornada: JornadaHabil = JORNADA_DIA_COMPLETO,
): number {
  if (!Number.isFinite(desdeMs) || !Number.isFinite(hastaMs)) return 0
  if (hastaMs <= desdeMs) return 0
  if (!(jornada.finHora > jornada.inicioHora)) return 0

  let total = 0
  for (let dia = diaBogota(desdeMs); dia <= diaBogota(hastaMs); dia++) {
    if (!esDiaHabil(dia, jornada, festivos)) continue
    const medianocheBogota = dia * DIA_MS + OFFSET_BOGOTA_MS
    const ventanaIni = medianocheBogota + jornada.inicioHora * 3_600_000
    const ventanaFin = medianocheBogota + jornada.finHora * 3_600_000
    const ini = Math.max(desdeMs, ventanaIni)
    const fin = Math.min(hastaMs, ventanaFin)
    if (fin > ini) total += (fin - ini) / 3_600_000
  }
  return total
}

/**
 * SLA en horas hábiles de una etapa (`etapas_negocio.config_extra.sla_horas`).
 * null = la etapa no tiene SLA configurado (la mayoría hoy) → no se evalúa atraso
 * y la UI guarda silencio.
 */
export function slaHorasDeEtapa(configExtra: unknown): number | null {
  const raw = (configExtra as Record<string, unknown> | null)?.sla_horas
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}
