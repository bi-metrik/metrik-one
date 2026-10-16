/**
 * La biblioteca de fotos (2026-10-16): hasta 3 fotos por elemento, una sola principal, y los
 * hoteles siempre elegidos por una persona.
 *
 * El doble de la tabla hace cumplir LAS MISMAS llaves que la migración `20261016153000`
 * (puesto 1 a 3, único por elemento; una principal por elemento; valores por defecto
 * `principal = true`, `posicion = 1`), para que una prueba no pase por un doble más blando que
 * la base.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const almacen = vi.hoisted(() => ({ guardadas: [] as string[], borradas: [] as string[] }))
vi.mock('./catalogo-almacen', async (original) => {
  const real = await original<typeof import('./catalogo-almacen')>()
  return {
    ...real,
    guardarEnCatalogo: async (ws: string, tipo: string) => {
      const ref = `one://fotos-catalogo/${ws}/${tipo}/${String(almacen.guardadas.length).padStart(16, '0')}.jpg`
      almacen.guardadas.push(ref)
      return ref
    },
    borrarDeCatalogo: async (_ws: string, ref: string) => {
      almacen.borradas.push(ref)
    },
  }
})

import {
  elegirDeCommons,
  elementosDe,
  extrasDe,
  filaDe,
  leerBiblioteca,
  marcarPrincipal,
  MENSAJE_TOPE,
  ponerFotoPropia,
  quitarFotoPorId,
  sugerirDesdeCommons,
  type FilaCatalogo,
} from './catalogo'
import { MAX_FOTOS_POR_ELEMENTO, objetivo } from './clave'

/** La casilla «Tengo autorización» que la acción ya revisó (Emilio, 2026-10-16). */
const AUTORIZADA = { userId: '00000000-0000-4000-8000-0000000000aa', procedencia: null }

const WS = '11111111-2222-3333-4444-555555555555'
type Fila = Record<string, unknown>

/** Las llaves de la migración: devuelve el error de PostgreSQL que daría la base, o null. */
function violacion(filas: Fila[]): { code: string; message: string } | null {
  for (const f of filas) {
    const p = Number(f.posicion)
    if (!Number.isInteger(p) || p < 1 || p > 3) return { code: '23514', message: 'fotos_catalogo_posicion_1_a_3' }
  }
  const puestos = new Set<string>()
  const principales = new Set<string>()
  for (const f of filas) {
    const el = `${f.workspace_id}|${f.tipo}|${f.clave}`
    if (puestos.has(`${el}|${f.posicion}`)) return { code: '23505', message: 'fotos_catalogo_una_por_posicion' }
    puestos.add(`${el}|${f.posicion}`)
    if (f.principal) {
      if (principales.has(el)) return { code: '23505', message: 'fotos_catalogo_una_principal' }
      principales.add(el)
    }
  }
  return null
}

function dobleConLlaves(inicial: Fila[] = []) {
  let filas: Fila[] = inicial.map((f) => ({ principal: true, posicion: 1, descartadas: [], ...f }))
  let n = filas.length
  return {
    get filas() {
      return filas
    },
    from(tabla: string) {
      expect(tabla).toBe('fotos_catalogo')
      const filtros: ((f: Fila) => boolean)[] = []
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
      let valores: Fila = {}
      let limite: number | null = null
      const fin = (unica: boolean) => {
        const antes = filas.map((f) => ({ ...f }))
        let afectadas: Fila[]
        if (op === 'insert') {
          // Los valores por defecto de la migración.
          const nueva = { id: `id-${++n}`, descartadas: [], principal: true, posicion: 1, ...valores }
          filas.push(nueva)
          afectadas = [nueva]
        } else {
          afectadas = filas.filter((f) => filtros.every((fn) => fn(f)))
          if (op === 'update') afectadas.forEach((f) => Object.assign(f, valores))
          if (op === 'delete') filas = filas.filter((f) => !afectadas.includes(f))
        }
        const error = violacion(filas)
        if (error) {
          filas = antes
          return { data: null, error }
        }
        let copias = afectadas.map((f) => ({ ...f }))
        if (limite !== null) copias = copias.slice(0, limite)
        return { data: unica ? copias[0] ?? null : copias, error: null }
      }
      const q = {
        select: () => q,
        insert: (v: Fila) => ((op = 'insert'), (valores = v), q),
        update: (v: Fila) => ((op = 'update'), (valores = v), q),
        delete: () => ((op = 'delete'), q),
        eq: (k: string, v: unknown) => (filtros.push((f) => f[k] === v), q),
        neq: (k: string, v: unknown) => (filtros.push((f) => f[k] !== v), q),
        in: (k: string, v: unknown[]) => (filtros.push((f) => v.includes(f[k])), q),
        limit: (l: number) => ((limite = l), q),
        maybeSingle: async () => fin(true),
        then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(fin(false)).then(res, rej),
      }
      return q
    },
  }
}

