// ⚠️ ESTO ES UNA COPIA. La fuente es `src/lib/dates/dias-habiles.ts` (y los festivos,
// `src/lib/dates/festivos-colombia.ts`): las edge functions se despliegan solas y no
// alcanzan `src/`. `src/lib/dates/dias-habiles.test.ts` compara las dos dia por dia, asi
// que si se toca una sin la otra, la prueba cae.
//
// Regla (decision de Mauricio, 2026-09-27): todo aviso automatico al cliente sale solo
// en dia habil del pais del cliente; si caia en dia no habil, se corre al siguiente
// habil. Colombia usa sus festivos calculados; otro pais sin calendario cargado solo
// salta sabado y domingo. Los avisos internos a MeTRIK no pasan por aqui.

export const PAIS_POR_DEFECTO = 'CO';

const DIA_MS = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function msDe(fechaISO: string): number {
  return Date.parse(`${fechaISO.slice(0, 10)}T00:00:00Z`);
}

/** Domingo de Pascua (Meeus/Jones/Butcher), como epoch ms a medianoche UTC. */
function pascuaMs(anio: number): number {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(anio, mes - 1, dia);
}

/** Ley Emiliani: si no cae lunes, pasa al lunes siguiente. */
function lunes(ms: number): number {
  const dow = new Date(ms).getUTCDay();
  return ms + ((8 - dow) % 7) * DIA_MS;
}

const cacheFestivos = new Map<number, Set<string>>();

/** Fechas festivas de Colombia del anio (Ley 51 de 1983 + Pascua). */
export function festivosColombia(anio: number): Set<string> {
  const hit = cacheFestivos.get(anio);
  if (hit) return hit;
  const p = pascuaMs(anio);
  const d = (mes: number, dia: number) => Date.UTC(anio, mes - 1, dia);
  const fechas = new Set([
    d(1, 1), lunes(d(1, 6)), lunes(d(3, 19)), p - 3 * DIA_MS, p - 2 * DIA_MS, d(5, 1),
    lunes(p + 39 * DIA_MS), lunes(p + 60 * DIA_MS), lunes(p + 68 * DIA_MS), lunes(d(6, 29)),
    d(7, 20), d(8, 7), lunes(d(8, 15)), lunes(d(10, 12)), lunes(d(11, 1)), lunes(d(11, 11)),
    d(12, 8), d(12, 25),
  ].map(iso));
  cacheFestivos.set(anio, fechas);
  return fechas;
}

const FESTIVOS_POR_PAIS: Record<string, (fechaISO: string) => boolean> = {
  CO: (f) => festivosColombia(Number(f.slice(0, 4))).has(f),
};

/** Codigo ISO-3166 alfa-2 en mayusculas; cualquier otra cosa cae en Colombia. */
export function normalizarPais(pais: string | null | undefined): string {
  const p = (pais ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(p) ? p : PAIS_POR_DEFECTO;
}

/** ¿El pais tiene calendario de festivos, o solo se saltan fines de semana? */
export function tieneCalendarioDeFestivos(pais: string | null | undefined): boolean {
  return normalizarPais(pais) in FESTIVOS_POR_PAIS;
}

/** Dia de la semana ISO: 1 = lunes ... 7 = domingo. */
export function diaSemanaISO(fechaISO: string): number {
  const d = new Date(msDe(fechaISO)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** ¿'YYYY-MM-DD' es dia habil en el pais? */
export function esDiaHabil(fechaISO: string, pais?: string | null): boolean {
  if (diaSemanaISO(fechaISO) >= 6) return false;
  const esFestivo = FESTIVOS_POR_PAIS[normalizarPais(pais)];
  return esFestivo ? !esFestivo(fechaISO.slice(0, 10)) : true;
}

/** El primer dia habil en o despues de `fechaISO` (o estrictamente despues). */
export function siguienteDiaHabil(fechaISO: string, pais?: string | null, incluirMismoDia = true): string {
  let ms = msDe(fechaISO) + (incluirMismoDia ? 0 : DIA_MS);
  for (let i = 0; i < 31; i++) {
    const f = iso(ms);
    if (esDiaHabil(f, pais)) return f;
    ms += DIA_MS;
  }
  throw new Error(`sin dia habil en 31 dias desde ${fechaISO} (${normalizarPais(pais)})`);
}

/**
 * ¿Un aviso periodico (dias ISO de la semana en `diasProgramados`) debe salir hoy? Sale
 * el primer dia habil en o despues de su ultima fecha programada. El cron que lo invoca
 * tiene que correr todos los dias.
 */
export function debeSalirHoy(hoyISO: string, diasProgramados: readonly number[], pais?: string | null): boolean {
  if (diasProgramados.length === 0) return false;
  if (!esDiaHabil(hoyISO, pais)) return false;
  let ms = msDe(hoyISO);
  for (let i = 0; i < 7; i++) {
    const f = iso(ms);
    if (diasProgramados.includes(diaSemanaISO(f))) return siguienteDiaHabil(f, pais) === hoyISO;
    ms -= DIA_MS;
  }
  return false;
}

// Las edge functions usan el cliente sin el generico `Database`.
// deno-lint-ignore no-explicit-any
type Supabase = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const cachePais = new Map<string, string>();

/**
 * El pais del workspace (`workspaces.pais`). Si la columna no existe todavia o la lectura
 * falla, Colombia: es el pais de todos los workspaces de hoy, y frenar un aviso por no
 * poder leer el pais seria peor que mandarlo con el calendario colombiano.
 */
export async function paisDelWorkspace(supabase: Supabase, workspaceId: string | null | undefined): Promise<string> {
  if (!workspaceId) return PAIS_POR_DEFECTO;
  const hit = cachePais.get(workspaceId);
  if (hit) return hit;
  const { data, error } = await supabase.from('workspaces').select('pais').eq('id', workspaceId).maybeSingle();
  if (error) {
    console.error(`[dias-habiles] no se pudo leer el pais de ${workspaceId}, se asume ${PAIS_POR_DEFECTO}:`, error.message);
    return PAIS_POR_DEFECTO;
  }
  const pais = normalizarPais((data as { pais?: string | null } | null)?.pais);
  cachePais.set(workspaceId, pais);
  return pais;
}
