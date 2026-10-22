/**
 * `20261022170000_modulo_funciones.sql` corrida de verdad en Postgres en memoria (PGlite), encima de la migración real
 * del asistente (`20261021090000_asistente_chatwoot.sql`, de donde sale `chatwoot_consentimientos`).
 *
 * Pruebas de §5 del diseño (`proyectos/sabor-experiencias/clarity/docs/entrada/diseno-etapa2-funciones-mapa.md`) y de
 * las decisiones de Mauricio del 2026-10-22: sin mapa, dos cupos, precios con la foto del monto, y la jerarquía
 * Experiencia → Campaña → Función con la disponibilidad para el asistente. La concurrencia (prueba 8) no se prueba
 * aquí: PGlite tiene UNA conexión y el `for update` nunca espera a nadie. La corre `scripts/funciones-concurrencia.sh`
 * contra un Postgres real en el CI; aquí queda la ráfaga en serie, que prueba la cuenta pero no el candado.
 *
 * Cómo se llama: el equipo con `set role authenticated` y un `auth.uid()` (setting `prueba.uid`), el asistente con
 * `set role service_role` y sin uid, y la preparación de datos como el dueño (la carga de MéTRIK por SQL).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const RAIZ = process.cwd()
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')
const ESQUEMA_BASE = leer('src/lib/funciones/__fixtures__/esquema-base.sql')
const CHATWOOT = leer('supabase/migrations/20261021090000_asistente_chatwoot.sql')
const FUNCIONES = leer('supabase/migrations/20261022170000_modulo_funciones.sql')

const WS = '00000000-0000-4000-8000-00000000f001'
const OTRO_WS = '00000000-0000-4000-8000-00000000f002'
const EQUIPO = '00000000-0000-4000-8000-00000000f011'
const LECTOR = '00000000-0000-4000-8000-00000000f012'
const AJENO = '00000000-0000-4000-8000-00000000f013'
const HUELLA = 'a'.repeat(64)
const TABLAS = ['funcion_experiencias', 'funcion_campanas', 'funcion_funciones', 'funcion_reservas']

let db: PGlite
let n = 0
const uuid = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`
let codigos = 0
const codigo_ = () => `C-${++codigos}`

type Quien = 'dueno' | 'servidor' | { equipo: string }

async function como(q: Quien) {
  await db.exec('reset role')
  if (q === 'dueno') {
    await db.exec(`select set_config('prueba.uid', '', false)`)
  } else if (q === 'servidor') {
    await db.exec(`select set_config('prueba.uid', '', false)`)
    await db.exec('set role service_role')
  } else {
    await db.exec(`select set_config('prueba.uid', '${q.equipo}', false)`)
    await db.exec('set role authenticated')
  }
}

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows
}

/** El mensaje del error (el código estable) o `ok`. */
async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  } catch (e) {
    return (e as Error).message
  }
}

/** Corre `f` como `quien` y vuelve a dueño, pase lo que pase. */
async function siendo<T>(quien: Quien, f: () => Promise<T>): Promise<T> {
  await como(quien)
  try {
    return await f()
  } finally {
    await como('dueno')
  }
}

interface Escenario {
  experiencia: string
  campana: string
  codigo: string
  funcion: string
}

interface OpcionesEscenario {
  capacidad?: number
  cupoAsistente?: number
  /** Precios de la campaña. */
  precio?: number | null
  preventa?: number | null
  abono?: number | null
  permiteTotal?: boolean
  minutos?: number | null
  campanaEstado?: 'borrador' | 'activa' | 'pausada' | 'cerrada'
  publicada?: boolean
  /** De la función. */
  estado?: 'activa' | 'pausada' | 'cancelada'
  esPreventa?: boolean
  cierraVentaAt?: string | null
  reemplazos?: { precio?: number; preventa?: number; abono?: number; permiteTotal?: boolean }
  ws?: string
}

