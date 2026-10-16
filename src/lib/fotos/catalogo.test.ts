/**
 * El catálogo de fotos: llaves de archivo, búsqueda por nombre y las escrituras (sugerir de
 * Commons, poner la propia, quitar) sobre un doble de la tabla. El almacenamiento es un doble.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const almacen = vi.hoisted(() => ({ guardadas: [] as string[], borradas: [] as string[] }))
vi.mock('./catalogo-almacen', async (original) => {
  const real = await original<typeof import('./catalogo-almacen')>()
  return {
    ...real,
    guardarEnCatalogo: async (ws: string, tipo: string, foto: { buffer: Buffer }) => {
      const ref = `one://fotos-catalogo/${ws}/${tipo}/${String(almacen.guardadas.length).padStart(16, '0')}.jpg`
      void foto
      almacen.guardadas.push(ref)
      return ref
    },
    borrarDeCatalogo: async (_ws: string, ref: string) => {
      almacen.borradas.push(ref)
    },
  }
})

import { actividadPorNombre, filaDe, ponerFotoPropia, quitarFoto, sugerirDesdeCommons, type FilaCatalogo } from './catalogo'
import { objetivo } from './clave'
import { rutaDeReferencia } from './referencia-catalogo'

/** La casilla «Tengo autorización» que la acción ya revisó (Emilio, 2026-10-16). */
const AUTORIZADA = { userId: '00000000-0000-4000-8000-0000000000aa', procedencia: null }

const WS = '11111111-2222-3333-4444-555555555555'
const OTRO = '99999999-2222-3333-4444-555555555555'

describe('la referencia de un archivo del catálogo', () => {
  it('solo la de ese workspace y con la forma que escribe ONE', () => {
    const ref = `one://fotos-catalogo/${WS}/hotel/0123456789abcdef.jpg`
    expect(rutaDeReferencia(ref, WS)).toBe(`${WS}/hotel/0123456789abcdef.jpg`)
    expect(rutaDeReferencia(ref, OTRO)).toBeNull()
    expect(rutaDeReferencia(`one://fotos-catalogo/${WS}/../${OTRO}/a.jpg`, WS)).toBeNull()
    expect(rutaDeReferencia(`one://ve-documentos/${WS}/hotel/0123456789abcdef.jpg`, WS)).toBeNull()
    expect(rutaDeReferencia(`one://fotos-catalogo/${WS}/museo/0123456789abcdef.jpg`, WS)).toBeNull()
    expect(rutaDeReferencia(null, WS)).toBeNull()
  })
})

const fila = (over: Partial<FilaCatalogo>): FilaCatalogo => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  tipo: 'actividad',
  clave: 'city tour|paris',
  nombre_clave: 'city tour',
  nombre: 'City tour',
  ciudad: 'París',
  ref: `one://fotos-catalogo/${WS}/actividad/0123456789abcdef.jpg`,
  origen: 'wikimedia',
  fuente_url: 'https://commons.wikimedia.org/wiki/File:A.jpg',
  titulo_fuente: 'File:A.jpg',
  autor: 'Autora',
  licencia: 'CC BY 4.0',
  foco_x: null,
  foco_y: null,
  proporcion: 1.5,
  revisada: false,
  descartadas: [],
  principal: true,
  posicion: 1,
  imagen_url: null,
  categoria: null,
  ...over,
})

describe('la foto de un plan opcional por su nombre', () => {
  const paris = fila({ id: 'p' })
  const roma = fila({ id: 'r', clave: 'city tour|roma', ciudad: 'Roma' })
  const suelta = fila({ id: 's', tipo: 'actividad', clave: 'disneyland|', nombre_clave: 'disneyland', nombre: 'Disneyland', ciudad: null })

  it('la de una ciudad del viaje', () => {
    expect(actividadPorNombre([roma, paris], 'City Tour', ['paris'])?.id).toBe('p')
  })
  it('un «City tour» de otras ciudades no ilustra este viaje', () => {
    expect(actividadPorNombre([roma, paris], 'City tour', ['madrid'])).toBeNull()
  })
  it('la única con ese nombre, o la que no tiene ciudad', () => {
    expect(actividadPorNombre([roma], 'City tour', ['madrid'])?.id).toBe('r')
    expect(actividadPorNombre([suelta], 'DISNEYLAND', ['paris'])?.id).toBe('s')
  })
  it('por tipo y llave', () => {
    expect(filaDe([paris], { tipo: 'actividad', clave: 'city tour|paris' })?.id).toBe('p')
    expect(filaDe([paris], { tipo: 'hotel', clave: 'city tour|paris' })).toBeNull()
  })
})

