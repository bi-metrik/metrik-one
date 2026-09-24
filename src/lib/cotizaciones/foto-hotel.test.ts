import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { LADO_MAXIMO_FOTO_HOTEL, BYTES_MAXIMOS_FOTO_HOTEL, TEXTO_AGREGAR_FOTO_HOTEL, medidasFotoHotel, urlDeFotoHotel } from './foto-hotel'
import { leerTarifaPax, type LecturaCasilla } from './tarifa-pasajero'
import { hotelesDeItems } from './detalle-viaje'

const subidas: { subcarpeta: string; nombre: string; mime: string }[] = []
let hayAlmacen = true
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({
  almacenamientoExternoDe: async () => (hayAlmacen
    ? {
      subirArchivo: async (a: { negocioId: string; subcarpeta: string; nombre: string; mime: string }) => {
        subidas.push({ subcarpeta: a.subcarpeta, nombre: a.nombre, mime: a.mime })
        return { referencia: `sbext://one-documentos/negocios/${a.negocioId}/${a.subcarpeta}/${a.nombre}`, path: '', bytes: 0, sha256: '' }
      },
    }
    : null),
}))

const { guardarFotoHotel, validarFotoHotel, MENSAJE_FOTO_NO_ES_IMAGEN, MENSAJE_FOTO_MUY_PESADA, MENSAJE_SIN_ALMACEN } = await import('./foto-hotel-almacen')
const { default: HojaCliente } = await import('@/app/(app)/negocios/hoja-cliente')

const jpeg = (bytes: number) => `data:image/jpeg;base64,${Buffer.alloc(bytes, 7).toString('base64')}`
const REF = 'sbext://one-documentos/negocios/n1/fotos-hotel/c1/i1-abc.jpg'

beforeEach(() => { subidas.length = 0; hayAlmacen = true })

describe('la compresión: el lado mayor a lo sumo 1600 px, sin deformar ni agrandar', () => {
  it('una foto horizontal grande', () => {
    expect(medidasFotoHotel(4000, 3000)).toEqual({ ancho: LADO_MAXIMO_FOTO_HOTEL, alto: 1200 })
  })
  it('una foto vertical grande', () => {
    expect(medidasFotoHotel(3000, 4500)).toEqual({ ancho: 1067, alto: 1600 })
  })
  it('una foto chica queda igual', () => {
    expect(medidasFotoHotel(800, 600)).toEqual({ ancho: 800, alto: 600 })
  })
  it('medidas que no sirven: null', () => {
    expect(medidasFotoHotel(0, 600)).toBeNull()
    expect(medidasFotoHotel(Number.NaN, 600)).toBeNull()
  })
})

describe('se abre por enlace firmado', () => {
  it('pasa por la ruta de archivos, que valida la sesión', () => {
    expect(urlDeFotoHotel(REF)).toBe(`/api/archivos/abrir?ref=${encodeURIComponent(REF)}`)
    expect(urlDeFotoHotel(null)).toBeNull()
  })
})

describe('lo que el servidor acepta', () => {
  it('un JPEG comprimido', () => {
    expect(validarFotoHotel(jpeg(100)).ok).toBe(true)
  })
  it('otro formato o algo que no es imagen: rechazo con su mensaje', () => {
    expect(validarFotoHotel(`data:image/png;base64,${Buffer.from('x').toString('base64')}`)).toEqual({ ok: false, mensaje: MENSAJE_FOTO_NO_ES_IMAGEN })
    expect(validarFotoHotel('hola')).toEqual({ ok: false, mensaje: MENSAJE_FOTO_NO_ES_IMAGEN })
    expect(validarFotoHotel(null)).toEqual({ ok: false, mensaje: MENSAJE_FOTO_NO_ES_IMAGEN })
  })
  it('demasiado pesada: rechazo', () => {
    expect(validarFotoHotel(jpeg(BYTES_MAXIMOS_FOTO_HOTEL + 1))).toEqual({ ok: false, mensaje: MENSAJE_FOTO_MUY_PESADA })
  })
})

