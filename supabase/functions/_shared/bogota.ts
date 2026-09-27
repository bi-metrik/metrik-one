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

/**
 * Rango [desde, hasta) del mes de Bogota, para filtrar columnas `date`:
 * `.gte('fecha', desde).lt('fecha', hasta)`. El 30-sep a las 20:00 sigue siendo
 * septiembre; con `new Date().getMonth()` en UTC ya era octubre.
 */
export function bogotaRangoMes(d?: Date): { desde: string; hasta: string } {
  const { year, month } = bogotaParts(d);
  const sigAnio = month === 12 ? year + 1 : year;
  const sigMes = month === 12 ? 1 : month + 1;
  return { desde: `${year}-${pad(month)}-01`, hasta: `${sigAnio}-${pad(sigMes)}-01` };
}

/**
 * Dias de calendario entre un dia civil ('YYYY-MM-DD') y hoy en Bogota. Para columnas
 * `date` ("hace 3 dias"): contar horas desde la medianoche UTC sumaba un dia desde las
 * 19:00 de Bogota.
 */
export function diasCalendarioDesde(fechaISO: string, d?: Date): number {
  const [y, m, dd] = fechaISO.slice(0, 10).split('-').map(Number);
  const hoy = bogotaParts(d);
  return Math.round((Date.UTC(hoy.year, hoy.month - 1, hoy.day) - Date.UTC(y, m - 1, dd)) / 86_400_000);
}

/** Dias que tiene el mes (1-12) del anio. */
export function diasDelMes(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