// ── Un doble mínimo de la tabla ──────────────────────────────────────────────

type Fila = Record<string, unknown>
function dobleTabla(inicial: Fila[] = [], opciones: { sinTabla?: boolean } = {}) {
  const filas = inicial.map((f) => ({ ...f }))
  const cliente = {
    filas,
    from(tabla: string) {
      expect(tabla).toBe('fotos_catalogo')
      const filtros: [string, string, unknown][] = []
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
      let valores: Fila = {}
      const cumple = (f: Fila) =>
        filtros.every(([k, tipo, v]) => (tipo === 'eq' ? f[k] === v : tipo === 'neq' ? f[k] !== v : (v as unknown[]).includes(f[k])))
      const fin = (unica: boolean) => {
        if (opciones.sinTabla) return { data: null, error: { code: '42P01', message: 'relation "fotos_catalogo" does not exist' } }
        let afectadas: Fila[]
        if (op === 'insert') {
          const nueva = { id: `id-${filas.length + 1}`, descartadas: [], ...valores }
          filas.push(nueva)
          afectadas = [nueva]
        } else {
          afectadas = filas.filter(cumple)
          if (op === 'update') afectadas.forEach((f) => Object.assign(f, valores))
          if (op === 'delete') afectadas.forEach((f) => filas.splice(filas.indexOf(f), 1))
        }
        // Copias, como PostgREST: lo leído no cambia si la fila cambia después.
        const copias = afectadas.map((f) => ({ ...f }))
        return { data: unica ? copias[0] ?? null : copias, error: null }
      }
      const q = {
        select: () => q,
        insert: (v: Fila) => ((op = 'insert'), (valores = v), q),
        update: (v: Fila) => ((op = 'update'), (valores = v), q),
        delete: () => ((op = 'delete'), q),
        eq: (k: string, v: unknown) => (filtros.push([k, 'eq', v]), q),
        neq: (k: string, v: unknown) => (filtros.push([k, 'neq', v]), q),
        in: (k: string, v: unknown[]) => (filtros.push([k, 'in', v]), q),
        limit: () => q,
        maybeSingle: async () => fin(true),
        then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(fin(false)).then(res, rej),
      }
      return q
    },
  }
  return cliente
}

async function jpeg(ancho = 1200, alto = 800): Promise<Buffer> {
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 200, g: 60, b: 120 } } }).jpeg().toBuffer()
}

function commonsFalso(titulos: string[], bytes: Buffer): typeof fetch {
  return (async (url: string) => {
    if (url.startsWith('https://commons.wikimedia.org/w/api.php')) {
      return new Response(JSON.stringify({
        query: {
          pages: titulos.map((t, i) => ({
            title: t,
            index: i + 1,
            imageinfo: [{
              descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(t)}`,
              thumburl: `https://upload.wikimedia.org/thumb/${i}.jpg`,
              thumbwidth: 1600, thumbheight: 1066, width: 3000, height: 2000, mime: 'image/jpeg',
              extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: `Autora ${i + 1}` } },
            }],
          })),
        },
      }))
    }
    if (url.startsWith('https://upload.wikimedia.org/')) return new Response(new Uint8Array(bytes))
    return new Response('no', { status: 404 })
  }) as unknown as typeof fetch
}

