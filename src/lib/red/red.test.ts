import { describe, it, expect, vi } from 'vitest'
import {
  esErrorDeRed,
  esErrorDeCargaDeChunk,
  textoPantallaDeError,
  PANTALLA_TARDANDO,
} from './error-de-red'
import {
  planearRecuperacion,
  reclamarRecarga,
  reclamarSuave,
  tomarPendiente,
  olvidarRecargas,
  ESPERAS_RECARGA_MS,
  MAX_RECARGAS,
  VENTANA_RECARGAS_MS,
  type AlmacenRecarga,
} from './auto-recarga'
import { conReintentoDeRed } from './con-reintento'
import { envolverTolerante } from './transicion-tolerante'

const chunkTurbopack = new Error(
  'Failed to load chunk /_next/static/chunks/bed563291db3ead2.js?dpl=dpl_BxLac from module 964893',
)

describe('esErrorDeRed', () => {
  it.each([
    ['WebKit (iPhone, el caso del 2-oct)', new TypeError('Load failed')],
    ['Chromium', new TypeError('Failed to fetch')],
    ['Firefox', new TypeError('NetworkError when attempting to fetch resource.')],
    ['Chromium "network error" (Chrome en Mac, el caso del 3-oct)', new TypeError('network error')],
    ['"Network Error" en mayusculas, TypeError', new TypeError('Network Error')],
    ['Firefox, stream RSC cortado (el caso del 3-oct)', new TypeError('Error in input stream')],
    ['WebKit, conexion perdida a medias', new TypeError('The network connection was lost.')],
    ['WebKit, sin internet', new TypeError('The Internet connection appears to be offline.')],
    ['Firefox, frase completa aunque llegue sin nombre', { message: 'NetworkError when attempting to fetch resource.' }],
    ['import() en Chromium', new TypeError('Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js')],
    ['chunk de Turbopack (el caso del 2-oct)', chunkTurbopack],
    ['chunk de webpack', new Error('Loading chunk 123 failed.')],
    ['CSS chunk', new Error('Loading CSS chunk 7 failed')],
    ['import() en WebKit', new TypeError('Importing a module script failed.')],
    ['import() en Firefox', new TypeError('error loading dynamically imported module: https://x/y.js')],
  ])('%s → si', (_, e) => {
    expect(esErrorDeRed(e)).toBe(true)
  })

  it('ChunkLoadError por nombre, aunque el mensaje no diga nada', () => {
    const e = new Error('x')
    e.name = 'ChunkLoadError'
    expect(esErrorDeRed(e)).toBe(true)
    expect(esErrorDeCargaDeChunk(e)).toBe(true)
  })

  it('acepta objetos sin ser Error (lo que llega serializado)', () => {
    expect(esErrorDeRed({ name: 'TypeError', message: 'Load failed' })).toBe(true)
  })

  it.each([
    ['error de negocio', new Error('Negocio no encontrado')],
    ['bug de render', new TypeError("Cannot read properties of undefined (reading 'id')")],
    ['digest de server component', Object.assign(new Error('An error occurred in the Server Components render.'), { digest: '123' })],
    ['null', null],
    ['undefined', undefined],
    ['string cualquiera', 'boom'],
    ['identificador de la app que contiene "networkError"', new ReferenceError('networkErrors is not defined')],
    ['"Network error" de negocio (Error, no TypeError)', new Error('Network error de la API de Siigo')],
    ['"Network Error" como Error a secas', new Error('Network Error')],
    ['"Error in input stream" de la app', new Error('Error in input stream del PDF')],
    ['"connection was lost" de la app', new Error('The network connection was lost while syncing Siigo')],
    ['serializado sin nombre con texto ambiguo', { message: 'network error' }],
    ['"error" a secas, aun como TypeError', new TypeError('error')],
    ['TypeError con "input stream" pero sin la frase', new TypeError('Invalid input stream')],
  ])('%s → no', (_, e) => {
    expect(esErrorDeRed(e)).toBe(false)
  })

  it('el caso del 3-oct llega serializado con nombre: si', () => {
    expect(esErrorDeRed({ name: 'TypeError', message: 'network error' })).toBe(true)
    expect(esErrorDeRed({ name: 'TypeError', message: 'Error in input stream' })).toBe(true)
  })

  it('import() de Chromium es de chunk (recargar lo vuelve a pedir)', () => {
    expect(esErrorDeCargaDeChunk(new TypeError('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true)
    expect(esErrorDeCargaDeChunk(new TypeError('network error'))).toBe(false)
  })

  it('una falla de fetch NO es de chunk (solo de red)', () => {
    expect(esErrorDeCargaDeChunk(new TypeError('Load failed'))).toBe(false)
    expect(esErrorDeCargaDeChunk(chunkTurbopack)).toBe(true)
  })
})

describe('textoPantallaDeError', () => {
  it('error de red con los intentos agotados: "tardando más de lo normal", sin culpar la señal', () => {
    const t = textoPantallaDeError(new TypeError('Load failed'), 'Algo se rompió en esta pantalla')
    expect(t).toEqual(PANTALLA_TARDANDO)
    expect(t.titulo).toBe('Esta página está tardando más de lo normal')
    expect(`${t.titulo} ${t.cuerpo}`).not.toMatch(/conexi[oó]n|señal|desconect/i)
    expect(t.cuerpo).not.toMatch(/pestaña/i)
  })

  it('"network error" de Chromium y "Error in input stream" de Firefox tambien', () => {
    expect(textoPantallaDeError(new TypeError('network error'), 'x')).toEqual(PANTALLA_TARDANDO)
    expect(textoPantallaDeError(new TypeError('Error in input stream'), 'x')).toEqual(PANTALLA_TARDANDO)
  })

  it('"Network error" de negocio NO es de red: titulo propio', () => {
    expect(textoPantallaDeError(new Error('Network error de la API de Siigo'), 'x').titulo).toBe('x')
  })

  it('error de la app: titulo propio de la pantalla y el texto de la pestaña vieja', () => {
    const t = textoPantallaDeError(
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      'MéTRIK one no pudo cargar',
    )
    expect(t.titulo).toBe('MéTRIK one no pudo cargar')
    expect(t.cuerpo).toMatch(/pestaña que llevaba mucho tiempo abierta/)
  })
})

function almacenEnMemoria(): AlmacenRecarga & { datos: Map<string, string> } {
  const datos = new Map<string, string>()
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => void datos.set(k, v),
  }
}

describe('planearRecuperacion + reclamos (la escalera)', () => {
  const T0 = 1_760_000_000_000
  const red = new TypeError('Failed to fetch')
  const base = { message: 'Failed to fetch', name: 'TypeError', origen: 'app' as const }
  const plan = (s: AlmacenRecarga | null, ahora: number, enLinea = true, pathname = '/negocios') =>
    planearRecuperacion({ error: red, pathname, almacen: s, ahora, enLinea })

  it('un error que no es de red: null (no se recupera solo)', () => {
    expect(planearRecuperacion({ error: new Error('boom'), pathname: '/x', almacen: almacenEnMemoria(), ahora: T0, enLinea: true })).toBeNull()
  })

  it('primero el suave; luego recargas a 2, 5, 15 y 30 s; despues, agotado', () => {
    const s = almacenEnMemoria()
    let t = T0
    expect(plan(s, t)).toEqual({ accion: 'suave', esperaMs: 0, intento: 0 })
    expect(reclamarSuave('/negocios', s, t, base)).toBe(true)
    for (let i = 0; i < MAX_RECARGAS; i++) {
      expect(plan(s, t)).toEqual({ accion: 'recarga', esperaMs: ESPERAS_RECARGA_MS[i], intento: i })
      t += ESPERAS_RECARGA_MS[i]
      expect(reclamarRecarga('/negocios', s, t, base)).toBe(true)
    }
    expect(ESPERAS_RECARGA_MS).toEqual([2_000, 5_000, 15_000, 30_000])
    expect(plan(s, t + 1_000)).toEqual({ accion: 'agotado', esperaMs: 0, intento: MAX_RECARGAS })
    expect(reclamarRecarga('/negocios', s, t + 1_000, base)).toBe(false)
  })

  it('el suave es UNO por episodio (si el refresh acaba en navegacion completa, no se repite)', () => {
    const s = almacenEnMemoria()
    expect(reclamarSuave('/negocios', s, T0, base)).toBe(true)
    expect(reclamarSuave('/negocios', s, T0 + 1_000, base)).toBe(false)
    expect(plan(s, T0 + 1_000)?.accion).toBe('recarga')
    // Pasada la ventana, un episodio nuevo vuelve a empezar por el suave.
    expect(plan(s, T0 + VENTANA_RECARGAS_MS)?.accion).toBe('suave')
  })

  it('el tope es por ruta y por ventana deslizante de 3 min', () => {
    const s = almacenEnMemoria()
    for (let i = 0; i < MAX_RECARGAS; i++) reclamarRecarga('/negocios', s, T0 + i, base)
    expect(reclamarRecarga('/negocios', s, T0 + 10, base)).toBe(false)
    expect(reclamarRecarga('/tableros', s, T0 + 10, base)).toBe(true)
    // La primera sale de la ventana: vuelve a haber cupo para una.
    expect(reclamarRecarga('/negocios', s, T0 + VENTANA_RECARGAS_MS, base)).toBe(true)
    expect(reclamarRecarga('/negocios', s, T0 + VENTANA_RECARGAS_MS, base)).toBe(false)
  })

  it('sin internet: esperar la red, sin gastar nada', () => {
    const s = almacenEnMemoria()
    expect(plan(s, T0, false)).toEqual({ accion: 'esperar-red', esperaMs: 0, intento: 0 })
    expect(s.datos.size).toBe(0)
  })

  it('planear solo lee', () => {
    const s = almacenEnMemoria()
    plan(s, T0)
    plan(s, T0, false)
    expect(s.datos.size).toBe(0)
  })

  it('sin sessionStorage, o si lanza o no guarda: agotado y ningun reclamo', () => {
    expect(plan(null, T0)?.accion).toBe('agotado')
    const ilegible: AlmacenRecarga = { getItem: () => { throw new Error('SecurityError') }, setItem: () => {} }
    expect(plan(ilegible, T0)?.accion).toBe('agotado')
    expect(reclamarSuave('/negocios', ilegible, T0, base)).toBe(false)
    const roto: AlmacenRecarga = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
    expect(reclamarSuave('/negocios', roto, T0, base)).toBe(false)
    expect(reclamarRecarga('/negocios', roto, T0, base)).toBe(false)
    const mudo: AlmacenRecarga = { getItem: () => null, setItem: () => {} }
    expect(reclamarRecarga('/negocios', mudo, T0, base)).toBe(false)
  })

  it('la marca vieja de #1002 (un numero) cuenta como una recarga; la basura no bloquea', () => {
    const s = almacenEnMemoria()
    s.datos.set('metrik:auto-recarga:/negocios', String(T0))
    expect(plan(s, T0 + 1_000)?.intento).toBe(1)
    s.datos.set('metrik:auto-recarga:/negocios', 'basura')
    expect(plan(s, T0)?.accion).toBe('suave')
  })

  it('tomarPendiente: devuelve lo anotado UNA vez y conserva el historial', () => {
    const s = almacenEnMemoria()
    reclamarSuave('/negocios', s, T0, base)
    reclamarRecarga('/negocios', s, T0 + 2_000, base)
    expect(tomarPendiente('/negocios', s, T0 + 9_000)).toMatchObject({ accion: 'recarga', intento: 1, message: 'Failed to fetch', origen: 'app' })
    expect(tomarPendiente('/negocios', s, T0 + 9_000)).toBeNull()
    expect(plan(s, T0 + 9_000)).toMatchObject({ accion: 'recarga', intento: 1 })
  })

  it('olvidarRecargas (boton Recargar): la escalera vuelve a empezar', () => {
    const s = almacenEnMemoria()
    for (let i = 0; i < MAX_RECARGAS; i++) reclamarRecarga('/negocios', s, T0 + i, base)
    olvidarRecargas('/negocios', s)
    expect(plan(s, T0 + 10)?.accion).toBe('suave')
  })
})

describe('conReintentoDeRed', () => {
  const dormir = vi.fn(async () => {})

  it('falla de red y luego exito: un reintento y devuelve el valor', async () => {
    const fn = vi.fn<() => Promise<number>>()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(42)
    await expect(conReintentoDeRed(fn, { dormir })).resolves.toBe(42)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('dos fallas de red: lanza la segunda (solo UN reintento)', async () => {
    const fn = vi.fn<() => Promise<number>>().mockRejectedValue(new TypeError('Load failed'))
    await expect(conReintentoDeRed(fn, { dormir })).rejects.toThrow('Load failed')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('error que no es de red: no reintenta', async () => {
    const fn = vi.fn<() => Promise<number>>().mockRejectedValue(new Error('Negocio no encontrado'))
    await expect(conReintentoDeRed(fn, { dormir })).rejects.toThrow('Negocio no encontrado')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('envolverTolerante', () => {
  it('falla de red en una transicion async: avisa y NO relanza', async () => {
    const avisar = vi.fn()
    const cb = envolverTolerante(async () => { throw new TypeError('Load failed') }, avisar)
    await expect(cb()).resolves.toBeUndefined()
    expect(avisar).toHaveBeenCalledTimes(1)
  })

  it('error de la app en una transicion async: relanza (sigue al boundary)', async () => {
    const avisar = vi.fn()
    const cb = envolverTolerante(async () => { throw new Error('bug') }, avisar)
    await expect(cb()).rejects.toThrow('bug')
    expect(avisar).not.toHaveBeenCalled()
  })

  it('callback sincrono: corre igual, y su error de red tambien se absorbe', () => {
    const avisar = vi.fn()
    let corrio = false
    expect(envolverTolerante(() => { corrio = true }, avisar)()).toBeUndefined()
    expect(corrio).toBe(true)
    expect(() => envolverTolerante(() => { throw new TypeError('Failed to fetch') }, avisar)()).not.toThrow()
    expect(avisar).toHaveBeenCalledTimes(1)
    expect(() => envolverTolerante(() => { throw new Error('bug') }, avisar)()).toThrow('bug')
  })

  it('una respuesta { error } de la accion no se toca', async () => {
    const avisar = vi.fn()
    let visto: unknown
    const accion = async () => ({ error: 'No tienes permiso' })
    await envolverTolerante(async () => { visto = await accion() }, avisar)()
    expect(visto).toEqual({ error: 'No tienes permiso' })
    expect(avisar).not.toHaveBeenCalled()
  })
})
