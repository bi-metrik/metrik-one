import { describe, expect, it } from 'vitest'

import { fondoDeMiniatura, opcionesDeLaPestana, type OpcionFoto } from '@/lib/fotos/vista'
import { clasificarFotosDeHotel, FOTOS_POR_LLAMADA, normalizarClasificacion } from './clasificar-fotos-hotel'

describe('la respuesta del clasificador de fotos de hotel', () => {
  it('una clasificación por foto, en el orden en que se mandaron', () => {
    expect(normalizarClasificacion({ fotos: [{ n: 2, categoria: 'habitacion' }, { n: 1, categoria: 'no_es_hotel' }] }, 3)).toEqual(['no_es_hotel', 'habitacion', null])
  })

  it('números fuera de rango, repetidos o categorías desconocidas dejan la foto sin clasificar', () => {
    expect(normalizarClasificacion({ fotos: [{ n: 0, categoria: 'fachada' }, { n: 1, categoria: 'piscina' }, { n: 2, categoria: 'fachada' }, { n: 2, categoria: 'habitacion' }] }, 2)).toEqual([null, 'fachada'])
    expect(normalizarClasificacion(null, 2)).toEqual([null, null])
    expect(normalizarClasificacion({ fotos: 'x' }, 1)).toEqual([null])
  })

  it('sin llave no llama a nadie y todo queda sin clasificar', async () => {
    const r = await clasificarFotosDeHotel([{ bytes: Buffer.from('x'), mime: 'image/jpeg' }], { apiKey: undefined, hotel: 'H', ciudad: null, fetch: () => { throw new Error('no') } })
    expect(r).toEqual([null])
  })

  it('va de a 12 por llamada; una tanda caída deja SUS fotos sin clasificar', async () => {
    let llamada = 0
    const f = (async (_u: string, init?: RequestInit) => {
      llamada++
      const n = (JSON.parse(String(init?.body)).contents[0].parts as { inline_data?: unknown }[]).filter((p) => p.inline_data).length
      if (llamada > 1) return new Response('caído', { status: 503 })
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ fotos: Array.from({ length: n }, (_, i) => ({ n: i + 1, categoria: 'fachada' })) }) }] } }] })
    }) as unknown as typeof fetch
    const fotos = Array.from({ length: FOTOS_POR_LLAMADA + 2 }, () => ({ bytes: Buffer.from('x'), mime: 'image/jpeg' }))
    const r = await clasificarFotosDeHotel(fotos, { apiKey: 'k', hotel: 'H', ciudad: null, fetch: f })
    expect(r.filter((x) => x === 'fachada')).toHaveLength(FOTOS_POR_LLAMADA)
    expect(r.slice(FOTOS_POR_LLAMADA)).toEqual([null, null])
  })
})

describe('lo que muestra cada pestaña', () => {
  const op = (id: string, categoria: OpcionFoto['categoria']): OpcionFoto => ({ id, fuente: 'wikimedia', miniatura: '', ancho: 1, alto: 1, titulo: id, credito: null, pagina: '', categoria })

  it('las suyas y, aparte, las sin clasificar (en todas las pestañas)', () => {
    const opciones = [op('a', 'fachada'), op('b', 'habitacion'), op('c', null), op('a', 'fachada')]
    expect(opcionesDeLaPestana(opciones, 'fachada')).toEqual({ propias: [opciones[0]], sinClasificar: [opciones[2]] })
    expect(opcionesDeLaPestana(opciones, 'zonas_comunes')).toEqual({ propias: [], sinClasificar: [opciones[2]] })
  })
})

describe('la miniatura con paréntesis en la URL', () => {
  it('va entre comillas', () => {
    expect(fondoDeMiniatura('https://upload.wikimedia.org/a_(1).jpg')).toBe('url("https://upload.wikimedia.org/a_(1).jpg")')
  })
})
