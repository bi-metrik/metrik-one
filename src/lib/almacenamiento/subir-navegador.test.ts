import { describe, expect, it } from 'vitest'
import { subirAUrlFirmada } from './subir-navegador'

const URL_FIRMADA = 'https://x.supabase.co/storage/v1/object/upload/sign/one-documentos/negocios/a/_pendientes/b.pdf?token=t'

describe('subirAUrlFirmada', () => {
  it('hace un PUT a la URL firmada, con el tipo y sin ninguna llave', async () => {
    const llamadas: Array<{ url: string; init: RequestInit }> = []
    const r = await subirAUrlFirmada(URL_FIRMADA, new Blob(['%PDF']), 'application/pdf', async (url, init) => {
      llamadas.push({ url, init })
      return new Response('{"Key":"x"}', { status: 200 })
    })
    expect(r).toEqual({ ok: true })
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].url).toBe(URL_FIRMADA)
    expect(llamadas[0].init.method).toBe('PUT')
    const headers = llamadas[0].init.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/pdf')
    expect(Object.keys(headers).map(h => h.toLowerCase())).not.toContain('apikey')
    expect(Object.keys(headers).map(h => h.toLowerCase())).not.toContain('authorization')
  })

  it('traduce el error de Storage a un mensaje legible', async () => {
    const r = await subirAUrlFirmada(URL_FIRMADA, new Blob(['x']), 'application/zip', async () =>
      new Response('{"statusCode":"415","error":"invalid_mime_type","message":"mime type application/zip is not supported"}', {
        status: 400,
      }),
    )
    expect(r).toEqual({ ok: false, error: 'No se pudo subir el archivo (400): mime type application/zip is not supported' })
  })

  it('un fallo de red no lanza: devuelve el error', async () => {
    const r = await subirAUrlFirmada(URL_FIRMADA, new Blob(['x']), 'application/pdf', async () => {
      throw new Error('Failed to fetch')
    })
    expect(r).toEqual({ ok: false, error: 'No se pudo subir el archivo: Failed to fetch' })
  })
})
