/**
 * Los campos propios de una opción que salen de su LECTURA (Parte B del brief de captura del
 * 2026-09-23): el cargo en destino (B2) y los tramos del vuelo (B3).
 *
 * ## Por qué se escriben en el mismo update que la lectura
 *
 * Son la lectura puesta en su sitio, no otra versión de ella. Se escriben junto con
 * `items.tarifa_pax` cada vez que esta cambia (leer, quitar, corregir, pasajeros, moneda):
 * así el campo y la lectura no pueden decir cosas distintas, y una corrección de la ficha
 * llega al documento sin que nadie tenga que acordarse de nada.
 *
 * ## Sin la migración, no se escribe nada
 *
 * Mientras `20260923233000` no esté aplicada la fila no trae esas columnas (`select('*')`), y
 * nombrarlas en el update devolvería un error que tumbaría la lectura entera. Por eso cada
 * campo se escribe solo si la fila leída YA lo trae. El documento, entretanto, los deriva de
 * la lectura con las mismas funciones (`cargoDeItem`, `tramosDelItem`): sale idéntico.
 *
 * Puro: no toca la base.
 */

import { cargoLeidoDelItem, tramosLeidosDelItem } from './detalle-viaje'

/**
 * El techo de `items.cargo_destino_valor` es `numeric(14, 2)`. Una lectura desbocada (un
 * número de reserva leído como monto) no puede hacer rebotar el update: se guarda vacío y el
 * documento sigue leyendo de la lectura, donde alguien lo verá y lo corregirá.
 */
const TECHO_CARGO = 999_999_999_999

export function camposDeLectura(
  fila: Record<string, unknown>,
  tarifaPax: unknown,
): Record<string, unknown> {
  const item = {
    nombre: (fila.nombre ?? null) as string | null,
    grupo: (fila.grupo ?? null) as string | null,
    tarifa_pax: tarifaPax,
  }
  const out: Record<string, unknown> = {}
  if ('cargo_destino_valor' in fila && 'cargo_destino_moneda' in fila) {
    const cargo = cargoLeidoDelItem(item)
    const valido = cargo !== null && cargo.valor < TECHO_CARGO
    out.cargo_destino_valor = valido ? Math.round(cargo.valor * 100) / 100 : null
    out.cargo_destino_moneda = valido ? cargo.moneda : null
  }
  if ('tramos' in fila) out.tramos = tramosLeidosDelItem(item)
  return out
}
