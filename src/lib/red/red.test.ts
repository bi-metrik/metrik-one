import { describe, it, expect, vi } from 'vitest'
import {
  esErrorDeRed,
  esErrorDeCargaDeChunk,
  textoPantallaDeError,
  PANTALLA_SIN_CONEXION,
} from './error-de-red'
import { reclamarAutoRecarga, VENTANA_AUTO_RECARGA_MS, type AlmacenRecarga } from './auto-recarga'
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
  it('error de red (iPhone, guarda ya gastada, el caso del 3-oct): dice que se perdio la conexion', () => {
    const t = textoPantallaDeError(new TypeError('Load failed'), 'Algo se rompió en esta pantalla')
    expect(t).toEqual(PANTALLA_SIN_CONEXION)
    expect(t.titulo).toBe('Se perdió la conexión')
    expect(t.cuerpo).toMatch(/revisa la señal y recarga/i)
    expect(t.cuerpo).not.toMatch(/pestaña/i)
  })

  it('"network error" de Chromium y "Error in input stream" de Firefox tambien son sin conexion', () => {
    expect(textoPantallaDeError(new TypeError('network error'), 'x')).toEqual(PANTALLA_SIN_CONEXION)
    expect(textoPantallaDeError(new TypeError('Error in input stream'), 'x')).toEqual(PANTALLA_SIN_CONEXION)
  })

  it('"Network error" de negocio NO dice sin conexion', () => {
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

describe('reclamarAutoRecarga (guarda anti-bucle)', () => {
  const T0 = 1_760_000_000_000

  it('la primera vez en una ruta: si, y deja la marca', () => {
    const s = almacenEnMemoria()
    expect(reclamarAutoRecarga('/negocios', s, T0)).toBe(true)
    expect([...s.datos.values()]).toEqual([String(T0)])
  })

  it('la segunda dentro de la ventana: no (corta el bucle)', () => {
    const s = almacenEnMemoria()
    reclamarAutoRecarga('/negocios', s, T0)
    expect(reclamarAutoRecarga('/negocios', s, T0 + 1_000)).toBe(false)
    expect(reclamarAutoRecarga('/negocios', s, T0 + VENTANA_AUTO_RECARGA_MS - 1)).toBe(false)
  })

  it('pasada la ventana vuelve a poder', () => {
    const s = almacenEnMemoria()
    reclamarAutoRecarga('/negocios', s, T0)
    expect(reclamarAutoRecarga('/negocios', s, T0 + VENTANA_AUTO_RECARGA_MS)).toBe(true)
  })

  it('la guarda es por ruta', () => {
    const s = almacenEnMemoria()
    reclamarAutoRecarga('/negocios', s, T0)
    expect(reclamarAutoRecarga('/negocios/abc', s, T0 + 10)).toBe(true)
  })

  it('sin sessionStorage no recarga', () => {
    expect(reclamarAutoRecarga('/negocios', null, T0)).toBe(false)
  })

  it('si sessionStorage lanza (cuota, modo privado) no recarga ni lanza', () => {
    const roto: AlmacenRecarga = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError') },
    }
    expect(reclamarAutoRecarga('/negocios', roto, T0)).toBe(false)
    const ilegible: AlmacenRecarga = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    }
    expect(reclamarAutoRecarga('/negocios', ilegible, T0)).toBe(false)
  })

  it('si el setItem no guarda nada no recarga (no habria guarda)', () => {
    const mudo: AlmacenRecarga = { getItem: () => null, setItem: () => {} }
    expect(reclamarAutoRecarga('/negocios', mudo, T0)).toBe(false)
  })

  it('un valor basura en la marca no bloquea para siempre', () => {
    const s = almacenEnMemoria()
    s.datos.set('metrik:auto-recarga:/negocios', 'basura')
    expect(reclamarAutoRecarga('/negocios', s, T0)).toBe(true)
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
