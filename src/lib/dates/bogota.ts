// Helpers de fecha en zona horaria Colombia (America/Bogota, UTC-5).
//
// Por que existe este archivo:
//   Vercel ejecuta en UTC. Colombia es UTC-5 sin DST. Despues de las 19:00
//   Bogota (= 00:00 UTC del dia siguiente), `new Date().toISOString()` da el
//   dia calendario siguiente, lo que rompe consecutivos anuales, nombres de
//   archivo, fechas de emision de documentos y registros tipo `DATE` que
//   representan dias civiles en Bogota.
//
// Reglas:
//   - Cualquier columna DATE (sin hora) que represente "el dia en que paso X"
//     debe usar `todayBogotaISO()` en lugar de `new Date().toISOString().split('T')[0]`.
//   - Cualquier display de "Hoy" para el usuario o consecutivo anual debe
//     usar `bogotaYear()` / `formatBogotaEs()` / `bogotaYearMonth()`.
//   - NO usar este helper para columnas `timestamptz` (`created_at`, `updated_at`,
//     etc.) — esas se guardan en UTC con `new Date().toISOString()` puro.
//   - NO usar para math interno de `Date.now() + ms` ni para defaults de inputs
//     `<input type="date">` en client components (corren en el browser del usuario).

export const TZ = 'America/Bogota'

const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const

export interface BogotaParts {
  year: number
  month: number  // 1-12
  day: number    // 1-31
  hour: number   // 0-23
  minute: number // 0-59
  second: number // 0-59
}

function partsOf(d: Date = new Date()): BogotaParts {
  // Intl.DateTimeFormat con timeZone proyecta el instante al calendario Bogota.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  // 'en-CA' con hour12:false puede emitir hour='24' a medianoche — normalizar a 0.
  const hourRaw = Number(map.hour ?? '0')
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: Number(map.minute ?? '0'),
    second: Number(map.second ?? '0'),
  }
}

/** Componentes de fecha/hora del instante `d` proyectado a Bogota. */
export function bogotaParts(d?: Date): BogotaParts {
  return partsOf(d ?? new Date())
}

/** 'YYYY-MM-DD' del dia en Bogota correspondiente a `d` (default: ahora). */
export function todayBogotaISO(d?: Date): string {
  const p = partsOf(d ?? new Date())
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Ano calendario en Bogota — util para consecutivos COT-YYYY-XXX. */
export function bogotaYear(d?: Date): number {
  return partsOf(d ?? new Date()).year
}

/** 'YYYY-MM' del mes en Bogota — util para selectores de mes. */
export function bogotaYearMonth(d?: Date): string {
  const p = partsOf(d ?? new Date())
  return `${p.year}-${String(p.month).padStart(2, '0')}`
}

/** Fecha humana en espanol: "12 de mayo de 2026". */
export function formatBogotaEs(d?: Date): string {
  const p = partsOf(d ?? new Date())
  return `${p.day} de ${MESES_ES[p.month - 1]} de ${p.year}`
}

/**
 * ISO timestamp con offset explicito de Bogota: '2026-05-12T19:00:00-05:00'.
 * Util cuando se necesita persistir un instante "local" sin que se reinterprete
 * como UTC. Si solo necesitas el dia, usa `todayBogotaISO()`.
 */
export function nowBogotaTimestamp(d?: Date): string {
  const p = partsOf(d ?? new Date())
  const yyyy = String(p.year)
  const mm = String(p.month).padStart(2, '0')
  const dd = String(p.day).padStart(2, '0')
  const hh = String(p.hour).padStart(2, '0')
  const mi = String(p.minute).padStart(2, '0')
  const ss = String(p.second).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-05:00`
}