/** Una experiencia, una campaña (por defecto activa, publicada, $100.000 con abono de $40.000) y una función mañana. */
async function escenario(o: OpcionesEscenario = {}): Promise<Escenario> {
  const ws = o.ws ?? WS
  const experiencia = uuid()
  const campana = uuid()
  const funcion = uuid()
  const cod = codigo_()
  const publicada = o.publicada ?? true
  await q(`insert into funcion_experiencias (id, workspace_id, nombre) values ($1, $2, 'Ratatouille')`, [experiencia, ws])
  await q(
    `insert into funcion_campanas (id, workspace_id, experiencia_id, nombre, codigo, estado, agenda_publicada_at, minutos_apartado,
       precio_persona, precio_preventa_persona, abono_persona, permite_pago_total)
     values ($1, $2, $3, 'Ratatouille octubre', $4, $5, $6, $7, $8, $9, $10, $11)`,
    [campana, ws, experiencia, cod, o.campanaEstado ?? (publicada ? 'activa' : 'borrador'), publicada ? new Date().toISOString() : null,
      o.minutos === undefined ? 30 : o.minutos, o.precio === undefined ? 100_000 : o.precio, o.preventa ?? null,
      o.abono === undefined ? 40_000 : o.abono, o.permiteTotal ?? true],
  )
  const capacidad = o.capacidad ?? 10
  await q(
    `insert into funcion_funciones (id, workspace_id, campana_id, inicia_at, capacidad, cupo_asistente, estado, cierra_venta_at,
       es_preventa, precio_persona, precio_preventa_persona, abono_persona, permite_pago_total)
     values ($1, $2, $3, now() + interval '1 day', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [funcion, ws, campana, capacidad, o.cupoAsistente ?? capacidad, o.estado ?? 'activa', o.cierraVentaAt ?? null, o.esPreventa ?? false,
      o.reemplazos?.precio ?? null, o.reemplazos?.preventa ?? null, o.reemplazos?.abono ?? null, o.reemplazos?.permiteTotal ?? null],
  )
  return { experiencia, campana, codigo: cod, funcion }
}

/** Una autorización en `chatwoot_consentimientos` (la escribe el asistente; aquí, el dueño). */
async function autorizacion(conv: number, tipo: 'general' | 'sensible', respuesta: 'si' | 'no', ws = WS): Promise<string> {
  const id = uuid()
  await q(
    `insert into chatwoot_consentimientos (id, workspace_id, cuenta_id, conversacion_id, canal, tipo, respuesta, texto_clave, texto_version, texto_huella, created_at)
     values ($1, $2, 1, $3, 'instagram', $4, $5, 'rf.autorizacion', 'v1', $6, clock_timestamp())`,
    [id, ws, conv, tipo, respuesta, HUELLA],
  )
  return id
}

interface Apartado {
  reserva_id: string
  estado: string
  vence_at: string
  repetida: boolean
  campana_id: string
  tarifa: string
  precio_unitario: number
  monto_total: number
  modalidad: string
  monto_a_pagar: number
}

let conversaciones = 1000
/** Aparta como el asistente, con una conversación que ya dijo «sí» a la autorización general. */
async function apartarAsistente(
  funcion: string,
  personas: number,
  o: { clave?: string; conv?: number; datos?: Record<string, unknown>; modalidad?: string; ws?: string } = {},
): Promise<Apartado> {
  let conv = o.conv
  if (conv === undefined) {
    conv = ++conversaciones
    await autorizacion(conv, 'general', 'si', o.ws ?? WS)
  }
  const datos = { canal: 'instagram', chatwoot_cuenta_id: 1, chatwoot_conversacion_id: conv, nombre: 'Cliente', ...o.datos }
  return siendo('servidor', async () => {
    const r = await q<{ r: Apartado }>(
      `select funcion_apartar($1, $2, $3, $4, $5::jsonb, $6, 'asistente') as r`,
      [o.ws ?? WS, funcion, personas, o.modalidad ?? 'total', JSON.stringify(datos), o.clave ?? `clave-${uuid()}`],
    )
    return r[0].r
  })
}

/** Aparta como el equipo (origen equipo). */
async function apartarEquipo(funcion: string, personas: number, o: { clave?: string; ws?: string; perfil?: string; modalidad?: string } = {}): Promise<Apartado> {
  return siendo({ equipo: o.perfil ?? EQUIPO }, async () => {
    const r = await q<{ r: Apartado }>(
      `select funcion_apartar($1, $2, $3, $4, '{"nombre": "Reserva del equipo"}'::jsonb, $5, 'equipo') as r`,
      [o.ws ?? WS, funcion, personas, o.modalidad ?? 'total', o.clave ?? `eq-${uuid()}`],
    )
    return r[0].r
  })
}

interface Ocupacion {
  capacidad: number
  cupo_asistente: number
  ocupadas: number
  libres: number
  libres_asistente: number
  disponible_asistente: boolean
  motivo_asistente: string | null
  tope_sobreventa: number | null
  tarifa: Tarifa
}
interface Tarifa {
  tarifa: string
  precio_persona: number | null
  precio_completo_persona: number | null
  abono_persona: number | null
  permite_pago_total: boolean
}

async function ocupacion(funcion: string, quien: Quien = { equipo: EQUIPO }): Promise<Ocupacion> {
  return siendo(quien, async () => (await q<{ o: Ocupacion }>(`select funcion_ocupacion($1) as o`, [funcion]))[0].o)
}

const rpc = <T = unknown>(sql: string, params: unknown[], quien: Quien = { equipo: EQUIPO }) =>
  siendo(quien, async () => (await q<{ r: T }>(sql, params))[0].r)

async function cancelar(reserva: string) {
  return siendo({ equipo: EQUIPO }, () => q(`select funcion_cancelar_reserva($1)`, [reserva]))
}

async function vencer(reserva: string) {
  await q(`update funcion_reservas set vence_at = now() - interval '1 minute' where id = $1`, [reserva])
}

async function estado(reserva: string) {
  return (await q<{ estado: string }>(`select estado from funcion_reservas where id = $1`, [reserva]))[0].estado
}

interface Alternativa { funcion_id: string; experiencia: string; campana: string; campana_codigo: string; inicia_at: string; inicia_texto: string; tarifa: Tarifa; alcanza: boolean; grupo: string }
interface Consulta { funcion_id: string; campana_codigo: string; inicia_at: string; inicia_texto: string; estado: string; tarifa: Tarifa; alternativas: Alternativa[] }
const consultar = (funcion: string, ws = WS, personas = 1) =>
  rpc<Consulta>(`select funcion_consultar_cupo($1, $2, $3) as r`, [ws, funcion, personas], 'servidor')

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(CHATWOOT)
  await db.exec(FUNCIONES)
  await db.exec(`
    insert into public.workspaces (id, slug) values ('${WS}', 'sabor-prueba'), ('${OTRO_WS}', 'otro');
    insert into public.profiles values ('${EQUIPO}', '${WS}', 'operator'), ('${LECTOR}', '${WS}', 'read_only'),
                                       ('${AJENO}', '${OTRO_WS}', 'owner');
  `)
})

afterAll(async () => {
  await db.close()
})

describe('no sobreventa', () => {
  it('1. cupo 10: apartados de 4 + 4 + 2 pasan; uno más de 1 da sin_cupo', async () => {
    const e = await escenario({ capacidad: 10 })
    for (const p of [4, 4, 2]) expect((await apartarAsistente(e.funcion, p)).estado).toBe('apartada')
    expect(await codigo(apartarAsistente(e.funcion, 1))).toBe('sin_cupo')
    expect(await codigo(apartarEquipo(e.funcion, 1))).toBe('sin_cupo')
    const o = await ocupacion(e.funcion)
    expect([o.capacidad, o.ocupadas, o.libres]).toEqual([10, 10, 0])
  })

  it('2. un apartado vencido no cuenta: su cupo vuelve y queda vencida', async () => {
    const e = await escenario({ capacidad: 4 })
    const a = await apartarAsistente(e.funcion, 4)
    expect(await codigo(apartarAsistente(e.funcion, 1))).toBe('sin_cupo')
    await vencer(a.reserva_id)
    expect((await ocupacion(e.funcion)).libres).toBe(4)
    expect((await apartarAsistente(e.funcion, 4)).estado).toBe('apartada')
    expect(await estado(a.reserva_id)).toBe('vencida')
  })

  it('3. cancelar libera el cupo', async () => {
    const e = await escenario({ capacidad: 3 })
    const a = await apartarEquipo(e.funcion, 3)
    expect(await codigo(apartarEquipo(e.funcion, 1))).toBe('sin_cupo')
    await cancelar(a.reserva_id)
    expect(await estado(a.reserva_id)).toBe('cancelada')
    expect((await apartarEquipo(e.funcion, 3)).estado).toBe('apartada')
  })

  it('4. la misma clave dos veces: una reserva, el cupo cuenta una vez', async () => {
    const e = await escenario({ capacidad: 5 })
    const conv = ++conversaciones
    await autorizacion(conv, 'general', 'si')
    const a = await apartarAsistente(e.funcion, 3, { clave: 'huella-propuesta-1', conv })
    const b = await apartarAsistente(e.funcion, 3, { clave: 'huella-propuesta-1', conv })
    expect(b.reserva_id).toBe(a.reserva_id)
    expect([a.repetida, b.repetida]).toEqual([false, true])
    expect((await ocupacion(e.funcion)).ocupadas).toBe(3)
    expect(await codigo(apartarAsistente(e.funcion, 2, { clave: 'huella-propuesta-1', conv }))).toBe('clave_reusada')
    expect(await codigo(apartarAsistente(e.funcion, 3, { clave: 'huella-propuesta-1', conv, modalidad: 'abono' }))).toBe('clave_reusada')
  })

  it('5. confirmar un apartado vencido cuyo cupo ya se tomó: sin_cupo; con cupo libre, confirma', async () => {
    const e = await escenario({ capacidad: 4 })
    const a = await apartarAsistente(e.funcion, 4)
    await vencer(a.reserva_id)
    const b = await apartarAsistente(e.funcion, 2)
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'verificado_manual') as r`, [a.reserva_id]))).toBe('sin_cupo')
    await cancelar(b.reserva_id)
    await rpc(`select funcion_confirmar_pago($1, 'verificado_manual') as r`, [a.reserva_id])
    expect(await estado(a.reserva_id)).toBe('confirmada')
  })

  it('confirmar a mano: solo el equipo y solo verificado_manual; la pasarela entra por funcion_registrar_pago', async () => {
    const e = await escenario({ capacidad: 4 })
    const a = await apartarEquipo(e.funcion, 2)
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'aprobado') as r`, [a.reserva_id]))).toBe('pago_estado_invalido')
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'verificado_manual') as r`, [a.reserva_id], 'servidor'))).toMatch(/permission denied/)
    await rpc(`select funcion_confirmar_pago($1, 'verificado_manual') as r`, [a.reserva_id])
    const r = (await q<{ estado: string; pago_estado: string; confirmada_por: string }>(
      `select estado, pago_estado, confirmada_por from funcion_reservas where id = $1`, [a.reserva_id]))[0]
    expect(r).toEqual({ estado: 'confirmada', pago_estado: 'verificado_manual', confirmada_por: EQUIPO })
    await vencer(a.reserva_id)
    expect((await ocupacion(e.funcion)).ocupadas).toBe(2)
  })

  it('6. pasada la hora de cierre de venta no aparta nadie; sin regla de apartado tampoco', async () => {
    const sinVenta = await escenario({ cierraVentaAt: new Date(Date.now() - 60_000).toISOString() })
    expect(await codigo(apartarAsistente(sinVenta.funcion, 1))).toBe('venta_cerrada')
    expect(await codigo(apartarEquipo(sinVenta.funcion, 1))).toBe('venta_cerrada')
    const sinRegla = await escenario({ minutos: null })
    expect(await codigo(apartarEquipo(sinRegla.funcion, 1))).toBe('sin_regla_apartado')
    const pasada = await escenario()
    await q(`update funcion_funciones set inicia_at = now() - interval '1 minute' where id = $1`, [pasada.funcion])
    expect(await codigo(apartarEquipo(pasada.funcion, 1))).toBe('funcion_cerrada')
    expect(await codigo(apartarAsistente(pasada.funcion, 1))).toBe('funcion_pasada')
  })

  it('7. la capacidad no baja de lo ocupado', async () => {
    const e = await escenario({ capacidad: 6 })
    await apartarEquipo(e.funcion, 5)
    expect(await codigo(q(`update funcion_funciones set capacidad = 4, cupo_asistente = 4 where id = $1`, [e.funcion]))).toBe('capacidad_bajo_ocupacion')
    await q(`update funcion_funciones set capacidad = 5, cupo_asistente = 5 where id = $1`, [e.funcion])
    expect((await ocupacion(e.funcion)).libres).toBe(0)
  })

  it('8 (en serie). una ráfaga de 30 apartados de 1 sobre capacidad 7 deja 7 ocupadas', async () => {
    const e = await escenario({ capacidad: 7 })
    const r: string[] = []
    for (let i = 0; i < 30; i++) r.push(await codigo(apartarEquipo(e.funcion, 1)))
    expect(r.filter((x) => x === 'ok').length).toBe(7)
    expect(new Set(r.filter((x) => x !== 'ok'))).toEqual(new Set(['sin_cupo']))
  })
})

describe('dos cupos: capacidad y cupo del asistente', () => {
  it('el asistente llena su cupo y recibe sin_cupo, mientras el equipo sigue hasta la capacidad', async () => {
    const e = await escenario({ capacidad: 7, cupoAsistente: 5 })
    await apartarAsistente(e.funcion, 3)
    expect(await codigo(apartarAsistente(e.funcion, 3))).toBe('sin_cupo')
    await apartarAsistente(e.funcion, 2)
    expect(await codigo(apartarAsistente(e.funcion, 1))).toBe('sin_cupo')
    await apartarEquipo(e.funcion, 2)
    expect(await codigo(apartarEquipo(e.funcion, 1))).toBe('sin_cupo')
    const o = await ocupacion(e.funcion)
    expect([o.capacidad, o.cupo_asistente, o.ocupadas, o.libres, o.libres_asistente]).toEqual([7, 5, 7, 0, 0])
  })

  it('lo que agrega el equipo le resta al asistente (una sola suma)', async () => {
    const e = await escenario({ capacidad: 10, cupoAsistente: 6 })
    await apartarEquipo(e.funcion, 4)
    expect((await consultar(e.funcion, WS, 2)).estado).toBe('alcanza')
    expect((await consultar(e.funcion, WS, 3)).estado).toBe('llena_para_asistente')
    expect(await codigo(apartarAsistente(e.funcion, 3))).toBe('sin_cupo')
    expect((await apartarAsistente(e.funcion, 2)).estado).toBe('apartada')
    expect((await ocupacion(e.funcion)).libres).toBe(4)
  })

  it('cupo del asistente mayor que la capacidad falla; puede bajar por debajo de lo ocupado y solo frena al bot', async () => {
    const e = await escenario({ capacidad: 6, cupoAsistente: 6 })
    expect(await codigo(q(`update funcion_funciones set cupo_asistente = 7 where id = $1`, [e.funcion]))).toMatch(/funcion_funciones_cupo_asistente/)
    expect(await codigo(rpc(`select funcion_editar_funcion($1, 6, 7, 'activa', null, null) as r`, [e.funcion]))).toBe('cupo_asistente_invalido')
    await apartarAsistente(e.funcion, 4)
    await rpc(`select funcion_editar_funcion($1, 6, 2, 'activa', null, null) as r`, [e.funcion])
    const o = await ocupacion(e.funcion)
    expect([o.cupo_asistente, o.ocupadas, o.libres_asistente, o.libres, o.motivo_asistente]).toEqual([2, 4, 0, 2, 'agotada'])
    expect(await codigo(apartarAsistente(e.funcion, 1))).toBe('sin_cupo')
    expect((await apartarEquipo(e.funcion, 2)).estado).toBe('apartada')
  })

  it('confirmar un vencido revisa contra el límite de SU origen', async () => {
    const e = await escenario({ capacidad: 6, cupoAsistente: 3 })
    const a = await apartarAsistente(e.funcion, 3)
    await vencer(a.reserva_id)
    await apartarEquipo(e.funcion, 1)
    // Ocupadas 1 + 3 = 4 cabe en la capacidad (6) pero no en el cupo del asistente (3).
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'verificado_manual') as r`, [a.reserva_id]))).toBe('sin_cupo')
    const b = await apartarEquipo(e.funcion, 4)
    await vencer(b.reserva_id)
    await apartarAsistente(e.funcion, 2)
    // Del equipo: 1 + 2 + 4 = 7 no cabe en 6. Con 1 + 2 + 3 sí cabría; aquí no.
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'verificado_manual') as r`, [b.reserva_id]))).toBe('sin_cupo')
  })
})