async function jpeg(color = 120): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: color, g: 60, b: 120 } } }).jpeg().toBuffer()
}

/** Commons de mentira: búsqueda, ficha de un archivo por título y la descarga. */
function commonsFalso(bytes: Buffer, licencia = 'CC BY-SA 4.0'): { fetch: typeof fetch; llamadas: string[] } {
  const llamadas: string[] = []
  const pagina = (t: string, i: number) => ({
    title: t,
    index: i + 1,
    imageinfo: [{
      descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(t)}`,
      thumburl: `https://upload.wikimedia.org/thumb/${i}.jpg`,
      thumbwidth: 1600, thumbheight: 1066, width: 3000, height: 2000, mime: 'image/jpeg',
      extmetadata: { LicenseShortName: { value: licencia }, Artist: { value: `Autora ${i + 1}` } },
    }],
  })
  const f = (async (url: string) => {
    llamadas.push(String(url))
    if (url.startsWith('https://commons.wikimedia.org/w/api.php')) {
      const u = new URL(url)
      const titulos = u.searchParams.get('titles')
      if (titulos) return new Response(JSON.stringify({ query: { pages: [pagina(titulos, 0)] } }))
      return new Response(JSON.stringify({ query: { pages: Array.from({ length: 30 }, (_, i) => pagina(`File:F${i}.jpg`, i)) } }))
    }
    if (url.startsWith('https://upload.wikimedia.org/')) return new Response(new Uint8Array(bytes))
    return new Response('no', { status: 404 })
  }) as unknown as typeof fetch
  return { fetch: f, llamadas }
}

beforeEach(() => {
  almacen.guardadas = []
  almacen.borradas = []
})

const hotel = objetivo('hotel', 'H10 Metropolitan', 'Barcelona')!
const plan = objetivo('actividad', 'Park Güell con guía', 'Barcelona')!

