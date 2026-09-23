/**
 * La casilla «va en propuesta» mientras el servidor contesta.
 *
 * ## El defecto que esto cierra (ensayo del 2026-09-23, hallazgo 24)
 *
 * Se marcaron las tres tarifas seguidas y, al recargar, la Recomendada estaba sin marcar. Los
 * registros de Vercel lo dicen sin ambigüedad: salieron DOS llamadas a `marcarEnPropuesta`
 * (03:42:01 y 03:42:05, cada una con su refresco), después una recarga completa (03:42:16) y
 * una tercera llamada suelta (03:42:39) que es la persona volviendo a marcarla. Tres clics,
 * dos llamadas: el del medio nunca salió.
 *
 * La causa era la pantalla: TODAS las casillas se deshabilitaban mientras cualquier acción de la
 * tabla estaba en curso (`isPending`), y el refresco de la primera tardaba unos dos segundos. El
 * segundo clic cayó sobre una casilla deshabilitada, que no dispara nada ni avisa. Encima la
 * casilla es controlada por lo que dice el servidor, así que el primer clic tampoco se veía
 * marcado hasta que llegaba el refresco: la pantalla no dejaba notar que un clic se perdía.
 *
 * El desmarcado automático (`desmarcarLosQueYaNoPueden`) quedó descartado: solo desmarca una
 * tarifa con `bloqueo` (incompleta o bajo el piso duro), y marcar exige exactamente lo contrario
 * con el mismo cálculo. La Recomendada se volvió a marcar sin tocar nada más, así que no tenía
 * bloqueo.
 *
 * ## Qué hace esto
 *
 * Lo que la persona marcó se ve marcado de inmediato y la casilla no se bloquea: cada clic se
 * anota aquí y la llamada se encola. La anotación NO es la verdad; se retira sola en cuanto el
 * servidor la confirma o la contradice:
 *
 *  · el servidor ya dice lo mismo → se retira (el dato ya es suyo);
 *  · la llamada falló → se retira y se vuelve a lo que dice el servidor;
 *  · la llamada funcionó → se espera el siguiente dato del servidor y se retira, diga lo que
 *    diga. Si entre tanto otra edición desmarcó la tarifa, manda el servidor: una anotación que
 *    sobrevive a su confirmación sería una pantalla sana que miente.
 *
 * Puro: la pantalla solo guarda el estado y llama a estas funciones.
 */

export interface MarcaPendiente {
  /** Lo que la persona pidió con su último clic. */
  valor: boolean
  /** `true` cuando el servidor ya aceptó ese valor y solo falta que llegue el dato nuevo. */
  confirmada: boolean
}

/** Las anotaciones vivas, por id de tarifa. */
export type MarcasPendientes = Readonly<Record<string, MarcaPendiente>>

/** Lo que la casilla muestra: lo pedido si hay anotación, si no lo que dice el servidor. */
export function marcaVisible(id: string, delServidor: boolean, marcas: MarcasPendientes): boolean {
  return marcas[id]?.valor ?? delServidor
}

/** ¿Hay un clic de esta tarifa esperando al servidor? */
export function marcaEnCamino(id: string, marcas: MarcasPendientes): boolean {
  const m = marcas[id]
  return m !== undefined && !m.confirmada
}

/** Un clic: queda anotado lo que se pidió, todavía sin confirmar. */
export function anotarClic(marcas: MarcasPendientes, id: string, valor: boolean): MarcasPendientes {
  return { ...marcas, [id]: { valor, confirmada: false } }
}

/**
 * La respuesta del servidor a la llamada que pidió `valor`.
 *
 * ⚠️ Solo toca la anotación si sigue pidiendo ESE valor. Con dos clics seguidos sobre la misma
 * casilla (marcar y desmarcar), la respuesta del primero no puede pisar lo que pidió el segundo:
 * el segundo tiene su propia llamada en la cola y su propia respuesta.
 */
export function anotarRespuesta(
  marcas: MarcasPendientes,
  id: string,
  valor: boolean,
  ok: boolean,
): MarcasPendientes {
  const actual = marcas[id]
  if (!actual || actual.valor !== valor) return marcas
  if (!ok) {
    const { [id]: _descartada, ...resto } = marcas
    return resto
  }
  return { ...marcas, [id]: { valor, confirmada: true } }
}

/**
 * Llegó un dato nuevo del servidor: se retiran las anotaciones que ya no hacen falta.
 *
 * Una tarifa que ya no está (se borró) tampoco conserva su anotación.
 */
export function conciliarConServidor(
  marcas: MarcasPendientes,
  delServidor: readonly { id: string; vaEnPropuesta: boolean }[],
): MarcasPendientes {
  const servidor = new Map(delServidor.map(i => [i.id, i.vaEnPropuesta]))
  let cambio = false
  const out: Record<string, MarcaPendiente> = {}
  for (const [id, m] of Object.entries(marcas)) {
    const real = servidor.get(id)
    if (real === undefined || real === m.valor || m.confirmada) {
      cambio = true
      continue
    }
    out[id] = m
  }
  // Sin cambios se devuelve el MISMO objeto: la pantalla no vuelve a pintar por nada.
  return cambio ? out : marcas
}
