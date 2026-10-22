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
  o: { clave?: string; conv?: number; datos?: Record<string, unknown>; modalidad?: string } = {},
): Promise<Apartado> {
  let conv = o.conv
  if (conv === undefined) {
    conv = ++conversaciones
    await autorizacion(conv, 'general', 'si')
  }
  const datos = { canal: 'instagram', chatwoot_cuenta_id: 1, chatwoot_conversacion_id: conv, nombre: 'Cliente', ...o.datos }
  return siendo('servidor', async () => {
    const r = await q<{ r: Apartado }>(
      `select funcion_apartar($1, $2, $3, $4, $5::jsonb, $6, 'asistente') as r`,
      [WS, funcion, personas, o.modalidad ?? 'total', JSON.stringify(datos), o.clave ?? `clave-${uuid()}`],
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

const consultar = (funcion: string, ws = WS) =>
  rpc<{ disponible: boolean; motivo: string | null; cupo_libre: number; agotada: boolean; tarifa: Tarifa }>(
    `select funcion_consultar_cupo($1, $2) as r`, [ws, funcion], 'servidor')

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
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'aprobado') as r`, [a.reserva_id], 'servidor'))).toBe('sin_cupo')
    await cancelar(b.reserva_id)
    await rpc(`select funcion_confirmar_pago($1, 'aprobado') as r`, [a.reserva_id], 'servidor')
    expect(await estado(a.reserva_id)).toBe('confirmada')
  })

  it('confirmar: el equipo solo verifica a mano y el servidor solo aprueba', async () => {
    const e = await escenario({ capacidad: 4 })
    const a = await apartarEquipo(e.funcion, 2)
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'aprobado') as r`, [a.reserva_id]))).toBe('pago_estado_invalido')
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'verificado_manual') as r`, [a.reserva_id], 'servidor'))).toBe('pago_estado_invalido')
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
    expect((await consultar(e.funcion)).cupo_libre).toBe(2)
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
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'aprobado') as r`, [a.reserva_id], 'servidor'))).toBe('sin_cupo')
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
    expect(await codigo(consultar(borrador.funcion))).toBe('funcion_no_existe')
    expect(await codigo(apartarAsistente(borrador.funcion, 1))).toBe('funcion_no_existe')
    const pausada = await escenario({ campanaEstado: 'pausada' })
    expect((await consultar(pausada.funcion)).motivo).toBe('campana_no_activa')
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
    expect(await codigo(consultar(ids[0]))).toBe('funcion_no_existe')
    await rpc(`select funcion_publicar_agenda($1) as r`, [ok])
    const c = await consultar(ids[0])
    expect([c.disponible, c.cupo_libre, c.tarifa.precio_persona]).toEqual([true, 24, 180_000])
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

  it('el asistente solo ve lo libre del asistente y la tarifa, nunca la capacidad', async () => {
    const e = await escenario({ capacidad: 10, cupoAsistente: 4 })
    const c = await consultar(e.funcion)
    expect(Object.keys(c).sort()).toEqual(['agotada', 'campana_codigo', 'cupo_libre', 'disponible', 'funcion_id', 'inicia_at', 'motivo', 'tarifa'])
    expect(c.cupo_libre).toBe(4)
    expect(await codigo(consultar(e.funcion, OTRO_WS))).toBe('funcion_no_existe')
    expect(await codigo(rpc(`select funcion_consultar_cupo($1, $2) as r`, [WS, e.funcion]))).toMatch(/permission denied/)
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
