import { parseMontoCop } from '@/lib/negocios/monto-cop'

/**
 * El valor sin IVA de la Factura del vehículo, leído de las filas de su bloque.
 *
 * Es la base de la tarifa UPME (Art. 13). Lo leen dos sitios: la inicialización del
 * bloque de confirmación de tarifa (`getNegocioDetalle`) y el respaldo de
 * `leerModeloDineroCompleto` para los negocios que no tienen ese bloque.
 *
 * ⚠️ POR QUÉ VIVE AQUÍ Y PASA POR `parseMontoCop`
 *
 * Los dos sitios lo leían a mano con `Number(valor.replace(/[^\d.-]/g, ''))`, que
 * CONSERVA el punto de miles: «350.906» se leía como 350,906 pesos y la tarifa salía
 * calculada sobre esa base. Es el mismo defecto que el 2026-09-23 llevó «50,08 COP» al
 * PDF de un cliente de Trappvel (ver `monto-cop.ts`). El extractor de documentos ya
 * entrega el valor limpio casi siempre, pero una edición a mano o un dato migrado
 * pueden traer el punto, y ahí el error no avisa: devuelve un número plausible.
 *
 * Gana la primera fila con un monto positivo: un negocio arrastra copias heredadas del
 * bloque y no todas traen el valor. Sin un monto legible devuelve 0, que era el
 * contrato de los dos llamadores («la Factura aún no tiene valor»).
 */
export function valorSinIvaDeFactura(
  filas: ReadonlyArray<{ data: Record<string, unknown> | null }>,
  campo = 'valor_unitario_sin_iva',
): number {
  for (const fila of filas) {
    const campos = (fila.data?.campos ?? {}) as Record<string, { value?: unknown } | undefined>
    const valor = parseMontoCop(campos[campo]?.value)
    if (valor !== null && valor > 0) return valor
  }
  return 0
}
