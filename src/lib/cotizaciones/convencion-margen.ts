/**
 * Lo que la línea de negocio declara sobre el margen.
 *
 * Vive en `lineas_negocio.config_extra -> 'margen'`, un jsonb que ya existía, así que
 * no hay columnas nuevas ni un lugar más que mantener:
 *
 *     {"margen": {"convencion": "sobre_venta", "default_pct": 15,
 *                 "piso_pct": 5, "aviso_pct": 10}}
 *
 * Este archivo es la ÚNICA pieza que sabe leer ese jsonb. La forma del dato entra por
 * aquí y sale tipada; nadie más hace `config_extra?.margen?.convencion` a mano, que es
 * como se desincronizan las dos mitades de una regla.
 *
 * ## Por qué los umbrales viven aquí y no en una columna de `workspaces`
 *
 * Porque la pregunta que responden —«¿a partir de qué margen este trabajo deja de
 * valer la pena?»— es de la LÍNEA, no de la empresa: una agencia puede cotizar
 * viajes a medida con piso 5% y un corporativo con piso 12%, y una columna por
 * workspace obliga a elegir uno de los dos. Es además donde ya viven `convencion` y
 * `default_pct`, que son de la misma familia (cómo se le pone precio a esta línea) y
 * las lee este mismo módulo: partirlas entre un jsonb y dos columnas crea una segunda
 * regla de precedencia para un dato que ya tiene la suya. Y no cuesta migración.
 */

import { CONVENCION_MARGEN_POR_DEFECTO, type ConvencionMargen } from './precio-item'

/** Lo que la línea declara, ya resuelto y con sus valores por defecto puestos. */
export interface PoliticaMargen {
  convencion: ConvencionMargen
  /** Margen con el que nace un ítem nuevo. Editable después, ítem por ítem. */
  defaultPct: number
  /**
   * Margen real por debajo del cual el trabajo no vale la pena. Se pinta en ROJO.
   *
   * **Hoy solo se muestra.** El rechazo en servidor llega con los itinerarios: hasta
   * que exista, un piso que bloquee no subiría el margen, enseñaría a escribir el
   * número que deja pasar la pantalla.
   */
  pisoPct: number
  /** Margen real por debajo del cual la pantalla avisa en ámbar. Nunca bloquea. */
  avisoPct: number
}

/**
 * Margen real por debajo del cual el trabajo deja de valer la pena. Se pinta ROJO.
 *
 * **Hoy no bloquea nada.** El rechazo en servidor llega con los itinerarios; hasta
 * entonces esto es una marca, no una barrera, y la cotización se envía igual. La
 * razón es la de siempre: un piso duro no sube el margen, enseña a escribir el
 * número que deja pasar la pantalla, y el dato que llega después no sirve para nada.
 *
 * El 5% sale de la operación real de una agencia de viajes: 2025 corrió entre 10,6%
 * y 13,0%, con viajes cerrados al 3,1% y uno con pérdida de -6,5%. Cada línea puede
 * poner el suyo en `config_extra.margen.piso_pct`.
 */
export const PISO_MARGEN_PCT_POR_DEFECTO = 5

/**
 * Margen real por debajo del cual la pantalla avisa en ámbar. Nunca bloquea.
 *
 * El 10% es el punto donde la cifra deja de parecerse a la política y vale la pena
 * mirarla, no un límite de negocio. Cada línea puede poner el suyo en
 * `config_extra.margen.aviso_pct`.
 */
export const AVISO_MARGEN_PCT_POR_DEFECTO = 10

/**
 * La política que rige cuando la línea no declara nada, o cuando el negocio no
 * tiene línea.
 *
 * `markup` y 0 no son una elección de diseño: son exactamente lo que ONE hacía antes
 * de que esta pieza existiera. Un default distinto le cambiaría el precio a los
 * workspaces que ya estaban operando.
 *
 * Los umbrales sí traen un valor con opinión (5 y 10) porque no cambian ningún
 * precio: solo deciden de qué color sale un número que antes no se veía.
 */
export const POLITICA_MARGEN_POR_DEFECTO: PoliticaMargen = {
  convencion: CONVENCION_MARGEN_POR_DEFECTO,
  defaultPct: 0,
  pisoPct: PISO_MARGEN_PCT_POR_DEFECTO,
  avisoPct: AVISO_MARGEN_PCT_POR_DEFECTO,
}

