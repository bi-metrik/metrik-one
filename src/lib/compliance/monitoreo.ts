/**
 * R3 — Motor de monitoreo recurrente: a quién se re-consulta, cuánto cuesta y
 * qué hace un cambio cuando aparece.
 *
 * Fuentes de la regla, todas verificables:
 *   - `proyectos/afi/alma/docs/entrada/2026-08-18_requerimientos-cierre.md`, R3
 *     (las cuatro poblaciones, el dictamen de Lucía del 2026-08-24 y la tabla
 *     "Qué dispara el barrido — y qué cuesta").
 *   - `proyectos/afi/alma/docs/entrada/2026-08-31_concepto-emilio-enrutamiento-tier.md`,
 *     §3 (horizonte finito para *Rechazadas*) y C10 (quién notifica y quién no).
 *
 * Las tres cosas que este archivo decide, y que no pueden vivir en el cron:
 *
 *   1. **Quién entra al barrido.** Solo las tres etiquetas de reposo. Las dos
 *      que exigen acción humana cuestan cero: un represamiento del oficial no
 *      se traduce en factura. Esa regla ya estaba escrita en `bandeja.ts`
 *      (`consumeCuotaDeReconsulta`) y acá se aplica, no se reescribe.
 *   2. **Cuánto se gasta.** El tope por periodo es del obligado, no nuestro, y
 *      sin tope adoptado el motor no consume: corre en simulación. Preferir un
 *      número por defecto sería elegir por el cliente cuánto le facturan.
 *   3. **Qué significa un cambio.** Para *Excepciones vigentes* un delta rompe
 *      la premisa sobre la que el oficial firmó y vuelve a pedirle decisión.
 *      Para *Rechazadas* un cambio NO puede alertar sobre la persona: su única
 *      salida legítima es habilitar la re-evaluación (fallo de Emilio, §3).
 *
 * Módulo puro, sin base de datos y sin reloj: `hoyISO` se recibe. Mismo criterio
 * que `liberaciones.ts`, `bandeja.ts` y `periodicidad.ts`.
 */

import type { EtiquetaBandeja } from './bandeja';
import { consumeCuotaDeReconsulta } from './bandeja';
import { sumarMesesISO } from './liberaciones';
import type { TierResuelto } from './tier-fuentes';
import { tierMasAlto } from './tier-fuentes';

// ─── Configuración del obligado ────────────────────────────────────────────

/**
 * Las dos perillas del motor. Ninguna es constante de código:
 *
 *   - `cupo_periodo` es plata del cliente. `null` = no adoptado todavía.
 *   - `horizonte_rechazadas_meses` es el límite que fijó Emilio (§3.i): pasado
 *     ese plazo desde el rechazo, la contraparte sale del barrido. No hay
 *     número normativo que citar, así que nace como criterio a adoptar.
 */
export type ConfigMonitoreo = {
  cupo_periodo: number | null;
  horizonte_rechazadas_meses: number;
};

/**
 * Sugerido, no norma. Se muestra rotulado como criterio para que el oficial lo
 * adopte o lo cambie — mismo patrón que el cuadro 12/6/3 de R2.
 */
export const DEFAULT_HORIZONTE_RECHAZADAS_MESES = 12;

export const CUPO_MIN = 1;
export const CUPO_MAX = 100_000;
export const HORIZONTE_MIN = 1;
export const HORIZONTE_MAX = 120;

export type ModoBarrido = 'simulacion' | 'ejecucion';

/**
 * El tope es "no opcional" en el alcance de R3. La lectura fuerte de eso no es
 * inventar un default: es que **sin tope adoptado no se gasta**. El barrido
 * corre igual, selecciona igual y deja su fila igual, pero no llama a la fuente.
 * Así la decisión pendiente queda visible en pantalla en vez de resolverse sola
 * contra la cuenta de alguien.
 */
export function modoDelBarrido(config: ConfigMonitoreo | null | undefined): ModoBarrido {
  return typeof config?.cupo_periodo === 'number' && config.cupo_periodo > 0
    ? 'ejecucion'
    : 'simulacion';
}

// ─── Selección ─────────────────────────────────────────────────────────────

/** Lo mínimo que hay que saber de una contraparte para decidir si se barre. */
export type CandidatoMonitoreo = {
  /** `claveContraparte()` — documento cuando lo hay, si no el nombre normalizado. */
  clave: string;
  etiqueta: EtiquetaBandeja;
  /** Hasta cuándo cubre la última consulta (R2). `null` en las anteriores a R2. */
  vigente_hasta: string | null;
  /**
   * Día civil de la decisión que produjo la etiqueta *Rechazadas*. Solo se mira
   * en esa etiqueta; en las demás es irrelevante y puede venir null.
   */
  decidida_en: string | null;
};

