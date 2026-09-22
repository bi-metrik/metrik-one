/**
 * Qué necesita un caso de la cola para poder facturarse HOY.
 *
 * Vive aparte y lo consumen el servidor (que cuenta los totales de la bandeja) y
 * la pantalla (que decide si pinta el botón). Estaba escrito en los dos lados con
 * palabras parecidas, que es exactamente como un criterio se desincroniza sin que
 * nadie lo note: la bandeja diría "3 listos" y la lista mostraría cuatro botones.
 *
 * ── El recaudo YA NO es condición (decisión de Mauricio, 2026-09-22) ────────
 *
 * Del 2026-09-08 al 2026-09-22 el honorario recaudado era condición de entrada a esta
 * cola: con una banda del 1% y tres estados (`cubierto`, `descuadre_menor`,
 * `retenido`). Desde el 22 la factura sale en cualquier momento, a crédito, y la cuenta
 * por cobrar la cierran los ABONOS de los pagos (`lib/siigo/abonos-factura.ts`). Por eso
 * aquí ya no entra el saldo: lo que decide es lo mismo de siempre —el RUT, el honorario
 * aprobado y los datos de la factura— y nada más.
 *
 * Puro: no toca DB ni red.
 */
export interface CasoFacturable {
  faltan_factura: string[]
  faltan_cliente: string[]
  /** El negocio no tiene RUT con identificación utilizable. */
  sin_rut?: boolean
}

/**
 * ¿Está listo para emitir?
 *
 * El recibo del recaudo UPME NO entra en este criterio a propósito: es otro
 * documento y plata de un tercero, así que su falta no puede frenar la factura
 * del honorario. Quien lo vigila es el control de recibos de `/conciliacion`
 * (`getControlRecibos`), que es una superficie aparte.
 */
export function casoListoParaFacturar(caso: CasoFacturable): boolean {
  return caso.faltan_factura.length === 0 && caso.faltan_cliente.length === 0
}

/**
 * Lista de lo que le falta, sin repetir, para pintarla como etiquetas.
 *
 * ⚠️ Sin RUT se nombra el RUT, no sus consecuencias. `faltan_cliente` se arma del
 * documento, así que un negocio sin RUT declaraba a la vez identificación, nombre,
 * dirección y ciudad: cuatro etiquetas que se leen como cuatro datos por teclear,
 * cuando el trabajo real es UNO y no es de digitación, es pedirle el documento al
 * cliente. Los faltantes de la FACTURA sí se conservan, porque no salen del RUT y
 * seguirían faltando el día que llegue.
 */
export function faltantesDelCaso(caso: CasoFacturable): string[] {
  const delCliente = caso.sin_rut ? ['RUT sin cargar'] : caso.faltan_cliente
  return [...new Set([...delCliente, ...caso.faltan_factura])]
}
