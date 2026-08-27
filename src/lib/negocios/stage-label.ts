/**
 * Cómo se LLAMAN las tres fases en pantalla. Una sola definición para todo el producto.
 *
 * La clave interna (`venta`, `ejecucion`, `cobro`) no cambia: la usan el enum de la base,
 * los gates, el routing de etapas y la asignación por área. Lo que cambia es la etiqueta,
 * y por una razón concreta: "Cobro" es a la vez el nombre de una FASE y el de una ETAPA
 * dentro de ella, así que un caso en Facturación (fase cobro) se leía como "está en
 * Cobro" y nadie sabía si eso era la fase o la etapa. Pasó de verdad con V0276.
 *
 * Decisión de Mauricio (2026-08-26): las fases se nombran por el área dueña, que es como
 * habla el equipo. Comercial, Operaciones, Financiera. Ninguna etapa se llama así, y el
 * nombre dice de una vez quién responde.
 *
 * ⚠️ Esto es SOLO presentación. Nada acá debe usarse como clave, ni compararse contra
 * `negocios.stage_actual`, ni guardarse. Si algún día una etiqueta y una clave vuelven a
 * coincidir, el problema es el mismo que este archivo vino a resolver.
 */

/** Etiqueta de la fase, en el caso natural de una frase. */
export const STAGE_LABEL: Record<string, string> = {
  venta: 'Comercial',
  ejecucion: 'Operaciones',
  cobro: 'Financiera',
  cierre: 'Cierre',
  cerrado: 'Cerrado',
}

/** La misma etiqueta en mayúsculas, para los chips que ya se pintaban así. */
export const STAGE_LABEL_UPPER: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_LABEL).map(([k, v]) => [k, v.toUpperCase()]),
)

/**
 * Etiqueta de una fase. Si la clave no está en el mapa devuelve la clave tal cual, que es
 * mejor que un hueco: deja ver el dato crudo en vez de afirmar que no existe.
 */
export function etiquetaStage(stage: string | null | undefined): string {
  if (!stage) return ''
  return STAGE_LABEL[stage] ?? stage
}
