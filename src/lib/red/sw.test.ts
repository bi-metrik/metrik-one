import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACES_PILOTO_RED } from './piloto'

/**
 * `public/sw.js` corrido tal cual (el mismo texto que baja el navegador) sobre un `self` falso:
 * listeners capturados, Cache Storage en memoria y `fetch` controlado. Lo que se prueba aquí es
 * la DECISIÓN (qué se guarda, con qué llave, qué se repite, qué no se toca); el navegador real
 * está en `scripts/sw-piloto.e2e.mjs` y `scripts/aviso-conexion.e2e.mjs` (caso SW).
 */

const CODIGO = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')

class CacheFalso {
  filas: Array<{ url: string; res: Response }> = []
  async match(req: Request) {
    const f = this.filas.find((x) => x.url === req.url)
    return f ? f.res.clone() : undefined
  }
  async put(req: Request, res: Response) {
    await res.clone().arrayBuffer()
    this.filas = this.filas.filter((x) => x.url !== req.url)
    this.filas.push({ url: req.url, res })
  }
  async keys() {
    return this.filas.map((x) => new Request(x.url))
  }
  async delete(req: Request) {
    const antes = this.filas.length
    this.filas = this.filas.filter((x) => x.url !== req.url)
    return this.filas.length < antes
  }
}

interface EventoFetch {
  request: Request
  respondWith: (p: Promise<Response>) => void
  waitUntil: (p: Promise<unknown>) => void
  preloadResponse?: Promise<Response | undefined>
}

function montarSw(host: string, opciones: { apagado?: boolean } = {}) {
  const listeners: Record<string, (e: unknown) => void> = {}
  const almacen = new Map<string, CacheFalso>()
  const caches = {
    open: async (n: string) => {
      if (!almacen.has(n)) almacen.set(n, new CacheFalso())
      return almacen.get(n)!
    },
    keys: async () => [...almacen.keys()],
    delete: async (n: string) => almacen.delete(n),
  }
  const pedidos: string[] = []
  let red: (req: Request) => Promise<Response> = async () => new Response('x', { status: 200 })
  const fetchFalso = vi.fn(async (req: Request) => {
    pedidos.push(req.url)
    return red(req)
  })
  const unregister = vi.fn(async () => true)
  const navigationPreload = { enable: vi.fn(async () => {}), disable: vi.fn(async () => {}) }
  const self = {
    location: new URL(`https://${host}/sw.js`),
    addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn),
    skipWaiting: vi.fn(),
    registration: { unregister, navigationPreload },
    clients: { claim: vi.fn(async () => {}) },
    crypto: globalThis.crypto,
  }
  const codigo = opciones.apagado ? CODIGO.replace('const APAGADO = false', 'const APAGADO = true') : CODIGO
  new Function('self', 'caches', 'fetch', 'indexedDB', codigo)(self, caches, fetchFalso, undefined)

  async function pedir(url: string, init: RequestInit = {}) {
    let respuesta: Promise<Response> | null = null
    const esperas: Promise<unknown>[] = []
    const ev: EventoFetch = {
      request: new Request(url, init),
      respondWith: (p) => (respuesta = p),
      waitUntil: (p) => esperas.push(p),
    }
    listeners.fetch(ev)
    const r = respuesta ? await respuesta : null
    await Promise.all(esperas)
    return r as Response | null
  }
  async function activar() {
    const esperas: Promise<unknown>[] = []
    listeners.activate({ waitUntil: (p: Promise<unknown>) => esperas.push(p) })
    await Promise.all(esperas)
  }
  return {
    pedir,
    activar,
    almacen,
    caches,
    pedidos,
    navigationPreload,
    unregister,
    poner: (f: (req: Request) => Promise<Response>) => (red = f),
  }
}

const CHUNK = 'https://trappvel.metrikone.co/_next/static/chunks/bf96dbcfda516470.js'