export type MotivoBarrido =
  /** Cumplió `vigente_hasta`: es exactamente la periodicidad de R2. */
  | 'vigencia_vencida'
  /**
   * Consulta anterior a R2: nunca se le calculó vigencia. Entra igual, porque
   * no poder probar que está cubierta no es lo mismo que estarlo.
   */
  | 'sin_vigencia';

export type MotivoExclusion =
  /** Cola de trabajo o alarma: se apaga decidiendo, no consultando. */
  | 'exige_accion'
  /** Ya está cubierta. Es la deduplicación que pidió Yessica, sin tabla extra. */
  | 'vigencia_corriendo'
  /** *Rechazadas* que agotó el horizonte del §3. Sale del barrido, no vuelve. */
  | 'horizonte_agotado';

export type Evaluacion =
  | { barrer: true; motivo: MotivoBarrido }
  | { barrer: false; motivo: MotivoExclusion };

/**
 * ¿Entra esta contraparte al barrido de hoy?
 *
 * El orden de las tres guardas importa y no es estético:
 *
 *   1. Primero la etiqueta. Si exige acción humana, no se consulta ni aunque
 *      esté vencidísima. Es la regla de costo.
 *   2. Después el horizonte de *Rechazadas*. Una rechazada con el horizonte
 *      agotado sale aunque su vigencia haya caducado: el permiso para seguir
 *      mirándola se acabó antes que la vigencia de la consulta.
 *   3. De último la vigencia, que es lo que efectivamente dispara.
 *
 * Invertir 2 y 3 dejaría a las rechazadas viejas entrando al barrido para
 * siempre, que es justo lo que el fallo de Emilio prohíbe.
 */
export function evaluarCandidato(
  c: CandidatoMonitoreo,
  hoyISO: string,
  config: ConfigMonitoreo,
): Evaluacion {
  if (!consumeCuotaDeReconsulta(c.etiqueta)) {
    return { barrer: false, motivo: 'exige_accion' };
  }

  if (c.etiqueta === 'rechazadas' && horizonteAgotado(c.decidida_en, hoyISO, config)) {
    return { barrer: false, motivo: 'horizonte_agotado' };
  }

  if (c.vigente_hasta === null) return { barrer: true, motivo: 'sin_vigencia' };
  if (c.vigente_hasta >= hoyISO) return { barrer: false, motivo: 'vigencia_corriendo' };
  return { barrer: true, motivo: 'vigencia_vencida' };
}

/**
 * Horizonte finito del §3 de Emilio, contado desde la decisión de rechazo.
 *
 * Una rechazada **sin fecha de decisión** se trata como agotada, no como
 * eterna. Es el lado conservador: si no podemos probar cuándo empezó el plazo,
 * no podemos sostener que sigue corriendo, y seguir consultando a alguien que
 * ya no es contraparte es tratamiento después de agotada la finalidad.
 */
export function horizonteAgotado(
  decididaEnISO: string | null,
  hoyISO: string,
  config: ConfigMonitoreo,
): boolean {
  if (!decididaEnISO) return true;
  const dia = decididaEnISO.slice(0, 10);
  const limite = sumarMesesISO(dia, config.horizonte_rechazadas_meses);
  return limite < hoyISO;
}

// ─── Tope de consumo ───────────────────────────────────────────────────────

/**
 * Orden en que se gasta el cupo cuando no alcanza para todos.
 *
 * *Excepciones vigentes* primero porque es riesgo asumido y firmado: es la
 * población donde un cambio invalida una decisión que ya se tomó.
 * *Vigilancia continua* después, que es la obligación de consulta permanente.
 * *Rechazadas* de última: su barrido no protege a nadie hoy, solo permite
 * levantar un rechazo más adelante.
 */
const PRIORIDAD: readonly EtiquetaBandeja[] = [
  'excepciones_vigentes',
  'vigilancia_continua',
  'rechazadas',
];

const RANGO_PRIORIDAD: ReadonlyMap<EtiquetaBandeja, number> = new Map(
  PRIORIDAD.map((e, i) => [e, i] as const),
);

export type Seleccionado = CandidatoMonitoreo & { motivo: MotivoBarrido };

export type Corte = {
  ejecutar: readonly Seleccionado[];
  diferidos: readonly Seleccionado[];
  /** true cuando el tope dejó gente afuera. Se registra, nunca se calla. */
  corte_por_tope: boolean;
};

