/**
 * El INTERRUPTOR de la cotización por pasos (etapa C de la cotización integrada, pieza C1).
 *
 * ## Qué gobierna y qué no
 *
 * Gobierna la PANTALLA y las ESCRITURAS NUEVAS. Nunca la LECTURA: el total, el IVA, el PDF,
 * la aprobación, el gate de etapa, el registro de decisiones y el presupuesto se calculan
 * con el mismo código, encendido o apagado, y dependen solo del dato (nota técnica de Max
 * §0). Así se apaga sin que se mueva un peso: lo que el flujo nuevo escribe lo lee igual el
 * flujo viejo. Lo hace cumplir `por-pasos-lectura-guard.test.ts`, que falla si un lector de
 * plata llega a importar este módulo (criterio N4 de Vera).
 *
 * ## Cuándo enciende
 *
 * Con las CUATRO condiciones a la vez (criterio N5):
 *  1. la línea del negocio cotiza por tipo (`lineasPorTipo`: es de viaje);
 *  2. la plantilla del workspace es `trappvel`;
 *  3. `workspaces.config_extra.cotizacion_por_pasos.activo === true` (estricto: `"true"`,
 *     `1` o la clave ausente no encienden);
 *  4. la cotización está en `borrador` (las enviadas y aceptadas se ven con la pantalla de
 *     hoy, criterio N7).
 * Un workspace que no es de viaje, o con otra plantilla, no entra aunque alguien encienda
 * la clave por error.
 *
 * ## La forma de `config_extra`
 *
 *     cotizacion_por_pasos: {
 *       activo: boolean,
 *       piezas?: { modelo_destino, toda_opcion_en_tarifas, opcional_traslado,
 *                  incluye_por_one, lista_unica, margen_por_tarifa }
 *     }
 *
 * Con el maestro apagado las piezas no cuentan. Con el maestro encendido, una pieza AUSENTE
 * está encendida y solo `false` explícito la apaga: las piezas existen para apagar una parte
 * sin deploy, no para tener que encender seis claves. `margen_por_tarifa` es de C7 (segunda
 * entrega) y hoy no la lee nadie.
 *
 * ⚠️ La excepción es `modelo_destino` (C5): se enciende solo con `true` explícito. Vera (M4) pide
 * que quede apagada mientras no se pruebe que el modelo acierta igual o mejor que las reglas (M1)
 * con una corrida real, y esa corrida no se ha hecho. Apagada, la frase de la bandeja sale de las
 * reglas de siempre.
 *
 * Volver atrás = poner `activo: false` (o borrar la clave). Sin deploy.
 */

export const PIEZAS_POR_PASOS = [
  'modelo_destino',
  'toda_opcion_en_tarifas',
  'opcional_traslado',
  'incluye_por_one',
  'lista_unica',
  'margen_por_tarifa',
] as const

export type PiezaPorPasos = (typeof PIEZAS_POR_PASOS)[number]

/** Las piezas que no encienden solas con el maestro: piden `true` explícito (ver arriba). */
export const PIEZAS_SOLO_CON_TRUE: ReadonlySet<PiezaPorPasos> = new Set<PiezaPorPasos>(['modelo_destino'])

export interface ConfigPorPasos {
  /** El maestro, leído de forma estricta. */
  activo: boolean
  /** Cada pieza, ya resuelta: con el maestro apagado, todas `false`. */
  piezas: Record<PiezaPorPasos, boolean>
}

const TODAS_APAGADAS: Record<PiezaPorPasos, boolean> = Object.fromEntries(
  PIEZAS_POR_PASOS.map(p => [p, false]),
) as Record<PiezaPorPasos, boolean>

/**
 * `config_extra.cotizacion_por_pasos` del workspace, interpretado. Recibe el jsonb crudo y
 * no confía en su forma: cualquier cosa que no sea `activo === true` es apagado.
 */
export function leerConfigPorPasos(configExtraWorkspace: unknown): ConfigPorPasos {
  const raiz = configExtraWorkspace && typeof configExtraWorkspace === 'object'
    ? (configExtraWorkspace as { cotizacion_por_pasos?: unknown }).cotizacion_por_pasos
    : undefined
  const bloque = raiz && typeof raiz === 'object' ? (raiz as { activo?: unknown; piezas?: unknown }) : null
  const activo = bloque?.activo === true
  if (!activo) return { activo: false, piezas: { ...TODAS_APAGADAS } }
  const piezasCrudas = bloque?.piezas && typeof bloque.piezas === 'object'
    ? (bloque.piezas as Record<string, unknown>)
    : {}
  const piezas = Object.fromEntries(
    PIEZAS_POR_PASOS.map(p => [p, PIEZAS_SOLO_CON_TRUE.has(p) ? piezasCrudas[p] === true : piezasCrudas[p] !== false]),
  ) as Record<PiezaPorPasos, boolean>
  return { activo: true, piezas }
}

/** Las cuatro entradas de la condición de entrada. Todas salen de datos que la página ya lee. */
export interface EntradaPorPasos {
  lineasPorTipo: boolean
  plantilla: string | null | undefined
  configWorkspace: unknown
  estado: string | null | undefined
}

/** Por qué la forma nueva NO está encendida para esta cotización. `null` = encendida. */
export type MotivoApagado = 'no_es_viaje' | 'otra_plantilla' | 'interruptor_apagado' | 'no_es_borrador'

export interface EstadoPorPasos extends ConfigPorPasos {
  /** Las cuatro condiciones a la vez. */
  encendido: boolean
  motivo: MotivoApagado | null
}

/**
 * ¿La cotización se trabaja por pasos? Conjunción estricta de las cuatro condiciones. Si no,
 * dice cuál faltó (la primera, en el orden de arriba), y todas las piezas quedan apagadas.
 */
export function estadoPorPasos(e: EntradaPorPasos): EstadoPorPasos {
  const config = leerConfigPorPasos(e.configWorkspace)
  const motivo: MotivoApagado | null = !e.lineasPorTipo
    ? 'no_es_viaje'
    : e.plantilla !== 'trappvel'
      ? 'otra_plantilla'
      : !config.activo
        ? 'interruptor_apagado'
        : e.estado !== 'borrador'
          ? 'no_es_borrador'
          : null
  if (motivo !== null) return { activo: config.activo, piezas: { ...TODAS_APAGADAS }, encendido: false, motivo }
  return { ...config, encendido: true, motivo: null }
}

/** Atajo: `true` solo con las cuatro condiciones. */
export function porPasos(e: EntradaPorPasos): boolean {
  return estadoPorPasos(e).encendido
}

/** ¿Esta pieza está encendida para esta cotización? Exige el maestro y las cuatro condiciones. */
export function piezaEncendida(estado: EstadoPorPasos, pieza: PiezaPorPasos): boolean {
  return estado.encendido && estado.piezas[pieza] === true
}

/**
 * El texto con que el SERVIDOR rechaza una acción de la forma nueva. Una pestaña abierta
 * antes de apagar el interruptor no puede seguir escribiendo con la forma nueva: recarga y
 * ve la de siempre.
 */
export function rechazoPorPasos(motivo: MotivoApagado | 'pieza_apagada'): string {
  switch (motivo) {
    case 'no_es_borrador':
      return 'Esta cotización ya no es un borrador: no se edita. Duplícala para trabajar sobre una nueva.'
    case 'pieza_apagada':
      return 'Esta parte de la cotización por pasos está apagada en este workspace. Recarga la página.'
    default:
      return 'La cotización por pasos no está encendida en este workspace. Recarga la página para ver la de siempre.'
  }
}
