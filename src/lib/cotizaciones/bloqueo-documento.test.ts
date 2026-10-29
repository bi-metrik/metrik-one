import { describe, expect, it } from 'vitest'

import aliadosHotel from './__fixtures__/bloqueo/aliados-hotel.json'
import aliadosVuelos from './__fixtures__/bloqueo/aliados-vuelos.json'
import { PROPS_CURAZAO } from '../../../test/propuesta-curazao'
import { hotelDesdeLectura, vueloDesdeLectura } from './bloqueo-extraccion'
import { descripcionDelPaquete, paqueteVacio, type PaqueteBloqueo } from './bloqueo-paquete'
import { acomodacionDelPaquete, hotelesDePaquetes, vuelosDePaquetes } from './bloqueo-documento'
import { descripcionVisibleDeLinea, nombreVisibleDeLinea } from './nombre-visible'
import { modeloDePropuesta } from './propuesta/modelo-documento'
import { aMayusculas } from '@/lib/negocios/mayusculas'
import { htmlDePropuesta, type RecursosPropuesta } from '@/lib/pdf/html/trappvel/plantilla'

/**
 * La propuesta de un viaje en bloqueo (QA del 2026-10-29): «Hospedaje» y «Vuelos» salen del paquete
 * (`tarifa_pax.bloqueo`: hotel, acomodación, aerolínea y tramos), y el nombre no sale en MAYÚSCULAS.
 * Con los fixtures del pantallazo de Aliados (ficticios en lo demás).
 */

function paqueteAliados(): PaqueteBloqueo {
  const h = hotelDesdeLectura(aliadosHotel)
  const v = vueloDesdeLectura(aliadosVuelos)
  if (!h.ok || !v.ok) throw new Error('fixture ilegible')
  const p: PaqueteBloqueo = { ...paqueteVacio('Aliados Travel'), hotel: h.hotel, incluye: h.incluye, vuelo: v.vuelo }
  p.distribucion = { habitaciones: { doble: 1 }, ninos: 1, infantes: 0, edadesNinos: [7] }
  return p
}

/** La línea como la deja `guardarPaqueteBloqueo`: nombre y descripción en mayúscula. */
function lineaDelPaquete(p: PaqueteBloqueo) {
  return {
    nombre: aMayusculas(p.hotel.hotel),
    descripcion: aMayusculas(descripcionDelPaquete(p)),
    grupo: 'paquete de bloqueo: Paquete de bloqueo en Cartagena',
    tarifa_pax: { bloqueo: p },
  }
}

const RECURSOS: RecursosPropuesta = { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'Agencia de ejemplo' }
const texto = (h: string) => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('el paquete en el documento', () => {
  const p = paqueteAliados()
  const linea = lineaDelPaquete(p)

  it('el hotel del paquete es una ficha de hospedaje: hotel, zona, plan, noches, fechas del vuelo y acomodación', () => {
    const [h] = hotelesDePaquetes([linea])
    expect(h.hotel).toBe('Hotel Cartagena Dubai')
    expect(h.ciudad).toBe('Bocagrande')
    expect(h.noches).toBe(p.hotel.noches)
    expect(h.checkIn).toBe('5 feb 2027')
    expect(h.ocupacion).toBe(acomodacionDelPaquete(p))
    expect(h.ocupacion).toBe('1 doble · 1 niño')
    expect(h.regimen).toBe(p.hotel.planAlimentacion)
  })

  it('los tramos son los vuelos: ida y regreso de la misma ruta en un vuelo, con aerolínea y número', () => {
    const vuelos = vuelosDePaquetes([linea])
    expect(vuelos).toHaveLength(1)
    expect(vuelos[0]).toMatchObject({ aerolinea: 'JetSMART', origen: 'BOG', destino: 'CTG', fechaSalida: '5 feb 2027', horaSalida: '04:45' })
    expect(vuelos[0].numeros?.ida).toBe('5150')
    expect(vuelos[0].fechaRegreso).not.toBeNull()
  })

  it('una línea que no es paquete no aporta nada (el hotel y el vuelo de siempre no cambian)', () => {
    expect(hotelesDePaquetes([{ nombre: 'HOTEL', grupo: 'hotel', tarifa_pax: { bloqueo: p } }])).toEqual([])
    expect(vuelosDePaquetes([{ nombre: 'VUELO', grupo: 'vuelo', tarifa_pax: { bloqueo: p } }])).toEqual([])
  })

  it('el nombre y la descripción se muestran como se leyeron, no en MAYÚSCULAS', () => {
    expect(linea.nombre).toBe('HOTEL CARTAGENA DUBAI')
    expect(nombreVisibleDeLinea(linea)).toBe('Hotel Cartagena Dubai')
    expect(descripcionVisibleDeLinea(linea)).toBe(descripcionDelPaquete(p))
    // Lo que escribió una persona se respeta tal cual.
    expect(nombreVisibleDeLinea({ ...linea, nombre: 'PAQUETE ESPECIAL' })).toBe('PAQUETE ESPECIAL')
  })

  it('la propuesta html dice el hotel en «Hospedaje» y el vuelo en «Vuelos», y el precio con el nombre legible', () => {
    const item = { nombre: nombreVisibleDeLinea(linea), descripcion: descripcionVisibleDeLinea(linea), precio_venta: 4_000_000, descuento_porcentaje: 0, cantidad: 1 }
    const props = {
      ...PROPS_CURAZAO,
      items: [item],
      itinerarios: [],
      fiscal: { ...PROPS_CURAZAO.fiscal!, subtotal: 4_000_000, totalBruto: 4_000_000, teQueda: 4_000_000 },
      viaje: { ...PROPS_CURAZAO.viaje!, vuelos: vuelosDePaquetes([linea]), hoteles: hotelesDePaquetes([linea]) },
    }
    const m = modeloDePropuesta({ props })
    expect(m.hoteles.flatMap(c => c.opciones.map(o => o.hotel))).toEqual(['Hotel Cartagena Dubai'])
    expect(m.vuelos.map(f => f.sentido)).toEqual(['ida', 'regreso'])
    const t = texto(htmlDePropuesta(m, RECURSOS))
    expect(t).toContain('Hospedaje')
    expect(t).toContain('Hotel Cartagena Dubai')
    expect(t).toContain('JetSMART')
    expect(t).not.toContain('HOTEL CARTAGENA DUBAI')
  })
})