/**
 * Ordena por prioridad y corta en el cupo.
 *
 * Dentro de cada etiqueta gana el más atrasado: `sin_vigencia` antes que
 * `vigencia_vencida` (nunca se le pudo probar cobertura), y entre vencidas la
 * de fecha más vieja. El desempate final por `clave` existe para que dos
 * corridas con los mismos datos produzcan el mismo corte — un tope que reparte
 * distinto cada noche es un tope que nadie puede auditar.
 */
export function aplicarTope(
  seleccionados: readonly Seleccionado[],
  cupoDisponible: number,
): Corte {
  const ordenados = [...seleccionados].sort(compararPrioridad);
  const cupo = Math.max(0, Math.floor(cupoDisponible));
  return {
    ejecutar: ordenados.slice(0, cupo),
    diferidos: ordenados.slice(cupo),
    corte_por_tope: ordenados.length > cupo,
  };
}

function compararPrioridad(a: Seleccionado, b: Seleccionado): number {
  const ra = RANGO_PRIORIDAD.get(a.etiqueta) ?? PRIORIDAD.length;
  const rb = RANGO_PRIORIDAD.get(b.etiqueta) ?? PRIORIDAD.length;
  if (ra !== rb) return ra - rb;

  const sa = a.motivo === 'sin_vigencia' ? 0 : 1;
  const sb = b.motivo === 'sin_vigencia' ? 0 : 1;
  if (sa !== sb) return sa - sb;

  const va = a.vigente_hasta ?? '';
  const vb = b.vigente_hasta ?? '';
  if (va !== vb) return va < vb ? -1 : 1;

  return a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0;
}

/** Lo que queda del cupo del periodo. Nunca negativo. */
export function cupoRestante(config: ConfigMonitoreo, consumidasEnPeriodo: number): number {
  if (typeof config.cupo_periodo !== 'number') return 0;
  return Math.max(0, config.cupo_periodo - Math.max(0, consumidasEnPeriodo));
}

// ─── Delta ─────────────────────────────────────────────────────────────────

/** La foto de una consulta que hace falta para compararla con otra. */
export type FotoConsulta = {
  total_matches: number;
  /** Nombres de lista tal como los devuelve la fuente. Se normalizan acá. */
  fuentes: readonly (string | null | undefined)[];
  tier_maximo: TierResuelto | null;
};

export type Delta = {
  /** ¿Cambió algo que le importe al oficial? */
  hay: boolean;
  matches_antes: number;
  matches_ahora: number;
  /** Listas que no estaban antes. Un cambio de fuente a igual conteo también cuenta. */
  fuentes_nuevas: readonly string[];
  /** Pasó de limpia a reportada. */
  aparecio_hallazgo: boolean;
  /** El tier máximo se volvió más exigente. */
  tier_subio: boolean;
  /**
   * Estaba reportada y ya no lo está. NO es un delta que alerte: es la única
   * señal que le sirve a *Rechazadas* para saber si subsiste la causa.
   */
  desaparecio_hallazgo: boolean;
};

/**
 * Compara la consulta nueva contra la anterior.
 *
 * Qué cuenta como cambio, y por qué no es simplemente `total_matches !== antes`:
 *
 *   - **Más coincidencias** sí: es literal lo que describió Yessica —"tenía 10
 *     y ahora tiene 20"— y es lo que invalida una decisión ya tomada.
 *   - **Menos coincidencias** no. Una decisión tomada sobre 10 reportes sigue
 *     cubriendo 5. Tratarlo como delta llenaría la cola de trabajo del oficial
 *     de casos donde el riesgo bajó.
 *   - **Fuente nueva** sí, aunque el conteo no se mueva: que salga de una lista
 *     y entre a otra distinta cambia el hecho, no solo su tamaño.
 *   - **Tier más alto** sí, por la misma razón: la exigencia se predica de la
 *     lista. Se compara con `tierMasAlto()` para no reimplementar la
 *     precedencia jurídica en dos lados.
 */
export function compararConsultas(anterior: FotoConsulta, nueva: FotoConsulta): Delta {
  const antes = normalizarFuentes(anterior.fuentes);
  const ahora = normalizarFuentes(nueva.fuentes);
  const fuentes_nuevas = [...ahora].filter((f) => !antes.has(f)).sort();

  const aparecio_hallazgo = anterior.total_matches === 0 && nueva.total_matches > 0;
  const desaparecio_hallazgo = anterior.total_matches > 0 && nueva.total_matches === 0;
  const tier_subio = subioElTier(anterior.tier_maximo, nueva.tier_maximo);
  const subioConteo = nueva.total_matches > anterior.total_matches;

  return {
    hay: subioConteo || fuentes_nuevas.length > 0 || aparecio_hallazgo || tier_subio,
    matches_antes: anterior.total_matches,
    matches_ahora: nueva.total_matches,
    fuentes_nuevas,
    aparecio_hallazgo,
    tier_subio,
    desaparecio_hallazgo,
  };
}

