// ============================================================
// Leer el consecutivo de la factura que quedó CARGADA en el bloque del negocio.
//
// Vive aparte de `facturas.ts` por una razón práctica: ese módulo arrastra el
// cliente de Siigo y las server actions, así que no se puede probar solo.
//
// Puro: no toca DB ni red.
// ============================================================

/**
 * El consecutivo que ya está CARGADO en el bloque de la factura, si lo hay.
 *
 * Segunda señal de "ya facturado", y hace falta porque `metadata.siigo_factura`
 * solo existe cuando la factura salió desde ONE. Los negocios cuya factura se hizo
 * antes de que ONE facturara entran por el otro lado: alguien carga en el bloque el
 * PDF que bajó de Siigo, y por ahí el negocio no queda marcado.
 *
 * La cola ya lo tenía en cuenta (`facturadoPorNegocio`, facturacion-actions), pero
 * esconder el botón no es cerrar la puerta: emitir es irreversible, así que la
 * barrera va donde ocurre. Medido 2026-08-27 en SOENA: de 13 facturas cargadas en el
 * bloque, 2 no tienen marca — dos casos a un clic de radicar ante la DIAN una segunda
 * factura por lo mismo.
 *
 * Sin `slugBloque` no hay dónde mirar y responde null: la emisión queda como estaba.
 */
export function numeroFacturaEnData(data: unknown): string | null {
  const campos = (data as { campos?: Record<string, { value?: unknown } | null> } | null)?.campos
  const bruto = campos?.numero_factura?.value
  const numero = bruto == null ? '' : String(bruto).trim()
  return numero || null
}
