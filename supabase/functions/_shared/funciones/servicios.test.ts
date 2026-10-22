import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { apartar, consultarCupo } from './servicios'
import { funcionesEnMemoria, type FuncionEnMemoria } from './memoria'
import { datosDeApartado, puertoFuncionesSupabase, type ClienteFunciones } from './supabase'
import { codigoDeError, type PropuestaApartado, type PuertoFunciones } from './tipos'
import type { LlaveConversacion } from '../agente/publico/tipos'

/**
 * Los servicios `consultar_cupo` y `apartar` del asistente (§3 del diseño de la etapa 2), corridos dos veces con las
 * MISMAS pruebas: contra el doble en memoria (`memoria.ts`, el del arnés) y contra la base real (la migración
 * `20261022170000_modulo_funciones.sql` en PGlite, por el puerto de producción `supabase.ts` y un cliente que habla
 * con PGlite como service_role). Si el doble y la base dicen cosas distintas, falla una de las dos.
 */

const WS = '00000000-0000-4000-8000-00000000d001'
const OTRO_WS = '00000000-0000-4000-8000-00000000d002'
const HORA = 3_600_000

interface Banco {
  puerto: PuertoFunciones
  agregarFuncion(f: FuncionEnMemoria): Promise<void>
  autorizar(llave: LlaveConversacion, r: 'si' | 'no'): Promise<void>
  vencer(reservaId: string): Promise<void>
  solicitudDe(reservaId: string): Promise<string | null>
}

let pg: PGlite
let n = 0
const id = (pre = 'd') => `00000000-0000-4000-8000-${pre}${(++n).toString(16).padStart(11, '0')}`
let conv = 0
const llave = (ws = WS): LlaveConversacion => ({ workspaceId: ws, cuentaId: 1, conversacionId: ++conv })

/** Un cliente con la forma de supabase-js que corre en PGlite como service_role. */
function clientePGlite(db: PGlite): ClienteFunciones {
  const comoServidor = async <T>(f: () => Promise<T>) => {
    await db.exec(`reset role; select set_config('prueba.uid', '', false); set role service_role`)
    try {
      return await f()
    } finally {
      await db.exec('reset role')
    }
  }
  return {
    async rpc(nombre, args) {
      const claves = Object.keys(args)
      const valores = claves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]))
      const lista = claves.map((k, i) => `${k} => $${i + 1}${typeof args[k] === 'object' && args[k] !== null ? '::jsonb' : ''}`).join(', ')
      try {
        const r = await comoServidor(() => db.query<{ r: unknown }>(`select public.${nombre}(${lista}) as r`, valores))
        return { data: r.rows[0].r, error: null }
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } }
      }
    },
    from(tabla) {
      return {
        select(columnas) {
          const filtros: Array<[string, unknown]> = []
          let orden = ''
          let limite = ''
          const consulta = {
            eq(c: string, v: unknown) { filtros.push([c, v]); return consulta },
            order(c: string, o: { ascending: boolean }) { orden = ` order by ${c} ${o.ascending ? 'asc' : 'desc'}`; return consulta },
            limit(k: number) { limite = ` limit ${k}`; return consulta },
            then(ok: (r: { data: unknown[] | null; error: { message: string } | null }) => unknown, mal?: (e: unknown) => unknown) {
              const where = filtros.map(([c], i) => `${c} = $${i + 1}`).join(' and ')
              return comoServidor(() => db.query(`select ${columnas} from public.${tabla} where ${where}${orden}${limite}`, filtros.map(([, v]) => v)))
                .then((r) => ({ data: r.rows as unknown[], error: null }), (e) => ({ data: null, error: { message: (e as Error).message } }))
                .then(ok, mal)
            },
          }
          return consulta
        },
      }
    },
  }
}

function bancoMemoria(): Banco {
  const m = funcionesEnMemoria()
  return {
    puerto: m.puerto,
    agregarFuncion: async (f) => m.agregarFuncion(f),
    autorizar: async (l, r) => m.autorizar(l, r),
    vencer: async (rid) => m.vencer(rid),
    solicitudDe: async (rid) => m.reservas().find((r) => r.id === rid)?.propuesta.solicitudCliente ?? null,
  }
}

