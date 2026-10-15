/**
 * La sugerencia de Wikimedia Commons: qué se pregunta, qué se deja pasar y qué crédito se imprime.
 * La respuesta es de EJEMPLO (forma de la API con `formatversion=2`), armada a mano.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  autorLimpio,
  buscarEnCommons,
  candidatasDeRespuesta,
  consultaDeFoto,
  creditoDeCatalogo,
  elegirCandidata,
  licenciaImprimible,
  urlDeBusqueda,
} from './wikimedia'
import { claveDeFoto, objetivo, sinRepetir } from './clave'

const pagina = (over: { title: string; index: number; licencia?: string; artist?: string; width?: number; height?: number; mime?: string; restrictions?: string }) => ({
  title: over.title,
  index: over.index,
  imageinfo: [{
    url: `https://upload.wikimedia.org/x/${encodeURIComponent(over.title)}`,
    descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(over.title)}`,
    thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(over.title)}/1600px.jpg`,
    thumbwidth: 1600,
    thumbheight: Math.round(1600 * (over.height ?? 2000) / (over.width ?? 3000)),
    width: over.width ?? 3000,
    height: over.height ?? 2000,
    mime: over.mime ?? 'image/jpeg',
    extmetadata: {
      LicenseShortName: { value: over.licencia ?? 'CC BY-SA 4.0' },
      Artist: { value: over.artist ?? '<a href="//commons.wikimedia.org/wiki/User:Ejemplo">Autora de Ejemplo</a>' },
      Restrictions: { value: over.restrictions ?? '' },
    },
  }],
})

const RESPUESTA = {
  query: {
    pages: [
      pagina({ title: 'File:Parque 02.jpg', index: 2, licencia: 'CC BY 4.0' }),
      pagina({ title: 'File:Parque 01.jpg', index: 1, width: 1500, height: 2200 }),
      pagina({ title: 'File:Parque NC.jpg', index: 3, licencia: 'CC BY-NC-SA 2.0' }),
      pagina({ title: 'File:Parque ND.jpg', index: 4, licencia: 'CC BY-ND 3.0' }),
      pagina({ title: 'File:Parque PD.jpg', index: 5, licencia: 'Public domain' }),
      pagina({ title: 'File:Parque chica.jpg', index: 6, width: 640, height: 480 }),
      pagina({ title: 'File:Parque plano.svg', index: 7, mime: 'image/svg+xml' }),
      pagina({ title: 'File:Parque sin autor.jpg', index: 8, artist: 'Unknown author' }),
      pagina({ title: 'File:Parque gente.jpg', index: 9, restrictions: 'personality' }),
      pagina({ title: 'File:Parque cero.jpg', index: 10, licencia: 'CC0' }),
    ],
  },
}

describe('candidatasDeRespuesta', () => {
  const c = candidatasDeRespuesta(RESPUESTA)

  it('solo CC0, CC BY y CC BY-SA, con autor, foto ancha y sin derechos de imagen de personas', () => {
    expect(c.map((x) => x.titulo)).toEqual(['File:Parque 01.jpg', 'File:Parque 02.jpg', 'File:Parque cero.jpg'])
    expect(c.map((x) => x.licencia)).toEqual(['CC BY-SA 4.0', 'CC BY 4.0', 'CC0'])
    expect(c[0].autor).toBe('Autora de Ejemplo')
    expect(c[0].pagina).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\//)
  })

  it('la respuesta vieja (pages como objeto) y la rara no rompen', () => {
    expect(candidatasDeRespuesta({ query: { pages: { a: RESPUESTA.query.pages[1] } } })).toHaveLength(1)
    expect(candidatasDeRespuesta(null)).toEqual([])
    expect(candidatasDeRespuesta({ error: 'x' })).toEqual([])
  })

  it('elige la primera horizontal que nadie descartó', () => {
    // La 01 es vertical: va la 02.
    expect(elegirCandidata(c)?.titulo).toBe('File:Parque 02.jpg')
    expect(elegirCandidata(c, ['File:Parque 02.jpg'])?.titulo).toBe('File:Parque cero.jpg')
    // Sin horizontales libres, la que quede.
    expect(elegirCandidata(c, ['File:Parque 02.jpg', 'File:Parque cero.jpg'])?.titulo).toBe('File:Parque 01.jpg')
    expect(elegirCandidata(c, c.map((x) => x.titulo))).toBeNull()
  })
})

describe('licencias', () => {
  it.each([
    ['CC BY-SA 4.0', 'CC BY-SA 4.0'],
    ['CC-BY-SA-3.0', 'CC BY-SA 3.0'],
    ['CC BY 2.0 de', 'CC BY 2.0 de'],
    ['CC0', 'CC0'],
    ['CC0 1.0', 'CC0 1.0'],
    ['CC BY-NC 2.0', null],
    ['CC BY-NC-SA 4.0', null],
    ['CC BY-ND 3.0', null],
    ['Public domain', null],
    ['GFDL', null],
    ['', null],
  ])('%s → %s', (corta, esperada) => {
    expect(licenciaImprimible(corta)).toBe(esperada)
  })

  it('la que se imprime cabe en el CHECK de la tabla', () => {
    const regla = /^(CC0( 1\.0)?|CC BY(-SA)?( [0-9.]+)?( [a-z]{2,3})?)$/
    for (const l of ['CC BY-SA 4.0', 'CC-BY-SA-3.0', 'CC BY 2.0 de', 'CC0', 'CC0 1.0']) expect(licenciaImprimible(l)).toMatch(regla)
  })
})

describe('el crédito y la consulta', () => {
  it('«Nombre, Autor (Wikimedia Commons, Licencia)»; una foto propia no lleva', () => {
    expect(creditoDeCatalogo({ nombre: 'Park Güell', autor: 'Autora de Ejemplo', licencia: 'CC BY-SA 3.0' })).toBe(
      'Park Güell, Autora de Ejemplo (Wikimedia Commons, CC BY-SA 3.0)',
    )
    expect(creditoDeCatalogo({ nombre: 'Hotel', autor: null, licencia: null })).toBeNull()
  })

  it('el autor sin HTML', () => {
    expect(autorLimpio('<a href="x">Ana&nbsp;Pérez</a> &amp; <span>Luis</span>')).toBe('Ana Pérez & Luis')
    expect(autorLimpio('<span>Unknown author</span>')).toBeNull()
  })

  it('nombre + ciudad, sin repetir la ciudad que el nombre ya dice', () => {
    expect(consultaDeFoto('actividad', 'Park Güell con guía', 'Barcelona')).toBe('Park Güell con guía Barcelona')
    expect(consultaDeFoto('actividad', 'Aquàrium de Barcelona', 'Barcelona')).toBe('Aquàrium de Barcelona')
    expect(consultaDeFoto('hotel', 'H10 Metropolitan', 'Barcelona BCN')).toBe('H10 Metropolitan Barcelona')
    expect(consultaDeFoto('ciudad', 'Ámsterdam', null)).toBe('Ámsterdam')
    const url = new URL(urlDeBusqueda('Park Güell Barcelona'))
    expect(url.searchParams.get('gsrsearch')).toBe('Park Güell Barcelona filetype:bitmap')
    expect(url.searchParams.get('gsrnamespace')).toBe('6')
  })

  it('sin red, lista vacía (nunca un error)', async () => {
    const caida = vi.fn(async () => { throw new Error('sin red') }) as unknown as typeof fetch
    expect(await buscarEnCommons('x', { fetch: caida })).toEqual([])
    const ok = vi.fn(async () => new Response(JSON.stringify(RESPUESTA), { status: 200 })) as unknown as typeof fetch
    expect(await buscarEnCommons('x', { fetch: ok })).toHaveLength(3)
    const [, init] = (ok as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^MetrikONE\//)
  })
})

describe('las llaves del catálogo', () => {
  it('la misma ciudad escrita de varias formas es una llave', () => {
    expect(claveDeFoto('ciudad', 'Ámsterdam')).toBe(claveDeFoto('ciudad', 'AMSTERDAM'))
    expect(claveDeFoto('hotel', 'H10 Metropolitan', 'Barcelona')).toBe('h10 metropolitan|barcelona')
    expect(claveDeFoto('hotel', 'H10  METROPOLITAN', 'Barcelona, España')).toBe('h10 metropolitan|barcelona')
    expect(claveDeFoto('actividad', 'Sagrada Familia', null)).toBe('sagrada familia|')
    expect(claveDeFoto('actividad', '  ', 'Madrid')).toBe('')
  })

  it('sin repetidos', () => {
    const lista = sinRepetir([objetivo('ciudad', 'Madrid'), objetivo('ciudad', 'MADRID'), objetivo('hotel', '', 'Madrid'), objetivo('hotel', 'Sol', 'Madrid')])
    expect(lista.map((o) => `${o.tipo}:${o.clave}`)).toEqual([`ciudad:${claveDeFoto('ciudad', 'Madrid')}`, 'hotel:sol|madrid'])
  })
})