describe('precios: una tarifa y la foto del monto', () => {
  it('preventa frente a completa, y el reemplazo de la función frente al de la campaña', async () => {
    const completa = await escenario({ precio: 180_000, preventa: 150_000, abono: 100_000 })
    expect((await ocupacion(completa.funcion)).tarifa).toEqual({
      tarifa: 'completa', precio_persona: 180_000, precio_completo_persona: null, abono_persona: 100_000, permite_pago_total: true,
    })
    const preventa = await escenario({ precio: 180_000, preventa: 150_000, abono: 100_000, esPreventa: true })
    expect((await ocupacion(preventa.funcion)).tarifa).toEqual({
      tarifa: 'preventa', precio_persona: 150_000, precio_completo_persona: 180_000, abono_persona: 100_000, permite_pago_total: true,
    })
    const reemplazo = await escenario({ precio: 180_000, abono: 100_000, reemplazos: { precio: 200_000, abono: 120_000, permiteTotal: false } })
    expect((await ocupacion(reemplazo.funcion)).tarifa).toEqual({
      tarifa: 'completa', precio_persona: 200_000, precio_completo_persona: null, abono_persona: 120_000, permite_pago_total: false,
    })
    // El asistente ve la misma tarifa.
    expect((await consultar(preventa.funcion)).tarifa.precio_completo_persona).toBe(180_000)
  })

  it('el total y el abono los calcula la base', async () => {
    const e = await escenario({ precio: 180_000, abono: 100_000 })
    const t = await apartarAsistente(e.funcion, 3, { modalidad: 'total' })
    expect([t.tarifa, t.precio_unitario, t.monto_total, t.modalidad, t.monto_a_pagar]).toEqual(['completa', 180_000, 540_000, 'total', 540_000])
    const a = await apartarAsistente(e.funcion, 2, { modalidad: 'abono' })
    expect([a.monto_total, a.modalidad, a.monto_a_pagar]).toEqual([360_000, 'abono', 200_000])
    const fila = (await q<{ monto_total: string; monto_a_pagar: string; abono_unitario: number }>(
      `select monto_total, monto_a_pagar, abono_unitario from funcion_reservas where id = $1`, [a.reserva_id]))[0]
    expect([Number(fila.monto_total), Number(fila.monto_a_pagar), fila.abono_unitario]).toEqual([360_000, 200_000, 100_000])
  })

  it('modalidad_no_permitida y sin_precio: no aparta', async () => {
    const sinAbono = await escenario({ abono: null })
    expect(await codigo(apartarAsistente(sinAbono.funcion, 2, { modalidad: 'abono' }))).toBe('modalidad_no_permitida')
    const sinTotal = await escenario({ permiteTotal: false })
    expect(await codigo(apartarEquipo(sinTotal.funcion, 2, { modalidad: 'total' }))).toBe('modalidad_no_permitida')
    expect(await codigo(apartarEquipo(sinTotal.funcion, 2, { modalidad: 'cuotas' }))).toBe('modalidad_no_permitida')
    const sinPrecio = await escenario({ precio: null, abono: null })
    expect(await codigo(apartarAsistente(sinPrecio.funcion, 2))).toBe('sin_precio')
    const preventaSinPrecio = await escenario({ esPreventa: true })
    expect(await codigo(apartarEquipo(preventaSinPrecio.funcion, 2))).toBe('sin_precio')
    for (const f of [sinAbono, sinTotal, sinPrecio, preventaSinPrecio]) expect((await ocupacion(f.funcion)).ocupadas).toBe(0)
  })

  it('la foto no cambia al editar el precio; la misma clave devuelve la misma foto', async () => {
    const e = await escenario({ precio: 180_000, abono: 100_000 })
    const conv = ++conversaciones
    await autorizacion(conv, 'general', 'si')
    const a = await apartarAsistente(e.funcion, 2, { clave: 'foto-1', conv })
    await rpc(
      `select funcion_guardar_campana($1, $2, $3, 'Ratatouille octubre', $4, null, null, 'activa', 30, '{"precio_persona": 210000, "abono_persona": 100000}'::jsonb) as r`,
      [WS, e.campana, e.experiencia, e.codigo],
    )
    expect((await ocupacion(e.funcion)).tarifa.precio_persona).toBe(210_000)
    const fila = (await q<{ precio_unitario: number; monto_total: string }>(`select precio_unitario, monto_total from funcion_reservas where id = $1`, [a.reserva_id]))[0]
    expect([fila.precio_unitario, Number(fila.monto_total)]).toEqual([180_000, 360_000])
    const otra = await apartarAsistente(e.funcion, 2, { clave: 'foto-1', conv })
    expect([otra.repetida, otra.precio_unitario, otra.monto_total]).toEqual([true, 180_000, 360_000])
    expect((await apartarAsistente(e.funcion, 2)).precio_unitario).toBe(210_000)
  })

  it('un monto en los datos se rechaza: el asistente nunca manda montos', async () => {
    const e = await escenario()
    for (const extra of [{ monto_total: 1 }, { monto_a_pagar: 1 }, { precio_unitario: 1 }, { precio: 1 }, { tarifa: 'preventa' }]) {
      expect(await codigo(apartarAsistente(e.funcion, 2, { datos: extra }))).toBe('dato_no_admitido')
    }
  })

  it('el abono no puede pasar el precio que rige', async () => {
    const e = await escenario({ precio: 100_000, abono: 40_000 })
    expect(await codigo(q(`update funcion_funciones set abono_persona = 120000 where id = $1`, [e.funcion]))).toBe('abono_sobre_precio')
    // Una preventa más barata que el abono de la campaña tampoco.
    expect(await codigo(q(`update funcion_funciones set es_preventa = true, precio_preventa_persona = 30000 where id = $1`, [e.funcion]))).toBe('abono_sobre_precio')
    // Ni la campaña puede subir su abono por encima del precio de una función futura.
    expect(await codigo(q(`update funcion_campanas set abono_persona = 150000 where id = $1`, [e.campana]))).toBe('abono_sobre_precio')
  })
})

