// ⚠️ ESTO ES UNA COPIA, recortada. La fuente es `src/lib/dates/bogota.ts`: las edge
// functions se despliegan solas y no alcanzan `src/`. Si cambia alla, cambia aca.
//
// Vercel y Deno corren en UTC; Colombia es UTC-5 sin horario de verano. Entre las
// 19:00 y la medianoche de Bogota, `new Date().getDate()` / `toISOString()` ya dan
// el dia siguiente. Todo "hoy", "este mes" o "dia del mes" va por aqui.

export const TZ = 'America/Bogota';

export interface BogotaParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function bogotaParts(d: Date = new Date()): BogotaParts {
  const map: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' del dia en Bogota. */
export function todayBogotaISO(d?: Date): string {
  const p = bogotaParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 'YYYY-MM' del mes en Bogota. */
export function bogotaYearMonth(d?: Date): string {
  const p = bogotaParts(d);
  return `${p.year}-${pad(p.month)}`;
}

/** Dias que tiene el mes (1-12) del anio. */
export function diasDelMes(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
