/**
 * Lo que la línea de negocio declara sobre el margen.
 *
 * Vive en `lineas_negocio.config_extra -> 'margen'`, un jsonb que ya existía, así que
 * no hay columnas nuevas ni un lugar más que mantener:
 *
 *     {"margen": {"convencion": "sobre_venta", "default_pct": 15}}
 *
 * Este archivo es la ÚNICA pieza que sabe leer ese jsonb. La forma del dato entra por
 * aquí y sale tipada; nadie más hace `config_extra?.margen?.convencion` a mano, que es
 * como se desincronizan las dos mitades de una regla.
 */

import { CONVENCION_MARGEN_POR_DEFECTO, type ConvencionMargen } from './precio-item'

/** Lo que la línea declara, ya resuelto y con sus valores por defecto puestos. */
export interface PoliticaMargen {
  convencion: ConvencionMargen
  /** Margen con el que nace un ítem nuevo. Editable después, ítem por ítem. */
  defaultPct: number
}

/**
 * La política que rige cuando la línea no declara nada, o cuando el negocio no
 * tiene línea.
 *
 * `markup` y 0 no son una elección de diseño: son exactamente lo que ONE hacía antes
 * de que esta pieza existiera. Un default distinto le cambiaría el precio a los
 * workspaces que ya estaban operando.
 */
export const POLITICA_MARGEN_POR_DEFECTO: PoliticaMargen = {
  convencion: CONVENCION_MARGEN_POR_DEFECTO,
  defaultPct: 0,
}

/** Solo lo que interesa de `config_extra`. Todo opcional: el jsonb es libre. */
type ConfigExtra = { margen?: { convencion?: unknown; default_pct?: unknown } | null } | null

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

  return { convencion, defaultPct }
}

/**
 * Cómo se llama el campo en pantalla, según lo que el número significa.
 *
 * Con `markup` el número NO es el margen, y llamarlo "margen" es la confusión que esta
 * pieza viene a cerrar.
 */
export function etiquetaCampoMargen(convencion: ConvencionMargen): string {
  return convencion === 'sobre_venta' ? 'Margen %' : 'Recargo %'
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
