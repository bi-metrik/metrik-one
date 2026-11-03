import { describe, expect, it } from 'vitest'

import { MENSAJE_PAQUETE_SIN_BLOQUEO } from './bloqueo-pegado'
import { construirLecturaCasilla } from './lectura-casilla'
import { precioEsPorPersona, type Aceptacion, type CampoLeido } from './lectura-pantallazo'
import { ranuraPorSlug, type DefinicionRanura } from './ranuras-pantallazo'
import type { Composicion, LecturaCasilla } from './tarifa-pasajero'
import { enElDestinoDelViaje, esZonaDelDestino, ubicarLectura, type LineaParaUbicar } from './ubicar-lectura'

/**
 * Viaje a San Andrés en bloqueo, 3 adultos (Trappvel, 2026-11-03). Tres fallos que reportó Mauricio:
 * el precio por persona se costeaba como total, el vuelo del paquete no entraba y los hoteles de
 * zonas distintas del mismo destino abrían un bloque cada uno. Datos sintéticos con las cifras reales.
 */

const HOTEL = ranuraPorSlug('hotel_detalle')!
const PAQUETE = ranuraPorSlug('paquete_detalle')!
const TRES_ADULTOS: Composicion = { adultos: 3, ninos: 0, infantes: 0 }
const LEIDA_EN = '2026-11-03T20:00:00Z'

function aceptacion(ranura: DefinicionRanura, valores: Record<string, string | null>): Aceptacion {
  const campos: CampoLeido[] = ranura.campos.map(c => ({
    slug: c.slug,
    label: c.label,
    valor: valores[c.slug] ?? null,
    confidence: valores[c.slug] ? 1 : 0,
    alertaRevision: c.alerta_revision === true,
  }))
  return { ok: true, ranura: ranura.slug, campos, desglose: [], avisos: [], porTipoPax: [], totalGeneral: null }
}

describe('1 · el precio por persona es por adulto: costo = precio × personas', () => {
  it('hotel «por_persona» con «3 PAX» en la captura: 3.110.717 × 3 = 9.332.151 (antes quedaba 3.110.717)', () => {
    const l = construirLecturaCasilla(HOTEL, aceptacion(HOTEL, {
      hotel: 'Hotel A', ciudad: 'San Andres', moneda: 'COP', precio_total: '3110717', base_precio: 'por_persona',
      ocupacion: '3 PAX', ocupacion_total: '3',
    }), LEIDA_EN, TRES_ADULTOS)
    expect(l.total).toBe(9_332_151)
    expect(l.alertas.some(a => a.includes('por persona') && a.includes('3 personas'))).toBe(true)
  })

  it('hotel «por_persona» con adultos separados: 2.294.863 × 3 = 6.884.589', () => {
    const l = construirLecturaCasilla(HOTEL, aceptacion(HOTEL, {
      hotel: 'Hotel B', ciudad: 'Zona SAN LUIS', moneda: 'COP', precio_total: '2294863', base_precio: 'por_persona',
      ocupacion: '3 PAX', ocupacion_adultos: '3', ocupacion_ninos: '0', ocupacion_infantes: '0', ocupacion_total: '3',
    }), LEIDA_EN, TRES_ADULTOS)
    expect(l.total).toBe(6_884_589)
  })

  it('hotel «por_persona» sin ocupación en la imagen: multiplica por las personas de la línea (3)', () => {
    const l = construirLecturaCasilla(HOTEL, aceptacion(HOTEL, {
      hotel: 'Hotel C', moneda: 'COP', precio_total: '2441205', base_precio: 'por_persona',
    }), LEIDA_EN, TRES_ADULTOS)
    expect(l.ocupacionDelItem).toBe(true)
    expect(l.total).toBe(7_323_615)
  })

  it('hotel «total» no cambia: 7.323.615 sigue siendo 7.323.615', () => {
    const l = construirLecturaCasilla(HOTEL, aceptacion(HOTEL, {
      hotel: 'Hotel C', moneda: 'COP', precio_total: '7323615', base_precio: 'total',
      ocupacion: '3 PAX', ocupacion_adultos: '3', ocupacion_ninos: '0', ocupacion_infantes: '0',
    }), LEIDA_EN, TRES_ADULTOS)
    expect(l.total).toBe(7_323_615)
  })

  it('hotel «por_persona_noche»: 100.000 × 2 personas × 4 noches', () => {
    const l = construirLecturaCasilla(HOTEL, aceptacion(HOTEL, {
      hotel: 'Hotel D', moneda: 'COP', precio_total: '100000', base_precio: 'por_persona_noche', noches: '4',
      ocupacion: '2 adultos', ocupacion_adultos: '2', ocupacion_ninos: '0', ocupacion_infantes: '0',
    }), LEIDA_EN, null)
    expect(l.total).toBe(800_000)
  })

  it('el lector del hotel ya ofrece por_persona y por_persona_noche', () => {
    expect(HOTEL.campos.find(c => c.slug === 'base_precio')?.opciones).toEqual(['total', 'por_noche', 'por_persona', 'por_persona_noche'])
  })

  it('paquete de bloqueo: el precio es por persona aunque la pantalla no lo diga: 2.441.205 × 3 = 7.323.615', () => {
    const l = construirLecturaCasilla(PAQUETE, aceptacion(PAQUETE, { nombre: 'Hotel C', moneda: 'COP', precio_total: '2441205' }), LEIDA_EN, TRES_ADULTOS)
    expect(l.total).toBe(7_323_615)
  })

  it('paquete de bloqueo con «total» dicho por la pantalla: no se multiplica', () => {
    const l = construirLecturaCasilla(PAQUETE, aceptacion(PAQUETE, { nombre: 'Hotel C', moneda: 'COP', precio_total: '7323615', base_precio: 'total' }), LEIDA_EN, TRES_ADULTOS)
    expect(l.total).toBe(7_323_615)
  })

  it('precioEsPorPersona: hotel por_noche y total no; paquete sin base sí', () => {
    expect(precioEsPorPersona(HOTEL, 'total')).toBe(false)
    expect(precioEsPorPersona(HOTEL, 'por_noche')).toBe(false)
    expect(precioEsPorPersona(HOTEL, null)).toBe(false)
    expect(precioEsPorPersona(HOTEL, 'por_persona')).toBe(true)
    expect(precioEsPorPersona(PAQUETE, null)).toBe(true)
    expect(precioEsPorPersona(PAQUETE, 'total')).toBe(false)
  })
})