describe('escrituras del catálogo', () => {
  beforeEach(() => {
    almacen.guardadas = []
    almacen.borradas = []
  })
  const sagrada = objetivo('actividad', 'Sagrada Familia', 'Barcelona')!

  it('sugerir: baja la primera foto libre, la guarda SIN revisar y con su crédito', { timeout: 20_000 }, async () => {
    const db = dobleTabla()
    const r = await sugerirDesdeCommons({ supabase: db, workspaceId: WS, staffId: 's1', objetivo: sagrada, fetch: commonsFalso(['File:A.jpg', 'File:B.jpg'], await jpeg()) })
    expect(r.ok).toBe(true)
    expect(db.filas).toHaveLength(1)
    expect(db.filas[0]).toMatchObject({
      workspace_id: WS, tipo: 'actividad', clave: 'sagrada familia|barcelona', nombre_clave: 'sagrada familia', nombre: 'Sagrada Familia',
      origen: 'wikimedia', titulo_fuente: 'File:A.jpg', autor: 'Autora 1', licencia: 'CC BY-SA 4.0', revisada: false, created_by: 's1',
    })
    expect(String(db.filas[0].fuente_url)).toMatch(/^https:\/\/commons\.wikimedia\.org\//)
  })

  it('un hotel NUNCA se sugiere de Commons: ni busca, ni baja, ni escribe', async () => {
    const db = dobleTabla()
    const llamadas: string[] = []
    const espia = (async (url: string) => {
      llamadas.push(url)
      return commonsFalso(['File:A.jpg'], await jpeg())(url)
    }) as unknown as typeof fetch
    const hotel = objetivo('hotel', 'H10 Metropolitan', 'Barcelona')!
    const r = await sugerirDesdeCommons({ supabase: db, workspaceId: WS, staffId: 's1', objetivo: hotel, fetch: espia })
    expect(r).toEqual({ ok: false, mensaje: expect.stringContaining('Subir la mía') })
    expect(llamadas).toEqual([])
    expect(db.filas).toHaveLength(0)
    expect(almacen.guardadas).toEqual([])
  })

  it('«Otra foto»: salta la descartada, reemplaza la fila y borra el archivo viejo', { timeout: 20_000 }, async () => {
    const db = dobleTabla()
    const f = commonsFalso(['File:A.jpg', 'File:B.jpg'], await jpeg())
    await sugerirDesdeCommons({ supabase: db, workspaceId: WS, staffId: null, objetivo: sagrada, fetch: f })
    const vieja = db.filas[0].ref as string
    const r = await sugerirDesdeCommons({ supabase: db, workspaceId: WS, staffId: null, objetivo: sagrada, descartadas: ['File:A.jpg'], fetch: f })
    expect(r.ok).toBe(true)
    expect(db.filas).toHaveLength(1)
    expect(db.filas[0]).toMatchObject({ titulo_fuente: 'File:B.jpg', descartadas: ['File:A.jpg'] })
    expect(almacen.borradas).toEqual([vieja])
    // Sin más candidatas, lo dice y no toca la fila.
    const fin = await sugerirDesdeCommons({ supabase: db, workspaceId: WS, staffId: null, objetivo: sagrada, descartadas: ['File:A.jpg', 'File:B.jpg'], fetch: f })
    expect(fin).toEqual({ ok: false, mensaje: expect.stringContaining('Sube la tuya') })
    expect(db.filas[0].titulo_fuente).toBe('File:B.jpg')
  })

  it('la propia: revisada, sin crédito; lo que no es foto no entra', { timeout: 20_000 }, async () => {
    const db = dobleTabla()
    const r = await ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: 's1', objetivo: sagrada, bytes: await jpeg(3000, 2000) , autorizacion: AUTORIZADA })
    expect(r.ok).toBe(true)
    expect(db.filas[0]).toMatchObject({ origen: 'asesora', revisada: true, autor: null, licencia: null, fuente_url: null })
    expect(Number(db.filas[0].proporcion)).toBeCloseTo(1.5, 1)
    expect((await ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: 's1', objetivo: sagrada, bytes: Buffer.from('no soy una foto') , autorizacion: AUTORIZADA })).ok).toBe(false)
  })

  it('quitar: borra la fila y el archivo, salvo que otra fila use el mismo', async () => {
    const ref = `one://fotos-catalogo/${WS}/actividad/0123456789abcdef.jpg`
    const db = dobleTabla([
      { id: 'a', workspace_id: WS, tipo: 'actividad', clave: 'sagrada familia|barcelona', ref },
      { id: 'b', workspace_id: WS, tipo: 'actividad', clave: 'sagrada familia|', ref },
    ])
    expect((await quitarFoto(db, WS, { tipo: 'actividad', clave: 'sagrada familia|barcelona' })).ok).toBe(true)
    expect(db.filas.map((f) => f.id)).toEqual(['b'])
    expect(almacen.borradas).toEqual([])
    await quitarFoto(db, WS, { tipo: 'actividad', clave: 'sagrada familia|' })
    expect(almacen.borradas).toEqual([ref])
  })

  it('sin la migración: el motivo, y el archivo subido no queda huérfano', { timeout: 20_000 }, async () => {
    const db = dobleTabla([], { sinTabla: true })
    const r = await ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: null, objetivo: sagrada, bytes: await jpeg() , autorizacion: AUTORIZADA })
    expect(r).toEqual({ ok: false, mensaje: expect.stringContaining('migración') })
  })
})
