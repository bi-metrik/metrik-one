/**
 * Nombre del archivo del soporte de una consulta de listas.
 *
 * VISTOS FALLAR (2026-09-11). Se mutaron las dos piezas por separado:
 *   - lista blanca `[^a-z0-9]+` -> `[^a-z0-9"\n]+` (o sea, dejar pasar comilla y
 *     salto de linea, que es el defecto que esta funcion existe para evitar):
 *     cayo el caso de la cabecera.
 *   - `todayBogotaISO(d)` -> `c.created_at.slice(0, 10)` (leer el dia en UTC en
 *     vez de Bogota): cayo el caso de las 7 p.m.
 * El resto siguio verde en las dos, que es justo lo que hace falta comprobar:
 * un test que pasa contra la implementacion mutada no esta probando nada.
 */

import { describe, it, expect } from 'vitest'
import { nombreArchivoSoporte, sanearParaNombreArchivo } from './nombre-soporte'

const BASE = {
  id: '8f2c1b4a-0000-0000-0000-000000000000',
  nombre_consultado: 'Juan Pérez Gómez',
  documento_numero: '1020304050',
  created_at: '2026-09-11T14:05:00Z',
}

describe('sanearParaNombreArchivo', () => {
  it('quita acentos y deja solo minusculas, digitos y guiones', () => {
    expect(sanearParaNombreArchivo('Juan Pérez Gómez')).toBe('juan-perez-gomez')
    expect(sanearParaNombreArchivo('ALMACENES ÑUÑOA S.A.S.')).toBe('almacenes-nunoa-s-a-s')
  })

  it('no deja salir un caracter que rompa la cabecera HTTP', () => {
    const sucio = 'Pedro" ; rm -rf /\r\nX-Inyectado: si'
    const limpio = sanearParaNombreArchivo(sucio)
    expect(limpio).not.toMatch(/["\r\n;/\\]/)
    expect(limpio).toBe('pedro-rm-rf-x-inyectado-si')
  })

  it('recorta y nunca termina en guion', () => {
    const largo = 'Corporacion Internacional de Servicios Integrados de Colombia'
    const limpio = sanearParaNombreArchivo(largo)
    expect(limpio.length).toBeLessThanOrEqual(40)
    expect(limpio.endsWith('-')).toBe(false)
  })

  it('un valor sin un solo caracter util devuelve cadena vacia, no guiones', () => {
    expect(sanearParaNombreArchivo('///   ---   ///')).toBe('')
  })
})

describe('nombreArchivoSoporte', () => {
  it('arma sujeto + documento + fecha de la consulta', () => {
    expect(nombreArchivoSoporte(BASE)).toBe(
      'soporte-listas-juan-perez-gomez-1020304050-2026-09-11.pdf',
    )
  })

  it('la fecha es el dia en Bogota, no en UTC', () => {
    // 2026-09-11 21:30 Bogota = 2026-09-12 02:30 UTC. Leerla en UTC la correria
    // al dia siguiente para todo lo consultado despues de las 7 p.m.
    const tarde = { ...BASE, created_at: '2026-09-12T02:30:00Z' }
    expect(nombreArchivoSoporte(tarde)).toContain('-2026-09-11.pdf')
  })

  it('omite la parte que la consulta no tiene', () => {
    expect(nombreArchivoSoporte({ ...BASE, documento_numero: null })).toBe(
      'soporte-listas-juan-perez-gomez-2026-09-11.pdf',
    )
    expect(nombreArchivoSoporte({ ...BASE, nombre_consultado: null })).toBe(
      'soporte-listas-1020304050-2026-09-11.pdf',
    )
  })

  it('sin sujeto ni documento cae al prefijo del id, nunca a un nombre sin identificador', () => {
    expect(
      nombreArchivoSoporte({ ...BASE, nombre_consultado: null, documento_numero: null }),
    ).toBe('soporte-listas-8f2c1b4a-2026-09-11.pdf')
  })

  it('un nombre que no deja nada tras el saneado tambien cae al id', () => {
    expect(
      nombreArchivoSoporte({ ...BASE, nombre_consultado: '¿?¡!', documento_numero: null }),
    ).toBe('soporte-listas-8f2c1b4a-2026-09-11.pdf')
  })

  it('una fecha ilegible se omite en vez de imprimir NaN', () => {
    const roto = nombreArchivoSoporte({ ...BASE, created_at: 'no-es-una-fecha' })
    expect(roto).not.toContain('NaN')
    expect(roto).toBe('soporte-listas-juan-perez-gomez-1020304050.pdf')
  })
})