describe('se guarda en el almacenamiento propio del workspace', () => {
  it('bajo fotos-hotel/<cotización>, con la opción y la huella en el nombre', async () => {
    const r = await guardarFotoHotel({ workspaceId: 'w1', negocioId: 'n1', cotizacionId: 'c1', itemId: 'i1', dataUrl: jpeg(50) })
    expect(r.ok).toBe(true)
    expect(subidas).toHaveLength(1)
    expect(subidas[0].subcarpeta).toBe('fotos-hotel/c1')
    expect(subidas[0].nombre).toMatch(/^i1-[0-9a-f]{16}\.jpg$/)
    expect(subidas[0].mime).toBe('image/jpeg')
  })
  it('un workspace sin almacenamiento propio no la guarda (nunca al Drive de MeTRIK)', async () => {
    hayAlmacen = false
    expect(await guardarFotoHotel({ workspaceId: 'w1', negocioId: 'n1', cotizacionId: 'c1', itemId: 'i1', dataUrl: jpeg(50) }))
      .toEqual({ ok: false, mensaje: MENSAJE_SIN_ALMACEN })
    expect(subidas).toHaveLength(0)
  })
})

describe('la tarifa guarda la foto sin perderla en la siguiente escritura', () => {
  it('leerTarifaPax la conserva', () => {
    expect(leerTarifaPax({ fotoHotel: { ref: REF, proporcion: 1.5 } }).fotoHotel).toEqual({ ref: REF, proporcion: 1.5 })
  })
  it('una referencia que no es del almacenamiento propio no se lee', () => {
    expect(leerTarifaPax({ fotoHotel: { ref: 'https://x/y.jpg' } }).fotoHotel).toBeUndefined()
  })
  it('sin foto la llave no aparece: la tarifa de siempre se lee igual', () => {
    expect('fotoHotel' in leerTarifaPax({})).toBe(false)
  })
})

const LECTURA = {
  campos: { hotel: { label: 'Hotel', valor: 'Posada Enilda' }, ciudad: { label: 'Ciudad', valor: 'Providencia' } },
} as unknown as LecturaCasilla
const itemHotel = (tarifa: Record<string, unknown>) => ({
  nombre: 'Posada Enilda', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: LECTURA }, ...tarifa },
})

describe('el documento recibe la referencia de la foto', () => {
  it('con foto, el hotel trae fotoRef y su proporción', () => {
    const [h] = hotelesDeItems([itemHotel({ fotoHotel: { ref: REF, proporcion: 1.5 } })])
    expect(h.fotoRef).toBe(REF)
    expect(h.fotoProporcion).toBe(1.5)
  })
  it('sin foto, la ficha no cambia', () => {
    const [h] = hotelesDeItems([itemHotel({})])
    expect('fotoRef' in h).toBe(false)
  })
})

describe('«Así lo ve el cliente»: el lugar de la foto', () => {
  const base = {
    item: itemHotel({}),
    numero: 1,
    bloqueTitulo: 'Hotel en Providencia',
    general: false,
    adicionales: [],
    confirmada: null,
    preciosAMano: undefined,
    precioLinea: 100,
    precioOpcion: 100,
    onGuardarNota: () => {},
  }
  const pintar = (over: Record<string, unknown>) => renderToStaticMarkup(createElement(HojaCliente, { ...base, ...over } as unknown as Parameters<typeof HojaCliente>[0]))

  it('vacío y editable: invita a agregarla', () => {
    const html = pintar({ editable: true, onPonerFoto: () => {} })
    expect(html).toContain('data-foto-hotel="vacia"')
    expect(html).toContain(TEXTO_AGREGAR_FOTO_HOTEL)
  })
  it('con foto: se ve por el enlace firmado, con Cambiar y Quitar', () => {
    const html = pintar({ editable: true, onPonerFoto: () => {}, onQuitarFoto: () => {}, fotoRef: REF })
    expect(html).toContain('data-foto-hotel="con-foto"')
    expect(html).toContain(`src="/api/archivos/abrir?ref=${encodeURIComponent(REF)}"`)
    expect(html).toContain('Cambiar')
    expect(html).toContain('Quitar')
  })
  it('sin poder editar y sin foto: no hay lugar vacío', () => {
    const html = pintar({ editable: false })
    expect(html).not.toContain('data-foto-hotel')
  })
  it('sin poder editar y con foto: se ve, sin botones', () => {
    const html = pintar({ editable: false, fotoRef: REF })
    expect(html).toContain('data-foto-hotel="con-foto"')
    expect(html).not.toContain('Quitar')
  })
})
