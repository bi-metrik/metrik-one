/**
 * El envio de `[error-cliente]` con su bandeja de salida: se anota antes de mandar, se borra
 * con la respuesta, y lo que no llego sale en la siguiente carga o al volver `online`.
 * Corre en node con `window`, `navigator`, `localStorage` y `fetch` de mentira.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLAVE_COLA } from './cola'

type Respuesta = { status: number } | 'red'

function montar({ conAlmacen = true, enLinea = true } = {}) {
  const datos = new Map<string, string>()
  const oyentes = new Map<string, () => void>()
  const respuestas: Respuesta[] = []
  const llamadas: Array<{ url: string; cuerpo: Record<string, unknown> }> = []
  const fetchFalso = vi.fn(async (url: string, init: RequestInit) => {
    llamadas.push({ url, cuerpo: JSON.parse(String(init.body)) })
    const r = respuestas.shift() ?? { status: 204 }
    if (r === 'red') throw new TypeError('Load failed')
    return { status: r.status } as Response
  })
  vi.stubGlobal('window', {
    location: { pathname: '/negocios/abc', host: 'soena.metrikone.co' },
    get localStorage() {
      if (!conAlmacen) throw new Error('SecurityError')
      return {
        getItem: (k: string) => datos.get(k) ?? null,
        setItem: (k: string, v: string) => void datos.set(k, v),
        removeItem: (k: string) => void datos.delete(k),
      }
    },
    addEventListener: (ev: string, fn: () => void) => void oyentes.set(ev, fn),
    removeEventListener: (ev: string) => void oyentes.delete(ev),
  })
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (iPhone)',
    onLine: enLinea,
    connection: { effectiveType: '3g', rtt: 400, downlink: 0.8 },
  })
  vi.stubGlobal('fetch', fetchFalso)
  const cola = () => JSON.parse(datos.get(CLAVE_COLA) ?? '[]') as Array<{ id: string; reenvios: number }>
  return { datos, oyentes, respuestas, llamadas, fetchFalso, cola }
}

const esperar = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('reportarErrorCliente con cola de reenvio', () => {
  it('manda el reporte con id y red del navegador, y lo borra de la cola al responder', async () => {
    const m = montar()
    const { reportarErrorCliente } = await import('./enviar')
    reportarErrorCliente(new TypeError('Failed to fetch'), 'app', true, { accion: 'recarga', intento: 1 })
    expect(m.cola()).toHaveLength(1) // anotado ANTES de que llegue la respuesta
    await esperar()
    expect(m.llamadas).toHaveLength(1)
    const c = m.llamadas[0].cuerpo
    expect(m.llamadas[0].url).toBe('/api/errores-cliente')
    expect(c).toMatchObject({
      message: 'Failed to fetch',
      pathname: '/negocios/abc',
      enLinea: true,
      red: { tipo: '3g', rtt: 400, bajadaMbps: 0.8 },
      accion: 'recarga',
    })
    expect(typeof c.id).toBe('string')
    expect(typeof c.segDesdeCarga).toBe('number')
    expect(m.cola()).toEqual([])
  })

  it('sin respuesta (red caida) queda en la cola; al volver online sale con reenvio y edad', async () => {
    const m = montar()
    m.respuestas.push('red')
    const { reportarErrorCliente, iniciarColaDeReenvio } = await import('./enviar')
    reportarErrorCliente(new TypeError('Load failed'), 'app')
    await esperar()
    expect(m.cola()).toHaveLength(1)
    const id = m.llamadas[0].cuerpo.id

    iniciarColaDeReenvio(60_000)
    m.oyentes.get('online')?.()
    await esperar()
    expect(m.llamadas).toHaveLength(2)
    expect(m.llamadas[1].cuerpo).toMatchObject({ id, reenvio: 1, message: 'Load failed' })
    expect(typeof m.llamadas[1].cuerpo.edadS).toBe('number')
    expect(m.cola()).toEqual([])
  })

  it('un 5xx deja el reporte en la cola; un 400 lo suelta (reintentar no lo arregla)', async () => {
    const m = montar()
    m.respuestas.push({ status: 503 }, { status: 400 })
    const { reportarErrorCliente, reenviarPendientes } = await import('./enviar')
    reportarErrorCliente(new Error('uno'), 'app')
    await esperar()
    expect(m.cola()).toHaveLength(1)
    reenviarPendientes()
    await esperar()
    expect(m.cola()).toEqual([])
  })

  it('lo que dejo otra carga sale en esta, a los segundos de cargar', async () => {
    vi.useFakeTimers()
    const m = montar()
    m.datos.set(
      CLAVE_COLA,
      JSON.stringify([{ id: 'previo-1', creado: Date.now() - 30_000, reenvios: 0, cuerpo: { message: 'viejo' } }]),
    )
    const { iniciarColaDeReenvio } = await import('./enviar')
    const soltar = iniciarColaDeReenvio(3000)
    expect(m.fetchFalso).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(m.llamadas[0].cuerpo).toMatchObject({ id: 'previo-1', reenvio: 1, edadS: 33, message: 'viejo' })
    expect(m.cola()).toEqual([])
    soltar()
  })

  it('no reenvia lo que esta en vuelo en esta misma carga', async () => {
    const m = montar()
    let soltarFetch: (r: Response) => void = () => {}
    m.fetchFalso.mockImplementationOnce(
      (url: string, init: RequestInit) =>
        new Promise<Response>((res) => {
          m.llamadas.push({ url, cuerpo: JSON.parse(String(init.body)) })
          soltarFetch = res
        }),
    )
    const { reportarErrorCliente, reenviarPendientes } = await import('./enviar')
    reportarErrorCliente(new Error('lento'), 'app')
    reenviarPendientes()
    await esperar()
    expect(m.llamadas).toHaveLength(1)
    soltarFetch({ status: 204 } as Response)
    await esperar()
    expect(m.cola()).toEqual([])
  })

  it('sin red no intenta vaciar la cola', async () => {
    const m = montar({ enLinea: false })
    m.datos.set(CLAVE_COLA, JSON.stringify([{ id: 'p', creado: Date.now(), reenvios: 0, cuerpo: { message: 'x' } }]))
    const { reenviarPendientes } = await import('./enviar')
    reenviarPendientes()
    await esperar()
    expect(m.fetchFalso).not.toHaveBeenCalled()
  })

  it('sin localStorage el reporte sale igual, una vez', async () => {
    const m = montar({ conAlmacen: false })
    const { reportarErrorCliente } = await import('./enviar')
    reportarErrorCliente(new Error('sin almacen'), 'global')
    reportarErrorCliente(new Error('sin almacen'), 'global')
    await esperar()
    expect(m.llamadas).toHaveLength(1)
    expect(m.llamadas[0].cuerpo).toMatchObject({ message: 'sin almacen', origen: 'global' })
  })

  it('sin `navigator` (Node 20, el de CI) el fallo de la bandeja sale igual, sin userAgent', async () => {
    const m = montar()
    vi.stubGlobal('navigator', undefined)
    const { reportarFalloDeBandeja } = await import('./enviar')
    reportarFalloDeBandeja({ ruta: 'aceptar-captura', codigo: 'RED', cotizacionId: 'c1', intentos: 3 })
    expect(m.llamadas).toHaveLength(1)
    expect(m.llamadas[0].cuerpo).toMatchObject({ origen: 'bandeja', message: 'Bandeja: aceptar-captura RED' })
    expect(m.llamadas[0].cuerpo).not.toHaveProperty('userAgent')
  })
})