/** Solo lo que interesa de `config_extra`. Todo opcional: el jsonb es libre. */
type ConfigExtra = {
  margen?: {
    convencion?: unknown
    default_pct?: unknown
    piso_pct?: unknown
    aviso_pct?: unknown
  } | null
} | null

/**
 * Lee un porcentaje del jsonb, o devuelve el default.
 *
 * Mismo criterio que `default_pct`: fuera de [0, 100) se DESCARTA en vez de
 * corregirse a un número cercano. Un 150 en el piso no es "150 que quisimos decir
 * 99": es un jsonb mal escrito, y adivinar por él inventa una regla que nadie tomó.
 */
function pctDelJsonb(crudo: unknown, porDefecto: number): number {
  const n = Number(crudo)
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : porDefecto
}

/**
 * Lee la política de margen del `config_extra` de una línea.
 *
 * Tolerante a propósito: un `config_extra` vacío, con otra forma, o con un valor que
 * no reconocemos, cae en la política por defecto. Un jsonb mal escrito no puede
 * tumbar el cálculo de un precio ni, peor, cambiarlo en silencio.
 */
export function politicaMargenDeLinea(configExtra: unknown): PoliticaMargen {
  const cfg = (configExtra ?? null) as ConfigExtra
  const margen = cfg && typeof cfg === 'object' ? cfg.margen : null
  if (!margen || typeof margen !== 'object') return POLITICA_MARGEN_POR_DEFECTO

  const convencion: ConvencionMargen =
    margen.convencion === 'sobre_venta' || margen.convencion === 'markup'
      ? margen.convencion
      : POLITICA_MARGEN_POR_DEFECTO.convencion

  // Un default fuera de [0, 100) no se corrige a un número cercano: se descarta. Con
  // `sobre_venta`, 100 es la división por cero y por encima el precio se iría bajo el
  // costo; callarlo con un 99 sería inventar una regla que nadie escribió.
  const pctCrudo = Number(margen.default_pct)
  const defaultPct =
    Number.isFinite(pctCrudo) && pctCrudo >= 0 && pctCrudo < 100
      ? pctCrudo
      : POLITICA_MARGEN_POR_DEFECTO.defaultPct

  return {
    convencion,
    defaultPct,
    pisoPct: pctDelJsonb(margen.piso_pct, POLITICA_MARGEN_POR_DEFECTO.pisoPct),
    avisoPct: pctDelJsonb(margen.aviso_pct, POLITICA_MARGEN_POR_DEFECTO.avisoPct),
  }
}

/**
 * Cómo se llama el campo en pantalla, según lo que el número significa.
 *
 * Con `markup` el número NO es el margen, y llamarlo "margen" es la confusión que esta
 * pieza viene a cerrar.
 */
export function etiquetaCampoMargen(convencion: ConvencionMargen): string {
  return `${nombreDelMargen(convencion)} %`
}

/**
 * Cómo se llama el número, sin el signo de porcentaje.
 *
 * Hace falta aparte porque la etiqueta se usa también dentro de una frase y al lado de
 * un campo que ya lleva su propio `%`: "Recargo % 0% de la cotización" es lo que salía
 * antes, y ahí el lector deja de entender cuál de los dos números manda.
 */
export function nombreDelMargen(convencion: ConvencionMargen): string {
  return convencion === 'sobre_venta' ? 'Margen' : 'Recargo'
}

/**
 * La política de margen que le corresponde a un negocio, resuelta contra su línea.
 *
 * Se usa al CREAR una cotización, para copiarle la convención. No se vuelve a consultar
 * después: ver el comentario de la columna `cotizaciones.convencion_margen`.
 *
 * Un negocio sin línea, o una lectura que falla, caen en la política por defecto. El
 * precio de una cotización no puede depender de que una consulta secundaria responda.
 */
