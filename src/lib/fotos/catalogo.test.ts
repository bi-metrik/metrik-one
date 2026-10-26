/**
 * La biblioteca de fotos (2026-10-16): hasta 3 fotos por perfil, una sola principal, el orden que
 * pone la asesora, y la casilla de autorización obligatoria. La búsqueda automática se quitó: solo
 * entran fotos subidas o pegadas.
 *
 * El doble de la tabla hace cumplir LAS MISMAS llaves que las migraciones `20261016153000` y
 * `20261017090000` (puesto 1 a 3, único por elemento; una principal por elemento; orden 1 a 3;
 * valores por defecto `principal = true`, `posicion = 1`), para que una prueba no pase por un doble
 * más blando que la base.
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

import { creditoDeFila, elementosDe, filaDe, fotosDe, leerCatalogo, MENSAJE_TOPE, ponerFotoPropia, quitarFotoPorId, reordenarFotos, type FilaCatalogo } from './catalogo'
import { fotoImprimible, MAX_FOTOS_POR_ELEMENTO, objetivo } from './clave'
import { rutaDeReferencia } from './referencia-catalogo'

/** La casilla «Tengo autorización» que la acción ya revisó (Emilio, 2026-10-16). */
const AUTORIZADA = { userId: '00000000-0000-4000-8000-0000000000aa', procedencia: 'kit de medios del hotel' }

const WS = '11111111-2222-3333-4444-555555555555'
const OTRO = '99999999-2222-3333-4444-555555555555'
type Fila = Record<string, unknown>

/** Las llaves de las migraciones: devuelve el error de PostgreSQL que daría la base, o null. */
function violacion(filas: Fila[]): { code: string; message: string } | null {
  for (const f of filas) {
    const p = Number(f.posicion)
    if (!Number.isInteger(p) || p < 1 || p > 3) return { code: '23514', message: 'fotos_catalogo_posicion_1_a_3' }
    if (f.orden !== null && f.orden !== undefined && (Number(f.orden) < 1 || Number(f.orden) > 3)) return { code: '23514', message: 'fotos_catalogo_orden_check' }
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
  let filas: Fila[] = inicial.map((f) => ({ principal: true, posicion: 1, descartadas: [], orden: null, ...f }))
  let n = filas.length
  return {
    get filas() {
      return filas
    },
    from(tabla: string) {
      expect(['fotos_catalogo', 'fotos_catalogo_por_clave']).toContain(tabla)
      const filtros: ((f: Fila) => boolean)[] = []
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
      let valores: Fila = {}
      let limite: number | null = null
      const fin = (unica: boolean) => {
        if (tabla === 'fotos_catalogo_por_clave') {
          const vista = filas.map((f) => ({ ...f, clave_pedida: f.clave })).filter((f) => filtros.every((fn) => fn(f)))
          return { data: unica ? vista[0] ?? null : vista, error: null }
        }
        const antes = filas.map((f) => ({ ...f }))
        let afectadas: Fila[]
        if (op === 'insert') {
          // Los valores por defecto de la migración.
          const nueva = { id: `id-${++n}`, descartadas: [], principal: true, posicion: 1, orden: null, ...valores }
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

beforeEach(() => {
  almacen.guardadas = []
  almacen.borradas = []
})

const hotel = objetivo('hotel', 'H10 Metropolitan', 'Barcelona')!
const plan = objetivo('actividad', 'Park Güell con guía', 'Barcelona')!
const subir = (db: ReturnType<typeof dobleConLlaves>, o = plan, color = 0, extra: Partial<Parameters<typeof ponerFotoPropia>[0]> = {}) =>
  jpeg(color).then((bytes) => ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: 's1', objetivo: o, bytes, autorizacion: AUTORIZADA, ...extra }))

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

describe('la foto subida o pegada', () => {
  it('queda revisada, propia, sin crédito y con quién la autorizó y de dónde viene', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    const r = await subir(db, hotel, 0, { categoria: 'fachada' })
    expect(r.ok).toBe(true)
    expect(db.filas[0]).toMatchObject({
      tipo: 'hotel', clave: hotel.clave, origen: 'asesora', revisada: true, principal: true, posicion: 1, orden: 1, categoria: 'fachada',
      autorizada_por: AUTORIZADA.userId, procedencia: 'kit de medios del hotel', fuente_url: null, autor: null, licencia: null,
    })
    expect(creditoDeFila(db.filas[0] as unknown as FilaCatalogo)).toBeNull()
  })

  it('sin quién autoriza no se guarda ni se sube nada; lo que no es foto tampoco', async () => {
    const db = dobleConLlaves()
    const sin = await ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: null, objetivo: plan, bytes: await jpeg(), autorizacion: { userId: '', procedencia: null } })
    expect(sin.ok).toBe(false)
    const basura = await ponerFotoPropia({ supabase: db, workspaceId: WS, staffId: null, objetivo: plan, bytes: Buffer.from('no soy foto'), autorizacion: AUTORIZADA })
    expect(basura.ok).toBe(false)
    expect(db.filas).toHaveLength(0)
    expect(almacen.guardadas).toHaveLength(0)
  })

  it('un tour no lleva categoría (es de hotel)', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    await subir(db, plan, 0, { categoria: 'habitacion' })
    expect(db.filas[0].categoria).toBeNull()
  })
})

