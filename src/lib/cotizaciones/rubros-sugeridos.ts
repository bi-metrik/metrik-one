/**
 * El rubro SUGERIDO: propuesto por la lectura de un pantallazo, todavía sin confirmar.
 *
 * ## La invariante (R-P1)
 *
 * *«El pantallazo PROPONE. Una persona confirma antes de que entre al costo.»*
 *
 * Persistir la propuesta es lo que hace que recargar la página no la descarte. Pero un
 * rubro guardado lo suma `calcularCascada` como cualquier otro: quedaría dentro del
 * costo sin que nadie lo haya confirmado, que es exactamente lo que R-P1 prohíbe.
 *
 * Por eso la columna y el filtro son **un solo movimiento**, y el filtro vive aquí,
 * en una función que consumen TODOS los que suman rubros. Si cada lector filtrara por
 * su cuenta, el día que aparezca un lector nuevo la propuesta se le colaría al costo
 * — y un costo inflado por un rubro que nadie confirmó no falla en ninguna parte: se
 * ve como un margen peor.
 *
 * ## Confirmar es poner `sugerido = false`
 *
 * No hay un segundo estado ni una tabla aparte. Un rubro confirmado es indistinguible
 * de uno escrito a mano, que es lo correcto: una vez que una persona lo aprobó, su
 * origen no cambia lo que vale.
 *
 * ## `undefined` cuenta como CONFIRMADO, a propósito
 *
 * Es lo que llega mientras la migración no esté aplicada, y también lo que llega de
 * cualquier consulta que no pida la columna. Tratarlo como sugerido dejaría el costo
 * de toda cotización en CERO durante esa ventana — un fallo mudo del peor tipo, porque
 * un margen del 100% se ve como una buena noticia.
 */

/** Lo mínimo que hace falta de un rubro para saber si cuenta. */
export interface RubroConEstado {
  /** `true` = propuesto y sin confirmar. Ausente o `false` = cuenta al costo. */
  sugerido?: boolean | null
}

/** Un rubro cuenta al costo salvo que esté explícitamente marcado como sugerido. */
export function esConfirmado(rubro: RubroConEstado): boolean {
  return rubro.sugerido !== true
}

/** Los rubros que entran al costo. */
export function soloConfirmados<T extends RubroConEstado>(rubros: T[]): T[] {
  return rubros.filter(esConfirmado)
}

/** Los que están esperando que alguien los confirme. */
export function soloSugeridos<T extends RubroConEstado>(rubros: T[]): T[] {
  return rubros.filter(r => !esConfirmado(r))
}

/**
 * Lo que la cascada necesita saber del desglose de un ítem: cuántos rubros CUENTAN y
 * cuánto suman.
 *
 * ⚠️ `numeroDeRubros` también sale filtrado, y no es un detalle: `costoUnitarioDelItem`
 * decide con él si el costo del ítem viene del desglose o del `subtotal` escrito a
 * mano. Un ítem con solo rubros sugeridos tiene que seguir costando lo que diga su
 * `subtotal` — contarlos haría que su costo cayera a cero mientras nadie confirma.
 */
export function costoDeRubrosConfirmados(
  rubros: Array<RubroConEstado & { valor_total?: number | null }> | null | undefined,
): { numeroDeRubros: number; costoDeRubros: number } {
  const cuentan = soloConfirmados(rubros ?? [])
  return {
    numeroDeRubros: cuentan.length,
    costoDeRubros: cuentan.reduce((s, r) => s + (Number(r.valor_total) || 0), 0),
  }
}
