/**
 * Las acciones de la biblioteca de fotos sobre el doble de Supabase: quién puede, el interruptor
 * de la página oficial, las 12 opciones que no se guardan y el tope de 3.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

const sesion = vi.hoisted(() => ({ role: 'operator' as string }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: WS, staffId: 's-1', role: sesion.role, error: null }),
}))
vi.mock('@/lib/fotos/catalogo-almacen', async (original) => ({
  ...(await original<typeof import('@/lib/fotos/catalogo-almacen')>()),
  guardarEnCatalogo: async (ws: string, tipo: string) => `one://fotos-catalogo/${ws}/${tipo}/${Math.random().toString(16).slice(2).padEnd(16, '0')}.jpg`,
  enlacesDeCatalogo: async () => new Map(),
  borrarDeCatalogo: async () => {},
}))

const WS = '11111111-2222-3333-4444-555555555555'

import { fuentesDelSelector } from '@/lib/fotos/clave'
import { elegirFoto, leerBibliotecaDeFotos, opcionesDeFoto, paginaOficialSugerida, subirFotoABiblioteca } from './actions'

function sembrar(configExtra: Record<string, unknown> = {}, plantilla = 'trappvel') {
  base.secuencia = 0
  base.tablas = {
    workspaces: [{ id: WS, cotizacion_template_slug: plantilla, config_extra: configExtra }],
    fotos_catalogo: [],
  }
}

let llamadas: string[] = []
function commons() {
  const pagina = (i: number) => ({
    title: `File:Foto ${i}.jpg`,
    index: i + 1,
    imageinfo: [{
      descriptionurl: `https://commons.wikimedia.org/wiki/File:Foto_${i}.jpg`,
      thumburl: `https://upload.wikimedia.org/thumb/${i}.jpg`,
      thumbwidth: 400, thumbheight: 266, width: 3000, height: 2000, mime: 'image/jpeg',
      extmetadata: { LicenseShortName: { value: 'CC BY 4.0' }, Artist: { value: `Autora ${i}` } },
    }],
  })
  vi.stubGlobal('fetch', async (url: string) => {
    llamadas.push(String(url))
    if (String(url).startsWith('https://commons.wikimedia.org/w/api.php')) {
      return new Response(JSON.stringify({ query: { pages: Array.from({ length: 30 }, (_, i) => pagina(i)) } }))
    }
    return new Response('no', { status: 404 })
  })
}

async function dataUrl(color = 90): Promise<string> {
  const b = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: color, g: 160, b: 190 } } }).jpeg().toBuffer()
  return `data:image/jpeg;base64,${b.toString('base64')}`
}

const HOTEL = { tipo: 'hotel', nombre: 'H10 Metropolitan', ciudad: 'Barcelona' }

beforeEach(() => {
  sesion.role = 'operator'
  llamadas = []
  sembrar()
  commons()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('la biblioteca', () => {
  it('solo en espacios con propuesta de viaje', async () => {
    sembrar({}, 'termotech')
    expect(await leerBibliotecaDeFotos()).toEqual({ ok: false, error: expect.stringContaining('no tiene') })
  })

  it('un rol de solo lectura la ve pero no cambia nada', async () => {
    sesion.role = 'read_only'
    expect((await leerBibliotecaDeFotos()).ok).toBe(true)
    expect(await subirFotoABiblioteca(HOTEL, await dataUrl())).toEqual({ ok: false, error: expect.stringContaining('no cambiarlas') })
  })
})

describe('12 opciones, «Ver más» y nada se guarda hasta elegir', () => {
  it('Commons da 12 por tanda para un hotel (lo elige una persona), sin escribir nada', async () => {
    const r = await opcionesDeFoto(HOTEL, 'wikimedia', null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.opciones).toHaveLength(12)
    expect(r.opciones[0]).toMatchObject({ fuente: 'wikimedia', titulo: 'File:Foto 0.jpg', credito: 'Autora 0 · CC BY 4.0' })
    expect(r.siguiente).toBe('1')
    const mas = await opcionesDeFoto(HOTEL, 'wikimedia', r.siguiente)
    expect(mas.ok && mas.opciones.map((o) => o.titulo)[0]).toBe('File:Foto 12.jpg')
    // Las candidatas NO se guardan.
    expect(base.tablas.fotos_catalogo).toHaveLength(0)
  })
})

describe('la página oficial, detrás del interruptor', () => {
  it('apagada (por defecto): el selector no la ofrece y las acciones la rechazan sin salir a la red', async () => {
    expect(fuentesDelSelector(false)).toEqual(['wikimedia', 'subida'])
    expect((await leerBibliotecaDeFotos()) as { sitioOficial?: boolean }).toMatchObject({ ok: true, sitioOficial: false })
    expect(await opcionesDeFoto(HOTEL, 'sitio_oficial', null, 'https://www.hotel.example/galeria')).toEqual({ ok: false, error: expect.stringContaining('no están encendidas') })
    expect(await paginaOficialSugerida(HOTEL)).toEqual({ ok: false, error: expect.stringContaining('no están encendidas') })
    expect(await elegirFoto(HOTEL, { fuente: 'sitio_oficial', pagina: 'https://www.hotel.example/', imagen: 'https://www.hotel.example/a.jpg' })).toEqual({
      ok: false,
      error: expect.stringContaining('no están encendidas'),
    })
    expect(llamadas).toEqual([])
    expect(base.tablas.fotos_catalogo).toHaveLength(0)
  })

  it('encendida: va primera en el selector y pide la URL si no la tiene', async () => {
    sembrar({ documento_viaje: { fotos_sitio_oficial: true } })
    expect(fuentesDelSelector(true)[0]).toBe('sitio_oficial')
    expect(await opcionesDeFoto(HOTEL, 'sitio_oficial', null, '')).toEqual({ ok: false, error: expect.stringContaining('Pega la dirección') })
  })
})

describe('máximo 3 por elemento', () => {
  it('la cuarta subida no entra', { timeout: 30_000 }, async () => {
    for (let i = 0; i < 3; i++) expect((await subirFotoABiblioteca(HOTEL, await dataUrl(i * 50))).ok).toBe(true)
    const filas = base.tablas.fotos_catalogo as Fila[]
    expect(filas.map((f) => [f.posicion, f.principal])).toEqual([[1, true], [2, false], [3, false]])
    expect(await subirFotoABiblioteca(HOTEL, await dataUrl(220))).toEqual({ ok: false, error: expect.stringContaining('Ya tiene 3 fotos') })
    expect(base.tablas.fotos_catalogo).toHaveLength(3)
  })
})