describe('máximo 3 fotos por perfil', () => {
  it('la cuarta no entra, no se sube y el perfil queda con 3', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    for (let i = 0; i < MAX_FOTOS_POR_ELEMENTO; i++) expect((await subir(db, plan, i * 40)).ok).toBe(true)
    expect(db.filas.map((f) => f.posicion).sort()).toEqual([1, 2, 3])
    expect(db.filas.map((f) => f.orden)).toEqual([1, 2, 3])
    const cuarta = await subir(db, plan, 200)
    expect(cuarta).toEqual({ ok: false, mensaje: MENSAJE_TOPE })
    expect(db.filas).toHaveLength(3)
    // No se subió un archivo que iba a quedar huérfano.
    expect(almacen.guardadas).toHaveLength(3)
  })

  it('con 3, reemplazar sí entra (conserva el puesto, el orden y si es principal) y borra el archivo viejo', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    for (let i = 0; i < 3; i++) await subir(db, plan, i * 40)
    const segunda = db.filas.find((f) => f.posicion === 2)!
    const vieja = segunda.ref
    const r = await subir(db, plan, 250, { reemplaza: segunda.id as string })
    expect(r.ok).toBe(true)
    expect(db.filas).toHaveLength(3)
    expect(db.filas.find((f) => f.id === segunda.id)).toMatchObject({ posicion: 2, orden: 2, principal: false })
    expect(almacen.borradas).toEqual([vieja])
  })

  it('una nueva va al FINAL aunque ocupe un puesto libre del medio (las de antes se numeran como se ven)', { timeout: 30_000 }, async () => {
    // Fotos de antes de `orden`: puestos 1 y 3, sin orden.
    const db = dobleConLlaves([
      { id: 'a', workspace_id: WS, tipo: 'actividad', clave: plan.clave, posicion: 1, principal: true, ref: 'one://a' },
      { id: 'c', workspace_id: WS, tipo: 'actividad', clave: plan.clave, posicion: 3, principal: false, ref: 'one://c' },
    ])
    await subir(db, plan, 10)
    const filas = db.filas as unknown as FilaCatalogo[]
    expect(fotosDe(filas, plan).map((f) => f.id)).toEqual(['a', 'c', 'id-3'])
    expect(db.filas.find((f) => f.id === 'id-3')).toMatchObject({ posicion: 2, orden: 3 })
  })
})

