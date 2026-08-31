/**
 * R2 — periodicidad de revalidación por nivel de riesgo.
 *
 * Qué resuelve: hoy una consulta contra listas restrictivas no dice cuándo hay
 * que repetirla. La debida diligencia continua se asume, no se mide, y por eso
 * nadie sabe cuántas contrapartes vinculadas llevan más de un año sin mirar.
 *
 * ── De quién es cada decisión ─────────────────────────────────────────────
 *
 * El cuadro de la oficial de cumplimiento (sin reporte 12 meses, riesgo medio 6,
 * alto 3, PEP 6) **no tiene fuente normativa verificada**: es criterio suyo
 * (dictamen Lucía 2026-08-24). Y el efecto de cada categoría sobre el flujo
 * interno es parámetro del obligado, no afirmación de MéTRIK (concepto Emilio
 * 2026-08-31, §1.2).
 *
 * Consecuencia de diseño, no cosmética: aquí NO hay una tabla de meses. Los
 * meses viven en `compliance_periodicidad_config`, por workspace y editables. Lo
 * que vive acá es la regla de CÓMO se aplica esa configuración, que sí es
 * nuestra y sí tiene que ser la misma para todos.
 *
 * ── La regla, y por qué es el mínimo y no el máximo ───────────────────────
 *
 * La vigencia de una consulta es la del nivel MÁS EXIGENTE presente, o sea el
 * de menos meses, no la del tier máximo.
 *
 * Parece lo mismo y no lo es. `tierMaximo` está ordenado por precedencia
 * jurídica; la periodicidad la fija el cliente y puede configurar cualquier
 * número en cualquier nivel. Si un workspace pusiera medios en 1 mes y tier_2 en
 * 6, leer el tier máximo daría 6 meses y dejaría sin mirar durante cinco meses
 * algo que el propio oficial pidió revisar cada mes. Tomar el mínimo hace que la
 * regla no dependa de que la configuración sea coherente con la precedencia.
 *
 * ⚠️ Ninguna de estas frecuencias puede presentarse como "exigido por norma".
 * Ver `cerebro/reglas/cautela-afirmacion-marco-normativo.md`.
 *
 * Vive fuera de los archivos `'use server'` porque esos solo pueden exportar
 * funciones async, y porque la regla tiene que poder probarse sin base de datos.
 */

import { sumarMesesISO } from './liberaciones';
import type { TierResuelto } from './tier-fuentes';

// ─── Vocabulario ───────────────────────────────────────────────────────────

/** Los niveles configurables: los tiers del catálogo más la consulta limpia. */
export type NivelPeriodicidad = 'sin_hallazgo' | TierResuelto;

export const NIVELES: readonly NivelPeriodicidad[] = [
  'sin_hallazgo',
  'tier_1',
  'tier_2',
  'tier_3',
  'tier_4',
  'medios',
  'sin_clasificar',
];

/**
 * Cómo se le presenta cada nivel al oficial. Descriptivo, nunca normativo: dice
 * QUÉ es la fuente, no qué obliga.
 */
export const NIVEL_LABEL: Readonly<Record<NivelPeriodicidad, string>> = {
  sin_hallazgo: 'Sin hallazgo',
  tier_1: 'Lista vinculante',
  tier_2: 'Sanción extranjera',
  tier_3: 'PEP',
  tier_4: 'Otras fuentes oficiales',
  medios: 'Mención en medios',
  sin_clasificar: 'Fuente no clasificada',
};

export const NIVEL_AYUDA: Readonly<Record<NivelPeriodicidad, string>> = {
  sin_hallazgo: 'La consulta no encontró nada. Es la revalidación de rutina.',
  tier_1: 'Consejo de Seguridad de la ONU y equivalentes.',
  tier_2: 'OFAC, Unión Europea y similares. No son vinculantes en Colombia por sí solas.',
  tier_3: 'Persona expuesta políticamente.',
  tier_4: 'Fuentes oficiales que no imponen prohibición de contratar.',
  medios: 'Noticias y prensa. Una mención no es una sanción.',
  sin_clasificar: 'El catálogo no reconoce la fuente. Se revisa con la frecuencia más corta.',
};

/**
 * El default SUGERIDO cuando un workspace todavía no configuró nada. Es el
 * cuadro que dictó la oficial de cumplimiento, traducido a los tiers.
 *
 * Es sugerencia, no política: se siembra para que el oficial lo vea y lo cambie,
 * y la pantalla dice de dónde salió. `sin_clasificar` va al valor más corto
 * porque no sabemos qué es la fuente, y ante esa duda el lado correcto es el que
 * exige más (C4 del concepto de Emilio).
 */
export const DEFAULT_SUGERIDO: Readonly<Record<NivelPeriodicidad, number>> = {
  sin_hallazgo: 12,
  tier_1: 3,
  tier_2: 3,
  tier_3: 6,
  tier_4: 6,
  medios: 12,
  sin_clasificar: 3,
};

export const MESES_MIN = 1;
export const MESES_MAX = 60;

export type ConfigPeriodicidad = Readonly<Partial<Record<NivelPeriodicidad, number>>>;