export async function politicaMargenDelNegocio(
  // El cliente de Supabase viene tipado desde el caller y su tipo generado es enorme;
  // acotarlo aquí obligaría a importar medio `database.ts` para un solo `select`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioId: string,
): Promise<PoliticaMargen> {
  const { data } = await supabase
    .from('negocios')
    .select('lineas_negocio(config_extra)')
    .eq('id', negocioId)
    .maybeSingle()

  // El embed llega como objeto o como array de uno según cómo resuelva PostgREST la
  // relación; las dos formas son válidas y la que llegue depende de los FKs.
  const linea = (data as { lineas_negocio?: unknown } | null)?.lineas_negocio
  const fila = Array.isArray(linea) ? linea[0] : linea
  const configExtra = (fila as { config_extra?: unknown } | null | undefined)?.config_extra

  return politicaMargenDeLinea(configExtra)
}

// ── Umbrales de margen: uno avisa, el otro marca en rojo ─────────────────────



/** Los dos números que deciden de qué color sale un margen. */
export interface UmbralesMargen {
  pisoPct: number
  avisoPct: number
}

/** Los umbrales que rigen mientras nadie configure nada. */
export const UMBRALES_MARGEN_POR_DEFECTO: UmbralesMargen = {
  pisoPct: PISO_MARGEN_PCT_POR_DEFECTO,
  avisoPct: AVISO_MARGEN_PCT_POR_DEFECTO,
}

/**
 * Cómo se lee un margen real contra los umbrales.
 *
 *  · `sin_dato`   — no hay margen que juzgar (ítem recién creado, sin precio o sin
 *                   costo). NO se pinta de ningún color: regañar por no haber
 *                   llegado todavía enseña a ignorar el aviso.
 *  · `bajo_piso`  — rojo.
 *  · `aviso`      — ámbar.
 *  · `ok`         — sin marca.
 *
 * Un piso por ENCIMA del aviso no es un error de configuración que haya que
 * corregir: deja la banda ámbar vacía y todo lo que no llega al piso sale en rojo,
 * que es exactamente lo que esa configuración pide.
 */
export type NivelMargen = 'sin_dato' | 'bajo_piso' | 'aviso' | 'ok'

export function nivelDeMargen(
  margenRealPct: number | null | undefined,
  umbrales: UmbralesMargen = UMBRALES_MARGEN_POR_DEFECTO,
): NivelMargen {
  if (margenRealPct === null || margenRealPct === undefined) return 'sin_dato'
  if (!Number.isFinite(margenRealPct)) return 'sin_dato'
  // Un margen negativo cae en `bajo_piso`, que es el caso que más importa: vender
  // por debajo del costo.
  if (margenRealPct < umbrales.pisoPct) return 'bajo_piso'
  if (margenRealPct < umbrales.avisoPct) return 'aviso'
  return 'ok'
}

/**
 * Los umbrales que le aplican a UNA cotización, resolviendo la congelación.
 *
 * Manda lo que la cotización tenga CONGELADO al nacer; la política de la línea solo
 * entra donde la cotización no diga nada. Es la misma regla de `convencion_margen`, y
 * por la misma razón: subir el piso de la línea no puede cambiarle el color —ni, el
 * día que bloquee, el desenlace— a una cotización que ya salió al cliente.
 *
 * Las cotizaciones anteriores a la columna la traen en `null` y caen a la línea. Es
 * deliberado: congelar hacia atrás exigiría inventar qué umbral regía el día en que
 * se crearon, y nadie lo sabe.
 */
export function umbralesDeCotizacion(
  congelados: { pisoPct?: number | null; avisoPct?: number | null } | null | undefined,
  politicaDeLinea: UmbralesMargen = UMBRALES_MARGEN_POR_DEFECTO,
): UmbralesMargen {
  return {
    pisoPct: congelado(congelados?.pisoPct, politicaDeLinea.pisoPct),
    avisoPct: congelado(congelados?.avisoPct, politicaDeLinea.avisoPct),
  }
}

/**
 * Un umbral congelado, o el de la línea si la cotización no congeló nada.
 *
 * ⚠️ `null` y `0` NO son lo mismo, y `Number(null)` vale **0**: sin el corte
 * explícito, una columna nula se leería como un piso declarado del 0% y ninguna
 * cotización vieja volvería a marcarse en rojo jamás. Es la misma trampa que
 * `items.margen_porcentaje`, un nivel más arriba.
 */
function congelado(valor: number | null | undefined, deLaLinea: number): number {
  if (valor === null || valor === undefined) return deLaLinea
  const n = Number(valor)
  return Number.isFinite(n) ? n : deLaLinea
}
