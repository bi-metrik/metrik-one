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
  nochesDeEstadia,
  numeroLeido,
  precioEsPorPersona,
  resumenDeLinea,
  rubrosPropuestos,
  type Aceptacion,
} from './lectura-pantallazo'
import {
  camposDeIdentidad,
  totalPasajeros,
  type Composicion,
  type FilaTipo,
  type LecturaCasilla,
  type OcupacionLeida,
  type TipoPasajero,
} from './tarifa-pasajero'
import { resolverCostoAgencia } from './costo-agencia'
import { menoresDeDosAnios } from './habitaciones'

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
  /**
   * A cuántos se cotiza cuando la captura no lo dice (la del viaje). Solo la usa un precio POR
   * PERSONA sin ocupación en la imagen: sin ella, ese precio se multiplicaría por 1.
   */
  composicionSiFalta: Composicion | null = null,
): LecturaCasilla {
  const valor = (slug: string) => aceptacion.campos.find(c => c.slug === slug)?.valor ?? null
  const moneda = (valor('moneda') ?? 'COP').toUpperCase()
  // La captura no mostraba la moneda y se preseleccionó (`monedaSiFalta`). Queda dicho en
  // la lectura: es lo que impide confirmar el costo hasta que una persona la acepte.
  const monedaAsumida = aceptacion.campos.find(c => c.slug === 'moneda')?.supuesto === true
  const porTipo = agruparPorTipo(aceptacion)

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
  // R8 · menos de 2 años es infante, aunque la pantalla lo llame niño: «1 niño (0 años)».
  // El modelo tiene la misma regla en su prompt; esto la cumple cuando no la siguió.
  const bebes = Math.min(ocupacion.ninos ?? 0, menoresDeDosAnios(valor('ocupacion')))
  if (bebes > 0) {
    ocupacion.ninos = (ocupacion.ninos ?? 0) - bebes
    ocupacion.infantes = (ocupacion.infantes ?? 0) + bebes
  }
  // Si la pantalla solo dice adultos y deja niños/infantes en null, esos null son «no se
  // ve», no «cero». Pero si dice adultos y al menos uno de los menores, lo que falta es 0.
  if (ocupacion.adultos !== null && (ocupacion.ninos !== null || ocupacion.infantes !== null)) {
    ocupacion.ninos = ocupacion.ninos ?? 0
    ocupacion.infantes = ocupacion.infantes ?? 0
  }
  const sinOcupacion = porTipo.length === 0
    && ocupacion.adultos === null && ocupacion.ninos === null && ocupacion.infantes === null && ocupacion.total === null

  // El total de la ocupación de la captura (va después de la ocupación: un precio por persona
  // la necesita, ya sin los conteos que no hablan de personas).
  const avisosDelPrecio: string[] = []
  let total: number
  // `por_pax` sin pasajeros en la captura (el vuelo del GDS de Trappvel, 2026-11-06): el
  // multiplicador de siempre usa `pax` de la imagen y, sin él, multiplicaba por 1. Se cuenta como
  // un precio por persona: las personas de la línea.
  const porPaxSinPax = valor('base_precio') === 'por_pax' && entero(valor('pax')) === null && sinOcupacion
    && !!composicionSiFalta && totalPasajeros(composicionSiFalta) > 0
  if (porTipo.length > 0) {
    total = aceptacion.totalGeneral ?? numeroLeido(valor('precio_total')) ?? porTipo.reduce((a, f) => a + f.subtotal, 0)
  } else if (precioEsPorPersona(ranura, valor('base_precio')) || porPaxSinPax) {
    // Precio POR PERSONA (Trappvel, 2026-11-03): el costo es ese precio por cada persona, nunca el
    // de la reserva. Las personas son las de la captura; si no las muestra, las de la línea.
    const precio = numeroLeido(valor('precio_total')) ?? 0
    const leidas = sinOcupacion
      ? null
      : (ocupacion.adultos !== null || ocupacion.ninos !== null || ocupacion.infantes !== null)
        ? (ocupacion.adultos ?? 0) + (ocupacion.ninos ?? 0) + (ocupacion.infantes ?? 0)
        : ocupacion.total
    const delViaje = composicionSiFalta ? totalPasajeros(composicionSiFalta) : 0
    const deLaCaptura = !!leidas && leidas > 0
    const personas = deLaCaptura ? leidas! : delViaje > 0 ? delViaje : 1
    const porNoche = valor('base_precio') === 'por_persona_noche'
    const noches = porNoche ? Math.max(1, nochesDeEstadia(new Map(aceptacion.campos.map(c => [c.slug, c.valor])))) : 1
    total = Math.round(precio * personas * noches * 100) / 100
    if (precio > 0) {
      const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 })
      const menores = deLaCaptura
        ? (ocupacion.ninos ?? 0) + (ocupacion.infantes ?? 0)
        : composicionSiFalta ? composicionSiFalta.ninos + composicionSiFalta.infantes : 0
      avisosDelPrecio.push(
        `El precio de la captura es por persona${porNoche ? ' y por noche' : ''} (${fmt(precio)}): el costo es ` +
        `${personas} ${personas === 1 ? 'persona' : 'personas'}${porNoche ? ` × ${noches} ${noches === 1 ? 'noche' : 'noches'}` : ''} ` +
        `× ese precio = ${fmt(total)}.` +
        (menores > 0 ? ' Los menores van al mismo precio: si el proveedor les cobra otra tarifa, corrígela.' : ''),
      )
    }
  } else {
    // Sin desglose por tipo, el `desglose` de conceptos (tarifa + tasas) no reparte nada
    // entre pasajeros: se usa el precio resuelto, igual que el cargue de siempre.
    const propuestos = rubrosPropuestos(ranura, aceptacion.campos, [])
    total = propuestos.reduce((a, r) => a + r.cantidad * r.valorUnitario, 0)
  }

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

  // Lo que paga la agencia: el neto escrito si está, y si no el que deja la comisión
  // (`costo-agencia.ts`). Cuando la captura se contradice, el costo queda sin resolver y
  // el motivo se cuelga de las alertas — abstenerse deja la línea con el margen de la
  // cotización, que es el comportamiento de siempre; callarlo dejaría a quien revisa
  // preguntándose por qué esta captura no fijó margen y la de al lado sí.
  const costoAgencia = resolverCostoAgencia({
    precioCliente: total,
    netoLeido: numeroLeido(valor('total_a_pagar_agencia')),
    comisionValor: numeroLeido(valor('comision_agencia_valor')),
    comisionPct: numeroLeido(valor('comision_agencia_pct')),
  })
  const alertas = [...aceptacion.avisos, ...avisosDelPrecio]
  if (costoAgencia && costoAgencia.costoAgencia === null) alertas.push(costoAgencia.motivo)

  return {
    moneda,
    total,
    aPagarAgencia: costoAgencia?.costoAgencia ?? null,
    costoAgenciaOrigen: costoAgencia && costoAgencia.costoAgencia !== null ? costoAgencia.origen : null,
    porTipo,
    ocupacion,
    ocupacionDelItem: sinOcupacion,
    identidad,
    notasCliente,
    alertas,
    campos: aceptacion.campos
      .filter(c => c.valor !== null)
      // Un valor supuesto no se lista como leído: afirmaría que la imagen decía «COP».
      .filter(c => !c.supuesto)
      .map(c => ({ label: c.label, valor: c.delItem ? `${c.valor} (del viaje)` : (c.valor as string) })),
    nombre,
    descripcion,
    leidaEn,
    ...(monedaAsumida ? { monedaAsumida: true } : {}),
    ...(aceptacion.basePrecioOrigen ? { basePrecioOrigen: aceptacion.basePrecioOrigen } : {}),
    ...(aceptacion.habitacionesReserva ? { habitacionesReserva: aceptacion.habitacionesReserva } : {}),
  }
}
