/**
 * Ctrl+V de una imagen copiada desde el navegador (Mauricio, 2026-10-16): el archivo image/png
 * manda; si solo llegó HTML con <img src>, esa URL (o el data: URL); un texto no es una imagen.
 */
import { describe, expect, it } from 'vitest'

import { blobDeDataUrl, imagenDeHtml, imagenDelPortapapeles, type Portapapeles } from './portapapeles'

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function portapapeles(p: { files?: Blob[]; items?: { kind: string; type: string; archivo?: Blob }[]; datos?: Record<string, string> }): Portapapeles {
  return {
    files: p.files as Portapapeles['files'],
    items: (p.items ?? []).map((it) => ({ kind: it.kind, type: it.type, getAsFile: () => (it.archivo ?? null) as never })),
    getData: (formato) => p.datos?.[formato] ?? '',
  }
}

describe('qué imagen trae un pegado', () => {
  it('«Copiar imagen» (image/png + text/html): manda el archivo', () => {
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const r = imagenDelPortapapeles(portapapeles({ files: [png], datos: { 'text/html': '<img src="https://cdn.hotel.example/a.jpg">' } }))
    expect(r).toEqual({ tipo: 'archivo', archivo: png })
  })

  it('la imagen solo en `items` (sin `files`) también vale', () => {
    const png = new Blob([new Uint8Array([1])], { type: 'image/png' })
    expect(imagenDelPortapapeles(portapapeles({ items: [{ kind: 'string', type: 'text/html' }, { kind: 'file', type: 'image/png', archivo: png }] }))).toEqual({ tipo: 'archivo', archivo: png })
  })

  it('solo text/html con <img src="https://…">: la URL (para bajarla en el servidor)', () => {
    const html = '<meta charset="utf-8"><img src="https://www.hotel.example/im/hab.jpg?w=1600&amp;q=80" alt="Habitación">'
    expect(imagenDelPortapapeles(portapapeles({ datos: { 'text/html': html } }))).toEqual({ tipo: 'url', url: 'https://www.hotel.example/im/hab.jpg?w=1600&q=80' })
    expect(imagenDeHtml(html, 'https://www.hotel.example/im/hab.jpg?w=1600&q=80')).toEqual({ tipo: 'url', url: 'https://www.hotel.example/im/hab.jpg?w=1600&q=80' })
  })

  it('un <img> con data: URL: la imagen tal cual', () => {
    expect(imagenDelPortapapeles(portapapeles({ datos: { 'text/html': `<img src='${PNG_1PX}'>` } }))).toEqual({ tipo: 'data', dataUrl: PNG_1PX })
  })

  it('un texto no es una imagen: un párrafo con una foto en medio, una URL suelta, un http o un src relativo', () => {
    expect(imagenDelPortapapeles(portapapeles({ datos: { 'text/html': '<p>Habitación doble <img src="https://h.example/a.jpg"> con vista</p>', 'text/plain': 'Habitación doble con vista' } }))).toBeNull()
    expect(imagenDelPortapapeles(portapapeles({ datos: { 'text/plain': 'https://www.hilton.com/en/hotels/ctghihh-hilton-cartagena/' } }))).toBeNull()
    expect(imagenDelPortapapeles(portapapeles({ datos: { 'text/html': '<img src="http://h.example/a.jpg">' } }))).toBeNull()
    expect(imagenDelPortapapeles(portapapeles({ datos: { 'text/html': '<img src="/a.jpg">' } }))).toBeNull()
    expect(imagenDelPortapapeles(null)).toBeNull()
  })
})

describe('el data: URL como archivo', () => {
  it('un PNG vuelve como Blob image/png; lo que no es imagen, null', async () => {
    const b = blobDeDataUrl(PNG_1PX)
    expect(b?.type).toBe('image/png')
    expect(new Uint8Array(await b!.arrayBuffer()).slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]))
    expect(blobDeDataUrl('data:text/html;base64,PGI+')).toBeNull()
  })
})
