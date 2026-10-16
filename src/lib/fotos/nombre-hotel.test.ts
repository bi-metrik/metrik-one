import { describe, expect, it } from 'vitest'

import { esDelHotel, firmaDelHotel } from './nombre-hotel'

describe('¿el archivo de Commons es del hotel? (precisión antes que cantidad)', () => {
  it('deja fuera los cuatro ejemplos malos de la búsqueda real (Mauricio, 2026-10-16)', () => {
    expect(esDelHotel('File:Parc Can Dragó 001.jpg', 'Ibis Barcelona Centro', 'Barcelona')).toBe(false)
    expect(esDelHotel('File:The Eiffel Tower.jpg', 'Pullman Paris Tour Eiffel', 'París')).toBe(false)
    expect(esDelHotel('File:Summit @ Eiffel Tower.jpg', 'Pullman Paris Tour Eiffel', 'París')).toBe(false)
    expect(esDelHotel('File:Homenaje al Hotel Florida (Madrid).jpg', 'Gran Hotel Inglés', 'Madrid')).toBe(false)
  })

  it('deja pasar los archivos que sí son del hotel', () => {
    expect(esDelHotel('File:Barcelona - Hotel Ibis Barcelona Centro.jpg', 'Ibis Barcelona Centro', 'Barcelona')).toBe(true)
    expect(esDelHotel('File:Pullman Eiffel Tower Hotel Paris France 1.jpg', 'Pullman Paris Tour Eiffel', 'París')).toBe(true)
    expect(esDelHotel('File:Hotel Majestic, Barcelona, December 2014.JPG', 'Majestic Hotel & Spa Barcelona', 'Barcelona')).toBe(true)
    expect(esDelHotel('File:Victoria Hotel, Amsterdam 7337.jpg', 'Victoria Hotel Amsterdam', 'Ámsterdam')).toBe(true)
    expect(esDelHotel('File:Gran Hotel Ingles Madrid fachada.jpg', 'Gran Hotel Inglés', 'Madrid')).toBe(true)
  })

  it('la cadena sola no alcanza: otro Ibis, otro Pullman o un Ibis de otra ciudad quedan fuera', () => {
    expect(esDelHotel('File:Ibis Barcelona Meridiana.jpg', 'Ibis Barcelona Centro', 'Barcelona')).toBe(false)
    expect(esDelHotel('File:Pullman Paris Montparnasse.jpg', 'Pullman Paris Tour Eiffel', 'París')).toBe(false)
    // Lo único distintivo es la cadena: el título tiene que nombrar la ciudad.
    expect(esDelHotel('File:Hotel Ibis Lyon.jpg', 'Hotel Ibis', 'Barcelona')).toBe(false)
    expect(esDelHotel('File:Hotel Ibis Barcelona.jpg', 'Hotel Ibis', 'Barcelona')).toBe(true)
    expect(esDelHotel('File:Four Seasons Hotel Mumbai.jpg', 'Four Seasons Madrid', 'Madrid')).toBe(false)
  })

  it('un título que nombra OTRA marca es de otro hotel (medido en Commons el 2026-10-16)', () => {
    expect(esDelHotel('File:RIU hotel, Playa del Inglés, Gran Canaria, from the dunes.jpg', 'Gran Hotel Inglés', 'Madrid')).toBe(false)
    expect(esDelHotel('File:Hotel Riu Plaza España.jpg', 'Riu Plaza España', 'Madrid')).toBe(true)
  })

  it('«hotel», la ciudad y los artículos no cuentan como distintivas', () => {
    const f = firmaDelHotel('Hotel Catalonia Puerta del Sol', 'Madrid MAD')
    expect(f.requeridas.map((g) => g[0])).toEqual(expect.arrayContaining(['catalonia', 'puerta', 'sol']))
    expect(f.requeridas.some((g) => g.includes('hotel') || g.includes('madrid') || g.includes('del'))).toBe(false)
    // Un nombre sin nada propio no encuentra nada: mejor cero opciones que una equivocada.
    expect(esDelHotel('File:Hotel in Paris.jpg', 'Hotel París', 'París')).toBe(false)
    expect(firmaDelHotel('Hotel', 'Roma').vacia).toBe(true)
  })

  it('una categoría de Commons se juzga igual que un archivo', () => {
    expect(esDelHotel('Category:Hotel Ibis Barcelona Centro', 'Ibis Barcelona Centro', 'Barcelona')).toBe(true)
    expect(esDelHotel('Category:Ibis hotels in Barcelona', 'Ibis Barcelona Centro', 'Barcelona')).toBe(false)
  })
})
