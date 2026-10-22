import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { apartar, campanasActivas, consultarCupo, verFuncionesDisponibles } from './servicios'
import { funcionesEnMemoria, type CampanaEnMemoria, type FuncionEnMemoria } from './memoria'
import { datosDeApartado, puertoFuncionesSupabase, type ClienteFunciones } from './supabase'
import { codigoDeError, type PropuestaApartado, type PuertoFunciones } from './tipos'
import type { LlaveConversacion } from '../agente/publico/tipos'

/**
 * Los servicios del asistente (§3 del diseño de la etapa 2), corridos dos veces con las MISMAS pruebas: contra el doble
 * en memoria (`memoria.ts`, el del arnés) y contra la base real (la migración `20261022170000_modulo_funciones.sql` en
 * PGlite, por el puerto de producción `supabase.ts` y un cliente que habla con PGlite como service_role). Si el doble y
 * la base dicen cosas distintas, falla una de las dos.
 */

const HORA = 3_600_000

interface Banco {
  ws: string
  puerto: PuertoFunciones
  agregarCampana(c: CampanaEnMemoria): Promise<void>
  agregarFuncion(f: FuncionEnMemoria): Promise<void>
  apartarEquipo(funcionId: string, personas: number): Promise<void>
  autorizar(llave: LlaveConversacion, r: 'si' | 'no'): Promise<void>
  vencer(reservaId: string): Promise<void>
  solicitudDe(reservaId: string): Promise<string | null>
}

let pg: PGlite
let n = 0
const hex = (pre: string) => `00000000-0000-4000-8000-${pre}${(++n).toString(16).padStart(12 - pre.length, '0')}`
let conv = 0

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

function bancoMemoria(ws: string): Banco {
  const m = funcionesEnMemoria()
  return {
    ws,
    puerto: m.puerto,
    agregarCampana: async (c) => m.agregarCampana(c),
    agregarFuncion: async (f) => m.agregarFuncion(f),
    apartarEquipo: async (f, p) => {
      if (!m.apartarEquipo(f, p)) throw new Error('sin_cupo')
    },
    autorizar: async (l, r) => m.autorizar(l, r),
    vencer: async (rid) => m.vencer(rid),
    solicitudDe: async (rid) => m.reservas().find((r) => r.id === rid)?.propuesta?.solicitudCliente ?? null,
  }
}