describe('principal y orden', () => {
  it('reordenar: la primera queda principal (una sola) y el orden es el pedido', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    for (let i = 0; i < 3; i++) await subir(db, hotel, i * 40)
    const [a, b, c] = db.filas.map((f) => f.id as string)
    expect((await reordenarFotos(db, WS, 's1', [c, a, b])).ok).toBe(true)
    expect(db.filas.filter((f) => f.principal).map((f) => f.id)).toEqual([c])
    const filas = db.filas as unknown as FilaCatalogo[]
    expect(fotosDe(filas, hotel).map((f) => f.id)).toEqual([c, a, b])
    expect(filaDe(filas, hotel)?.id).toBe(c)
    // Solo cambia el orden entre las extras.
    expect((await reordenarFotos(db, WS, 's1', [c, b, a])).ok).toBe(true)
    expect(fotosDe(db.filas as unknown as FilaCatalogo[], hotel).map((f) => f.id)).toEqual([c, b, a])
  })

  it('reordenar con una lista que no es la del perfil no toca nada', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    for (let i = 0; i < 2; i++) await subir(db, hotel, i * 40)
    const [a] = db.filas.map((f) => f.id as string)
    expect((await reordenarFotos(db, WS, 's1', [a])).ok).toBe(false)
    expect((await reordenarFotos(db, WS, 's1', [a, a])).ok).toBe(false)
    expect(db.filas.filter((f) => f.principal).map((f) => f.id)).toEqual([a])
  })

  it('quitar la principal pasa la principal a la siguiente del orden', { timeout: 30_000 }, async () => {
    const db = dobleConLlaves()
    for (let i = 0; i < 3; i++) await subir(db, hotel, i * 40)
    const [a, b, c] = db.filas.map((f) => f.id as string)
    await reordenarFotos(db, WS, null, [a, c, b])
    expect((await quitarFotoPorId(db, WS, a)).ok).toBe(true)
    expect(db.filas).toHaveLength(2)
    expect(db.filas.filter((f) => f.principal).map((f) => f.id)).toEqual([c])
  })

  it('la base no admite dos principales', async () => {
    const db = dobleConLlaves([
      { id: 'a', workspace_id: WS, tipo: 'hotel', clave: hotel.clave, posicion: 1, principal: true },
      { id: 'b', workspace_id: WS, tipo: 'hotel', clave: hotel.clave, posicion: 2, principal: false },
    ])
    const r = await db.from('fotos_catalogo').update({ principal: true }).eq('id', 'b')
    expect((r as { error: { code: string } | null }).error?.code).toBe('23505')
  })

  it('una foto vieja (sin principal ni puesto) es la principal', () => {
    const vieja = { id: 'v', tipo: 'hotel', clave: hotel.clave, nombre: 'H10', ciudad: 'Barcelona' } as unknown as FilaCatalogo
    expect(filaDe([vieja], hotel)?.id).toBe('v')
    expect(elementosDe([vieja])[0].fotos.map((f) => f.id)).toEqual(['v'])
  })
})

describe('lo que queda de antes', () => {
  it('una de Commons se imprime con su crédito; una de la página oficial nunca; un hotel sin elegir no', () => {
    expect(creditoDeFila({ nombre: 'Park Güell', autor: 'Isiwal', licencia: 'CC BY-SA 3.0', origen: 'wikimedia' })).toBe('Park Güell, Isiwal (Wikimedia Commons, CC BY-SA 3.0)')
    expect(fotoImprimible('actividad', 'wikimedia', false)).toBe(true)
    expect(fotoImprimible('hotel', 'wikimedia', false)).toBe(false)
    expect(fotoImprimible('hotel', 'wikimedia', true)).toBe(true)
    expect(fotoImprimible('hotel', 'sitio_oficial', true)).toBe(false)
    expect(fotoImprimible('actividad', 'sitio_oficial', true)).toBe(false)
    expect(fotoImprimible('hotel', 'asesora', false)).toBe(true)
  })

  it('leer: por la vista, de las llaves pedidas, y cada fila dice por cuál salió', async () => {
    const db = dobleConLlaves([
      { id: 'a', workspace_id: WS, tipo: 'hotel', clave: hotel.clave },
      { id: 'b', workspace_id: WS, tipo: 'actividad', clave: plan.clave },
      { id: 'z', workspace_id: OTRO, tipo: 'hotel', clave: hotel.clave },
    ])
    const filas = await leerCatalogo(db, WS, [hotel.clave])
    expect(filas.map((f) => [f.id, f.clave_pedida])).toEqual([['a', hotel.clave]])
    expect(await leerCatalogo(db, WS, [])).toEqual([])
  })
})