describe('campañas y disponibilidad para el asistente', () => {
  it('el asistente no ve ni aparta en campaña borrador, pausada, cerrada o sin publicar, ni en función pausada o archivada', async () => {
    const borrador = await escenario({ publicada: false })
    expect((await consultar(borrador.funcion)).estado).toBe('no_disponible')
    expect(await codigo(apartarAsistente(borrador.funcion, 1))).toBe('funcion_no_existe')
    const pausada = await escenario({ campanaEstado: 'pausada' })
    expect((await consultar(pausada.funcion)).estado).toBe('no_disponible')
    expect(await codigo(apartarAsistente(pausada.funcion, 1))).toBe('campana_no_activa')
    const cerrada = await escenario({ campanaEstado: 'cerrada' })
    expect(await codigo(apartarAsistente(cerrada.funcion, 1))).toBe('campana_no_activa')
    const funcionPausada = await escenario({ estado: 'pausada' })
    expect(await codigo(apartarAsistente(funcionPausada.funcion, 1))).toBe('funcion_no_activa')
    const archivada = await escenario()
    await q(`update funcion_funciones set archivada_at = now() where id = $1`, [archivada.funcion])
    expect(await codigo(apartarAsistente(archivada.funcion, 1))).toBe('funcion_no_existe')
    const lista = await rpc<Array<{ funcion_id: string }>>(`select funcion_ver_disponibles($1, null) as r`, [WS], 'servidor')
    for (const f of [borrador, pausada, cerrada, funcionPausada, archivada]) expect(lista.map((x) => x.funcion_id)).not.toContain(f.funcion)
  })

  it('el equipo sí aparta en una campaña pausada o en borrador, y en una función pausada; no en una cerrada', async () => {
    for (const o of [{ campanaEstado: 'pausada' as const }, { publicada: false }, { estado: 'pausada' as const }]) {
      const e = await escenario(o)
      expect((await apartarEquipo(e.funcion, 2)).estado).toBe('apartada')
    }
    const cerrada = await escenario({ campanaEstado: 'cerrada' })
    expect(await codigo(apartarEquipo(cerrada.funcion, 2))).toBe('funcion_cerrada')
  })

  it('publicar sin funciones o sin precio falla; publicar deja la campaña activa y visible', async () => {
    const exp = await rpc<string>(`select funcion_guardar_experiencia($1, null, 'Harry Potter', null, null, null, null) as r`, [WS])
    const guardar = (cod: string, precios: unknown) =>
      rpc<string>(`select funcion_guardar_campana($1, null, $2, 'HP octubre', $3, null, null, 'borrador', 30, $4::jsonb) as r`, [WS, exp, cod, JSON.stringify(precios)])
    const vacia = await guardar('HP-VACIA', { precio_persona: 180000 })
    expect(await codigo(rpc(`select funcion_publicar_agenda($1) as r`, [vacia]))).toBe('campana_sin_funciones')

    const sinPrecio = await guardar('HP-SINPRECIO', {})
    const lote = (camp: string, h: unknown, cupo: number | null = null, precios: unknown = null) =>
      rpc<string[]>(`select funcion_crear_funciones($1, $2, 30, $3, null, $4::jsonb, $5::jsonb) as r`, [WS, camp, cupo, precios ? JSON.stringify(precios) : null, JSON.stringify(h)])
    await lote(sinPrecio, [{ fecha: '2099-10-24', hora: '13:00' }])
    expect(await codigo(rpc(`select funcion_publicar_agenda($1) as r`, [sinPrecio]))).toBe('funcion_sin_precio')

    const ok = await guardar('hp-oct26', { precio_persona: 180000, abono_persona: 100000 })
    const ids = await lote(ok, [{ fecha: '2099-10-24', hora: '13:00' }, { fecha: '2099-10-24', hora: '17:00' }], 24)
    expect((await q<{ codigo: string }>(`select codigo from funcion_campanas where id = $1`, [ok]))[0].codigo).toBe('HP-OCT26')
    expect((await consultar(ids[0])).estado).toBe('no_disponible')
    await rpc(`select funcion_publicar_agenda($1) as r`, [ok])
    const c = await consultar(ids[0], WS, 24)
    expect([c.estado, c.tarifa.precio_persona, c.inicia_texto]).toEqual(['alcanza', 180_000, 'sábado 24 de octubre, 1:00 p. m.'])
    expect((await consultar(ids[0], WS, 25)).estado).toBe('llena_para_asistente')
    const f = (await q<{ capacidad: number; cupo_asistente: number }>(`select capacidad, cupo_asistente from funcion_funciones where id = $1`, [ids[0]]))[0]
    expect(f).toEqual({ capacidad: 30, cupo_asistente: 24 })
    // El código no cambia después de publicar.
    expect(await codigo(rpc(`select funcion_guardar_campana($1, $2, $3, 'HP octubre', 'HP-NOV26', null, null, 'activa', 30, '{"precio_persona": 180000}'::jsonb) as r`, [WS, ok, exp]))).toBe('codigo_publicado')
    expect(await codigo(guardar('HP-OCT26', {}))).toBe('codigo_repetido')
    expect(await codigo(guardar('HP OCT', {}))).toBe('codigo_invalido')
  })

  it('la agenda en lote: pares explícitos, sin duplicados', async () => {
    const e = await escenario()
    const lote = (h: unknown) => rpc<string[]>(`select funcion_crear_funciones($1, $2, 20, null, null, null, $3::jsonb) as r`, [WS, e.campana, JSON.stringify(h)])
    expect(await codigo(lote([{ fecha: '2099-10-24', hora: '13:00' }, { fecha: '2099-10-24', hora: '13:00' }]))).toBe('horario_repetido')
    expect((await q(`select 1 from funcion_funciones where campana_id = $1`, [e.campana])).length).toBe(1)
    expect(await lote([{ fecha: '2099-10-24', hora: '13:00' }, { fecha: '2099-10-25', hora: '13:00' }])).toHaveLength(2)
    expect(await codigo(lote([{ fecha: '2099-10-24', hora: '13:00' }]))).toBe('horario_repetido')
    // Horas sueltas o fechas sin hora: no.
    expect(await codigo(lote([{ fecha: '2099-10-26', horas: ['13:00', '17:00'] }]))).toBe('horario_invalido')
    expect(await codigo(lote([{ fecha: '2099-10-26' }]))).toBe('horario_invalido')
    expect(await codigo(lote([{ fecha: '2099-10-26', hora: '7pm' }]))).toBe('horario_invalido')
    // La hora es de Bogotá.
    const [id] = await lote([{ fecha: '2099-11-01', hora: '19:30' }])
    const r = (await q<{ utc: string }>(`select to_char(inicia_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc from funcion_funciones where id = $1`, [id]))[0]
    expect(r.utc).toBe('2099-11-02 00:30')
  })

  it('la función hereda los precios de la campaña y los reemplazos ganan', async () => {
    const e = await escenario({ precio: 180_000, abono: 100_000 })
    const [hereda] = await rpc<string[]>(`select funcion_crear_funciones($1, $2, 20, null, null, null, '[{"fecha":"2099-12-01","hora":"13:00"}]'::jsonb) as r`, [WS, e.campana])
    const [reemplaza] = await rpc<string[]>(
      `select funcion_crear_funciones($1, $2, 20, null, null, '{"precio_persona": 150000}'::jsonb, '[{"fecha":"2099-12-02","hora":"13:00"}]'::jsonb) as r`, [WS, e.campana])
    expect((await ocupacion(hereda)).tarifa.precio_persona).toBe(180_000)
    expect((await ocupacion(reemplaza)).tarifa.precio_persona).toBe(150_000)
    expect((await ocupacion(reemplaza)).tarifa.abono_persona).toBe(100_000)
  })

  it('la reserva hereda la campaña de la función y guarda la atribución', async () => {
    const e = await escenario()
    const a = await apartarAsistente(e.funcion, 2, { datos: { atribucion_fuente: 'anuncio', atribucion_ref: 'ad-123' } })
    const b = await apartarEquipo(e.funcion, 1)
    const c = await apartarAsistente(e.funcion, 1)
    const filas = await q<{ id: string; campana_id: string; atribucion_fuente: string; atribucion_ref: string | null }>(
      `select id, campana_id, atribucion_fuente, atribucion_ref from funcion_reservas where id in ($1, $2, $3) order by created_at`, [a.reserva_id, b.reserva_id, c.reserva_id])
    expect(filas.map((f) => [f.campana_id, f.atribucion_fuente, f.atribucion_ref])).toEqual([
      [e.campana, 'anuncio', 'ad-123'], [e.campana, 'equipo', null], [e.campana, 'desconocida', null],
    ])
    expect(a.campana_id).toBe(e.campana)
    expect(await codigo(apartarAsistente(e.funcion, 1, { datos: { atribucion_fuente: 'tiktok' } }))).toBe('datos_invalidos')
    expect(await codigo(apartarAsistente(e.funcion, 1, { datos: { campana_id: uuid() } }))).toBe('dato_no_admitido')
  })

  it('eliminar archiva si hay reservas y borra si no', async () => {
    const conReserva = await escenario()
    await apartarEquipo(conReserva.funcion, 1)
    expect(await rpc(`select funcion_eliminar_funcion($1) as r`, [conReserva.funcion])).toBe('archivada')
    expect((await q(`select 1 from funcion_funciones where id = $1 and archivada_at is not null`, [conReserva.funcion])).length).toBe(1)
    expect(await codigo(apartarEquipo(conReserva.funcion, 1))).toBe('funcion_cerrada')
    const sinReserva = await escenario()
    expect(await rpc(`select funcion_eliminar_funcion($1) as r`, [sinReserva.funcion])).toBe('borrada')
    expect((await q(`select 1 from funcion_funciones where id = $1`, [sinReserva.funcion])).length).toBe(0)

    const campConReserva = await escenario()
    await apartarEquipo(campConReserva.funcion, 1)
    expect(await rpc(`select funcion_eliminar_campana($1) as r`, [campConReserva.campana])).toBe('archivada')
    expect((await q(`select 1 from funcion_campanas where id = $1 and archivada_at is not null`, [campConReserva.campana])).length).toBe(1)
    const campSin = await escenario()
    expect(await rpc(`select funcion_eliminar_campana($1) as r`, [campSin.campana])).toBe('borrada')
    expect((await q(`select 1 from funcion_campanas where id = $1`, [campSin.campana])).length).toBe(0)
    const activas = await rpc<{ campanas: Array<{ campana_id: string }> }>(`select funcion_campanas_activas($1) as r`, [WS], 'servidor')
    expect(activas.campanas.map((c) => c.campana_id)).not.toContain(campConReserva.campana)
  })

  it('campanas_activas cuenta solo las activas con agenda publicada, y ver_disponibles filtra por código', async () => {
    const WS3 = '00000000-0000-4000-8000-00000000f003'
    await q(`insert into workspaces (id, slug) values ($1, 'cuenta')`, [WS3])
    const vacio = await rpc<{ total: number }>(`select funcion_campanas_activas($1) as r`, [WS3], 'servidor')
    expect(vacio.total).toBe(0)
    const a = await escenario({ ws: WS3 })
    await escenario({ ws: WS3, publicada: false })
    await escenario({ ws: WS3, campanaEstado: 'pausada' })
    const uno = await rpc<{ total: number; campanas: Array<{ codigo: string; funciones_disponibles: number }> }>(`select funcion_campanas_activas($1) as r`, [WS3], 'servidor')
    expect([uno.total, uno.campanas[0].codigo, uno.campanas[0].funciones_disponibles]).toEqual([1, a.codigo, 1])
    const b = await escenario({ ws: WS3 })
    expect((await rpc<{ total: number }>(`select funcion_campanas_activas($1) as r`, [WS3], 'servidor')).total).toBe(2)
    const deB = await rpc<Array<{ funcion_id: string; campana_codigo: string; tarifa: Tarifa }>>(`select funcion_ver_disponibles($1, $2) as r`, [WS3, b.codigo.toLowerCase()], 'servidor')
    expect(deB.map((x) => x.funcion_id)).toEqual([b.funcion])
    expect(deB[0].tarifa.precio_persona).toBe(100_000)
    const todas = await rpc<Array<{ funcion_id: string }>>(`select funcion_ver_disponibles($1, null) as r`, [WS3], 'servidor')
    expect(todas.map((x) => x.funcion_id).sort()).toEqual([a.funcion, b.funcion].sort())
    expect(await codigo(rpc(`select funcion_campanas_activas($1) as r`, [WS3]))).toMatch(/permission denied/)
    expect(await codigo(rpc(`select funcion_ver_disponibles($1, null) as r`, [WS3]))).toMatch(/permission denied/)
  })
})