function bancoBase(ws: string): Banco {
  return {
    ws,
    puerto: puertoFuncionesSupabase(clientePGlite(pg)),
    async agregarCampana(c) {
      const exp = hex('e')
      await pg.query(`insert into funcion_experiencias (id, workspace_id, nombre) values ($1, $2, $3)`, [exp, c.workspaceId, c.experiencia])
      const publicada = c.publicada ?? true
      await pg.query(
        `insert into funcion_campanas (id, workspace_id, experiencia_id, nombre, codigo, estado, agenda_publicada_at, minutos_apartado,
           precio_persona, precio_preventa_persona, abono_persona, permite_pago_total)
         values ($1, $2, $3, $4, upper($5), $6, $7, $8, $9, $10, $11, $12)`,
        [c.id, c.workspaceId, exp, c.nombre, c.codigo, c.estado ?? (publicada ? 'activa' : 'borrador'), publicada ? new Date().toISOString() : null,
          c.minutosApartado, c.precioPersona, c.precioPreventaPersona ?? null, c.abonoPersona ?? null, c.permitePagoTotal ?? true],
      )
    },
    async agregarFuncion(f) {
      const ws = (await pg.query<{ w: string }>(`select workspace_id as w from funcion_campanas where id = $1`, [f.campanaId])).rows[0].w
      await pg.query(
        `insert into funcion_funciones (id, workspace_id, campana_id, inicia_at, capacidad, cupo_asistente, estado, cierra_venta_at,
           es_preventa, precio_persona, precio_preventa_persona, abono_persona, permite_pago_total, archivada_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [f.id, ws, f.campanaId, f.iniciaAt, f.capacidad, f.cupoAsistente ?? f.capacidad, f.estado ?? 'activa', f.cierraVentaAt ?? null,
          f.esPreventa ?? false, f.precioPersona ?? null, f.precioPreventaPersona ?? null, f.abonoPersona ?? null, f.permitePagoTotal ?? null,
          f.archivada ? new Date().toISOString() : null],
      )
    },
    async apartarEquipo(funcionId, personas) {
      const perfil = hex('d')
      await pg.query(`insert into profiles values ($1, $2, 'operator')`, [perfil, ws])
      await pg.exec(`select set_config('prueba.uid', '${perfil}', false); set role authenticated`)
      try {
        await pg.query(`select funcion_apartar($1, $2, $3, 'total', '{}'::jsonb, $4, 'equipo')`, [ws, funcionId, personas, `eq-${hex('a')}`])
      } finally {
        await pg.exec(`reset role; select set_config('prueba.uid', '', false)`)
      }
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

const manana = (h = 0) => new Date(Date.now() + 24 * HORA + h * HORA).toISOString()

function propuesta(l: LlaveConversacion, funcionId: string, personas: number, extra: Partial<PropuestaApartado> = {}): PropuestaApartado {
  return {
    llave: l, canal: 'instagram', funcionId, personas, modalidad: 'total', nombre: 'Cliente', documento: null, telefono: null,
    contactoCanal: '@cliente', solicitudCliente: null, atribucion: { fuente: 'desconocida', ref: null },
    huellaPropuesta: `huella-${hex('b')}`, ...extra,
  }
}

beforeAll(async () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), 'utf8')
  pg = new PGlite()
  await pg.exec(leer('src/lib/funciones/__fixtures__/esquema-base.sql'))
  await pg.exec(leer('supabase/migrations/20261021090000_asistente_chatwoot.sql'))
  await pg.exec(leer('supabase/migrations/20261022170000_modulo_funciones.sql'))
})

afterAll(async () => {
  await pg.close()
})

let espacios = 0
describe.each([
  ['doble en memoria', bancoMemoria],
  ['base real (PGlite)', bancoBase],
])('servicios del asistente — %s', (_nombre, crear) => {
  let b: Banco
  beforeAll(async () => {
    const ws = `00000000-0000-4000-8000-0000000d${(++espacios).toString(16).padStart(4, '0')}`
    await pg.query(`insert into workspaces (id, slug) values ($1, $2)`, [ws, `ws-${espacios}`])
    b = crear(ws)
  })

  async function campana(o: Partial<CampanaEnMemoria> = {}): Promise<CampanaEnMemoria> {
    const c: CampanaEnMemoria = {
      id: hex('c'), workspaceId: b.ws, codigo: `T-${++n}`, nombre: 'Ratatouille octubre', experiencia: 'Ratatouille',
      minutosApartado: 30, precioPersona: 180_000, abonoPersona: 100_000, ...o,
    }
    await b.agregarCampana(c)
    return c
  }

  async function funcion(c: CampanaEnMemoria, o: Partial<FuncionEnMemoria> = {}): Promise<string> {
    const f: FuncionEnMemoria = { id: hex('f'), campanaId: c.id, iniciaAt: manana(), capacidad: 5, ...o }
    await b.agregarFuncion(f)
    return f.id
  }

  async function autorizada() {
    const l = { workspaceId: b.ws, cuentaId: 1, conversacionId: ++conv }
    await b.autorizar(l, 'si')
    return l
  }

  it('consultar_cupo devuelve lo libre del asistente y la tarifa; apartar no sobrevende su cupo', async () => {
    const c = await campana()
    const f = await funcion(c, { capacidad: 7, cupoAsistente: 5 })
    const c0 = await consultarCupo(b.puerto, b.ws, f)
    expect(c0.ok && Object.keys(c0.cupo).sort()).toEqual(['agotada', 'campana_codigo', 'cupo_libre', 'disponible', 'funcion_id', 'inicia_at', 'motivo', 'tarifa'])
    expect(c0.ok && [c0.cupo.cupo_libre, c0.cupo.disponible, c0.cupo.tarifa.precio_persona]).toEqual([5, true, 180_000])

    const a = await apartar(b.puerto, propuesta(await autorizada(), f, 3))
    expect(a.ok && [a.estado, a.repetida, a.montoTotal, a.montoAPagar, a.campanaId]).toEqual(['apartada', false, 540_000, 540_000, c.id])
    expect(await apartar(b.puerto, propuesta(await autorizada(), f, 3))).toEqual({ ok: false, error: 'sin_cupo' })
    expect((await apartar(b.puerto, propuesta(await autorizada(), f, 2, { modalidad: 'abono' }))).ok).toBe(true)
    const c1 = await consultarCupo(b.puerto, b.ws, f)
    expect(c1.ok && [c1.cupo.cupo_libre, c1.cupo.agotada, c1.cupo.motivo]).toEqual([0, true, 'agotada'])
  })

  it('lo que agrega el equipo le resta al asistente', async () => {
    const f = await funcion(await campana(), { capacidad: 10, cupoAsistente: 6 })
    await b.apartarEquipo(f, 4)
    const c = await consultarCupo(b.puerto, b.ws, f)
    expect(c.ok && c.cupo.cupo_libre).toBe(2)
    expect(await apartar(b.puerto, propuesta(await autorizada(), f, 3))).toEqual({ ok: false, error: 'sin_cupo' })
  })

  it('el abono y la preventa: el monto lo calcula ONE', async () => {
    const c = await campana({ precioPreventaPersona: 150_000 })
    const f = await funcion(c, { esPreventa: true })
    const t = await consultarCupo(b.puerto, b.ws, f)
    expect(t.ok && t.cupo.tarifa).toEqual({ tarifa: 'preventa', precio_persona: 150_000, precio_completo_persona: 180_000, abono_persona: 100_000, permite_pago_total: true })
    const a = await apartar(b.puerto, propuesta(await autorizada(), f, 2, { modalidad: 'abono' }))
    expect(a.ok && [a.tarifa, a.precioUnitario, a.montoTotal, a.modalidad, a.montoAPagar]).toEqual(['preventa', 150_000, 300_000, 'abono', 200_000])
  })

  it('modalidad_no_permitida y sin_precio', async () => {
    const sinAbono = await funcion(await campana({ abonoPersona: null }))
    expect(await apartar(b.puerto, propuesta(await autorizada(), sinAbono, 1, { modalidad: 'abono' }))).toEqual({ ok: false, error: 'modalidad_no_permitida' })
    const sinPrecio = await funcion(await campana({ precioPersona: null, abonoPersona: null }))
    expect(await apartar(b.puerto, propuesta(await autorizada(), sinPrecio, 1))).toEqual({ ok: false, error: 'sin_precio' })
  })

  it('la misma huella dos veces es la misma reserva y la misma foto', async () => {
    const f = await funcion(await campana(), { capacidad: 4 })
    const p = propuesta(await autorizada(), f, 3)
    const a = await apartar(b.puerto, p)
    const r = await apartar(b.puerto, p)
    expect(a.ok && r.ok && r.reservaId === a.reservaId && r.repetida && r.montoTotal === a.montoTotal).toBe(true)
    const c = await consultarCupo(b.puerto, b.ws, f)
    expect(c.ok && c.cupo.cupo_libre).toBe(1)
  })

  it('sin autorización general (o retirada) no aparta', async () => {
    const f = await funcion(await campana(), { capacidad: 4 })
    expect(await apartar(b.puerto, propuesta({ workspaceId: b.ws, cuentaId: 1, conversacionId: ++conv }, f, 1))).toEqual({ ok: false, error: 'sin_autorizacion' })
    const l = await autorizada()
    await b.autorizar(l, 'no')
    expect(await apartar(b.puerto, propuesta(l, f, 1))).toEqual({ ok: false, error: 'sin_autorizacion' })
  })

  it('no ve ni aparta en campaña sin publicar, pausada, ni en función pausada, pasada, con venta cerrada o archivada', async () => {
    const l = await autorizada()
    const oculta = await funcion(await campana({ publicada: false }))
    expect(await consultarCupo(b.puerto, b.ws, oculta)).toEqual({ ok: false, error: 'funcion_no_existe' })
    expect(await apartar(b.puerto, propuesta(l, oculta, 1))).toEqual({ ok: false, error: 'funcion_no_existe' })
    const pausada = await funcion(await campana({ estado: 'pausada' }))
    expect(await apartar(b.puerto, propuesta(l, pausada, 1))).toEqual({ ok: false, error: 'campana_no_activa' })
    const activa = await campana()
    const fPausada = await funcion(activa, { estado: 'pausada' })
    expect(await apartar(b.puerto, propuesta(l, fPausada, 1))).toEqual({ ok: false, error: 'funcion_no_activa' })
    const ventaCerrada = await funcion(activa, { iniciaAt: manana(1), cierraVentaAt: new Date(Date.now() - HORA).toISOString() })
    expect(await apartar(b.puerto, propuesta(l, ventaCerrada, 1))).toEqual({ ok: false, error: 'venta_cerrada' })
    const archivada = await funcion(activa, { iniciaAt: manana(2), archivada: true })
    expect(await consultarCupo(b.puerto, b.ws, archivada)).toEqual({ ok: false, error: 'funcion_no_existe' })
  })

  it('ver_funciones_disponibles y campanas_activas usan la misma regla', async () => {
    const WS = b.ws
    const antes = await campanasActivas(b.puerto, WS)
    const x = await campana({ codigo: `x-${++n}` })
    const fx = await funcion(x, { iniciaAt: manana(3) })
    await funcion(x, { iniciaAt: manana(4), estado: 'pausada' })
    await funcion(await campana({ publicada: false }))
    const deX = await verFuncionesDisponibles(b.puerto, WS, x.codigo.toLowerCase())
    expect(deX.ok && deX.dato.map((f) => f.funcion_id)).toEqual([fx])
    expect(deX.ok && deX.dato[0].tarifa.precio_persona).toBe(180_000)
    const despues = await campanasActivas(b.puerto, WS)
    expect(antes.ok && despues.ok && despues.dato.total - antes.dato.total).toBe(1)
    expect(despues.ok && despues.dato.campanas.find((c) => c.codigo === x.codigo.toUpperCase())?.funciones_disponibles).toBe(1)
    expect(despues.ok && despues.dato.preguntar).toBe(despues.ok && despues.dato.total > 1)
  })

  it('una mesa o un monto colados por fuera del tipo no viajan; la solicitud llega como texto', async () => {
    const f = await funcion(await campana(), { capacidad: 8 })
    const colada = {
      ...propuesta(await autorizada(), f, 2, { solicitudCliente: 'vamos 6, queremos estar juntos' }),
      mesaId: hex('a'), montoTotal: 1, precio: 1,
    }
    const a = await apartar(b.puerto, colada as PropuestaApartado)
    if (!a.ok) throw new Error(a.error)
    expect(a.montoTotal).toBe(360_000)
    expect(await b.solicitudDe(a.reservaId)).toBe('vamos 6, queremos estar juntos')
  })
})

describe('piezas puras', () => {
  const l = { workspaceId: '00000000-0000-4000-8000-000000000001', cuentaId: 1, conversacionId: 2 }
  it('los datos que viajan a la base no tienen mesa, puesto ni monto', () => {
    const p = { ...propuesta(l, hex('f'), 2), mesaId: 'x', montoTotal: 1 } as PropuestaApartado
    expect(Object.keys(datosDeApartado(p)).sort()).toEqual([
      'atribucion_fuente', 'atribucion_ref', 'canal', 'chatwoot_conversacion_id', 'chatwoot_cuenta_id', 'contacto_canal', 'documento',
      'nombre', 'solicitud_cliente', 'telefono',
    ])
  })

  it('codigoDeError conoce los códigos de la base y el resto es error_base', () => {
    expect(codigoDeError('sin_cupo')).toBe('sin_cupo')
    expect(codigoDeError('modalidad_no_permitida')).toBe('modalidad_no_permitida')
    expect(codigoDeError('permission denied for function funcion_publicar_agenda')).toBe('error_base')
  })

  it('apartar valida antes de tocar el puerto', async () => {
    const m = funcionesEnMemoria()
    m.autorizar(l, 'si')
    expect(await apartar(m.puerto, propuesta(l, 'no-es-uuid', 1))).toEqual({ ok: false, error: 'funcion_no_existe' })
    expect(await apartar(m.puerto, propuesta(l, hex('f'), 0))).toEqual({ ok: false, error: 'personas_invalidas' })
    expect(await apartar(m.puerto, propuesta(l, hex('f'), 1, { modalidad: 'cuotas' as never }))).toEqual({ ok: false, error: 'modalidad_no_permitida' })
    expect(await apartar(m.puerto, propuesta(l, hex('f'), 1, { atribucion: { fuente: 'equipo' as never, ref: null } }))).toEqual({ ok: false, error: 'datos_invalidos' })
    expect(await apartar(m.puerto, propuesta(l, hex('f'), 1, { huellaPropuesta: ' ' }))).toEqual({ ok: false, error: 'datos_invalidos' })
  })
})
