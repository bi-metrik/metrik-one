/**
 * El perfil del hotel o del tour en su tarjeta (Mauricio, 2026-10-16). Una sola verdad:
 *  · la foto que se pega, arrastra o sube en la tarjeta va al PERFIL (llave hotel|ciudad, o la del
 *    perfil si el nombre es un alias);
 *  · la tarjeta muestra la del perfil (la que sale en la propuesta) con «+N»; vacía, «Agrega fotos
 *    de este hotel»; si el nombre se parece a otro, «¿Es el mismo hotel que …?»;
 *  · el documento toma la del perfil y la vieja de la opción solo de respaldo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'

import { base, clienteFalso, type Fila } from '../../../test/cotizacion-pdf-doble'

const sesion = vi.hoisted(() => ({ role: 'operator' as string }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: WS, staffId: 's-1', role: sesion.role, error: null }),
}))
vi.mock('@/lib/fotos/catalogo-almacen', async (original) => ({
  ...(await original<typeof import('@/lib/fotos/catalogo-almacen')>()),
  guardarEnCatalogo: async (ws: string, tipo: string) => `one://fotos-catalogo/${ws}/${tipo}/${Math.random().toString(16).slice(2).padEnd(16, '0')}.jpg`,
  enlacesDeCatalogo: async (_ws: string, refs: string[]) => new Map(refs.map((r) => [r, `https://firmada.example/${r.split('/').pop()}`])),
  bytesDeCatalogo: async () => Buffer.from('jpeg'),
  borrarDeCatalogo: async () => {},
}))

const WS = '11111111-2222-3333-4444-555555555555'

import type { HotelPDF, ItemConLectura } from '@/lib/cotizaciones/detalle-viaje'
import { hotelesDeItems } from '@/lib/cotizaciones/detalle-viaje'
import type { LecturaCasilla } from '@/lib/cotizaciones/tarifa-pasajero'
import { TEXTO_AGREGAR_FOTO_HOTEL } from '@/lib/cotizaciones/foto-hotel'
import { claveDeFoto } from './clave'
import { claveDeHotel, fotosDeHotelesDelDocumento, fuenteDeFotoDeHotel } from './foto-hotel-documento'
import { fotoDeLaTarjeta, type ElementoVista, type FotoVista } from './vista'
import { fotoDeHotelABiblioteca } from './foto-hotel-biblioteca'
import { fotosDeBibliotecaDelDocumento } from './catalogo-propuesta'
import { fotosParaTarjetas } from '@/app/(app)/fotos/actions'
import HojaCliente from '@/app/(app)/negocios/hoja-cliente'

const LECTURA = {
  total: 900000,
  campos: [{ label: 'Hotel', valor: 'Posada Enilda' }, { label: 'Ciudad', valor: 'Providencia' }, { label: 'Moneda', valor: 'COP' }, { label: 'Precio', valor: '900000' }],
  moneda: 'COP',
  nombre: 'Posada Enilda',
  alertas: [],
  leidaEn: '2026-10-16T16:00:00.000Z',
  porTipo: [],
  notasCliente: [],
} as unknown as LecturaCasilla
const ITEM: ItemConLectura = { nombre: 'Posada Enilda', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: LECTURA } } }
const REF_VIEJA = 'sbext://one-documentos/negocios/n1/fotos-hotel/c1/i1-abc.jpg'

async function dataUrl(color = 90): Promise<string> {
  const b = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: color, g: 160, b: 190 } } }).jpeg().toBuffer()
  return `data:image/jpeg;base64,${b.toString('base64')}`
}

function sembrar(plantilla = 'trappvel', configExtra: Record<string, unknown> = {}, fotos: Fila[] = []) {
  base.secuencia = 0
  base.tablas = { workspaces: [{ id: WS, cotizacion_template_slug: plantilla, config_extra: configExtra }], fotos_catalogo: fotos, fotos_perfiles: [], fotos_perfiles_alias: [] }
}

const filaHotel = (over: Fila): Fila => ({
  id: `f-${Math.random().toString(16).slice(2)}`,
  workspace_id: WS,
  tipo: 'hotel',
  clave: 'posada enilda|providencia',
  nombre_clave: 'posada enilda',
  nombre: 'Posada Enilda',
  ciudad: 'Providencia',
  ref: `one://fotos-catalogo/${WS}/hotel/${'a'.repeat(16)}.jpg`,
  origen: 'asesora',
  fuente_url: null,
  titulo_fuente: null,
  autor: null,
  licencia: null,
  foco_x: null,
  foco_y: null,
  proporcion: 1.5,
  revisada: true,
  descartadas: [],
  principal: true,
  posicion: 1,
  imagen_url: null,
  ...over,
})

beforeEach(() => {
  sesion.role = 'operator'
  sembrar()
})
afterEach(() => vi.unstubAllGlobals())

describe('la misma llave en la tarjeta, la biblioteca y el documento', () => {
  it('el hotel de la opción, el de la cotización y el del documento dan la misma llave hotel|ciudad', () => {
    const [h] = hotelesDeItems([ITEM])
    const delPedidoDeLaTarjeta = claveDeFoto('hotel', h.hotel ?? h.linea, h.ciudad)
    expect(delPedidoDeLaTarjeta).toBe('posada enilda|providencia')
    expect(claveDeHotel(h)).toBe(delPedidoDeLaTarjeta)
  })
})

describe('el documento: la biblioteca manda, la foto vieja de la opción es el respaldo', () => {
  const hotel = (over: Partial<HotelPDF> = {}): HotelPDF => ({ ...hotelesDeItems([ITEM])[0], ...over })
  const biblioteca = new Map([['posada enilda|providencia', { proporcion: 1.5 }]])
  const lecturas: string[] = []
  const leer = {
    leerDeBiblioteca: async (clave: string) => (lecturas.push(`bib:${clave}`), 'data:image/jpeg;base64,BIB'),
    leerDeOpcion: async (ref: string) => (lecturas.push(`op:${ref}`), 'data:image/jpeg;base64,OPCION'),
  }
  beforeEach(() => { lecturas.length = 0 })

  it('fuente: biblioteca si la hay; si no, la de la opción; si no, ninguna', () => {
    expect(fuenteDeFotoDeHotel(true, REF_VIEJA)).toBe('biblioteca')
    expect(fuenteDeFotoDeHotel(false, REF_VIEJA)).toBe('opcion')
    expect(fuenteDeFotoDeHotel(false, null)).toBeNull()
  })

  it('@react-pdf: con foto en la biblioteca imprime ESA aunque la opción tenga la vieja', async () => {
    const [h] = await fotosDeHotelesDelDocumento([hotel({ fotoRef: REF_VIEJA, fotoProporcion: 1.2 })], { biblioteca, motorHtml: false, ...leer })
    expect(h.foto).toEqual({ url: 'data:image/jpeg;base64,BIB', proporcion: 1.5, credito: null })
    expect(lecturas).toEqual(['bib:posada enilda|providencia'])
  })

  it('motor html: con foto en la biblioteca no pone la vieja (la pone el catálogo, con sus extras)', async () => {
    const [h] = await fotosDeHotelesDelDocumento([hotel({ fotoRef: REF_VIEJA })], { biblioteca, motorHtml: true, ...leer })
    expect(h.foto).toBeUndefined()
    expect(lecturas).toEqual([])
  })

  it('sin foto en la biblioteca: la de la opción, como antes (los dos motores)', async () => {
    for (const motorHtml of [false, true]) {
      const [h] = await fotosDeHotelesDelDocumento([hotel({ fotoRef: REF_VIEJA, fotoProporcion: 1.2 })], { biblioteca: new Map(), motorHtml, ...leer })
      expect(h.foto).toEqual({ url: 'data:image/jpeg;base64,OPCION', proporcion: 1.2 })
    }
  })

  it('la biblioteca no se pudo leer: respaldo de la opción; sin ninguna, el hotel queda como venía', async () => {
    const falla = { ...leer, leerDeBiblioteca: async () => null }
    const [conVieja] = await fotosDeHotelesDelDocumento([hotel({ fotoRef: REF_VIEJA })], { biblioteca, motorHtml: false, ...falla })
    expect(conVieja.foto?.url).toBe('data:image/jpeg;base64,OPCION')
    const [sinNada] = await fotosDeHotelesDelDocumento([hotel()], { biblioteca: new Map(), motorHtml: false, ...leer })
    expect(sinNada.foto).toBeUndefined()
  })
})

describe('lo que la tarjeta muestra de la biblioteca', () => {
  const foto = (over: Partial<FotoVista>): FotoVista => ({
    id: 'x', url: 'https://u/x.jpg', principal: false, origen: 'asesora', fuente: null, seImprime: true, categoria: null, ...over,
  })
  const elemento = (fotos: FotoVista[]): ElementoVista => ({ tipo: 'hotel', clave: 'k', nombre: 'H', ciudad: 'C', fotos, admiteOtra: fotos.length < 3, alias: [] })

  it('la principal y «+2» con tres fotos', () => {
    const r = fotoDeLaTarjeta(elemento([foto({ id: 'a', principal: true }), foto({ id: 'b' }), foto({ id: 'c' })]))
    expect(r).toEqual({ foto: expect.objectContaining({ id: 'a' }), mas: 2, admiteOtra: false })
  })

  it('si la principal no sale en la propuesta (una de la página oficial, de antes), muestra la primera que sí', () => {
    const r = fotoDeLaTarjeta(elemento([foto({ id: 'a', principal: true, origen: 'sitio_oficial', seImprime: false }), foto({ id: 'b' })]))
    expect(r.foto?.id).toBe('b')
    expect(r.mas).toBe(0)
  })

  it('sin fotos (o sin ninguna imprimible): vacía, y cabe otra', () => {
    expect(fotoDeLaTarjeta(null)).toEqual({ foto: null, mas: 0, admiteOtra: true })
    expect(fotoDeLaTarjeta(elemento([foto({ seImprime: false })])).foto).toBeNull()
  })
})

describe('el recuadro de la tarjeta («Así lo ve el cliente»)', () => {
  const props = {
    item: ITEM, numero: 1, bloqueTitulo: 'Hotel en Providencia', general: false, adicionales: [], confirmada: null,
    preciosAMano: undefined, precioLinea: 100, precioOpcion: 100, onGuardarNota: () => {},
  }
  const pintar = (over: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(HojaCliente, { ...props, ...over } as unknown as Parameters<typeof HojaCliente>[0]))
  const biblioteca = (over: Record<string, unknown> = {}) => ({
    tipo: 'hotel', foto: null, mas: 0, admiteOtra: true, duda: null, contestando: false, onContestar: () => {}, onVerFotos: () => {}, ...over,
  })

  it('con foto en el perfil: la muestra de una vez, con «+2» y «Ver fotos»; lleno, sin «Agregar»; nunca «Quitar»', () => {
    const html = pintar({ editable: true, onPonerFoto: () => {}, onQuitarFoto: () => {}, biblioteca: biblioteca({ foto: { url: 'https://firmada.example/a.jpg' }, mas: 2, admiteOtra: false }) })
    expect(html).toContain('data-foto-hotel="con-foto"')
    expect(html).toContain('data-de-biblioteca')
    expect(html).toContain('src="https://firmada.example/a.jpg"')
    expect(html).toMatch(/data-mas-fotos[^>]*>\+2</)
    expect(html).toContain('Ver fotos')
    expect(html).not.toContain('data-agregar-foto')
    expect(html).not.toContain('Quitar')
  })

  it('con foto y lugar para otra: «Agregar» (pegar o subir otra al perfil)', () => {
    const html = pintar({ editable: true, onPonerFoto: () => {}, biblioteca: biblioteca({ foto: { url: 'https://firmada.example/a.jpg' }, mas: 0, admiteOtra: true }) })
    expect(html).toContain('data-agregar-foto')
    expect(html).toContain('type="file"')
  })

  it('el perfil manda sobre la foto vieja de la opción', () => {
    const html = pintar({ editable: true, onPonerFoto: () => {}, fotoRef: REF_VIEJA, biblioteca: biblioteca({ foto: { url: 'https://firmada.example/a.jpg' } }) })
    expect(html).toContain('src="https://firmada.example/a.jpg"')
    expect(html).not.toContain(encodeURIComponent(REF_VIEJA))
  })

  it('vacía: «Agrega fotos de este hotel» para pegar, arrastrar o subir; nada de búsquedas', () => {
    const html = pintar({ editable: true, onPonerFoto: () => {}, biblioteca: biblioteca() })
    expect(html).toContain('data-foto-hotel="vacia"')
    expect(html).toContain('Agrega fotos de este hotel')
    expect(html).toContain('Pégala, arrástrala o súbela')
    expect(html).toContain('type="file"')
    expect(html).not.toContain('Buscar fotos')
  })

  it('sin foto en el perfil pero con la vieja de la opción: se ve la vieja, con «Agregar», «Ver fotos» y «Quitar»', () => {
    const html = pintar({ editable: true, onPonerFoto: () => {}, onQuitarFoto: () => {}, fotoRef: REF_VIEJA, biblioteca: biblioteca() })
    expect(html).toContain(`src="/api/archivos/abrir?ref=${encodeURIComponent(REF_VIEJA)}"`)
    expect(html).toContain('data-agregar-foto')
    expect(html).toContain('Ver fotos')
    expect(html).toContain('Quitar')
  })

  it('sin poder editar: la foto del perfil se ve y se puede abrir, sin agregar', () => {
    const html = pintar({ editable: false, biblioteca: biblioteca({ foto: { url: 'https://firmada.example/a.jpg' }, mas: 1 }) })
    expect(html).toContain('src="https://firmada.example/a.jpg"')
    expect(html).toContain('+1')
    expect(html).toContain('Ver fotos')
    expect(html).not.toContain('data-agregar-foto')
  })

  it('con duda: en el lugar de la foto, «¿Es el mismo hotel que …?» con sus dos respuestas', () => {
    const duda = { clave: 'posada enilda|providencia', nombre: 'Posada Enilda Providencia', ciudad: 'Providencia', url: 'https://firmada.example/p.jpg' }
    const html = pintar({ editable: true, onPonerFoto: () => {}, biblioteca: biblioteca({ duda }) })
    expect(html).toContain('data-pregunta-mismo')
    expect(html).toContain('¿Es el mismo hotel que <b>«Posada Enilda Providencia»</b> (Providencia)?')
    expect(html).toContain('Sí, es el mismo')
    expect(html).toContain('No, es otro')
    expect(html).not.toContain('data-foto-hotel')
  })

  it('un espacio sin biblioteca queda como antes: la foto de la opción, sin perfil', () => {
    const html = pintar({ editable: true, onPonerFoto: () => {} })
    expect(html).toContain('data-foto-hotel="vacia"')
    expect(html).toContain(TEXTO_AGREGAR_FOTO_HOTEL)
    expect(html).not.toContain('Ver fotos')
  })

  it('un tour con perfil lleva su recuadro de foto al lado de su línea', () => {
    const TOUR: ItemConLectura = { nombre: 'City tour', grupo: 'actividad', tarifa_pax: {} }
    const html = pintar({ item: TOUR, editable: true, onPonerFoto: () => {}, biblioteca: biblioteca({ tipo: 'actividad' }) })
    expect(html).toContain('data-linea-cliente')
    expect(html).toContain('Agrega fotos de este tour')
    const sinPerfil = pintar({ item: TOUR, editable: true })
    expect(sinPerfil).not.toContain('data-foto-hotel')
  })
})

describe('la foto de la tarjeta se guarda en la biblioteca (servidor)', () => {
  const base_ = {
    supabase: clienteFalso(), workspaceId: WS, staffId: 's-1', role: 'operator', item: ITEM,
    userId: 'u-1', autorizacion: { autorizada: true, procedencia: 'kit de medios del hotel' },
  }

  it('en un espacio con propuesta de viaje: queda en la biblioteca con la llave del hotel, elegida por una persona', async () => {
    const r = await fotoDeHotelABiblioteca({ ...base_, dataUrl: await dataUrl() })
    expect(r).toMatchObject({ ok: true })
    const filas = base.tablas.fotos_catalogo
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ tipo: 'hotel', clave: 'posada enilda|providencia', origen: 'asesora', revisada: true, principal: true, posicion: 1 })
    if (r?.ok) expect(r.elemento?.fotos[0]).toMatchObject({ seImprime: true, principal: true, url: expect.stringContaining('https://firmada.example/') })
  })

  it('la primera vez crea el perfil del hotel', async () => {
    await fotoDeHotelABiblioteca({ ...base_, dataUrl: await dataUrl() })
    expect(base.tablas.fotos_perfiles.map((p) => p.clave)).toEqual(['posada enilda|providencia'])
  })

  it('con `reemplaza`, cambia esa foto (no agrega una segunda)', async () => {
    const primera = await fotoDeHotelABiblioteca({ ...base_, dataUrl: await dataUrl() })
    const id = primera?.ok ? primera.elemento?.fotos[0].id : null
    const r = await fotoDeHotelABiblioteca({ ...base_, dataUrl: await dataUrl(200), reemplaza: id })
    expect(r).toMatchObject({ ok: true })
    expect(base.tablas.fotos_catalogo).toHaveLength(1)
  })

  it('en otro espacio (sin biblioteca): `null`, la foto va a la opción como antes', async () => {
    sembrar('termotech')
    expect(await fotoDeHotelABiblioteca({ ...base_, dataUrl: await dataUrl() })).toBeNull()
    expect(base.tablas.fotos_catalogo).toHaveLength(0)
  })

  it('un rol de solo lectura no la cambia', async () => {
    expect(await fotoDeHotelABiblioteca({ ...base_, role: 'read_only', dataUrl: await dataUrl() })).toEqual({ ok: false, mensaje: expect.stringContaining('no cambiarlas') })
    expect(base.tablas.fotos_catalogo).toHaveLength(0)
  })
})

describe('el documento lee las fotos de hotel y de plan de la biblioteca', () => {
  const hoteles = [{ hotel: 'Posada Enilda', linea: 'Posada Enilda', ciudad: 'Providencia' }]

  it('la imprimible, con su proporción', async () => {
    sembrar('trappvel', {}, [filaHotel({})])
    const r = await fotosDeBibliotecaDelDocumento(clienteFalso(), WS, hoteles)
    expect([...r.hoteles]).toEqual([['posada enilda|providencia', { proporcion: 1.5, credito: null }]])
    expect(await r.leerHotel('posada enilda|providencia')).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('una de Commons (de antes) lleva su crédito (autor y licencia) hasta el PDF de @react-pdf', async () => {
    sembrar('trappvel', {}, [
      filaHotel({
        origen: 'wikimedia', fuente_url: 'https://commons.wikimedia.org/wiki/File:Posada.jpg', titulo_fuente: 'File:Posada.jpg',
        autor: 'Ana Pérez', licencia: 'CC BY-SA 4.0',
      }),
    ])
    const r = await fotosDeBibliotecaDelDocumento(clienteFalso(), WS, hoteles)
    const credito = r.hoteles.get('posada enilda|providencia')?.credito
    expect(credito).toMatch(/Ana Pérez/)
    expect(credito).toMatch(/CC BY-SA 4\.0/)
    const [h] = await fotosDeHotelesDelDocumento([{ hotel: 'Posada Enilda', linea: 'Posada Enilda', ciudad: 'Providencia' } as never], {
      biblioteca: r.hoteles, motorHtml: false, leerDeBiblioteca: r.leerHotel, leerDeOpcion: async () => null,
    })
    expect((h as { foto?: { credito?: string | null } }).foto?.credito).toBe(credito)
  })

  it('una de la página oficial (de antes) nunca cuenta: la siguiente que sí', async () => {
    sembrar('trappvel', {}, [
      filaHotel({ id: 'a', origen: 'sitio_oficial', fuente_url: 'https://hotel.example/', principal: true, posicion: 1 }),
      filaHotel({ id: 'b', principal: false, posicion: 2, proporcion: 1.33 }),
    ])
    expect([...(await fotosDeBibliotecaDelDocumento(clienteFalso(), WS, hoteles)).hoteles]).toEqual([['posada enilda|providencia', { proporcion: 1.33, credito: null }]])
  })

  it('el plan opcional, por la llave de su nombre y su ciudad (la misma de su tarjeta)', async () => {
    sembrar('trappvel', {}, [
      filaHotel({ id: 'p', tipo: 'actividad', clave: 'tour de manglares|providencia', nombre: 'Tour de manglares', ciudad: 'Providencia', proporcion: 1.5 }),
    ])
    const r = await fotosDeBibliotecaDelDocumento(clienteFalso(), WS, [], [{ nombre: 'Tour de manglares', ciudad: 'Providencia' }, { nombre: 'Otro plan', ciudad: null }])
    expect(await r.opcional('Tour de manglares')).toMatchObject({ url: expect.stringMatching(/^data:image\/jpeg;base64,/), proporcion: 1.5, credito: null })
    expect(await r.opcional('Otro plan')).toBeNull()
  })

  it('sin fotos en la biblioteca: vacía (el documento usa la de la opción)', async () => {
    expect((await fotosDeBibliotecaDelDocumento(clienteFalso(), WS, hoteles)).hoteles.size).toBe(0)
  })
})

describe('una sola lectura para todas las tarjetas', () => {
  it('devuelve solo lo pedido, con la llave calculada en el servidor', async () => {
    sembrar('trappvel', {}, [filaHotel({}), filaHotel({ id: 'otro', clave: 'otro hotel|cartagena', nombre: 'Otro Hotel', ciudad: 'Cartagena', nombre_clave: 'otro hotel' })])
    const r = await fotosParaTarjetas([{ tipo: 'hotel', nombre: 'Posada Enilda', ciudad: 'PROVIDENCIA' }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tarjetas.map((t) => [t.clave, t.elemento?.clave, t.elemento?.fotos.length])).toEqual([['posada enilda|providencia', 'posada enilda|providencia', 1]])
    expect(r).toMatchObject({ editable: true })
  })

  it('un espacio sin propuesta de viaje: no hay biblioteca y la tarjeta queda como antes', async () => {
    sembrar('termotech')
    expect((await fotosParaTarjetas([{ tipo: 'hotel', nombre: 'Posada Enilda', ciudad: 'Providencia' }])).ok).toBe(false)
  })
})