function bancoBase(): Banco {
  return {
    puerto: puertoFuncionesSupabase(clientePGlite(pg)),
    async agregarFuncion(f) {
      const exp = id('e')
      await pg.query(`insert into funcion_experiencias (id, workspace_id, nombre, minutos_apartado) values ($1, $2, 'PRUEBA', $3)`, [exp, f.workspaceId, f.minutosApartado])
      await pg.query(
        `insert into funcion_funciones (id, workspace_id, experiencia_id, inicia_at, cupo_total, estado, cierra_venta_at) values ($1, $2, $3, $4, $5, $6, $7)`,
        [f.id, f.workspaceId, exp, f.iniciaAt, f.cupoTotal, f.estado ?? 'abierta', f.cierraVentaAt ?? null],
      )
    },
    async autorizar(l, r) {
      await pg.query(
        `insert into chatwoot_consentimientos (workspace_id, cuenta_id, conversacion_id, canal, tipo, respuesta, texto_clave, texto_version, texto_huella, created_at)
         values ($1, $2, $3, 'instagram', 'general', $4, 'rf.autorizacion', 'v1', $5, clock_timestamp())`,
        [l.workspaceId, l.cuentaId, l.conversacionId, r, 'b'.repeat(64)],
      )
    },
    async vencer(rid) {
      await pg.query(`update funcion_reservas set vence_at = now() - interval '1 minute' where id = $1`, [rid])
    },
    async solicitudDe(rid) {
      return (await pg.query<{ s: string | null }>(`select solicitud_cliente as s from funcion_reservas where id = $1`, [rid])).rows[0]?.s ?? null
    },
  }
}

const manana = () => new Date(Date.now() + 24 * HORA).toISOString()

function propuesta(l: LlaveConversacion, funcionId: string, personas: number, extra: Partial<PropuestaApartado> = {}): PropuestaApartado {
  return {
    llave: l, canal: 'instagram', funcionId, personas, nombre: 'Cliente', documento: null, telefono: null,
    contactoCanal: '@cliente', solicitudCliente: null, huellaPropuesta: `huella-${id('h')}`, ...extra,
  }
}

beforeAll(async () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), 'utf8')
  pg = new PGlite()
  await pg.exec(leer('src/lib/funciones/__fixtures__/esquema-base.sql'))
  await pg.exec(leer('supabase/migrations/20261021090000_asistente_chatwoot.sql'))
  await pg.exec(leer('supabase/migrations/20261022170000_modulo_funciones.sql'))
  await pg.exec(`insert into workspaces (id, slug) values ('${WS}', 'sabor-prueba'), ('${OTRO_WS}', 'otro')`)
})

afterAll(async () => {
  await pg.close()
})

