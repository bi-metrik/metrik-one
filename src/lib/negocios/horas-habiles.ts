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