describe('sin mesas (alcance del 2026-10-22)', () => {
  it('lo que pide el cliente es texto libre; una mesa o un puesto no entran por ningún lado', async () => {
    const e = await escenario()
    for (const extra of [{ mesa_id: uuid() }, { mesas: [] }, { puesto: 'F1' }, { preferencia_mesa: 'frente' }]) {
      expect(await codigo(apartarAsistente(e.funcion, 2, { datos: extra }))).toBe('dato_no_admitido')
    }
    const a = await apartarAsistente(e.funcion, 6, { datos: { solicitud_cliente: 'vamos 6, queremos estar juntos' } })
    expect((await q<{ s: string }>(`select solicitud_cliente as s from funcion_reservas where id = $1`, [a.reserva_id]))[0].s).toBe('vamos 6, queremos estar juntos')
    const columnas = await q(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name like 'funcion\\_%' and column_name ~ '(montaje|mesa|puesto)'`,
    )
    expect(columnas).toEqual([])
  })
})

describe('datos y permisos', () => {
  it('17. restricciones sin autorización sensible: sin_autorizacion_sensible; borrar la autorización las borra', async () => {
    const e = await escenario()
    const conv = ++conversaciones
    await autorizacion(conv, 'general', 'si')
    const a = await apartarAsistente(e.funcion, 2, { conv })
    const guardar = (consentimiento: string | null) => rpc(`select funcion_guardar_restricciones($1, 'sin gluten', $2) as r`, [a.reserva_id, consentimiento], 'servidor')
    expect(await codigo(guardar(null))).toBe('sin_autorizacion_sensible')
    const general = (await q<{ id: string }>(`select id from chatwoot_consentimientos where conversacion_id = $1`, [conv]))[0].id
    expect(await codigo(guardar(general))).toBe('sin_autorizacion_sensible')
    expect(await codigo(guardar(await autorizacion(conv + 50_000, 'sensible', 'si')))).toBe('sin_autorizacion_sensible')
    expect(await codigo(guardar(await autorizacion(conv, 'sensible', 'no')))).toBe('sin_autorizacion_sensible')
    expect(await codigo(q(`update funcion_reservas set restricciones = 'maní' where id = $1`, [a.reserva_id]))).toMatch(/restricciones_autorizadas/)
    const si = await autorizacion(conv, 'sensible', 'si')
    await guardar(si)
    expect((await q<{ r: string }>(`select restricciones as r from funcion_reservas where id = $1`, [a.reserva_id]))[0].r).toBe('sin gluten')
    await q(`delete from chatwoot_consentimientos where id = $1`, [si])
    expect((await q<{ r: string | null }>(`select restricciones as r from funcion_reservas where id = $1`, [a.reserva_id]))[0].r).toBeNull()
  })

  it('18. apartar sin autorización general: sin_autorizacion; un «no» posterior la retira', async () => {
    const e = await escenario()
    expect(await codigo(apartarAsistente(e.funcion, 1, { conv: ++conversaciones }))).toBe('sin_autorizacion')
    const retirada = ++conversaciones
    await autorizacion(retirada, 'general', 'si')
    await autorizacion(retirada, 'general', 'no')
    expect(await codigo(apartarAsistente(e.funcion, 1, { conv: retirada }))).toBe('sin_autorizacion')
    const ajena = ++conversaciones
    await autorizacion(ajena, 'general', 'si', OTRO_WS)
    expect(await codigo(apartarAsistente(e.funcion, 1, { conv: ajena }))).toBe('sin_autorizacion')
    expect((await ocupacion(e.funcion)).ocupadas).toBe(0)
  })

  it('19. authenticated de otro workspace no ve ni escribe nada; nadie escribe las tablas directo', async () => {
    const e = await escenario()
    const a = await apartarEquipo(e.funcion, 2)
    const visibles = await siendo({ equipo: AJENO }, () => Promise.all(TABLAS.map(async (t) => (await q(`select 1 from ${t}`)).length)))
    expect(visibles).toEqual([0, 0, 0, 0])
    expect(await codigo(rpc(`select funcion_ocupacion($1) as r`, [e.funcion], { equipo: AJENO }))).toBe('funcion_no_existe')
    expect(await codigo(apartarEquipo(e.funcion, 1, { perfil: AJENO }))).toBe('funcion_no_existe')
    expect(await codigo(rpc(`select funcion_cancelar_reserva($1) as r`, [a.reserva_id], { equipo: AJENO }))).toBe('reserva_no_existe')
    expect(await codigo(rpc(`select funcion_publicar_agenda($1) as r`, [e.campana], { equipo: AJENO }))).toBe('campana_no_existe')
    expect(await codigo(rpc(`select funcion_eliminar_funcion($1) as r`, [e.funcion], { equipo: AJENO }))).toBe('funcion_no_existe')
    expect(await codigo(rpc(`select funcion_ocupacion($1) as r`, [e.funcion], { equipo: LECTOR }))).toBe('ok')
    expect(await codigo(rpc(`select funcion_cancelar_reserva($1) as r`, [a.reserva_id], { equipo: LECTOR }))).toBe('sin_permiso')
    for (const quien of [{ equipo: EQUIPO }, 'servidor'] as Quien[]) {
      expect(await codigo(siendo(quien, () => q(`update funcion_reservas set personas = 1 where id = $1`, [a.reserva_id])))).toMatch(/permission denied/)
      expect(await codigo(siendo(quien, () => q(`update funcion_campanas set precio_persona = 1 where id = $1`, [e.campana])))).toMatch(/permission denied/)
      expect(await codigo(siendo(quien, () => q(`delete from funcion_funciones where id = $1`, [e.funcion])))).toMatch(/permission denied/)
    }
    const anon = await q<{ f: string; x: boolean }>(
      `select p.oid::regprocedure::text as f, has_function_privilege('anon', p.oid, 'execute') as x
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'funcion\\_%'`)
    expect(anon.length).toBeGreaterThan(15)
    expect(anon.filter((r) => r.x).map((r) => r.f)).toEqual([])
    for (const f of ['funcion_cancelar_reserva(uuid)', 'funcion_guardar_campana(uuid, uuid, uuid, text, text, date, date, text, integer, jsonb)',
      'funcion_publicar_agenda(uuid)', 'funcion_crear_funciones(uuid, uuid, integer, integer, integer, jsonb, jsonb)',
      'funcion_editar_funcion(uuid, integer, integer, text, timestamptz, jsonb)', 'funcion_eliminar_funcion(uuid)', 'funcion_eliminar_campana(uuid)',
      'funcion_guardar_experiencia(uuid, uuid, text, text, text, integer, text)']) {
      expect((await q<{ x: boolean }>(`select has_function_privilege('service_role', 'public.${f}', 'execute') as x`))[0].x, f).toBe(false)
    }
  })

  it('el asistente ve un estado y la tarifa, nunca un número de cupo', async () => {
    const e = await escenario({ capacidad: 10, cupoAsistente: 4 })
    const c = await consultar(e.funcion, WS, 4)
    expect(Object.keys(c).sort()).toEqual(['alternativas', 'campana_codigo', 'estado', 'funcion_id', 'inicia_at', 'inicia_texto', 'tarifa'])
    expect([c.estado, c.alternativas]).toEqual(['alcanza', []])
    expect(await codigo(consultar(e.funcion, OTRO_WS))).toBe('funcion_no_existe')
    expect(await codigo(consultar(e.funcion, WS, 0))).toBe('personas_invalidas')
    expect(await codigo(rpc(`select funcion_consultar_cupo($1, $2, 1) as r`, [WS, e.funcion]))).toMatch(/permission denied/)
  })

  it('el cliente queda en contactos: se crea por teléfono la primera vez y se reusa después', async () => {
    const e = await escenario()
    const a = await apartarAsistente(e.funcion, 1, { datos: { canal: 'whatsapp', telefono: '+57 300 111 2233', nombre: 'Ana' } })
    const b = await apartarAsistente(e.funcion, 1, { datos: { canal: 'whatsapp', telefono: '573001112233', nombre: 'Ana P.' } })
    const filas = await q<{ contacto_id: string }>(`select contacto_id from funcion_reservas where id in ($1, $2)`, [a.reserva_id, b.reserva_id])
    expect(filas[0].contacto_id).toBeTruthy()
    expect(filas[0].contacto_id).toBe(filas[1].contacto_id)
  })

  it('la llave de módulo `funciones` queda en las listas de la base', async () => {
    await q(`insert into workspace_modulos (workspace_id, modulo) values ($1, 'funciones')`, [WS])
    await q(`insert into catalogo_servicios (modulo) values ('funciones')`)
    await q(`insert into documentos_contractuales_versiones (modulo) values ('funciones')`)
    expect(await codigo(q(`insert into workspace_modulos (workspace_id, modulo) values ($1, 'sabor')`, [WS]))).toMatch(/workspace_modulos_modulo/)
  })
})

describe('pagos: uno o varios apartados en un solo link (P13)', () => {
  interface Pago { pago_id: string; monto_esperado: number; vence_at: string; reservas: string[] }
  interface Registro { pago_id: string; estado: string; repetida: boolean; confirmadas: string[]; pendientes: string[] }
  let refs = 0
  const preparar = (ids: string[], quien: Quien = 'servidor') => rpc<Pago>(`select funcion_preparar_pago($1, $2::uuid[]) as r`, [WS, ids], quien)
  const vincular = (pago: string, ref = `LNK_${++refs}`) =>
    rpc(`select funcion_vincular_link($1, $2, 'https://checkout.ejemplo/x') as r`, [pago, ref], 'servidor').then(() => ref)
  const registrar = (ref: string, estado: string, monto: number | null) =>
    rpc<Registro>(`select funcion_registrar_pago($1, $2, $3, $4) as r`, [WS, ref, estado, monto], 'servidor')
  const resolver = (reserva: string, accion: string, quien: Quien = { equipo: EQUIPO }) =>
    rpc<{ estado: string; sobreventa?: boolean; devolucion_monto?: number }>(`select funcion_resolver_pendiente($1, $2) as r`, [reserva, accion], quien)
  const fila = async (id: string) =>
    (await q<{ estado: string; pago_estado: string; vence_at: string; sobreventa: boolean; resuelta_por: string | null; devolucion_monto: string | null }>(
      `select estado, pago_estado, vence_at, sobreventa, resuelta_por, devolucion_monto from funcion_reservas where id = $1`, [id]))[0]
  const pagoEstado = async (id: string) => (await q<{ estado: string }>(`select estado from funcion_pagos where id = $1`, [id]))[0].estado

  /** Dos funciones apartadas por el asistente en la MISMA conversación. */
  async function dosApartados(o: { capacidad2?: number } = {}) {
    const e1 = await escenario({ precio: 180_000, abono: 100_000 })
    const e2 = await escenario({ precio: 150_000, abono: 100_000, capacidad: o.capacidad2 ?? 10 })
    const conv = ++conversaciones
    await autorizacion(conv, 'general', 'si')
    const a1 = await apartarAsistente(e1.funcion, 2, { conv, modalidad: 'abono' })
    const a2 = await apartarAsistente(e2.funcion, 2, { conv, modalidad: 'total' })
    return { e1, e2, a1, a2, conv }
  }

  it('el resumen lo calcula la base: cada reserva con su monto y el total sin las vencidas', async () => {
    const { a1, a2 } = await dosApartados()
    const r = await rpc<{ reservas: Array<{ monto_a_pagar: number; vigente: boolean }>; total: number; vencidas: string[] }>(
      `select funcion_resumen_pago($1, $2::uuid[]) as r`, [WS, [a1.reserva_id, a2.reserva_id]], 'servidor')
    expect([r.total, r.reservas.length, r.vencidas]).toEqual([200_000 + 300_000, 2, []])
    await vencer(a2.reserva_id)
    const v = await rpc<{ total: number; vencidas: string[] }>(`select funcion_resumen_pago($1, $2::uuid[]) as r`, [WS, [a1.reserva_id, a2.reserva_id]], 'servidor')
    expect([v.total, v.vencidas]).toEqual([200_000, [a2.reserva_id]])
    // Reservas de otra conversación no se juntan.
    const otra = await apartarAsistente((await escenario()).funcion, 1)
    expect(await codigo(rpc(`select funcion_resumen_pago($1, $2::uuid[]) as r`, [WS, [a1.reserva_id, otra.reserva_id]], 'servidor'))).toBe('distinta_conversacion')
  })

  it('aprobado con el monto esperado confirma todas, en una transacción; el aviso repetido no confirma dos veces', async () => {
    const { e1, e2, a1, a2 } = await dosApartados()
    const p = await preparar([a1.reserva_id, a2.reserva_id])
    expect(p.monto_esperado).toBe(500_000)
    const ref = await vincular(p.pago_id)
    const r = await registrar(ref, 'aprobado', 500_000)
    expect([r.estado, r.repetida, [...r.confirmadas].sort(), r.pendientes]).toEqual(['aprobado', false, [a1.reserva_id, a2.reserva_id].sort(), []])
    for (const id of [a1.reserva_id, a2.reserva_id]) expect((await fila(id))).toMatchObject({ estado: 'confirmada', pago_estado: 'aprobado' })
    const otra = await registrar(ref, 'aprobado', 500_000)
    expect([otra.repetida, otra.estado]).toEqual([true, 'aprobado'])
    expect([(await ocupacion(e1.funcion)).ocupadas, (await ocupacion(e2.funcion)).ocupadas]).toEqual([2, 2])
    // Un fallido tardío sobre un pago ya aprobado tampoco cambia nada.
    expect((await registrar(ref, 'fallido', null)).repetida).toBe(true)
    expect((await fila(a1.reserva_id)).estado).toBe('confirmada')
  })

  it('fallido o vencido no confirma ninguna; las reservas siguen apartadas hasta su vencimiento', async () => {
    for (const estado of ['fallido', 'vencido']) {
      const { a1, a2 } = await dosApartados()
      const p = await preparar([a1.reserva_id, a2.reserva_id])
      const r = await registrar(await vincular(p.pago_id), estado, null)
      expect([r.estado, r.confirmadas]).toEqual([estado, []])
      for (const id of [a1.reserva_id, a2.reserva_id]) expect((await fila(id)).estado).toBe('apartada')
      expect(await pagoEstado(p.pago_id)).toBe(estado)
    }
  })

  it('un monto distinto deja el pago en revisar y no confirma nada', async () => {
    const { a1, a2 } = await dosApartados()
    const p = await preparar([a1.reserva_id, a2.reserva_id])
    const r = await registrar(await vincular(p.pago_id), 'aprobado', 200_000)
    expect([r.estado, r.confirmadas]).toEqual(['revisar', []])
    expect((await fila(a1.reserva_id)).estado).toBe('apartada')
  })

  it('no se prepara un pago con una reserva vencida o que ya está en otro pago pendiente', async () => {
    const { a1, a2 } = await dosApartados()
    await vencer(a2.reserva_id)
    const e = await codigo(preparar([a1.reserva_id, a2.reserva_id]))
    expect(e).toBe('apartado_vencido')
    const detalle = await siendo('servidor', async () => {
      try { await q(`select funcion_preparar_pago($1, $2::uuid[])`, [WS, [a1.reserva_id, a2.reserva_id]]) } catch (x) { return (x as { detail?: string }).detail }
    })
    expect(detalle).toBe(a2.reserva_id)
    const b = await dosApartados()
    await preparar([b.a1.reserva_id])
    expect(await codigo(preparar([b.a1.reserva_id, b.a2.reserva_id]))).toBe('reserva_en_otro_pago')
    expect(await codigo(rpc(`select funcion_preparar_pago($1, $2::uuid[]) as r`, [WS, [b.a2.reserva_id]], { equipo: AJENO }))).toBe('reserva_no_existe')
  })

  it('la realineación iguala los vencimientos (de reservas y pago) y no se repite', async () => {
    const { a1, a2 } = await dosApartados()
    await q(`update funcion_reservas set vence_at = now() + interval '3 minutes' where id = $1`, [a1.reserva_id])
    const p = await preparar([a1.reserva_id, a2.reserva_id])
    const v1 = (await fila(a1.reserva_id)).vence_at
    const v2 = (await fila(a2.reserva_id)).vence_at
    const vp = (await q<{ v: string }>(`select vence_at as v from funcion_pagos where id = $1`, [p.pago_id]))[0].v
    expect(new Date(v1).getTime()).toBe(new Date(v2).getTime())
    expect(new Date(v1).getTime()).toBe(new Date(vp).getTime())
    expect(new Date(v1).getTime() - Date.now()).toBeGreaterThan(25 * 60_000)
    // El link venció: no se genera otro sobre las mismas reservas.
    await registrar(await vincular(p.pago_id), 'vencido', null)
    expect(await codigo(preparar([a1.reserva_id, a2.reserva_id]))).toBe('ya_realineada')
  })

  it('aprobado con una función sin cupo: confirma las otras y deja esa en pendiente_persona, sin pasar la capacidad', async () => {
    const { e2, a1, a2 } = await dosApartados({ capacidad2: 2 })
    const p = await preparar([a1.reserva_id, a2.reserva_id])
    const ref = await vincular(p.pago_id)
    // El apartado de la segunda vence y otra persona toma el cupo antes de que llegue el aviso.
    await vencer(a2.reserva_id)
    await apartarEquipo(e2.funcion, 2)
    const r = await registrar(ref, 'aprobado', 500_000)
    expect([r.confirmadas, r.pendientes]).toEqual([[a1.reserva_id], [a2.reserva_id]])
    expect((await fila(a2.reserva_id))).toMatchObject({ estado: 'pendiente_persona', pago_estado: 'aprobado' })
    const o = await ocupacion(e2.funcion)
    expect([o.ocupadas, o.capacidad]).toEqual([2, 2])
  })

  /** Una reserva en `pendiente_persona` de `personas` sobre una función llena (el mismo flujo de arriba). */
  async function pendiente(o: { tope?: number | null; capacidad?: number; personas?: number } = {}) {
    const capacidad = o.capacidad ?? 2
    const e = await escenario({ capacidad })
    if (o.tope !== undefined) await q(`update funcion_campanas set tope_sobreventa = $2 where id = $1`, [e.campana, o.tope])
    const a = await apartarAsistente(e.funcion, o.personas ?? 2)
    const p = await preparar([a.reserva_id])
    const ref = await vincular(p.pago_id)
    await vencer(a.reserva_id)
    await apartarEquipo(e.funcion, capacidad)
    await registrar(ref, 'aprobado', p.monto_esperado)
    expect((await fila(a.reserva_id)).estado).toBe('pendiente_persona')
    return { e, a }
  }

  it('pendiente_persona no ocupa cupo, y la llave del asistente no la resuelve', async () => {
    const { e, a } = await pendiente({ tope: 6 })
    expect((await ocupacion(e.funcion)).ocupadas).toBe(2)
    expect(await codigo(resolver(a.reserva_id, 'sobrevender', 'servidor'))).toMatch(/permission denied/)
    expect(await codigo(resolver(a.reserva_id, 'sobrevender', { equipo: LECTOR }))).toBe('sin_permiso')
    expect((await q<{ x: boolean }>(`select has_function_privilege('service_role', 'public.funcion_resolver_pendiente(uuid, text)', 'execute') as x`))[0].x).toBe(false)
  })

  it('sobrevender hasta el tope pasa; uno más da sobre_tope; lo libre del asistente nunca es negativo', async () => {
    const { e, a } = await pendiente({ tope: 4 })
    const r = await resolver(a.reserva_id, 'sobrevender')
    expect([r.estado, r.sobreventa]).toEqual(['confirmada', true])
    expect((await fila(a.reserva_id))).toMatchObject({ estado: 'confirmada', sobreventa: true, resuelta_por: EQUIPO })
    const o = await ocupacion(e.funcion)
    expect([o.ocupadas, o.capacidad, o.libres, o.libres_asistente, o.tope_sobreventa]).toEqual([4, 2, 0, 0, 4])
    // Otra pendiente de 1 en la misma función: 4 + 1 pasa el tope.
    const b = await apartarEquipo(e.funcion, 1).catch(() => null)
    expect(b).toBeNull()
    const otra = await apartarAsistente((await escenario()).funcion, 1)
    await q(`update funcion_reservas set funcion_id = $2, campana_id = $3, estado = 'pendiente_persona', pago_estado = 'aprobado' where id = $1`, [otra.reserva_id, e.funcion, e.campana])
    expect(await codigo(resolver(otra.reserva_id, 'sobrevender'))).toBe('sobre_tope')
    // Ningún camino automático pasa de la capacidad: el equipo tampoco aparta por encima.
    expect(await codigo(apartarEquipo(e.funcion, 1))).toBe('sin_cupo')
  })

  it('sin tope no se sobrevende; el tope no baja de la capacidad', async () => {
    const { e, a } = await pendiente({ tope: null })
    expect(await codigo(resolver(a.reserva_id, 'sobrevender'))).toBe('sin_sobreventa')
    expect(await codigo(q(`update funcion_campanas set tope_sobreventa = 1 where id = $1`, [e.campana]))).toBe('tope_bajo_capacidad')
    expect(await codigo(q(`update funcion_funciones set tope_sobreventa = 1 where id = $1`, [e.funcion]))).toMatch(/tope_sobre_capacidad/)
  })

  it('devolver deja requiere_devolucion con el monto y quién; no ocupa cupo', async () => {
    const { e, a } = await pendiente({ tope: 6 })
    const r = await resolver(a.reserva_id, 'devolver')
    expect([r.estado, Number(r.devolucion_monto)]).toEqual(['requiere_devolucion', 200_000])
    expect((await fila(a.reserva_id))).toMatchObject({ estado: 'requiere_devolucion', resuelta_por: EQUIPO })
    expect((await ocupacion(e.funcion)).ocupadas).toBe(2)
    expect(await codigo(resolver(a.reserva_id, 'sobrevender'))).toBe('reserva_no_pendiente')
  })

  it('solo el servidor registra pagos y vincula links', async () => {
    const { a1 } = await dosApartados()
    const p = await preparar([a1.reserva_id])
    expect(await codigo(rpc(`select funcion_vincular_link($1, 'X', null) as r`, [p.pago_id]))).toMatch(/permission denied/)
    const ref = await vincular(p.pago_id)
    expect(await codigo(rpc(`select funcion_registrar_pago($1, $2, 'aprobado', 1) as r`, [WS, ref]))).toMatch(/permission denied/)
    // La misma referencia en otro pago: no.
    const b = await dosApartados()
    const p2 = await preparar([b.a1.reserva_id])
    expect(await codigo(vincular(p2.pago_id, ref))).toMatch(/funcion_pagos_referencia_unica/)
  })
})

describe('nunca dejar ir a un cliente: estado y alternativas para el asistente', () => {
  const WS4 = '00000000-0000-4000-8000-00000000f004'
  const EQUIPO4 = '00000000-0000-4000-8000-00000000f014'
  beforeAll(async () => {
    await q(`insert into workspaces (id, slug) values ($1, 'alternativas')`, [WS4])
    await q(`insert into profiles values ($1, $2, 'operator')`, [EQUIPO4, WS4])
  })

  /** Una función más en una campaña existente, a `horas` de ahora. */
  async function otra(campana: string, horas: number, o: { capacidad?: number; cupo?: number; estado?: string; archivada?: boolean } = {}) {
    const id = uuid()
    await q(
      `insert into funcion_funciones (id, workspace_id, campana_id, inicia_at, capacidad, cupo_asistente, estado, archivada_at)
       values ($1, $2, $3, now() + $4::numeric * interval '1 hour', $5, $6, $7, $8)`,
      [id, WS4, campana, horas, o.capacidad ?? 10, o.cupo ?? o.capacidad ?? 10, o.estado ?? 'activa', o.archivada ? new Date().toISOString() : null],
    )
    return id
  }

  it('función llena para el asistente: alternativas de la misma campaña por cercanía, y estados según las personas', async () => {
    const e = await escenario({ ws: WS4, capacidad: 4, cupoAsistente: 2 })
    // La pedida es mañana (+24 h). Candidatas de la misma campaña:
    const cerca = await otra(e.campana, 26)
    const antes = await otra(e.campana, 21)
    const lejos = await otra(e.campana, 72)
    await otra(e.campana, 25, { estado: 'pausada' })
    await otra(e.campana, 24.5, { archivada: true })
    await otra(e.campana, 25.5, { capacidad: 1 })
    // Otra experiencia, publicada; y una sin publicar.
    const x = await escenario({ ws: WS4 })
    await escenario({ ws: WS4, publicada: false })
    await apartarEquipo(e.funcion, 2, { ws: WS4, perfil: EQUIPO4 })

    const c = await consultar(e.funcion, WS4, 2)
    expect(c.estado).toBe('llena_para_asistente')
    expect(c.alternativas.map((a) => [a.funcion_id, a.grupo, a.alcanza])).toEqual([
      [cerca, 'misma_campana', true], [antes, 'misma_campana', true], [lejos, 'misma_campana', true],
    ])
    expect(c.alternativas[0].inicia_texto).toMatch(/^[a-záéíóú]+ \d{1,2} de [a-z]+, \d{1,2}:\d{2} [ap]\. m\.$/)
    // Con 3 personas ya no cabe ni en la capacidad.
    expect((await consultar(e.funcion, WS4, 3)).estado).toBe('llena')
    // Si la misma campaña no alcanza a 3, se completan con otras experiencias, por fecha.
    await q(`update funcion_funciones set estado = 'pausada' where id = $1`, [lejos])
    const d = await consultar(e.funcion, WS4, 2)
    expect(d.alternativas.map((a) => [a.funcion_id, a.grupo])).toEqual([[cerca, 'misma_campana'], [antes, 'misma_campana'], [x.funcion, 'otra_experiencia']])
  })

  it('el tope es 3 en total y las otras experiencias van por fecha', async () => {
    const e = await escenario({ ws: WS4, capacidad: 2, cupoAsistente: 1 })
    await apartarEquipo(e.funcion, 1, { ws: WS4, perfil: EQUIPO4 })
    const c = await consultar(e.funcion, WS4, 1)
    expect(c.alternativas.length).toBeLessThanOrEqual(3)
    const otras = c.alternativas.filter((a) => a.grupo === 'otra_experiencia')
    const fechas = otras.map((a) => Date.parse(a.inicia_at))
    expect([...fechas].sort((a, b) => a - b)).toEqual(fechas)
    expect(c.alternativas.map((a) => a.funcion_id)).not.toContain(e.funcion)
  })

  it('alcanza no trae alternativas; no disponible sí, y pausadas, archivadas o sin publicar nunca aparecen', async () => {
    const e = await escenario({ ws: WS4, capacidad: 10 })
    expect(await consultar(e.funcion, WS4, 2)).toMatchObject({ estado: 'alcanza', alternativas: [] })
    const pausada = await escenario({ ws: WS4, estado: 'pausada' })
    const p = await consultar(pausada.funcion, WS4, 2)
    expect(p.estado).toBe('no_disponible')
    expect(p.alternativas.length).toBeGreaterThan(0)
    const malas = (await q<{ id: string }>(
      `select f.id from funcion_funciones f join funcion_campanas c on c.id = f.campana_id
        where f.workspace_id = $1 and (f.estado <> 'activa' or f.archivada_at is not null or c.agenda_publicada_at is null or c.estado <> 'activa')`, [WS4])).map((r) => r.id)
    expect(p.alternativas.map((a) => a.funcion_id).filter((id) => malas.includes(id))).toEqual([])
    const ventaCerrada = await escenario({ ws: WS4, cierraVentaAt: new Date(Date.now() - 60_000).toISOString() })
    expect((await consultar(ventaCerrada.funcion, WS4, 1)).estado).toBe('no_disponible')
  })

  it('apartar sin cupo devuelve el mismo estado y las mismas alternativas, sin números', async () => {
    const e = await escenario({ ws: WS4, capacidad: 3, cupoAsistente: 2 })
    await otra(e.campana, 30)
    await apartarAsistente(e.funcion, 2, { ws: WS4 })
    const detalle = await (async () => {
      const conv = ++conversaciones
      await autorizacion(conv, 'general', 'si', WS4)
      return siendo('servidor', async () => {
        try {
          await q(`select funcion_apartar($1, $2, 1, 'total', $3::jsonb, $4, 'asistente')`,
            [WS4, e.funcion, JSON.stringify({ canal: 'instagram', chatwoot_cuenta_id: 1, chatwoot_conversacion_id: conv }), `x-${uuid()}`])
          return null
        } catch (x) {
          return { mensaje: (x as Error).message, detalle: JSON.parse((x as { detail: string }).detail) }
        }
      })
    })()
    const consulta = await consultar(e.funcion, WS4, 1)
    expect(detalle?.mensaje).toBe('sin_cupo')
    expect(detalle?.detalle).toEqual({ estado: consulta.estado, alternativas: consulta.alternativas })
    expect(consulta.estado).toBe('llena_para_asistente')
    expect(JSON.stringify(detalle?.detalle)).not.toMatch(/cupo_libre|libres|ocupadas|capacidad|cupo_asistente|puestos/)
  })

  it('ninguna lectura del asistente trae un número de cupo', async () => {
    const e = await escenario({ ws: WS4, capacidad: 4, cupoAsistente: 2 })
    await apartarEquipo(e.funcion, 2, { ws: WS4, perfil: EQUIPO4 })
    const salidas = [
      await consultar(e.funcion, WS4, 1),
      await rpc(`select funcion_ver_disponibles($1, null) as r`, [WS4], 'servidor'),
      await rpc(`select funcion_campanas_activas($1) as r`, [WS4], 'servidor'),
    ]
    const claves: string[] = []
    const recorrer = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(recorrer)
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { claves.push(k); recorrer(x) }
    }
    salidas.forEach(recorrer)
    expect(claves.filter((k) => /cupo|libre|ocupad|capacidad|puesto/.test(k))).toEqual([])
  })
})

describe('el panel: estado efectivo, anuncios, duplicar y cambios de estado', () => {
  const panel = () => rpc<Array<{ campana_id: string; estado: string; funciones: number; llenas: number; llenas_asistente: number }>>(`select funcion_panel_campanas($1) as r`, [WS])

  it('P6: la campaña se cierra sola cuando pasa su última función (al leer, sin cron)', async () => {
    const e = await escenario()
    expect((await panel()).find((c) => c.campana_id === e.campana)?.estado).toBe('activa')
    await q(`update funcion_funciones set inicia_at = now() - interval '1 hour' where id = $1`, [e.funcion])
    expect((await panel()).find((c) => c.campana_id === e.campana)?.estado).toBe('cerrada')
    expect((await q<{ estado: string }>(`select estado from funcion_campanas where id = $1`, [e.campana]))[0].estado).toBe('activa')
    const activas = await rpc<{ campanas: Array<{ campana_id: string }> }>(`select funcion_campanas_activas($1) as r`, [WS], 'servidor')
    expect(activas.campanas.map((c) => c.campana_id)).not.toContain(e.campana)
  })

  it('agotada cuando todas sus funciones futuras están llenas; el detalle pone las llenas al final', async () => {
    const e = await escenario({ capacidad: 2 })
    await apartarEquipo(e.funcion, 2)
    expect((await panel()).find((c) => c.campana_id === e.campana)).toMatchObject({ estado: 'agotada', llenas: 1 })
    const [libre] = await rpc<string[]>(`select funcion_crear_funciones($1, $2, 5, null, null, null, '[{"fecha":"2099-01-10","hora":"13:00"}]'::jsonb) as r`, [WS, e.campana])
    const d = await rpc<{ estado: string; funciones: Array<{ funcion_id: string; ocupadas: number; reservas_activas: number }> }>(`select funcion_panel_campana($1) as r`, [e.campana])
    expect(d.estado).toBe('activa')
    expect(d.funciones.map((f) => f.funcion_id)).toEqual([libre, e.funcion])
    expect(d.funciones[1]).toMatchObject({ ocupadas: 2, reservas_activas: 1 })
    expect(await codigo(rpc(`select funcion_panel_campana($1) as r`, [e.campana], { equipo: AJENO }))).toBe('campana_no_existe')
  })

  it('P10: anuncios por campaña, y el asistente encuentra la campaña por anuncio o por código', async () => {
    const e = await escenario()
    const b = await escenario()
    await rpc(`select funcion_guardar_anuncio($1, '120208765432100001', false) as r`, [e.campana])
    await rpc(`select funcion_guardar_anuncio($1, '120208765432100001', false) as r`, [e.campana])
    expect(await codigo(rpc(`select funcion_guardar_anuncio($1, '120208765432100001', false) as r`, [b.campana]))).toBe('anuncio_de_otra_campana')
    expect(await codigo(rpc(`select funcion_guardar_anuncio($1, 'con espacio', false) as r`, [e.campana]))).toBe('anuncio_invalido')
    const porAnuncio = await rpc<{ campana_id: string; activa: boolean } | null>(`select funcion_campana_por_anuncio($1, '120208765432100001') as r`, [WS], 'servidor')
    expect(porAnuncio).toMatchObject({ campana_id: e.campana, activa: true })
    const porCodigo = await rpc<{ campana_id: string } | null>(`select funcion_campana_por_codigo($1, $2) as r`, [WS, e.codigo.toLowerCase()], 'servidor')
    expect(porCodigo?.campana_id).toBe(e.campana)
    const borrador = await escenario({ publicada: false })
    expect(await rpc(`select funcion_campana_por_codigo($1, $2) as r`, [WS, borrador.codigo], 'servidor')).toBeNull()
    await rpc(`select funcion_guardar_anuncio($1, '120208765432100001', true) as r`, [e.campana])
    expect(await rpc(`select funcion_campana_por_anuncio($1, '120208765432100001') as r`, [WS], 'servidor')).toBeNull()
    expect(await codigo(rpc(`select funcion_guardar_anuncio($1, 'x1', false) as r`, [e.campana], 'servidor'))).toMatch(/permission denied/)
    expect(await codigo(rpc(`select funcion_campana_por_anuncio($1, 'x1') as r`, [WS]))).toMatch(/permission denied/)
  })

  it('duplicar copia experiencia, precios y reglas, con código libre y la agenda vacía', async () => {
    const e = await escenario({ precio: 180_000, abono: 100_000 })
    const id = await rpc<string>(`select funcion_duplicar_campana($1) as r`, [e.campana])
    const c = (await q<{ codigo: string; estado: string; precio_persona: number; abono_persona: number; experiencia_id: string }>(
      `select codigo, estado, precio_persona, abono_persona, experiencia_id from funcion_campanas where id = $1`, [id]))[0]
    expect(c).toEqual({ codigo: `${e.codigo}-2`, estado: 'borrador', precio_persona: 180_000, abono_persona: 100_000, experiencia_id: e.experiencia })
    expect((await q(`select 1 from funcion_funciones where campana_id = $1`, [id])).length).toBe(0)
    const otraCopia = await rpc<string>(`select funcion_duplicar_campana($1) as r`, [e.campana])
    expect((await q<{ codigo: string }>(`select codigo from funcion_campanas where id = $1`, [otraCopia]))[0].codigo).toBe(`${e.codigo}-3`)
  })

  it('pausar, reactivar y cerrar la campaña; pausar o cancelar una función dice cuántas reservas tiene', async () => {
    const e = await escenario()
    await rpc(`select funcion_cambiar_estado_campana($1, 'pausada') as r`, [e.campana])
    expect(await codigo(apartarAsistente(e.funcion, 1))).toBe('campana_no_activa')
    await rpc(`select funcion_cambiar_estado_campana($1, 'activa') as r`, [e.campana])
    expect((await apartarAsistente(e.funcion, 1)).estado).toBe('apartada')
    const borrador = await escenario({ publicada: false })
    expect(await codigo(rpc(`select funcion_cambiar_estado_campana($1, 'activa') as r`, [borrador.campana]))).toBe('campana_no_publicada')
    const r = await rpc<{ estado: string; reservas_activas: number }>(`select funcion_cambiar_estado_funcion($1, 'cancelada') as r`, [e.funcion])
    expect(r).toMatchObject({ estado: 'cancelada', reservas_activas: 1 })
    expect(await codigo(rpc(`select funcion_cambiar_estado_funcion($1, 'activa') as r`, [e.funcion], 'servidor'))).toMatch(/permission denied/)
    expect(await codigo(rpc(`select funcion_cambiar_estado_campana($1, 'cerrada') as r`, [e.campana], { equipo: LECTOR }))).toBe('sin_permiso')
  })
})
