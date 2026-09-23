import { descripcionReescribible } from './descripcion-sistema'
import { leerTarifaPax } from './tarifa-pasajero'

/**
 * La nota para el cliente: la descripción de la línea, SOLO si la escribió una persona.
 *
 * La que escribió ONE (`TarifaPax.descripcionDelSistema`) no es nota: repite la ficha, que ya
 * sale en el documento desde los campos. Así las cotizaciones viejas con una descripción
 * escrita a mano la conservan como nota sin migrar nada (P2), y la de sistema deja de verse
 * como un texto que alguien tiene que mantener.
 */
export function notaDeLaLinea(item: { descripcion?: string | null; tarifa_pax?: unknown }): string | null {
  const texto = (item.descripcion ?? '').trim()
  if (texto === '') return null
  const tarifa = leerTarifaPax(item.tarifa_pax)
  // Una línea sin pantallazo leído no tiene descripción de sistema: lo que haya lo escribió
  // alguien.
  if (!tarifa.casillas?.grupo_completo && !tarifa.confirmada) return texto
  return descripcionReescribible(texto, tarifa.descripcionDelSistema, !!tarifa.confirmada) ? null : texto
}
