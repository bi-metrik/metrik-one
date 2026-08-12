import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

/**
 * Qué necesita un caso de la cola para poder facturarse HOY.
 *
 * Vive aparte y lo consumen el servidor (que cuenta los totales de la bandeja) y
 * la pantalla (que decide si pinta el botón). Estaba escrito en los dos lados con
 * palabras parecidas, que es exactamente como un criterio se desincroniza sin que
 * nadie lo note: la bandeja diría "3 listos" y la lista mostraría cuatro botones.
 *
 * Puro: no toca DB ni red.
 */
export interface CasoFacturable {
  faltan_factura: string[]
  faltan_cliente: string[]
  /** Lo que falta recaudar del HONORARIO. */
  falta_saldo: number
}

/**
 * El recibo del recaudo UPME NO entra en este criterio a propósito: es otro
 * documento y plata de un tercero, así que su falta no puede frenar la factura
 * del honorario.
 */
export function casoListoParaFacturar(caso: CasoFacturable): boolean {
  return (
    caso.faltan_factura.length === 0 &&
    caso.faltan_cliente.length === 0 &&
    caso.falta_saldo <= TOLERANCIA_SALDO_COP
  )
}

/** Lista de lo que le falta, sin repetir, para pintarla como etiquetas. */
export function faltantesDelCaso(caso: CasoFacturable): string[] {
  const faltas = [...new Set([...caso.faltan_cliente, ...caso.faltan_factura])]
  if (caso.falta_saldo > TOLERANCIA_SALDO_COP) faltas.push('recaudo del honorario')
  return faltas
}
