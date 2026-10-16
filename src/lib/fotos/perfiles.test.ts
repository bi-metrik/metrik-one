import { describe, expect, it } from 'vitest'

import { claveDeFoto, type TipoPerfil } from './clave'
import { palabrasDelNombre, parecido, reconocer, type NombreConocido } from './perfiles'

const conocido = (tipo: TipoPerfil, nombre: string, ciudad: string | null, clavePerfil?: string): NombreConocido => {
  const clave = claveDeFoto(tipo, nombre, ciudad)
  return { tipo, clave, clavePerfil: clavePerfil ?? clave, nombre, ciudad }
}
const pedido = (tipo: TipoPerfil, nombre: string, ciudad: string | null) => ({ tipo, nombre, ciudad, clave: claveDeFoto(tipo, nombre, ciudad) })

const CATALONIA = conocido('hotel', 'Catalonia Puerta del Sol', 'Madrid')
const IBEROSTAR = conocido('hotel', 'Iberostar Selection Bávaro', 'Punta Cana')

describe('las palabras que distinguen un nombre', () => {
  it('sin «hotel», sin la ciudad, sin tildes, mayúsculas ni signos, en cualquier orden', () => {
    expect(palabrasDelNombre('hotel', 'Hotel Catalonia Puerta del Sol Madrid', 'Madrid')).toEqual(['catalonia', 'puerta', 'sol'])
    expect(palabrasDelNombre('hotel', 'CATALONIA - Puerta del Sol', 'Madrid MAD')).toEqual(['catalonia', 'puerta', 'sol'])
  })
  it('si solo queda la ciudad, la ciudad es el nombre', () => {
    expect(palabrasDelNombre('hotel', 'Hotel Madrid', 'Madrid')).toEqual(['madrid'])
  })
  it('en un tour «tour» sí cuenta', () => {
    expect(palabrasDelNombre('actividad', 'City tour Madrid', 'Madrid')).toEqual(['city', 'tour'])
  })
  it('un error de tipeo en una palabra larga cuenta como la misma', () => {
    expect(parecido(['catalonia', 'sol'], ['catalunia', 'sol'])).toBe(1)
    expect(parecido(['sol'], ['sal'])).toBe(0)
  })
})

describe('reconocer el mismo hotel entre cotizaciones', () => {
  it('la llave conocida (propia o de un alias) es el mismo, sin preguntar', () => {
    const alias = conocido('hotel', 'Hotel Catalonia Puerta del Sol Madrid', 'Madrid', CATALONIA.clave)
    expect(reconocer(pedido('hotel', 'Catalonia Puerta del Sol', 'Madrid'), [CATALONIA])).toEqual({ tipo: 'exacto', clavePerfil: CATALONIA.clave })
    expect(reconocer(pedido('hotel', 'Hotel Catalonia Puerta del Sol Madrid', 'Madrid'), [CATALONIA, alias])).toEqual({ tipo: 'exacto', clavePerfil: CATALONIA.clave })
  })

  it('«Hotel Catalonia Puerta del Sol Madrid» = «Catalonia Puerta del Sol»: seguro, sin preguntar', () => {
    expect(reconocer(pedido('hotel', 'Hotel Catalonia Puerta del Sol Madrid', 'Madrid'), [CATALONIA])).toEqual({ tipo: 'seguro', clavePerfil: CATALONIA.clave })
    expect(reconocer(pedido('hotel', 'Catalonia, Puerta del Sol (Hotel)', 'Madrid'), [CATALONIA])).toEqual({ tipo: 'seguro', clavePerfil: CATALONIA.clave })
    // Tildes, mayúsculas y la ciudad escrita distinto ya dan la misma llave: exacto.
    expect(reconocer(pedido('hotel', 'CATALONIA PUERTA DEL SÓL', 'MADRID'), [CATALONIA])).toEqual({ tipo: 'exacto', clavePerfil: CATALONIA.clave })
  })

  it('parecido sin ser igual: pregunta, con el nombre que ya conoce', () => {
    expect(reconocer(pedido('hotel', 'Iberostar Selection Bávaro Suites', 'Punta Cana'), [IBEROSTAR])).toEqual({
      tipo: 'duda',
      clavePerfil: IBEROSTAR.clave,
      nombre: 'Iberostar Selection Bávaro',
      ciudad: 'Punta Cana',
    })
  })

  it('el mismo nombre sin ciudad en uno de los dos: pregunta (no lo da por hecho)', () => {
    expect(reconocer(pedido('hotel', 'Catalonia Puerta del Sol', null), [CATALONIA]).tipo).toBe('duda')
  })

  it('otra ciudad, otro hotel; otra cadena, otro hotel; otro tipo, otro perfil', () => {
    expect(reconocer(pedido('hotel', 'Catalonia Puerta del Sol', 'Barcelona'), [CATALONIA])).toEqual({ tipo: 'nuevo' })
    expect(reconocer(pedido('hotel', 'Catalonia Gran Vía', 'Madrid'), [CATALONIA])).toEqual({ tipo: 'nuevo' })
    expect(reconocer(pedido('actividad', 'Catalonia Puerta del Sol', 'Madrid'), [CATALONIA])).toEqual({ tipo: 'nuevo' })
  })

  it('iguales a dos perfiles distintos: no elige solo, pregunta', () => {
    const otro = conocido('hotel', 'Puerta del Sol Catalonia', 'Madrid')
    expect(reconocer(pedido('hotel', 'Hotel Catalonia Puerta del Sol', 'Madrid'), [CATALONIA, otro]).tipo).toBe('duda')
  })

  it('tours: «Madrid City Tour» = «City tour Madrid»; «Tour Toledo» no es «Toledo y Segovia»', () => {
    const city = conocido('actividad', 'City tour Madrid', 'Madrid')
    const toledo = conocido('actividad', 'Tour Toledo', 'Madrid')
    expect(reconocer(pedido('actividad', 'Madrid City Tour', 'Madrid'), [city])).toEqual({ tipo: 'seguro', clavePerfil: city.clave })
    expect(reconocer(pedido('actividad', 'Toledo y Segovia', 'Madrid'), [toledo])).toEqual({ tipo: 'nuevo' })
  })
})