describe('2 · «Es paquete de bloqueo» sin viaje en bloqueo dice qué hacer', () => {
  it('el mensaje manda a marcar la modalidad y aclara que el vuelo no necesita precio', () => {
    expect(MENSAJE_PAQUETE_SIN_BLOQUEO).toContain('Modalidad: Bloqueo')
    expect(MENSAJE_PAQUETE_SIN_BLOQUEO).toContain('no necesita precio')
  })
})

describe('3 · hoteles de zonas distintas del mismo destino son opciones del mismo bloque', () => {
  const lectura = (hotel: string, ciudad: string): LecturaCasilla => ({
    moneda: 'COP', total: 1, aPagarAgencia: null, porTipo: [],
    ocupacion: { adultos: 3, ninos: 0, infantes: 0, total: 3 }, ocupacionDelItem: false,
    identidad: { hotel, tipo_habitacion: 'Triple', regimen: null, check_in: null, check_out: null },
    notasCliente: [], alertas: [],
    campos: [{ label: 'Hotel', valor: hotel }, { label: 'Ciudad', valor: ciudad }],
    nombre: `${hotel} · ${ciudad}`, descripcion: '', leidaEn: LEIDA_EN,
  })
  const SIN_PISTAS = { lugar: null, origen: null, destino: null }

  function aceptarEnOrden(capturas: LecturaCasilla[], destinoViaje: string | null) {
    let lineas: LineaParaUbicar[] = []
    let ranuras = 0
    for (const [i, l] of capturas.entries()) {
      const d = ubicarLectura({ tipo: 'hotel', lectura: l, pistas: SIN_PISTAS, lineas, grupoViaje: TRES_ADULTOS, destinoViaje })
      if (d.como === 'hermana') lineas = [...lineas, { id: `h${i}`, grupo: d.grupo, nombre: l.nombre, tarifa_pax: { casillas: { grupo_completo: l } } }]
      else if (d.como === 'nueva') {
        ranuras++
        lineas = [...lineas, { id: `h${i}`, grupo: ranuras === 1 ? 'hotel' : `hotel ${ranuras}`, nombre: l.nombre, tarifa_pax: { casillas: { grupo_completo: l } } }]
      }
    }
    return { lineas, ranuras }
  }

  const SAN_ANDRES = [
    lectura('Hotel A', 'San Andres'),
    lectura('Hotel B', 'Zona SAN LUIS'),
    lectura('Hotel C', 'Zona LA ROCOSA - KORAY'),
  ]

  it('San Andrés, Zona SAN LUIS y Zona LA ROCOSA en un viaje a SAN ANDRÉS: 1 bloque, 3 opciones', () => {
    const { lineas, ranuras } = aceptarEnOrden(SAN_ANDRES, 'SAN ANDRÉS')
    expect(ranuras).toBe(1)
    expect(lineas.map(l => l.grupo)).toEqual(['hotel', 'hotel', 'hotel'])
  })

  it('también si la primera captura es la de una zona', () => {
    const { ranuras } = aceptarEnOrden([SAN_ANDRES[1], SAN_ANDRES[2], SAN_ANDRES[0]], 'San Andrés')
    expect(ranuras).toBe(1)
  })

  it('sin destino del viaje se decide como antes (por el lugar): la zona abre otro bloque', () => {
    expect(aceptarEnOrden(SAN_ANDRES, null).ranuras).toBe(3)
  })

  it('con varios destinos en el viaje no se junta: Cartagena y San Andrés son dos estadías', () => {
    const { ranuras } = aceptarEnOrden([lectura('Hotel A', 'Cartagena'), lectura('Hotel B', 'San Andres')], 'Cartagena y San Andrés')
    expect(ranuras).toBe(2)
  })

  it('otro destino que no se declara zona sigue abriendo su bloque (Providencia en un viaje a San Andrés)', () => {
    const { ranuras } = aceptarEnOrden([lectura('Hotel A', 'San Andres'), lectura('Hotel P', 'Providencia')], 'San Andrés')
    expect(ranuras).toBe(2)
  })

  it('reglas sueltas', () => {
    expect(esZonaDelDestino('Zona SAN LUIS')).toBe(true)
    expect(esZonaDelDestino('San Luis')).toBe(false)
    expect(enElDestinoDelViaje('San Andres', 'SAN ANDRÉS')).toBe(true)
    expect(enElDestinoDelViaje('Zona LA ROCOSA - KORAY', 'SAN ANDRÉS')).toBe(true)
    expect(enElDestinoDelViaje('Providencia', 'SAN ANDRÉS')).toBe(false)
    expect(enElDestinoDelViaje('Zona SAN LUIS', null)).toBe(false)
  })
})
