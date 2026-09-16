import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { llamarValidaNucleo, type DependenciasCliente } from './cliente-nucleo'

const ACTOR = { usuario_id: '11111111-1111-4111-8111-111111111111', correo: 'juan@4dsoft.co' }
const T = 1789500000
const LLAVE_EN_CLARO = 'vld_live_ESTA_LLAVE_NO_PUEDE_APARECER_EN_UN_LOG_9f3a'

type Capturada = { url: string; init: RequestInit }

function respuesta(status: number, cuerpo: unknown): Response {
  return new Response(cuerpo === undefined ? '' : JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function deps(over: Partial<DependenciasCliente> & { capturar?: Capturada[] } = {}): DependenciasCliente {
  const capturar = over.capturar
  return {
    secreto: 'secreto-de-prueba-no-real',
    base: 'https://valida.example',
    ahora: () => T,
    fetch: (async (url: string, init: RequestInit) => {
      capturar?.push({ url, init })
      return respuesta(200, { ok: true })
    }) as unknown as typeof fetch,
    ...over,
  }
}

describe('sin secreto no se llama', () => {
  it('devuelve no_disponible y NO toca la red', async () => {
    const fetch = vi.fn()
    const r = await llamarValidaNucleo(
      { metodo: 'GET', ruta: '/clientes/x/resumen', actor: ACTOR },
      deps({ secreto: '   ', fetch: fetch as unknown as typeof globalThis.fetch }),
    )
    expect(r).toEqual({ tipo: 'no_disponible', motivo: 'sin_secreto' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('lo que se firma es lo que viaja', () => {
  it('en un POST, la firma cubre el cuerpo EXACTO que se manda', async () => {
    const capturar: Capturada[] = []
    await llamarValidaNucleo(
      { metodo: 'POST', ruta: '/clientes/abc/llaves', actor: ACTOR, cuerpo: { actor: ACTOR, nombre: 'ERP' } },
      deps({ capturar }),
    )
    const { init, url } = capturar[0]
    expect(url).toBe('https://valida.example/api/one/v1/clientes/abc/llaves')
    const enviado = init.body as string
    const headers = init.headers as Record<string, string>
    // Recalculado aparte, con el cuerpo que salió por la red: si el cliente serializara dos
    // veces (y un orden de llaves cambiara), esto no cuadraría y Valida respondería 401.
    const esperada = createHmac('sha256', 'secreto-de-prueba-no-real').update(`${T}.${enviado}`).digest('hex')
    expect(headers['X-One-Firma']).toBe(`t=${T},v1=${esperada}`)
    expect(headers['X-One-Actor']).toBe(ACTOR.usuario_id)
    expect(headers['X-One-Actor-Correo']).toBe(ACTOR.correo)
    expect(JSON.parse(enviado)).toEqual({ actor: ACTOR, nombre: 'ERP' })
  })

  it('en un GET no manda cuerpo y firma la cadena vacía', async () => {
    const capturar: Capturada[] = []
    await llamarValidaNucleo({ metodo: 'GET', ruta: '/clientes/abc/resumen', actor: ACTOR }, deps({ capturar }))
    const { init } = capturar[0]
    expect(init.body).toBeUndefined()
    const esperada = createHmac('sha256', 'secreto-de-prueba-no-real').update(`${T}.`).digest('hex')
    expect((init.headers as Record<string, string>)['X-One-Firma']).toBe(`t=${T},v1=${esperada}`)
  })
})

describe('«Valida dijo que no» no es lo mismo que «Valida no responde»', () => {
  it('un 409 con su error es `rechazada`, con código y mensaje de Valida', async () => {
    const r = await llamarValidaNucleo(
      { metodo: 'POST', ruta: '/clientes/abc/llaves', actor: ACTOR, cuerpo: {} },
      deps({
        fetch: (async () =>
          respuesta(409, { error: 'limite_alcanzado', message: 'El cliente llego al maximo de llaves vigentes.' })) as unknown as typeof fetch,
      }),
    )
    expect(r).toEqual({
      tipo: 'rechazada',
      status: 409,
      codigo: 'limite_alcanzado',
      mensaje: 'El cliente llego al maximo de llaves vigentes.',
    })
  })

  it('un 503 (Valida sin su secreto) es `no_disponible`', async () => {
    const r = await llamarValidaNucleo(
      { metodo: 'GET', ruta: '/clientes/abc/resumen', actor: ACTOR },
      deps({ fetch: (async () => respuesta(503, { error: 'one_sin_secreto' })) as unknown as typeof fetch }),
    )
    expect(r).toEqual({ tipo: 'no_disponible', motivo: 'error_valida', status: 503 })
  })

  it('un error de red es `no_disponible`, no una excepción que tumbe la página', async () => {
    const r = await llamarValidaNucleo(
      { metodo: 'GET', ruta: '/clientes/abc/resumen', actor: ACTOR },
      deps({ fetch: (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch }),
    )
    expect(r).toEqual({ tipo: 'no_disponible', motivo: 'red' })
  })

  it('un tiempo agotado se nombra como tal', async () => {
    const r = await llamarValidaNucleo(
      { metodo: 'GET', ruta: '/clientes/abc/resumen', actor: ACTOR },
      deps({
        timeoutMs: 20,
        fetch: ((_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const e = new Error('aborted')
              e.name = 'AbortError'
              reject(e)
            })
          })) as unknown as typeof fetch,
      }),
    )
    expect(r).toEqual({ tipo: 'no_disponible', motivo: 'tiempo_agotado' })
  })
})

describe('la llave en claro no llega a ningún log', () => {
  it('ni en la respuesta 201 de generar, ni en un rechazo que la repitiera', async () => {
    const lineas: string[] = []
    const registrar = (l: string) => lineas.push(l)

    const ok = await llamarValidaNucleo<{ llave: string }>(
      { metodo: 'POST', ruta: '/clientes/abc/llaves', actor: ACTOR, cuerpo: { actor: ACTOR, nombre: 'ERP' } },
      deps({
        registrar,
        fetch: (async () => respuesta(201, { ok: true, key_id: 'k', llave: LLAVE_EN_CLARO })) as unknown as typeof fetch,
      }),
    )
    // La llave llega a quien la pidió…
    expect(ok.tipo === 'ok' && ok.datos.llave).toBe(LLAVE_EN_CLARO)

    // …y un rechazo o un 5xx que por error la trajeran en el cuerpo tampoco la registran.
    await llamarValidaNucleo(
      { metodo: 'POST', ruta: '/clientes/abc/llaves', actor: ACTOR, cuerpo: {} },
      deps({ registrar, fetch: (async () => respuesta(400, { error: 'x', message: LLAVE_EN_CLARO, llave: LLAVE_EN_CLARO })) as unknown as typeof fetch }),
    )
    await llamarValidaNucleo(
      { metodo: 'POST', ruta: '/clientes/abc/llaves', actor: ACTOR, cuerpo: {} },
      deps({ registrar, fetch: (async () => respuesta(500, { error: 'db_error', llave: LLAVE_EN_CLARO })) as unknown as typeof fetch }),
    )

    expect(lineas.length).toBeGreaterThan(0)
    for (const l of lineas) expect(l).not.toContain(LLAVE_EN_CLARO)
  })
})