function normalizarFuentes(fuentes: readonly (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const f of fuentes) {
    const limpio = (f ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (limpio) out.add(limpio);
  }
  return out;
}

function subioElTier(antes: TierResuelto | null, ahora: TierResuelto | null): boolean {
  if (!ahora) return false;
  if (!antes) return true;
  if (antes === ahora) return false;
  return tierMasAlto(antes, ahora) === ahora;
}

// ─── Qué hace el cambio ────────────────────────────────────────────────────

export type EfectoDelta = {
  /**
   * Campanita. Solo *Excepciones vigentes*: es donde Yessica la pidió y donde
   * hay una firma sobre un supuesto que cambió (C10).
   */
  notifica: boolean;
  /**
   * La premisa sobre la que el oficial liberó dejó de ser cierta. Devuelve la
   * contraparte a *Hallazgos sin decidir* — no crea estado nuevo, se deriva.
   */
  premisa_cambiada: boolean;
  /**
   * *Rechazadas* únicamente. Marca que dejó de estar reportada y que la
   * decisión puede volver a mirarse. **No notifica y no alerta sobre la
   * persona**: es el límite (iii) del fallo de Emilio, y romperlo por la vía de
   * la bandeja es exactamente el riesgo que el concepto señala.
   */
  habilita_reevaluacion: boolean;
};

const SIN_EFECTO: EfectoDelta = {
  notifica: false,
  premisa_cambiada: false,
  habilita_reevaluacion: false,
};

export function efectoDeDelta(etiqueta: EtiquetaBandeja, delta: Delta): EfectoDelta {
  switch (etiqueta) {
    case 'excepciones_vigentes':
      return delta.hay
        ? { notifica: true, premisa_cambiada: true, habilita_reevaluacion: false }
        : SIN_EFECTO;

    case 'rechazadas':
      // Ni siquiera cuando `delta.hay` es true. Un rechazo con más reportes no
      // le sirve a nadie: la persona ya no contrata con el obligado y avisarlo
      // sería vigilancia sobre ella.
      return delta.desaparecio_hallazgo
        ? { notifica: false, premisa_cambiada: false, habilita_reevaluacion: true }
        : SIN_EFECTO;

    case 'vigilancia_continua':
      // Estaba limpia y apareció reportada. La cobertura la resuelve
      // `coberturaDeContraparte()`: sin liberación cae sola en *Hallazgos sin
      // decidir*, así que no hay que marcarle nada. Sí notifica: es un hecho
      // nuevo sobre alguien que ya está vinculado.
      return delta.aparecio_hallazgo
        ? { notifica: true, premisa_cambiada: false, habilita_reevaluacion: false }
        : SIN_EFECTO;

    case 'hallazgos_sin_decidir':
    case 'sin_cobertura_vigente':
      // No se barren, así que no deberían llegar acá. Si llegan, callan.
      return SIN_EFECTO;
  }
}

// ─── Validación de la configuración ────────────────────────────────────────

export function validarCupo(valor: unknown): string | null {
  if (valor === null) return null; // "no adoptado" es un valor legítimo
  if (typeof valor !== 'number' || !Number.isInteger(valor)) {
    return 'El tope tiene que ser un número entero de consultas.';
  }
  if (valor < CUPO_MIN || valor > CUPO_MAX) {
    return `El tope va de ${CUPO_MIN} a ${CUPO_MAX} consultas por periodo.`;
  }
  return null;
}

export function validarHorizonte(valor: unknown): string | null {
  if (typeof valor !== 'number' || !Number.isInteger(valor)) {
    return 'El horizonte tiene que ser un número entero de meses.';
  }
  if (valor < HORIZONTE_MIN || valor > HORIZONTE_MAX) {
    return `El horizonte va de ${HORIZONTE_MIN} a ${HORIZONTE_MAX} meses.`;
  }
  return null;
}

/** Primer día del mes civil de `hoyISO`. El periodo del tope es el mes calendario. */
export function inicioDePeriodo(hoyISO: string): string {
  return `${hoyISO.slice(0, 7)}-01`;
}