describe('máximo 3 fotos por elemento', () => {
  it('la cuarta no entra, no se sube y el elemento queda con 3', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    for (let i = 0; i < MAX_FOTOS_POR_ELEMENTO; i++) {
      const r = await ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: 's1', objetivo: plan, bytes: await jpeg(i * 40), agregar: true , autorizacion: AUTORIZADA })
      expect(r.ok).toBe(true)
    }
    expect(db.filas.map((f) => f.posicion).sort()).toEqual([1, 2, 3])
    const cuarta = await ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: 's1', objetivo: plan, bytes: await jpeg(200), agregar: true , autorizacion: AUTORIZADA })
    expect(cuarta).toEqual({ ok: false, mensaje: MENSAJE_TOPE })
    expect(db.filas).toHaveLength(3)
    // No se subió un archivo que iba a quedar huérfano.
    expect(almacen.guardadas).toHaveLength(3)
  })

  it('con 3, «Cambiar» sí entra (reemplaza el puesto, no agrega)', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    for (let i = 0; i < 3; i++) await ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: null, objetivo: plan, bytes: await jpeg(i * 40), agregar: true , autorizacion: AUTORIZADA })
    const segunda = db.filas.find((f) => f.posicion === 2)!
    const vieja = segunda.ref
    const r = await ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: null, objetivo: plan, bytes: await jpeg(250), reemplaza: segunda.id as string , autorizacion: AUTORIZADA })
    expect(r.ok).toBe(true)
    expect(db.filas).toHaveLength(3)
    expect(db.filas.find((f) => f.id === segunda.id)).toMatchObject({ posicion: 2, principal: false })
    expect(almacen.borradas).toEqual([vieja])
  })

  it('la base también la frena: un cuarto puesto o un puesto repetido no se escriben', async () => {
    const db = dobleConLlaves([
      { id: 'a', workspace_id: WS, tipo: 'actividad', clave: plan.clave, posicion: 1, principal: true },
      { id: 'b', workspace_id: WS, tipo: 'actividad', clave: plan.clave, posicion: 2, principal: false },
      { id: 'c', workspace_id: WS, tipo: 'actividad', clave: plan.clave, posicion: 3, principal: false },
    ])
    const cuarto = await db.from('fotos_catalogo').insert({ workspace_id: WS, tipo: 'actividad', clave: plan.clave, posicion: 4, principal: false }).maybeSingle()
    expect(cuarto.error?.code).toBe('23514')
    const repetido = await db.from('fotos_catalogo').insert({ workspace_id: WS, tipo: 'actividad', clave: plan.clave, posicion: 2, principal: false }).maybeSingle()
    expect(repetido.error?.code).toBe('23505')
    expect(db.filas).toHaveLength(3)
  })
})

describe('una sola principal', () => {
  it('la primera es la principal; las que se agregan no; marcar otra deja una sola', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    for (let i = 0; i < 3; i++) await ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: 's1', objetivo: hotel, bytes: await jpeg(i * 40), agregar: true , autorizacion: AUTORIZADA })
    expect(db.filas.filter((f) => f.principal).map((f) => f.posicion)).toEqual([1])
    const tercera = db.filas.find((f) => f.posicion === 3)!
    expect((await marcarPrincipal(db, WS, 's1', tercera.id as string)).ok).toBe(true)
    expect(db.filas.filter((f) => f.principal).map((f) => f.id)).toEqual([tercera.id])
    // La propuesta la imprime primero; las otras dos van de extras.
    const filas = db.filas as unknown as FilaCatalogo[]
    expect(filaDe(filas, hotel)?.id).toBe(tercera.id)
    expect(extrasDe(filas, hotel).map((f) => f.posicion)).toEqual([1, 2])
  })

  it('quitar la principal pasa la principal a la del primer puesto que queda', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    for (let i = 0; i < 3; i++) await ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: null, objetivo: hotel, bytes: await jpeg(i * 40), agregar: true , autorizacion: AUTORIZADA })
    const principal = db.filas.find((f) => f.principal)!
    expect((await quitarFotoPorId(db, WS, principal.id as string)).ok).toBe(true)
    expect(db.filas).toHaveLength(2)
    expect(db.filas.filter((f) => f.principal).map((f) => f.posicion)).toEqual([2])
  })

  it('la base no admite dos principales', async () => {
    const db = dobleConLlaves([
      { id: 'a', workspace_id: WS, tipo: 'hotel', clave: hotel.clave, posicion: 1, principal: true },
      { id: 'b', workspace_id: WS, tipo: 'hotel', clave: hotel.clave, posicion: 2, principal: false },
    ])
    const r = await db.from('fotos_catalogo').update({ principal: true }).eq('id', 'b')
    expect((r as { error: { code: string } | null }).error?.code).toBe('23505')
    expect(db.filas.filter((f) => f.principal).map((f) => f.id)).toEqual(['a'])
  })

  it('una foto vieja (antes de la migración: sin principal ni puesto) es la principal', () => {
    const vieja = { id: 'v', tipo: 'hotel', clave: hotel.clave, nombre: 'H10', ciudad: 'Barcelona' } as unknown as FilaCatalogo
    expect(filaDe([vieja], hotel)?.id).toBe('v')
    expect(elementosDe([vieja])[0].fotos.map((f) => f.id)).toEqual(['v'])
  })
})