describe.each([
  ['doble en memoria', bancoMemoria],
  ['base real (PGlite)', bancoBase],
])('servicios del asistente — %s', (_nombre, crear) => {
  let b: Banco
  beforeAll(() => {
    b = crear()
  })

  async function funcion(o: Partial<FuncionEnMemoria> = {}): Promise<string> {
    const f: FuncionEnMemoria = { id: id('f'), workspaceId: WS, iniciaAt: manana(), cupoTotal: 5, minutosApartado: 30, ...o }
    await b.agregarFuncion(f)
    return f.id
  }

  async function autorizada(ws = WS) {
    const l = llave(ws)
    await b.autorizar(l, 'si')
    return l
  }

  it('consultar_cupo devuelve solo cupo libre y si está agotada; apartar no sobrevende', async () => {
    const f = await funcion({ cupoTotal: 5 })
    const c0 = await consultarCupo(b.puerto, WS, f)
    expect(c0.ok && Object.keys(c0.cupo).sort()).toEqual(['agotada', 'cupo_libre', 'estado', 'funcion_id', 'inicia_at'])
    expect(c0.ok && [c0.cupo.cupo_libre, c0.cupo.agotada, c0.cupo.estado]).toEqual([5, false, 'abierta'])

    const a = await apartar(b.puerto, propuesta(await autorizada(), f, 3))
    expect(a.ok && [a.estado, a.repetida]).toEqual(['apartada', false])
    expect(a.ok && a.venceAt).toBeTruthy()
    expect(await apartar(b.puerto, propuesta(await autorizada(), f, 3))).toEqual({ ok: false, error: 'sin_cupo' })
    expect((await apartar(b.puerto, propuesta(await autorizada(), f, 2))).ok).toBe(true)

    const c1 = await consultarCupo(b.puerto, WS, f)
    expect(c1.ok && [c1.cupo.cupo_libre, c1.cupo.agotada]).toEqual([0, true])
  })

  it('la misma huella dos veces es la misma reserva y cuenta una vez', async () => {
    const f = await funcion({ cupoTotal: 4 })
    const p = propuesta(await autorizada(), f, 3)
    const a = await apartar(b.puerto, p)
    const r = await apartar(b.puerto, p)
    expect(a.ok && r.ok && r.reservaId === a.reservaId && r.repetida).toBe(true)
    const c = await consultarCupo(b.puerto, WS, f)
    expect(c.ok && c.cupo.cupo_libre).toBe(1)
  })

  it('sin autorización general (o retirada) no aparta', async () => {
    const f = await funcion({ cupoTotal: 4 })
    expect(await apartar(b.puerto, propuesta(llave(), f, 1))).toEqual({ ok: false, error: 'sin_autorizacion' })
    const l = await autorizada()
    await b.autorizar(l, 'no')
    expect(await apartar(b.puerto, propuesta(l, f, 1))).toEqual({ ok: false, error: 'sin_autorizacion' })
    const c = await consultarCupo(b.puerto, WS, f)
    expect(c.ok && c.cupo.cupo_libre).toBe(4)
  })

  it('función cerrada, venta cerrada, sin regla de apartado y de otro workspace', async () => {
    const l = await autorizada()
    expect(await apartar(b.puerto, propuesta(l, await funcion({ estado: 'cerrada' }), 1))).toEqual({ ok: false, error: 'funcion_cerrada' })
    const ventaCerrada = await funcion({ cierraVentaAt: new Date(Date.now() - HORA).toISOString() })
    expect(await apartar(b.puerto, propuesta(l, ventaCerrada, 1))).toEqual({ ok: false, error: 'venta_cerrada' })
    const c = await consultarCupo(b.puerto, WS, ventaCerrada)
    expect(c.ok && c.cupo.estado).toBe('cerrada')
    expect(await apartar(b.puerto, propuesta(l, await funcion({ minutosApartado: null }), 1))).toEqual({ ok: false, error: 'sin_regla_apartado' })
    const ajena = await funcion({ workspaceId: OTRO_WS })
    expect(await consultarCupo(b.puerto, WS, ajena)).toEqual({ ok: false, error: 'funcion_no_existe' })
    expect(await apartar(b.puerto, propuesta(l, ajena, 1))).toEqual({ ok: false, error: 'funcion_no_existe' })
  })

  it('un apartado vencido libera su cupo', async () => {
    const f = await funcion({ cupoTotal: 2 })
    const a = await apartar(b.puerto, propuesta(await autorizada(), f, 2))
    if (!a.ok) throw new Error(a.error)
    expect(await apartar(b.puerto, propuesta(await autorizada(), f, 1))).toEqual({ ok: false, error: 'sin_cupo' })
    await b.vencer(a.reservaId)
    expect((await apartar(b.puerto, propuesta(await autorizada(), f, 2))).ok).toBe(true)
  })

  it('una mesa colada por fuera del tipo no viaja; la solicitud del cliente llega como texto', async () => {
    const f = await funcion({ cupoTotal: 4 })
    const conMesa = { ...propuesta(await autorizada(), f, 2, { solicitudCliente: 'vamos 6, queremos estar juntos' }), mesaId: id('m'), mesas: [{ mesa_id: id('m'), personas: 2 }] }
    const a = await apartar(b.puerto, conMesa as PropuestaApartado)
    if (!a.ok) throw new Error(a.error)
    expect(await b.solicitudDe(a.reservaId)).toBe('vamos 6, queremos estar juntos')
  })
})

describe('piezas puras', () => {
  it('los datos que viajan a la base no tienen campo de mesa ni de puesto', () => {
    const p = { ...propuesta(llave(), id('f'), 2), mesaId: 'x' } as PropuestaApartado
    expect(Object.keys(datosDeApartado(p)).sort()).toEqual([
      'canal', 'chatwoot_conversacion_id', 'chatwoot_cuenta_id', 'contacto_canal', 'documento', 'nombre', 'solicitud_cliente', 'telefono',
    ])
  })

  it('codigoDeError conoce los códigos de la base y el resto es error_base, no «sin cupo»', () => {
    expect(codigoDeError('sin_cupo')).toBe('sin_cupo')
    expect(codigoDeError('venta_cerrada')).toBe('venta_cerrada')
    expect(codigoDeError('permission denied for function funcion_cancelar_reserva')).toBe('error_base')
    expect(codigoDeError(undefined)).toBe('error_base')
  })

  it('apartar valida antes de tocar el puerto', async () => {
    const m = funcionesEnMemoria()
    const l = llave()
    m.autorizar(l, 'si')
    expect(await apartar(m.puerto, propuesta(l, 'no-es-uuid', 1))).toEqual({ ok: false, error: 'funcion_no_existe' })
    expect(await apartar(m.puerto, propuesta(l, id('f'), 0))).toEqual({ ok: false, error: 'personas_invalidas' })
    expect(await apartar(m.puerto, propuesta(l, id('f'), 1.5))).toEqual({ ok: false, error: 'personas_invalidas' })
    expect(await apartar(m.puerto, propuesta(l, id('f'), 1, { huellaPropuesta: '  ' }))).toEqual({ ok: false, error: 'datos_invalidos' })
  })
})
