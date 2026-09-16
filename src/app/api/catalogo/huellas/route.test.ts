/**
 * La lectura con la que la revisión nocturna detecta deriva entre el cerebro y ONE.
 *
 * Lo que fija: que sea una puerta cerrada como la de escritura (mismo secreto, misma ventana,
 * método y ruta dentro del mensaje), que no devuelva la definición completa, y que un error de
 * base salga como error y no como «no hay versiones» — que es el `?? []` que ya convirtió un
 * 42703 en «cero fuentes consultadas» en metrik-valida.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { firmar } from '@/lib/catalogo/firma'

const SECRETO = 'secreto-de-prueba-catalogo'
const RUTA = '/api/catalogo/huellas'

const seleccionadas: string[] = []
const tablas: Record<string, { data: unknown; error: { message: string } | null }> = {
  catalogo_servicios_versiones: { data: [], error: null },
  catalogo_servicios: { data: [], error: null },
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from(tabla: string) {
      const constructor = {
        select(cols: string) {
          seleccionadas.push(`${tabla}:${cols}`)
          return constructor
        },
        order() {
          return constructor
        },
        then(resolver: (v: unknown) => unknown) {
          return Promise.resolve(tablas[tabla]).then(resolver)
        },
      }
      return constructor
    },
  }),
}))

const { GET } = await import('./route')

function pedir(opciones: { secreto?: string; metodo?: string; ruta?: string; t?: number } = {}) {
  const t = opciones.t ?? Math.floor(Date.now() / 1000)
  const cabecera = firmar(
    { metodo: opciones.metodo ?? 'GET', ruta: opciones.ruta ?? RUTA, cuerpo: '', t },
    opciones.secreto ?? SECRETO,
  )
  return GET(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Request(`https://metrikone.co${RUTA}`, { headers: { 'x-one-firma': cabecera } }) as any,
  )
}

beforeEach(() => {
  seleccionadas.length = 0
  tablas.catalogo_servicios_versiones = {
    data: [
      {
        slug: 'licencia-clarity',
        version: 1,
        fuente_ruta: 'cerebro/catalogo/servicios/licencia-clarity.md',
        fuente_sha256: 'a'.repeat(64),
        recibida_at: '2026-09-16T12:00:00Z',
      },
    ],
    error: null,
  }
  tablas.catalogo_servicios = {
    data: [{ slug: 'licencia-clarity', version_vigente: 1, activo: true }],
    error: null,
  }
  process.env.CATALOGO_SYNC_SECRET = SECRETO
})

describe('es una puerta cerrada, igual que la de escritura', () => {
  it('sin secreto configurado: 503', async () => {
    delete process.env.CATALOGO_SYNC_SECRET
    expect((await pedir()).status).toBe(503)
    expect(seleccionadas).toEqual([])
  })

  it('con otro secreto: 401', async () => {
    expect((await pedir({ secreto: 'otro' })).status).toBe(401)
    expect(seleccionadas).toEqual([])
  })

  it('con una firma de POST sobre esta ruta: 401', async () => {
    expect((await pedir({ metodo: 'POST' })).status).toBe(401)
  })

  it('con una firma de otra ruta: 401', async () => {
    expect((await pedir({ ruta: '/api/catalogo/versiones' })).status).toBe(401)
  })

  it('con una firma vencida: 401', async () => {
    expect((await pedir({ t: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401)
  })
})

describe('lo que devuelve', () => {
  it('las huellas y la versión vigente de cada servicio', async () => {
    const r = await pedir()
    expect(r.status).toBe(200)
    const j = (await r.json()) as { versiones: { fuente_sha256: string }[]; servicios: unknown[] }
    expect(j.versiones[0].fuente_sha256).toBe('a'.repeat(64))
    expect(j.servicios).toEqual([{ slug: 'licencia-clarity', version_vigente: 1, activo: true }])
  })

  it('NO devuelve la definición: para comparar huellas no hace falta', async () => {
    await pedir()
    const cols = seleccionadas.find((s) => s.startsWith('catalogo_servicios_versiones:')) ?? ''
    expect(cols).not.toMatch(/definicion/)
  })
})

describe('un error de base no se disfraza de lista vacía', () => {
  it('500 cuando falla la consulta de versiones', async () => {
    tablas.catalogo_servicios_versiones = { data: null, error: { message: 'column does not exist' } }
    const r = await pedir()
    expect(r.status).toBe(500)
    expect(await r.json()).toMatchObject({ error: 'db_error' })
  })

  it('500 cuando falla la consulta de servicios', async () => {
    tablas.catalogo_servicios = { data: null, error: { message: 'relation does not exist' } }
    expect((await pedir()).status).toBe(500)
  })
})
