/**
 * La puerta por la que entra el catálogo de servicios al producto.
 *
 * Lo que fija, y que ninguna pantalla puede comprobar:
 *   (a) sin `CATALOGO_SYNC_SECRET` no entra nadie (503), y una firma vacía tampoco;
 *   (b) una firma de OTRA ruta no sirve para escribir aquí;
 *   (c) un archivo que no pasa el esquema rebota con 422 y **con el motivo**, no con un 500;
 *   (d) la misma versión con otra huella devuelve 409 y NO llega a la base;
 *   (e) un reenvío idéntico devuelve 200 y es inocuo;
 *   (f) la huella que se guarda la calcula ONE sobre el archivo recibido, no la manda el que
 *       envía.
 *
 * El doble de Supabase no finge: guarda las llamadas a la RPC para poder afirmar que un
 * rechazo ocurrió ANTES de tocar la base. Sin eso, «rebotó» y «rebotó después de escribir» se
 * ven igual desde aquí.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { firmar, sha256 } from '@/lib/catalogo/firma'

const SECRETO = 'secreto-de-prueba-catalogo'
const RUTA = '/api/catalogo/versiones'

const llamadas: Record<string, unknown>[] = []
const respuesta: { data: unknown; error: { message: string } | null } = { data: null, error: null }

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      llamadas.push({ nombre, ...args })
      return respuesta
    },
  }),
}))

const { POST } = await import('./route')

const ARCHIVO = `---
tipo: servicio
slug: licencia-clarity
version: 1
nombre: Licencia Clarity
modulo: business
disparador_cobro: ciclo
tratamiento_iva: excluido
tratamiento_iva_fuente: decisiones/2026-09-16_suscripciones-sin-iva-cloud-computing-excluido
precios_lista_fuente: reglas/pricing-one
parametros:
  precio_mensual: { tipo: cop }
  licencias:      { tipo: entero, min: 1, por_defecto: 3 }
---

Cuerpo.
`

function pedir(
  cuerpo: unknown,
  opciones: { secreto?: string | null; t?: number; metodo?: string; ruta?: string; cabecera?: string } = {},
) {
  const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)
  const t = opciones.t ?? Math.floor(Date.now() / 1000)
  const cabecera =
    opciones.cabecera ??
    firmar({ metodo: opciones.metodo ?? 'POST', ruta: opciones.ruta ?? RUTA, cuerpo: texto, t }, SECRETO)
  return POST(
    new Request(`https://metrikone.co${RUTA}`, {
      method: 'POST',
      body: texto,
      headers: { 'x-one-firma': cabecera, 'content-type': 'application/json' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  )
}

const cuerpoBueno = { fuente_ruta: 'cerebro/catalogo/servicios/licencia-clarity.md', archivo: ARCHIVO }

beforeEach(() => {
  llamadas.length = 0
  respuesta.data = { resultado: 'creada', slug: 'licencia-clarity', version: 1, version_vigente: 1 }
  respuesta.error = null
  process.env.CATALOGO_SYNC_SECRET = SECRETO
})

describe('quién entra', () => {
  it('sin secreto configurado: 503 y ni siquiera se consulta la base', async () => {
    delete process.env.CATALOGO_SYNC_SECRET
    const r = await pedir(cuerpoBueno)
    expect(r.status).toBe(503)
    expect(llamadas).toEqual([])
  })

  it('sin cabecera de firma: 401', async () => {
    const r = await pedir(cuerpoBueno, { cabecera: '' })
    expect(r.status).toBe(401)
    expect(llamadas).toEqual([])
  })

  it('firmado con otro secreto: 401', async () => {
    const texto = JSON.stringify(cuerpoBueno)
    const t = Math.floor(Date.now() / 1000)
    const r = await pedir(cuerpoBueno, { cabecera: firmar({ metodo: 'POST', ruta: RUTA, cuerpo: texto, t }, 'otro') })
    expect(r.status).toBe(401)
  })

  it('con una firma de OTRA ruta: 401', async () => {
    // Quien capture una lectura de huellas no puede usarla para publicar una versión.
    const r = await pedir(cuerpoBueno, { ruta: '/api/catalogo/huellas' })
    expect(r.status).toBe(401)
    expect(llamadas).toEqual([])
  })

  it('con una firma vencida: 401', async () => {
    const r = await pedir(cuerpoBueno, { t: Math.floor(Date.now() / 1000) - 3600 })
    expect(r.status).toBe(401)
    expect(await r.json()).toMatchObject({ motivo: 'fuera_de_ventana' })
  })

  it('si el cuerpo cambió después de firmar: 401', async () => {
    const texto = JSON.stringify(cuerpoBueno)
    const t = Math.floor(Date.now() / 1000)
    const cabecera = firmar({ metodo: 'POST', ruta: RUTA, cuerpo: texto, t }, SECRETO)
    const r = await POST(
      new Request(`https://metrikone.co${RUTA}`, {
        method: 'POST',
        body: JSON.stringify({ ...cuerpoBueno, archivo: ARCHIVO.replace('Clarity', 'Otra cosa') }),
        headers: { 'x-one-firma': cabecera },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    )
    expect(r.status).toBe(401)
  })
})

describe('un archivo bueno se publica', () => {
  it('201 cuando la versión no existía', async () => {
    const r = await pedir(cuerpoBueno)
    expect(r.status).toBe(201)
    expect(await r.json()).toMatchObject({ resultado: 'creada' })
  })

  it('200 cuando es el mismo reenvío (la Action corre en cada push)', async () => {
    respuesta.data = { resultado: 'ya_estaba', slug: 'licencia-clarity', version: 1, version_vigente: 1 }
    const r = await pedir(cuerpoBueno)
    expect(r.status).toBe(200)
  })

  it('la huella la calcula ONE sobre el archivo, no la manda quien envía', async () => {
    // Si viniera en el cuerpo, la huella y el contenido podrían decir cosas distintas y la
    // revisión de deriva no lo notaría nunca.
    await pedir({ ...cuerpoBueno, fuente_sha256: 'f'.repeat(64) })
    expect(llamadas[0].p_fuente_sha256).toBe(sha256(ARCHIVO))
    expect(llamadas[0].p_fuente_sha256).not.toBe('f'.repeat(64))
  })

  it('manda a la base el slug, la versión y la definición leída del archivo', async () => {
    await pedir(cuerpoBueno)
    expect(llamadas[0]).toMatchObject({
      nombre: 'registrar_version_catalogo',
      p_slug: 'licencia-clarity',
      p_version: 1,
      p_fuente_ruta: 'cerebro/catalogo/servicios/licencia-clarity.md',
    })
    expect(llamadas[0].p_definicion).toMatchObject({
      modulo: 'business',
      disparador_cobro: 'ciclo',
      tratamiento_iva: 'excluido',
    })
  })
})

describe('un archivo que no debe publicarse rebota ANTES de la base', () => {
  const rebota = async (cuerpo: unknown, estado: number, error: string) => {
    const r = await pedir(cuerpo)
    expect(r.status, error).toBe(estado)
    expect(await r.json()).toMatchObject({ error })
    expect(llamadas, 'no debió tocar la base').toEqual([])
  }

  it('sin `archivo`', () => rebota({ fuente_ruta: 'cerebro/catalogo/servicios/x.md' }, 400, 'falta_archivo'))
  it('sin `fuente_ruta`', () => rebota({ archivo: ARCHIVO }, 400, 'falta_fuente_ruta'))
  it('json que no parsea', async () => {
    const r = await pedir('{no es json')
    expect(r.status).toBe(400)
    expect(llamadas).toEqual([])
  })

  it('una ruta fuera del catálogo', () =>
    rebota({ fuente_ruta: 'cerebro/decisiones/algo.md', archivo: ARCHIVO }, 400, 'ruta_fuera_del_catalogo'))

  it('el slug del frontmatter no coincide con el nombre del archivo', () =>
    // Renombrar el archivo publicaría el mismo tipo dos veces, y un contrato quedaría
    // apuntando al que se abandonó.
    rebota(
      { fuente_ruta: 'cerebro/catalogo/servicios/licencia-sustenta.md', archivo: ARCHIVO },
      422,
      'slug_no_coincide',
    ))

  it('un frontmatter que no se puede leer', () =>
    rebota(
      { ...cuerpoBueno, archivo: '---\nlista:\n  - a\n  - b\n---\n' },
      422,
      'frontmatter_ilegible',
    ))

  it('una definición sin `tratamiento_iva`: nada nace con 19 %', async () => {
    const sinIva = ARCHIVO.replace('tratamiento_iva: excluido\n', '')
    const r = await pedir({ ...cuerpoBueno, archivo: sinIva })
    expect(r.status).toBe(422)
    expect(JSON.stringify(await r.json())).toMatch(/tratamiento_iva/)
    expect(llamadas).toEqual([])
  })

  it('una definición con `comision`: eso lo define cada contrato (N3)', async () => {
    const conComision = ARCHIVO.replace('tratamiento_iva: excluido', 'tratamiento_iva: excluido\ncomision: 20')
    const r = await pedir({ ...cuerpoBueno, archivo: conComision })
    expect(r.status).toBe(422)
    expect(JSON.stringify(await r.json())).toMatch(/cada negocio o contrato/)
    expect(llamadas).toEqual([])
  })

  it('el 422 dice QUÉ está mal, no solo que está mal', async () => {
    const r = await pedir({ ...cuerpoBueno, archivo: ARCHIVO.replace('modulo: business', 'modulo: inventado') })
    const j = (await r.json()) as { detalles: string[] }
    expect(j.detalles.length).toBeGreaterThan(0)
    expect(j.detalles.join(' ')).toMatch(/modulo/)
  })
})

describe('conflicto de huella', () => {
  it('409 con el motivo escrito, y la base no cambió nada', async () => {
    respuesta.data = {
      resultado: 'conflicto_huella',
      slug: 'licencia-clarity',
      version: 1,
      sha_registrada: 'a'.repeat(64),
      sha_recibida: 'b'.repeat(64),
    }
    const r = await pedir(cuerpoBueno)
    expect(r.status).toBe(409)
    const j = (await r.json()) as { detalles: string[]; sha_registrada: string }
    expect(j.detalles.join(' ')).toMatch(/subí la versión/)
    expect(j.sha_registrada).toBe('a'.repeat(64))
  })
})

describe('un error de base no se disfraza', () => {
  it('500 con el mensaje', async () => {
    respuesta.error = { message: 'connection reset' }
    const r = await pedir(cuerpoBueno)
    expect(r.status).toBe(500)
    expect(await r.json()).toMatchObject({ error: 'db_error', message: 'connection reset' })
  })
})
