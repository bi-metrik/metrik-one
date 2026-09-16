/**
 * De una lectura aceptada por su ranura a lo que se guarda en una casilla.
 *
 * Puente entre `lectura-pantallazo.ts` (qué se acepta de una imagen) y
 * `tarifa-pasajero.ts` (qué casilla pide qué y cómo se reparte el costo). Vive aparte para
 * que ninguno de los dos tenga que conocer al otro.
 *
 * Puro: la fecha de lectura entra por parámetro.
 */

import type { DefinicionRanura } from './ranuras-pantallazo'
import {
  numeroLeido,
  resumenDeLinea,
  rubrosPropuestos,
  type Aceptacion,
} from './lectura-pantallazo'
import {
  camposDeIdentidad,
  type FilaTipo,
  type LecturaCasilla,
  type OcupacionLeida,
  type TipoPasajero,
} from './tarifa-pasajero'

function entero(valor: string | null | undefined): number | null {
  const n = numeroLeido(valor ?? null)
  if (n === null || n < 0 || !Number.isInteger(n)) return null
  return n
}

/** ¿El texto habla de personas y no solo de habitaciones? */
export function mencionaPersonas(texto: string | null): boolean {
  if (!texto) return false
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return /adult|nin[oa]|menor|child|infant|beb[e]|huesped|persona|pasajer|\bpax\b|guest/.test(t)
}

/**
 * Suma las filas del mismo tipo. Una tabla de vuelo con dos aerolíneas trae dos filas ADT:
 * para el precio por pasajero son el mismo tipo, y dejarlas separadas haría que la
 * comparación contra la composición contara el doble de adultos.
 */
function agruparPorTipo(aceptacion: Aceptacion): FilaTipo[] {
  const porTipo = new Map<TipoPasajero, FilaTipo>()
  for (const f of aceptacion.porTipoPax) {
    const previa = porTipo.get(f.tipo)
    if (previa) {
      previa.cantidad += f.cantidad
      previa.subtotal += f.subtotal_tipo
    } else {
      porTipo.set(f.tipo, { tipo: f.tipo, cantidad: f.cantidad, subtotal: f.subtotal_tipo })
    }
  }
  return (['adulto', 'nino', 'infante'] as TipoPasajero[])
    .map(t => porTipo.get(t))
    .filter((f): f is FilaTipo => f !== undefined)
}

/**
 * Construye la lectura de una casilla a partir de una captura ya aceptada (RX1-RX5).
 *
 * El `total` es el precio de la ocupación de la captura:
 *  · con tabla por tipo, el total de esa tabla (TP2 lo compara contra sus filas);
 *  · con un solo precio, el precio ya resuelto por su `base_precio` — el mismo cálculo que
 *    el cargue de siempre (`rubrosPropuestos`), para que un hotel por noche no se costee
 *    como si fuera la estadía.
 */
export function construirLecturaCasilla(
  ranura: DefinicionRanura,
  aceptacion: Aceptacion,
  leidaEn: string,
): LecturaCasilla {
  const valor = (slug: string) => aceptacion.campos.find(c => c.slug === slug)?.valor ?? null
  const moneda = (valor('moneda') ?? 'COP').toUpperCase()
  const porTipo = agruparPorTipo(aceptacion)

  let total: number
  if (porTipo.length > 0) {
    total = aceptacion.totalGeneral ?? numeroLeido(valor('precio_total')) ?? porTipo.reduce((a, f) => a + f.subtotal, 0)
  } else {
    // Sin desglose por tipo, el `desglose` de conceptos (tarifa + tasas) no reparte nada
    // entre pasajeros: se usa el precio resuelto, igual que el cargue de siempre.
    const propuestos = rubrosPropuestos(ranura, aceptacion.campos, [])
    total = propuestos.reduce((a, r) => a + r.cantidad * r.valorUnitario, 0)
  }

  const ocupacion: OcupacionLeida = {
    adultos: entero(valor('ocupacion_adultos')),
    ninos: entero(valor('ocupacion_ninos')),
    infantes: entero(valor('ocupacion_infantes')),
    total: entero(valor('ocupacion_total')) ?? (ranura.slug === 'vuelo_detalle' ? entero(valor('pax')) : null),
  }
  // En un hotel, un conteo de personas sin un texto de PERSONAS detrás no es evidencia.
  // Medido el 2026-09-16 contra el modelo vivo: la tarjeta «1 x Standard Room AD» volvió
  // una vez sin ocupación y otra con `ocupacion_adultos: 1` — leyó el número de
  // habitaciones como adultos, y TP3 rechazó una tarjeta buena. Sin la palabra, los conteos
  // se descartan y la ocupación se toma del ítem con alerta (7.4).
  if (ranura.slug === 'hotel_detalle' && porTipo.length === 0 && !mencionaPersonas(valor('ocupacion'))) {
    ocupacion.adultos = null
    ocupacion.ninos = null
    ocupacion.infantes = null
    ocupacion.total = null
  }
  // Si la pantalla solo dice adultos y deja niños/infantes en null, esos null son «no se
  // ve», no «cero». Pero si dice adultos y al menos uno de los menores, lo que falta es 0.
  if (ocupacion.adultos !== null && (ocupacion.ninos !== null || ocupacion.infantes !== null)) {
    ocupacion.ninos = ocupacion.ninos ?? 0
    ocupacion.infantes = ocupacion.infantes ?? 0
  }
  const sinOcupacion = porTipo.length === 0
    && ocupacion.adultos === null && ocupacion.ninos === null && ocupacion.infantes === null && ocupacion.total === null

  // CC1 · solo cuenta como identidad lo que está EN la imagen. Una fecha tomada del viaje
  // compararía el viaje contra sí mismo y daría por buena cualquier captura.
  const identidad: Record<string, string | null> = {}
  for (const slug of camposDeIdentidad(ranura.slug)) {
    const campo = aceptacion.campos.find(c => c.slug === slug)
    identidad[slug] = campo && !campo.delItem ? campo.valor : null
  }

  const notasCliente: string[] = []
  const impuestosDestino = numeroLeido(valor('impuestos_destino_valor'))
  if (impuestosDestino !== null && impuestosDestino > 0) {
    const monedaDestino = (valor('impuestos_destino_moneda') ?? moneda).toUpperCase()
    notasCliente.push(
      `Impuestos y tasas a pagar en destino: ${impuestosDestino.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ` +
      `${monedaDestino}, no incluidos en el precio.`,
    )
  }

  const { nombre, descripcion } = resumenDeLinea(ranura, aceptacion.campos)

  return {
    moneda,
    total,
    aPagarAgencia: numeroLeido(valor('total_a_pagar_agencia')),
    porTipo,
    ocupacion,
    ocupacionDelItem: sinOcupacion,
    identidad,
    notasCliente,
    alertas: aceptacion.avisos,
    campos: aceptacion.campos
      .filter(c => c.valor !== null)
      .map(c => ({ label: c.label, valor: c.delItem ? `${c.valor} (del viaje)` : (c.valor as string) })),
    nombre,
    descripcion,
    leidaEn,
  }
}
