/**
 * «Hoteles y tours» sobre el doble de Supabase (Mauricio, 2026-10-16): el perfil se crea solo la
 * primera vez que el hotel o el tour entra a una cotización; el mismo hotel con otro nombre se
 * reconoce (sin preguntar si es seguro, preguntando si es dudoso, y la respuesta se recuerda); las
 * fotos se suben al perfil y entran por cualquiera de sus nombres. Nada sale a la red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

const sesion = vi.hoisted(() => ({ role: 'operator' as string }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: WS, staffId: 's-1', userId: 'u-1', role: sesion.role, error: null }),
}))
vi.mock('@/lib/fotos/catalogo-almacen', async (original) => ({
  ...(await original<typeof import('@/lib/fotos/catalogo-almacen')>()),
  guardarEnCatalogo: async (ws: string, tipo: string) => `one://fotos-catalogo/${ws}/${tipo}/${Math.random().toString(16).slice(2).padEnd(16, '0')}.jpg`,
  enlacesDeCatalogo: async (_ws: string, refs: string[]) => new Map(refs.map((r) => [r, `https://firmada.example/${r.split('/').pop()}`])),
  borrarDeCatalogo: async () => {},
}))

const WS = '11111111-2222-3333-4444-555555555555'

import { MENSAJE_SIN_AUTORIZACION } from '@/lib/fotos/autorizacion'
import { claveDeFoto } from '@/lib/fotos/clave'
import { fotosDeBibliotecaDelDocumento } from '@/lib/fotos/catalogo-propuesta'
import {
  contestarMismoPerfil,
  crearPerfil,
  fotosParaTarjetas,
  leerHotelesYTours,
  moverFoto,
  quitarFotoDeBiblioteca,
  separarNombreDelPerfil,
  subirFotoABiblioteca,
  type PedidoFoto,
} from './actions'

function sembrar(plantilla = 'trappvel', extra: Record<string, Fila[]> = {}) {
  base.secuencia = 0
  base.tablas = {
    workspaces: [{ id: WS, cotizacion_template_slug: plantilla, config_extra: {} }],
    fotos_catalogo: [],
    fotos_perfiles: [],
    fotos_perfiles_alias: [],
    ...extra,
  }
}

async function dataUrl(color = 90): Promise<string> {
  const b = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: color, g: 160, b: 190 } } }).jpeg().toBuffer()
  return `data:image/jpeg;base64,${b.toString('base64')}`
}

const AUTORIZADA = { autorizada: true, procedencia: 'kit de medios del hotel' }
const CATALONIA: PedidoFoto = { tipo: 'hotel', nombre: 'Catalonia Puerta del Sol', ciudad: 'Madrid' }
const CATALONIA_LARGO: PedidoFoto = { tipo: 'hotel', nombre: 'Hotel Catalonia Puerta del Sol Madrid', ciudad: 'Madrid' }
const IBEROSTAR: PedidoFoto = { tipo: 'hotel', nombre: 'Iberostar Selection Bávaro', ciudad: 'Punta Cana' }
const IBEROSTAR_SUITES: PedidoFoto = { tipo: 'hotel', nombre: 'Iberostar Selection Bávaro Suites', ciudad: 'Punta Cana' }
const TOUR: PedidoFoto = { tipo: 'actividad', nombre: 'City tour Madrid', ciudad: 'Madrid' }
const clave = (p: PedidoFoto) => claveDeFoto(p.tipo, p.nombre, p.ciudad)

beforeEach(() => {
  sesion.role = 'operator'
  sembrar()
  vi.stubGlobal('fetch', async () => {
    throw new Error('nada sale a la red')
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('el perfil se crea solo la primera vez', () => {
  it('un hotel y un tour nuevos en una cotización: perfil propio, sin fotos, sin pregunta', async () => {
    const r = await fotosParaTarjetas([CATALONIA, TOUR])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tarjetas.map((t) => [t.tipo, t.clave, t.elemento?.fotos.length, t.duda])).toEqual([
      ['hotel', clave(CATALONIA), 0, null],
      ['actividad', clave(TOUR), 0, null],
    ])
    expect(base.tablas.fotos_perfiles.map((p) => [p.tipo, p.clave, p.nombre, p.ciudad])).toEqual([
      ['hotel', clave(CATALONIA), 'Catalonia Puerta del Sol', 'Madrid'],
      ['actividad', clave(TOUR), 'City tour Madrid', 'Madrid'],
    ])
    // La segunda vez no crea otro.
    await fotosParaTarjetas([CATALONIA, TOUR])
    expect(base.tablas.fotos_perfiles).toHaveLength(2)
  })

  it('un rol de solo lectura ve las tarjetas pero no crea perfiles ni sube fotos', async () => {
    sesion.role = 'read_only'
    const r = await fotosParaTarjetas([CATALONIA])
    expect(r.ok && r.editable).toBe(false)
    expect(base.tablas.fotos_perfiles).toHaveLength(0)
    const s = await subirFotoABiblioteca(CATALONIA, await dataUrl(), null, null, AUTORIZADA)
    expect(s.ok).toBe(false)
  })

  it('en un espacio sin propuesta de viaje no hay perfiles ni pantalla', async () => {
    sembrar('generica')
    expect((await fotosParaTarjetas([CATALONIA])).ok).toBe(false)
    const p = await leerHotelesYTours()
    expect(p.ok === false && /no tiene/.test(p.error)).toBe(true)
  })

  it('un hotel con fotos de antes (sin fila de perfil) es su perfil: recibe la fila y muestra sus fotos', async () => {
    sembrar('trappvel', {
      fotos_catalogo: [{ id: 'f1', workspace_id: WS, tipo: 'hotel', clave: clave(CATALONIA), nombre: 'Catalonia Puerta del Sol', ciudad: 'Madrid', ref: `one://fotos-catalogo/${WS}/hotel/${'a'.repeat(16)}.jpg`, origen: 'asesora', revisada: true, principal: true, posicion: 1 }],
    })
    const r = await fotosParaTarjetas([CATALONIA])
    expect(r.ok && r.tarjetas[0].elemento?.fotos.map((f) => f.id)).toEqual(['f1'])
    expect(base.tablas.fotos_perfiles.map((p) => p.clave)).toEqual([clave(CATALONIA)])
  })
})

describe('un servicio escrito a mano no crea ficha por sí solo (brief del 2026-10-20, punto 2)', () => {
  const A_MANO: PedidoFoto = { tipo: 'actividad', nombre: 'City Tour Ficticio', ciudad: 'Santa Marta', aMano: true }

  it('pintar la tarjeta de una actividad escrita a mano no inserta en fotos_perfiles', async () => {
    const r = await fotosParaTarjetas([A_MANO])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(base.tablas.fotos_perfiles).toEqual([])
    expect(base.tablas.fotos_perfiles_alias).toEqual([])
    expect(r.tarjetas.find((t) => t.aMano)).toMatchObject({ tipo: 'actividad', clave: clave(A_MANO), elemento: null, proveedor: null })
  })

  it('si una línea leída de un pantallazo nombra lo mismo, esa sí crea el perfil; la escrita a mano sigue sin ficha', async () => {
    const r = await fotosParaTarjetas([A_MANO, { ...A_MANO, aMano: false }])
    expect(base.tablas.fotos_perfiles.map((p) => p.nombre)).toEqual(['City Tour Ficticio'])
    expect(r.ok && r.tarjetas.find((t) => t.aMano)?.proveedor).toBeNull()
  })

  it('las fotos de un perfil que ya existe se siguen viendo en la escrita a mano', async () => {
    await fotosParaTarjetas([CATALONIA])
    await subirFotoABiblioteca(CATALONIA, await dataUrl(), null, null, AUTORIZADA)
    const r = await fotosParaTarjetas([{ ...CATALONIA, aMano: true }])
    expect(r.ok && r.tarjetas.find((t) => t.aMano)?.elemento?.fotos).toHaveLength(1)
    expect(base.tablas.fotos_perfiles).toHaveLength(1)
  })
})

describe('el mismo hotel con otro nombre', () => {
  it('«Hotel Catalonia Puerta del Sol Madrid» = «Catalonia Puerta del Sol»: alias solo, sin preguntar, y trae sus fotos', async () => {
    await fotosParaTarjetas([CATALONIA])
    expect((await subirFotoABiblioteca(CATALONIA, await dataUrl(), null, 'fachada', AUTORIZADA)).ok).toBe(true)
    const r = await fotosParaTarjetas([CATALONIA_LARGO])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tarjetas[0]).toMatchObject({ clave: clave(CATALONIA_LARGO), duda: null })
    expect(r.tarjetas[0].elemento).toMatchObject({ clave: clave(CATALONIA), nombre: 'Catalonia Puerta del Sol' })
    expect(r.tarjetas[0].elemento?.fotos).toHaveLength(1)
    expect(base.tablas.fotos_perfiles).toHaveLength(1)
    expect(base.tablas.fotos_perfiles_alias.map((a) => [a.clave, a.nombre])).toEqual([[clave(CATALONIA_LARGO), 'Hotel Catalonia Puerta del Sol Madrid']])
  })

  it('el documento encuentra las fotos por el alias (la misma lectura de la vista)', async () => {
    await fotosParaTarjetas([CATALONIA])
    await subirFotoABiblioteca(CATALONIA, await dataUrl(), null, null, AUTORIZADA)
    await fotosParaTarjetas([CATALONIA_LARGO])
    const doc = await fotosDeBibliotecaDelDocumento(clienteFalso(), WS, [{ hotel: CATALONIA_LARGO.nombre, linea: CATALONIA_LARGO.nombre, ciudad: 'Madrid' }])
    expect([...doc.hoteles.keys()]).toEqual([clave(CATALONIA_LARGO)])
  })

  it('parecido, UN solo candidato en la misma ciudad: se asocia sin preguntar y trae sus fotos (brief del 2026-10-21, punto 5)', async () => {
    await fotosParaTarjetas([IBEROSTAR])
    await subirFotoABiblioteca(IBEROSTAR, await dataUrl(), null, null, AUTORIZADA)
    const r = await fotosParaTarjetas([IBEROSTAR_SUITES])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tarjetas[0]).toMatchObject({ duda: null, elemento: { clave: clave(IBEROSTAR) }, fotosDe: { nombre: 'Iberostar Selection Bávaro', ciudad: 'Punta Cana', deshacer: true } })
    expect(r.tarjetas[0].elemento?.fotos).toHaveLength(1)
    expect(base.tablas.fotos_perfiles).toHaveLength(1)
    expect(base.tablas.fotos_perfiles_alias.map((a) => a.nombre)).toEqual(['Iberostar Selection Bávaro Suites'])
  })

  it('parecido a DOS fichas de la misma ciudad: no se asocia, no se crea ficha ni se pregunta; queda «por clasificar»', async () => {
    const BEACH: PedidoFoto = { tipo: 'hotel', nombre: 'Iberostar Selection Bávaro Beach', ciudad: 'Punta Cana' }
    await fotosParaTarjetas([IBEROSTAR])
    // La segunda ficha la crea una persona («es otro»): sola, se habría asociado a la primera.
    await contestarMismoPerfil(BEACH, clave(IBEROSTAR), false)
    expect(base.tablas.fotos_perfiles).toHaveLength(2)
    const r = await fotosParaTarjetas([IBEROSTAR_SUITES])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tarjetas[0]).toMatchObject({ elemento: null, duda: null, proveedor: null, fotosDe: null, porClasificar: 2 })
    expect(base.tablas.fotos_perfiles).toHaveLength(2)
    expect(base.tablas.fotos_perfiles_alias).toHaveLength(0)
    // Subir una foto no adivina: pide clasificarlo.
    const s = await subirFotoABiblioteca(IBEROSTAR_SUITES, await dataUrl(), null, null, AUTORIZADA)
    expect(s.ok === false && s.error).toMatch(/Por clasificar/)
  })

  it('sin ciudad en el pantallazo, se compara con el destino del viaje', async () => {
    await fotosParaTarjetas([IBEROSTAR])
    const sinCiudad: PedidoFoto = { tipo: 'hotel', nombre: 'Iberostar Selection Bávaro Suites', ciudad: null }
    const con = await fotosParaTarjetas([sinCiudad], { destino: 'Punta Cana' })
    expect(con.ok && con.tarjetas[0]).toMatchObject({ elemento: { clave: clave(IBEROSTAR) }, fotosDe: { nombre: 'Iberostar Selection Bávaro' } })
    expect(con.ok && con.tarjetas[0].porClasificar).toBeUndefined()
    sembrar()
    await fotosParaTarjetas([IBEROSTAR])
    const sin = await fotosParaTarjetas([sinCiudad])
    expect(sin.ok && sin.tarjetas[0]).toMatchObject({ elemento: null, porClasificar: 1 })
    expect(base.tablas.fotos_perfiles).toHaveLength(1)
  })

  it('la línea con la ficha fijada trae las fotos de ESA ficha, sin escribir nada por el nombre', async () => {
    await fotosParaTarjetas([IBEROSTAR])
    await subirFotoABiblioteca(IBEROSTAR, await dataUrl(), null, null, AUTORIZADA)
    const id = 'd0000000-0000-4000-8000-0000000000aa'
    base.tablas.fotos_perfiles[0].id = id
    const otroNombre: PedidoFoto = { tipo: 'hotel', nombre: 'Un Nombre Ficticio Distinto', ciudad: 'Cartagena', proveedorId: id }
    const r = await fotosParaTarjetas([otroNombre])
    expect(r.ok && r.tarjetas.find((t) => t.proveedorId === id)).toMatchObject({ elemento: { clave: clave(IBEROSTAR) }, fotosDe: { nombre: 'Iberostar Selection Bávaro' } })
    expect(base.tablas.fotos_perfiles).toHaveLength(1)
    expect(base.tablas.fotos_perfiles_alias).toHaveLength(0)
  })

  it('«No es este» en una línea (`descartada`): esa ficha no vuelve sola, ni sus fotos', async () => {
    await fotosParaTarjetas([IBEROSTAR])
    await subirFotoABiblioteca(IBEROSTAR, await dataUrl(), null, null, AUTORIZADA)
    const r = await fotosParaTarjetas([{ ...IBEROSTAR_SUITES, descartada: clave(IBEROSTAR) }])
    expect(r.ok && r.tarjetas.find((t) => t.descartada)).toMatchObject({ elemento: null, proveedor: null, fotosDe: null })
    expect(base.tablas.fotos_perfiles_alias).toHaveLength(0)
  })

  it('«Sí, es el mismo»: queda como alias, trae las fotos y la próxima vez no pregunta', async () => {
    await fotosParaTarjetas([IBEROSTAR])
    await subirFotoABiblioteca(IBEROSTAR, await dataUrl(), null, null, AUTORIZADA)
    const r = await contestarMismoPerfil(IBEROSTAR_SUITES, clave(IBEROSTAR), true)
    expect(r.ok && r.elemento?.clave).toBe(clave(IBEROSTAR))
    expect(r.ok && r.elemento?.alias.map((a) => a.nombre)).toEqual(['Iberostar Selection Bávaro Suites'])
    const otra = await fotosParaTarjetas([IBEROSTAR_SUITES])
    expect(otra.ok && otra.tarjetas[0]).toMatchObject({ duda: null, elemento: { clave: clave(IBEROSTAR) } })
  })

  it('«No, es otro»: perfil propio, sin las fotos del otro, y la próxima vez no pregunta', async () => {
    await fotosParaTarjetas([IBEROSTAR])
    await subirFotoABiblioteca(IBEROSTAR, await dataUrl(), null, null, AUTORIZADA)
    const r = await contestarMismoPerfil(IBEROSTAR_SUITES, clave(IBEROSTAR), false)
    expect(r.ok && r.elemento).toMatchObject({ clave: clave(IBEROSTAR_SUITES), fotos: [] })
    const otra = await fotosParaTarjetas([IBEROSTAR_SUITES])
    expect(otra.ok && otra.tarjetas[0]).toMatchObject({ duda: null, elemento: { clave: clave(IBEROSTAR_SUITES) } })
    expect(base.tablas.fotos_perfiles_alias).toHaveLength(0)
  })

  it('separar un alias equivocado lo quita del perfil', async () => {
    await fotosParaTarjetas([IBEROSTAR])
    const r = await contestarMismoPerfil(IBEROSTAR_SUITES, clave(IBEROSTAR), true)
    const alias = r.ok ? r.elemento?.alias[0] : null
    expect(alias).toBeTruthy()
    const s = await separarNombreDelPerfil(alias!.id)
    expect(s.ok && s.elemento?.alias).toEqual([])
    expect(base.tablas.fotos_perfiles_alias).toHaveLength(0)
  })
})

describe('una línea escrita a mano nunca crea ficha, tampoco al subirle una foto (brief del 2026-10-21, punto 5)', () => {
  it('subir la foto de un hotel escrito a mano sin ficha: no crea perfil y pide guardarla en la opción', async () => {
    const A_MANO: PedidoFoto = { tipo: 'hotel', nombre: 'Hotel Ficticio a Mano', ciudad: 'Santa Marta', aMano: true }
    const s = await subirFotoABiblioteca(A_MANO, await dataUrl(), null, null, AUTORIZADA)
    expect(s).toMatchObject({ ok: false, codigo: 'A_MANO' })
    expect(base.tablas.fotos_perfiles).toEqual([])
    expect(base.tablas.fotos_catalogo ?? []).toEqual([])
  })

  it('con una ficha que ya existe con ese nombre, la foto va a esa ficha (sin crear otra)', async () => {
    await fotosParaTarjetas([CATALONIA])
    const s = await subirFotoABiblioteca({ ...CATALONIA, aMano: true }, await dataUrl(), null, null, AUTORIZADA)
    expect(s.ok && s.elemento?.clave).toBe(clave(CATALONIA))
    expect(base.tablas.fotos_perfiles).toHaveLength(1)
  })
})

describe('fotos del perfil', () => {
  it('sin la casilla de autorización no se guarda; con ella, hasta 3, y se ordenan y se quitan', { timeout: 30_000 }, async () => {
    expect(await subirFotoABiblioteca(TOUR, await dataUrl(), null, null, { autorizada: false })).toEqual({ ok: false, error: MENSAJE_SIN_AUTORIZACION })
    for (let i = 0; i < 3; i++) expect((await subirFotoABiblioteca(TOUR, await dataUrl(i * 30), null, null, AUTORIZADA)).ok).toBe(true)
    const cuarta = await subirFotoABiblioteca(TOUR, await dataUrl(200), null, null, AUTORIZADA)
    expect(cuarta.ok === false && cuarta.error).toMatch(/Ya tiene 3 fotos/)
    const p = await leerHotelesYTours()
    const fotos = p.ok ? p.elementos.find((e) => e.clave === clave(TOUR))!.fotos : []
    expect(fotos.map((f) => f.principal)).toEqual([true, false, false])
    const [a, b, c] = fotos.map((f) => f.id)
    const movida = await moverFoto(c, 'primera')
    expect(movida.ok && movida.elemento?.fotos.map((f) => f.id)).toEqual([c, a, b])
    const atras = await moverFoto(c, 'despues')
    expect(atras.ok && atras.elemento?.fotos.map((f) => f.id)).toEqual([a, c, b])
    const quitada = await quitarFotoDeBiblioteca(a)
    expect(quitada.ok && quitada.elemento?.fotos.map((f) => [f.id, f.principal])).toEqual([[c, true], [b, false]])
  })

  it('«Agregar» desde la pantalla: crea el perfil antes de la cotización; si se parece a otro, pregunta', async () => {
    const r = await crearPerfil(CATALONIA)
    expect(r.ok && r.elemento?.clave).toBe(clave(CATALONIA))
    const seguro = await crearPerfil(CATALONIA_LARGO)
    expect(seguro.ok && seguro.elemento?.clave).toBe(clave(CATALONIA))
    await crearPerfil(IBEROSTAR)
    // Lo que una persona crea a propósito sí pregunta (no se une solo a un parecido).
    const dudoso = await crearPerfil(IBEROSTAR_SUITES)
    expect(dudoso.ok && 'duda' in dudoso && dudoso.duda.clave).toBe(clave(IBEROSTAR))
  })

  it('la pantalla lista hoteles y tours (las ciudades solo si tienen fotos), con sus otros nombres', async () => {
    await fotosParaTarjetas([CATALONIA, CATALONIA_LARGO, TOUR])
    sembrar('trappvel', {
      ...base.tablas,
      fotos_catalogo: [{ id: 'c1', workspace_id: WS, tipo: 'ciudad', clave: 'barcelona', nombre: 'Barcelona', ciudad: 'Barcelona', ref: `one://fotos-catalogo/${WS}/ciudad/${'b'.repeat(16)}.jpg`, origen: 'wikimedia', revisada: false, principal: true, posicion: 1 }],
    })
    const p = await leerHotelesYTours()
    expect(p.ok && p.elementos.map((e) => [e.tipo, e.nombre, e.alias.map((a) => a.nombre)])).toEqual([
      ['hotel', 'Catalonia Puerta del Sol', ['Hotel Catalonia Puerta del Sol Madrid']],
      ['actividad', 'City tour Madrid', []],
      ['ciudad', 'Barcelona', []],
    ])
  })
})