// ─── La regla ──────────────────────────────────────────────────────────────

export type VigenciaCalculada = {
  /** null cuando no se pudo determinar (sin config para ningún nivel presente). */
  vigente_hasta: string | null;
  meses: number | null;
  /** El nivel que ganó: el más exigente presente, no el tier máximo. */
  nivel: NivelPeriodicidad | null;
};

const SIN_VIGENCIA: VigenciaCalculada = { vigente_hasta: null, meses: null, nivel: null };

/**
 * Calcula hasta cuándo cubre una consulta.
 *
 * `tiersPresentes` son TODOS los tiers que trajo la consulta, no solo el máximo.
 * Vacío significa que no hubo coincidencias, y entonces aplica `sin_hallazgo`.
 *
 * `catalogoOpera` es la bandera de C2: con el catálogo sin firma jurídica no
 * sabemos con qué autoridad clasificamos, así que la vigencia se calcula con el
 * nivel más corto de toda la configuración. No se deja sin vigencia: eso sacaría
 * a la contraparte del barrido, que es lo contrario de lo que exige la duda.
 */
export function calcularVigencia(
  desdeISO: string,
  tiersPresentes: readonly TierResuelto[],
  config: ConfigPeriodicidad,
  catalogoOpera: boolean,
): VigenciaCalculada {
  const candidatos: NivelPeriodicidad[] = !catalogoOpera
    ? [...NIVELES]
    : tiersPresentes.length === 0
      ? ['sin_hallazgo']
      : [...tiersPresentes];

  let ganador: NivelPeriodicidad | null = null;
  let minimo: number | null = null;

  for (const nivel of candidatos) {
    const meses = config[nivel];
    if (typeof meses !== 'number' || !Number.isFinite(meses)) continue;
    if (minimo === null || meses < minimo) {
      minimo = meses;
      ganador = nivel;
    }
  }

  if (minimo === null || ganador === null) return SIN_VIGENCIA;

  return {
    vigente_hasta: sumarMesesISO(desdeISO, minimo),
    meses: minimo,
    nivel: ganador,
  };
}

// ─── Estado de vigencia ────────────────────────────────────────────────────

export type EstadoVigencia = 'vigente' | 'por_vencer' | 'vencida' | 'sin_vigencia';

/**
 * Días antes del vencimiento en que una consulta entra en "por vencer".
 *
 * 30 días no sale de ninguna norma: es el aviso que le da al oficial tiempo de
 * programar el barrido antes de quedar en incumplimiento de su propia política.
 * Si algún día tiene que ser configurable, se mueve a la misma tabla.
 */
export const DIAS_AVISO_VENCIMIENTO = 30;

export function estadoDeVigencia(
  vigenteHasta: string | null | undefined,
  hoyISO: string,
  diasAviso: number = DIAS_AVISO_VENCIMIENTO,
): EstadoVigencia {
  if (!vigenteHasta) return 'sin_vigencia';
  // Comparación lexicográfica de `YYYY-MM-DD`: coincide con la cronológica, así
  // que no hay que construir Dates ni arrastrar zona horaria.
  if (vigenteHasta < hoyISO) return 'vencida';
  const aviso = sumarDiasISO(hoyISO, diasAviso);
  return vigenteHasta <= aviso ? 'por_vencer' : 'vigente';
}

export const ESTADO_VIGENCIA_LABEL: Readonly<Record<EstadoVigencia, string>> = {
  vigente: 'Vigente',
  por_vencer: 'Por vencer',
  vencida: 'Vencida',
  sin_vigencia: 'Sin vigencia',
};

/**
 * Suma días a una fecha civil sin pasar por `Date`.
 *
 * Con `new Date(iso)` esto se calcula en UTC y en Bogotá (UTC-5) el resultado se
 * corre un día; es el mismo error que documenta `src/lib/dates/bogota.ts`.
 */
export function sumarDiasISO(fechaISO: string, dias: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO);
  if (!m) throw new Error(`fecha_invalida: ${fechaISO}`);
  let anio = Number(m[1]);
  let mes = Number(m[2]);
  let dia = Number(m[3]) + dias;

  for (;;) {
    const enElMes = diasDelMes(anio, mes);
    if (dia <= enElMes) break;
    dia -= enElMes;
    mes += 1;
    if (mes > 12) { mes = 1; anio += 1; }
  }
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function diasDelMes(anio: number, mes: number): number {
  if (mes === 2) {
    const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
    return bisiesto ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

// ─── Validación de la configuración ────────────────────────────────────────

/** Devuelve el código de error, o null si el valor sirve. */
export function validarMeses(valor: unknown): string | null {
  const n = typeof valor === 'string' ? Number(valor.trim()) : valor;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'meses_no_numerico';
  if (!Number.isInteger(n)) return 'meses_no_entero';
  if (n < MESES_MIN) return `meses_minimo_${MESES_MIN}`;
  if (n > MESES_MAX) return `meses_maximo_${MESES_MAX}`;
  return null;
}

export function esNivel(v: unknown): v is NivelPeriodicidad {
  return typeof v === 'string' && (NIVELES as readonly string[]).includes(v);
}
