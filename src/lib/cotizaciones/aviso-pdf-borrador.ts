/**
 * EL AVISO DEL PDF DE BORRADOR CADUCA CON LA COTIZACIÓN (QA del #1342, punto 4).
 *
 * «Descargar PDF» con algo que impide enviar deja un aviso ámbar que no se cierra solo («PDF de
 * borrador … margen 5,8 %»). Seguía en pantalla después de subir la comisión al 15 % y de agregar
 * paquetes: decía una cifra que ya no existía. Ahora el aviso lleva la huella de lo que lo produjo
 * y se quita cuando la huella cambia; el próximo «Descargar PDF» dice lo vigente.
 *
 * La huella: lo que mueve la marca de borrador o sus cifras. Las líneas (costo, precio, margen,
 * cantidad, si suman, el tipo de tarifa con su comisión y el descuento al cliente), las tarifas (si
 * van y qué escogen) y los parámetros de la cotización. Puro.
 */

export const idAvisoPdfBorrador = (cotizacionId: string) => `pdf-borrador:${cotizacionId}`

export interface EntradaHuellaAviso {
  items: readonly {
    id: string
    subtotal?: number | null
    precio_venta?: number | null
    margen_porcentaje?: number | null
    cantidad?: number | null
    entra_al_precio?: boolean | null
    tarifa_pax?: unknown
  }[]
  tarifas: readonly { id: string; vaEnPropuesta: boolean; seleccion: readonly string[] }[]
  cotizacion: Record<string, unknown>
}

const deTarifa = (raw: unknown) => {
  const t = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return [t.tipoTarifa ?? null, t.descuentoCliente ?? null, t.confirmada ?? null]
}

export function huellaDelAvisoDelPdf(e: EntradaHuellaAviso): string {
  const c = e.cotizacion
  return JSON.stringify([
    [...e.items]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(i => [i.id, i.subtotal ?? null, i.precio_venta ?? null, i.margen_porcentaje ?? null, i.cantidad ?? null, i.entra_al_precio ?? null, ...deTarifa(i.tarifa_pax)]),
    [...e.tarifas]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(t => [t.id, t.vaEnPropuesta, [...t.seleccion].sort()]),
    [c.margen_porcentaje ?? null, c.descuento_porcentaje ?? null, c.reglas_margen ?? null, c.valor_total ?? null, c.estado ?? null],
  ])
}
