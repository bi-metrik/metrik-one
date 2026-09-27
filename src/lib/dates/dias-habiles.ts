// Dia habil por pais: la regla de CUANDO puede salir un aviso automatico al cliente.
//
// Decision de Mauricio (2026-09-27): todo aviso automatico al cliente (avisos_cliente,
// recordatorios de cobro, alertas de plazo, bot) sale solo en dia habil del pais del
// cliente. Si el dia en que tocaba no es habil, se corre al siguiente habil: no se
// pierde. Los avisos internos a MeTRIK no cambian.
//
//   - Colombia ('CO'): lunes a viernes menos los festivos CALCULADOS de
//     `festivos-colombia.ts` (espejo de `festivos_colombia_de()` en SQL).
//   - Cualquier otro pais: hoy NO hay calendario de festivos cargado, asi que solo se
//     saltan sabado y domingo. Es una limitacion declarada, no un olvido: el dia que
//     un workspace de otro pais lo necesite, su calendario entra en `FESTIVOS_POR_PAIS`.
//
// ⚠️ Hay una COPIA de este archivo en `supabase/functions/_shared/dias-habiles.ts` (las
// edge functions no alcanzan `src/`). `dias-habiles.test.ts` compara las dos dia por dia:
// si se toca una, la prueba obliga a tocar la otra.
//
// Las fechas son dias civiles 'YYYY-MM-DD'. Que dia es "hoy" lo decide quien llama, con
// `todayBogotaISO()`: la referencia horaria del sistema es Bogota.

import { esHabilColombia } from './festivos-colombia'

/** Pais que se asume cuando el dato no existe o no se puede leer. */
export const PAIS_POR_DEFECTO = 'CO'

/** Paises con calendario de festivos. El resto solo salta fines de semana. */
const FESTIVOS_POR_PAIS: Record<string, (fechaISO: string) => boolean> = {
  CO: (f) => !esHabilColombia(f),
}

const DIA_MS = 86_400_000

/** Codigo ISO-3166 alfa-2 en mayusculas; cualquier otra cosa cae en Colombia. */
export function normalizarPais(pais: string | null | undefined): string {
  const p = (pais ?? '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(p) ? p : PAIS_POR_DEFECTO
}

/** ¿El pais tiene calendario de festivos, o solo se saltan fines de semana? */
export function tieneCalendarioDeFestivos(pais: string | null | undefined): boolean {
  return normalizarPais(pais) in FESTIVOS_POR_PAIS
}

function msDe(fechaISO: string): number {
  return Date.parse(`${fechaISO.slice(0, 10)}T00:00:00Z`)
}

function isoDe(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Dia de la semana ISO: 1 = lunes ... 7 = domingo. */
export function diaSemanaISO(fechaISO: string): number {
  const d = new Date(msDe(fechaISO)).getUTCDay()
  return d === 0 ? 7 : d
}

/** ¿'YYYY-MM-DD' es dia habil en el pais? */
export function esDiaHabil(fechaISO: string, pais?: string | null): boolean {
  const dow = diaSemanaISO(fechaISO)
  if (dow >= 6) return false
  const esFestivo = FESTIVOS_POR_PAIS[normalizarPais(pais)]
  return esFestivo ? !esFestivo(fechaISO.slice(0, 10)) : true
}

/**
 * El primer dia habil en o despues de `fechaISO` (con `incluirMismoDia = false`,
 * estrictamente despues). Es a donde se corre un aviso que caia en dia no habil.
 */
export function siguienteDiaHabil(fechaISO: string, pais?: string | null, incluirMismoDia = true): string {
  let ms = msDe(fechaISO) + (incluirMismoDia ? 0 : DIA_MS)
  // Un tramo de dias no habiles seguidos no pasa de unos pocos (Semana Santa + puente);
  // el tope solo protege de un calendario roto.
  for (let i = 0; i < 31; i++) {
    const f = isoDe(ms)
    if (esDiaHabil(f, pais)) return f
    ms += DIA_MS
  }
  throw new Error(`sin dia habil en 31 dias desde ${fechaISO} (${normalizarPais(pais)})`)
}

/**
 * ¿Un aviso PERIODICO debe salir hoy?
 *
 * `diasProgramados` son los dias de la semana en que el aviso tocaba (ISO: 1 = lunes).
 * Sale hoy si hoy es el primer dia habil en o despues de la ultima fecha programada. O
 * sea: el resumen de los lunes sale el lunes; si el lunes es festivo, sale el martes, y
 * el martes normal no vuelve a salir.
 *
 * El cron que lo invoca tiene que correr TODOS los dias: un cron que solo corre los
 * lunes no tiene martes en el cual correr el aviso del lunes festivo.
 */
export function debeSalirHoy(hoyISO: string, diasProgramados: readonly number[], pais?: string | null): boolean {
  if (diasProgramados.length === 0) return false
  if (!esDiaHabil(hoyISO, pais)) return false
  // La fecha programada mas reciente que no sea posterior a hoy (a lo sumo 6 dias atras).
  let ms = msDe(hoyISO)
  for (let i = 0; i < 7; i++) {
    const f = isoDe(ms)
    if (diasProgramados.includes(diaSemanaISO(f))) return siguienteDiaHabil(f, pais) === hoyISO
    ms -= DIA_MS
  }
  return false
}