describe('hoteles: siempre los elige una persona', () => {
  it('nunca automático: sugerir no busca ni escribe nada para un hotel', async () => {
    const db = dobleConLlaves()
    const { fetch, llamadas } = commonsFalso(await jpeg())
    const r = await sugerirDesdeCommons({ supabase: db, workspaceId: WS, staffId: null, objetivo: hotel, fetch })
    expect(r.ok).toBe(false)
    expect(llamadas).toEqual([])
    expect(db.filas).toHaveLength(0)
  })

  it('elegida en el selector (de Commons): queda revisada, con su crédito, y se revalida la licencia', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    const { fetch, llamadas } = commonsFalso(await jpeg())
    const r = await elegirDeCommons({ supabase: db, workspaceId: WS, staffId: 's1', objetivo: hotel, titulo: 'File:H10.jpg', fetch })
    expect(r.ok).toBe(true)
    expect(db.filas[0]).toMatchObject({ tipo: 'hotel', origen: 'wikimedia', revisada: true, principal: true, posicion: 1, titulo_fuente: 'File:H10.jpg', licencia: 'CC BY-SA 4.0' })
    // Se pidió la ficha del archivo por su título (no se confió en lo que mandó el navegador).
    expect(llamadas.some((u) => new URL(u).searchParams.get('titles') === 'File:H10.jpg')).toBe(true)
  })

  it('una licencia que ya no es libre no se guarda', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    const { fetch } = commonsFalso(await jpeg(), 'CC BY-NC 2.0')
    const r = await elegirDeCommons({ supabase: db, workspaceId: WS, staffId: 's1', objetivo: hotel, titulo: 'File:H10.jpg', fetch })
    expect(r.ok).toBe(false)
    expect(db.filas).toHaveLength(0)
  })
})

describe('la biblioteca: buscar y filtrar', () => {
  it('por nombre o ciudad, sin tildes, y por tipo', async () => {
    const db = dobleConLlaves([
      { id: 'a', workspace_id: WS, tipo: 'hotel', clave: 'h10 metropolitan|barcelona', nombre: 'H10 Metropolitan', ciudad: 'Barcelona' },
      { id: 'b', workspace_id: WS, tipo: 'actividad', clave: 'park guell|barcelona', nombre: 'Park Güell', ciudad: 'Barcelona' },
      { id: 'c', workspace_id: WS, tipo: 'ciudad', clave: 'paris', nombre: 'París', ciudad: 'París' },
      { id: 'z', workspace_id: 'otro', tipo: 'ciudad', clave: 'roma', nombre: 'Roma', ciudad: 'Roma' },
    ])
    const todo = await leerBiblioteca(db, WS)
    expect(todo.ok && todo.elementos.map((e) => e.nombre)).toEqual(['H10 Metropolitan', 'Park Güell', 'París'])
    const guell = await leerBiblioteca(db, WS, { buscar: 'guell' })
    expect(guell.ok && guell.elementos.map((e) => e.nombre)).toEqual(['Park Güell'])
    const paris = await leerBiblioteca(db, WS, { buscar: 'PARIS' })
    expect(paris.ok && paris.elementos.map((e) => e.nombre)).toEqual(['París'])
    const hoteles = await leerBiblioteca(db, WS, { tipo: 'hotel', buscar: 'barcelona' })
    expect(hoteles.ok && hoteles.elementos.map((e) => e.nombre)).toEqual(['H10 Metropolitan'])
  })
})