describe('service worker: estáticos inmutables (todos los workspaces)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  it('la lista del piloto en sw.js es la misma de src/lib/red/piloto.ts', () => {
    const m = /const PILOTO = (\[[^\]]*\])/.exec(CODIGO)
    expect(m).not.toBeNull()
    expect(JSON.parse(m![1].replace(/'/g, '"'))).toEqual([...WORKSPACES_PILOTO_RED])
  })

  it('primera vez de la red, después del caché; la llave ignora ?dpl= (mismo nombre = mismo archivo)', async () => {
    const sw = montarSw('trappvel.metrikone.co')
    sw.poner(async () => new Response('codigo', { status: 200, headers: { 'content-type': 'application/javascript' } }))
    const a = await sw.pedir(`${CHUNK}?dpl=dpl_A`)
    expect(await a!.text()).toBe('codigo')
    const b = await sw.pedir(`${CHUNK}?dpl=dpl_B`)
    expect(await b!.text()).toBe('codigo')
    expect(sw.pedidos).toEqual([`${CHUNK}?dpl=dpl_A`])
    const filas = sw.almacen.get('one-estaticos-v1')!.filas
    expect(filas.map((f) => f.url)).toEqual([CHUNK])
    // El deployment nuevo re-anota la entrada (sale última en la poda).
    expect(filas[0].res.headers.get('x-one-dpl')).toBe('dpl_B')
  })

  it('un corte de red se repite dentro del SW y la página no se entera', async () => {
    const sw = montarSw('trappvel.metrikone.co')
    let n = 0
    sw.poner(async () => {
      n++
      if (n < 3) throw new TypeError('Failed to fetch')
      return new Response('ok', { status: 200 })
    })
    const p = sw.pedir(`${CHUNK}?dpl=dpl_A`)
    await vi.advanceTimersByTimeAsync(500 + 1500)
    const r = await p
    expect(await r!.text()).toBe('ok')
    expect(n).toBe(3)
  })

  it('sin red en ningún intento: error de red (la página aplica su propio reintento) y nada guardado', async () => {
    const sw = montarSw('trappvel.metrikone.co')
    sw.poner(async () => {
      throw new TypeError('Failed to fetch')
    })
    const p = sw.pedir(`${CHUNK}?dpl=dpl_A`)
    await vi.advanceTimersByTimeAsync(5_000)
    const r = await p
    expect(r!.type).toBe('error')
    expect(sw.pedidos).toHaveLength(3)
    expect(sw.almacen.get('one-estaticos-v1')?.filas ?? []).toHaveLength(0)
  })

  it('un 404 (deployment fuera de Skew Protection) pasa tal cual y no se guarda', async () => {
    const sw = montarSw('trappvel.metrikone.co')
    sw.poner(async () => new Response('no', { status: 404 }))
    const r = await sw.pedir(`${CHUNK}?dpl=dpl_viejo`)
    expect(r!.status).toBe(404)
    expect(sw.almacen.get('one-estaticos-v1')?.filas ?? []).toHaveLength(0)
  })

  it('NO toca: HTML, RSC, /api/, otro dominio, POST, estáticos sin hash, ni un pedido por rango', async () => {
    const sw = montarSw('trappvel.metrikone.co')
    const nada = [
      await sw.pedir('https://trappvel.metrikone.co/negocios'),
      await sw.pedir('https://trappvel.metrikone.co/negocios?_rsc=abc', { headers: { RSC: '1' } }),
      await sw.pedir('https://trappvel.metrikone.co/api/version'),
      await sw.pedir('https://yfjqscvvxetobiidnepa.supabase.co/rest/v1/negocios'),
      await sw.pedir(CHUNK, { method: 'POST', body: 'x' }),
      await sw.pedir('https://trappvel.metrikone.co/_next/static/BUILDID_xyz/_buildManifest.js'),
      await sw.pedir('https://trappvel.metrikone.co/_next/image?url=%2Flogo.png&w=64'),
      await sw.pedir('https://trappvel.metrikone.co/_next/static/media/video.0a1b2c3d.mp4', { headers: { Range: 'bytes=0-' } }),
    ]
    expect(nada.every((r) => r === null)).toBe(true)
    expect(sw.pedidos).toHaveLength(0)
  })

  it('las fuentes de /_next/static/media con hash también van al caché', async () => {
    const sw = montarSw('trappvel.metrikone.co')
    await sw.pedir('https://trappvel.metrikone.co/_next/static/media/Newsreader_latin_variable-s.p.a53cbbcc.woff2')
    await sw.pedir('https://trappvel.metrikone.co/_next/static/media/Newsreader_latin_variable-s.p.a53cbbcc.woff2')
    expect(sw.pedidos).toHaveLength(1)
  })

  it('fuera del piloto no atiende navegaciones ni RSC y apaga el navigation preload', async () => {
    const sw = montarSw('trappvel.metrikone.co')
    await sw.activar()
    expect(sw.navigationPreload.disable).toHaveBeenCalled()
    expect(sw.navigationPreload.enable).not.toHaveBeenCalled()
  })

  it('en el piloto sí enciende el navigation preload (la carga de página es suya)', async () => {
    const sw = montarSw('soena.metrikone.co')
    await sw.activar()
    expect(sw.navigationPreload.enable).toHaveBeenCalled()
  })

  it('al activarse borra los cachés que no son el vigente y poda al tope', async () => {
    const sw = montarSw('trappvel.metrikone.co')
    await sw.caches.open('otro-cache-viejo')
    const c = (await sw.caches.open('one-estaticos-v1')) as unknown as CacheFalso
    for (let i = 0; i < 605; i++) await c.put(new Request(`https://x/_next/static/chunks/${i.toString(16).padStart(16, '0')}.js`), new Response('x'))
    await sw.activar()
    expect([...sw.almacen.keys()]).toEqual(['one-estaticos-v1'])
    expect(c.filas).toHaveLength(600)
    // Salen los más viejos (los primeros en la fila).
    expect(c.filas[0].url).toContain(`${(5).toString(16).padStart(16, '0')}.js`)
  })

  it('APAGADO: no atiende nada, borra todo su caché y se desregistra', async () => {
    const sw = montarSw('trappvel.metrikone.co', { apagado: true })
    await sw.caches.open('one-estaticos-v1')
    expect(await sw.pedir(`${CHUNK}?dpl=dpl_A`)).toBeNull()
    // `borrarBase` usa indexedDB (no existe aquí: el try lo absorbe).
    await sw.activar()
    expect(sw.almacen.size).toBe(0)
    expect(sw.unregister).toHaveBeenCalled()
  })
})
