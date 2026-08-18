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
 * Fecha larga capitalizada: "Miércoles, 13 de agosto de 2026".
 *
 * Anclar la zona NO es cosmetico: sin `timeZone` el servidor (Vercel corre en
 * UTC) y el navegador del usuario producen cadenas distintas entre las 19:00 y
 * la medianoche de Colombia, React detecta el texto cambiado al hidratar y
 * aborta con `Minified React error #418`. Usar esto en cualquier componente que
 * pinte "hoy" y se hidrate en el cliente.
 */
export function formatBogotaFechaLarga(d?: Date): string {
  const s = (d ?? new Date()).toLocaleDateString('es-CO', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export type FechaInput = string | number | Date | null | undefined

// 'YYYY-MM-DD', con hora opcional y SIN marca de zona ('Z' o '±HH:MM').
const SIN_ZONA = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/

/**
 * Resuelve que instante hay que pintar y con que zona hay que leerlo.
 *
 * Son dos clases de valor y confundirlas corre la fecha un dia:
 *
 *   - **Instante** (`timestamptz`: '2026-08-13T03:45:00Z', o un `Date`). Es un
 *     punto en el tiempo; para saber que dia fue en Colombia hay que leerlo en
 *     `America/Bogota`. Sin eso, el servidor (UTC) y el navegador pintan dias
 *     distintos entre las 19:00 y la medianoche de Colombia.
 *   - **Fecha civil** (columna `date`: '2026-08-15'). NO es un instante: es un
 *     dia del calendario, y ya viene en el calendario de Colombia. Aqui la
 *     trampa es la contraria — `new Date('2026-08-15')` da medianoche UTC, que
 *     en Bogota son las 19:00 del dia ANTERIOR, asi que leerla en Bogota la
 *     retrocede un dia. Se lee en UTC para devolver los componentes tal cual.
 *
 * Las 31 columnas `date` del schema (`fecha_vencimiento`, `fecha_inicio`,
 * `valid_until`, ...) caen en el segundo caso.
 */
function resolverInstante(value: FechaInput): { d: Date; tz: string } | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') {
    const m = SIN_ZONA.exec(value.trim())
    if (m) {
      const [y, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
      const d = new Date(Date.UTC(y, mes - 1, dia, Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)))
      // `Date.UTC` no valida rangos: desborda en silencio y '2026-13-45' saldria
      // como 14 de febrero de 2027. Se comprueba que los componentes vuelvan
      // iguales, que es lo unico que distingue un desborde de una fecha real.
      const intacta = d.getUTCFullYear() === y && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
      return Number.isNaN(d.getTime()) || !intacta ? null : { d, tz: 'UTC' }
    }
  }
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : { d, tz: TZ }
}

/**
 * Formatea una fecha para un lector en Colombia, con la zona resuelta segun la
 * clase del valor (ver `resolverInstante`). Servidor y navegador producen
 * SIEMPRE la misma cadena, que es lo que evita el `Minified React error #418`.
 *
 * Devuelve `undefined` si el valor esta vacio o no es una fecha valida — nunca
 * la cadena "Invalid Date", que es lo que devuelve `toLocaleDateString` a secas.
 */
export function formatFecha(value: FechaInput, opts: Intl.DateTimeFormatOptions): string | undefined {
  const r = resolverInstante(value)
  if (!r) return undefined
  return r.d.toLocaleString('es-CO', { timeZone: r.tz, ...opts })
}

/** "13 ago" */
export function formatBogotaFechaCorta(value: FechaInput): string | undefined {
  return formatFecha(value, { day: 'numeric', month: 'short' })
}

/** "13 ago 2026" */
export function formatBogotaFechaCortaAno(value: FechaInput): string | undefined {
  return formatFecha(value, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "13 ago 2026, 10:45 a. m." */
export function formatBogotaFechaHora(value: FechaInput): string | undefined {
  return formatFecha(value, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
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
