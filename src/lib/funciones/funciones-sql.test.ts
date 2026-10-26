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
import { generarMensajeDirecto, generarOferta, type FuncionTextos } from '../../../supabase/functions/_shared/funciones/textos'
import type { TarifaPublica } from '../../../supabase/functions/_shared/funciones/tipos'
import { diaBogota, diasSaldoValido, mensajeDeError, preventaPasaLaFuncion } from './reglas'

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
const TABLAS = ['funcion_experiencias', 'funcion_campanas', 'funcion_funciones', 'funcion_reservas', 'funcion_negocio']

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
  /** Fecha de fin de la preventa, como expresión SQL de fecha (p. ej. `hoy_bogota() - 1`). */
  preventaHasta?: string
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
       es_preventa, preventa_hasta, precio_persona, precio_preventa_persona, abono_persona, permite_pago_total)
     values ($1, $2, $3, now() + interval '1 day', $4, $5, $6, $7, $8, ${o.preventaHasta ?? 'null'}, $9, $10, $11, $12)`,
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
  /** P14b: la foto no lleva modalidad; trae las dos cifras que el cliente elige al pagar. */
  monto_reserva: number | null
  permite_pago_total: boolean
}

let conversaciones = 1000
/** Aparta como el asistente, con una conversación que ya dijo «sí» a la autorización general. */
async function apartarAsistente(
  funcion: string,
  personas: number,
  o: { clave?: string; conv?: number; datos?: Record<string, unknown>; ws?: string } = {},
): Promise<Apartado> {
  let conv = o.conv
  if (conv === undefined) {
    conv = ++conversaciones
    await autorizacion(conv, 'general', 'si', o.ws ?? WS)
  }
  const datos = { canal: 'instagram', chatwoot_cuenta_id: 1, chatwoot_conversacion_id: conv, nombre: 'Cliente', ...o.datos }
  return siendo('servidor', async () => {
    const r = await q<{ r: Apartado }>(
      `select funcion_apartar($1, $2, $3, $4::jsonb, $5, 'asistente') as r`,
      [o.ws ?? WS, funcion, personas, JSON.stringify(datos), o.clave ?? `clave-${uuid()}`],
    )
    return r[0].r
  })
}

/** Aparta como el equipo (origen equipo). */
async function apartarEquipo(funcion: string, personas: number, o: { clave?: string; ws?: string; perfil?: string } = {}): Promise<Apartado> {
  return siendo({ equipo: o.perfil ?? EQUIPO }, async () => {
    const r = await q<{ r: Apartado }>(
      `select funcion_apartar($1, $2, $3, '{"nombre": "Reserva del equipo"}'::jsonb, $4, 'equipo') as r`,
      [o.ws ?? WS, funcion, personas, o.clave ?? `eq-${uuid()}`],
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
  })

  it('5. confirmar un apartado vencido cuyo cupo ya se tomó: sin_cupo; con cupo libre, confirma', async () => {
    const e = await escenario({ capacidad: 4 })
    const a = await apartarAsistente(e.funcion, 4)
    await vencer(a.reserva_id)
    const b = await apartarAsistente(e.funcion, 2)
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'verificado_manual', 'total') as r`, [a.reserva_id]))).toBe('sin_cupo')
    await cancelar(b.reserva_id)
    await rpc(`select funcion_confirmar_pago($1, 'verificado_manual', 'total') as r`, [a.reserva_id])
    expect(await estado(a.reserva_id)).toBe('confirmada')
  })

  it('confirmar a mano: solo el equipo y solo verificado_manual; la pasarela entra por funcion_registrar_pago', async () => {
    const e = await escenario({ capacidad: 4 })
    const a = await apartarEquipo(e.funcion, 2)
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'aprobado', 'total') as r`, [a.reserva_id]))).toBe('pago_estado_invalido')
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'verificado_manual', 'total') as r`, [a.reserva_id], 'servidor'))).toMatch(/permission denied/)
    await rpc(`select funcion_confirmar_pago($1, 'verificado_manual', 'total') as r`, [a.reserva_id])
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
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'verificado_manual', 'total') as r`, [a.reserva_id]))).toBe('sin_cupo')
    const b = await apartarEquipo(e.funcion, 4)
    await vencer(b.reserva_id)
    await apartarAsistente(e.funcion, 2)
    // Del equipo: 1 + 2 + 4 = 7 no cabe en 6. Con 1 + 2 + 3 sí cabría; aquí no.
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'verificado_manual', 'total') as r`, [b.reserva_id]))).toBe('sin_cupo')
  })
})

describe('precios: una tarifa y la foto del monto', () => {
  it('preventa frente a completa, y el reemplazo de la función frente al de la campaña', async () => {
    const completa = await escenario({ precio: 180_000, preventa: 150_000, abono: 100_000 })
    expect((await ocupacion(completa.funcion)).tarifa).toEqual({
      tarifa: 'completa', precio_persona: 180_000, precio_completo_persona: null, preventa_hasta: null, abono_persona: 100_000, permite_pago_total: true,
    })
    const preventa = await escenario({ precio: 180_000, preventa: 150_000, abono: 100_000, esPreventa: true })
    expect((await ocupacion(preventa.funcion)).tarifa).toEqual({
      tarifa: 'preventa', precio_persona: 150_000, precio_completo_persona: 180_000, preventa_hasta: null, abono_persona: 100_000, permite_pago_total: true,
    })
    const reemplazo = await escenario({ precio: 180_000, abono: 100_000, reemplazos: { precio: 200_000, abono: 120_000, permiteTotal: false } })
    expect((await ocupacion(reemplazo.funcion)).tarifa).toEqual({
      tarifa: 'completa', precio_persona: 200_000, precio_completo_persona: null, preventa_hasta: null, abono_persona: 120_000, permite_pago_total: false,
    })
    // El asistente ve la misma tarifa.
    expect((await consultar(preventa.funcion)).tarifa.precio_completo_persona).toBe(180_000)
  })

  it('el total y el abono los calcula la base', async () => {
    const e = await escenario({ precio: 180_000, abono: 100_000 })
    const t = await apartarAsistente(e.funcion, 3)
    expect([t.tarifa, t.precio_unitario, t.monto_total, Number(t.monto_reserva), t.permite_pago_total]).toEqual(['completa', 180_000, 540_000, 300_000, true])
    const a = await apartarAsistente(e.funcion, 2)
    expect([a.monto_total, Number(a.monto_reserva)]).toEqual([360_000, 200_000])
    // P14b: la foto guarda el abono por persona y si se permite el total; la modalidad queda vacía hasta pagar.
    const fila = (await q<{ monto_total: string; monto_a_pagar: string | null; abono_unitario: number; permite_pago_total: boolean; modalidad: string | null; dias_saldo_antes: number }>(
      `select monto_total, monto_a_pagar, abono_unitario, permite_pago_total, modalidad, dias_saldo_antes from funcion_reservas where id = $1`, [a.reserva_id]))[0]
    expect([Number(fila.monto_total), fila.monto_a_pagar, fila.abono_unitario, fila.permite_pago_total, fila.modalidad, fila.dias_saldo_antes])
      .toEqual([360_000, null, 100_000, true, null, 1])
  })

  it('modalidad_no_permitida (sin abono ni pago total) y sin_precio: no aparta', async () => {
    const ninguna = await escenario({ abono: null, permiteTotal: false })
    expect(await codigo(apartarAsistente(ninguna.funcion, 2))).toBe('modalidad_no_permitida')
    expect(await codigo(apartarEquipo(ninguna.funcion, 2))).toBe('modalidad_no_permitida')
    // Con una sola forma de pago sí aparta: la modalidad se revisa al pagar.
    const sinAbono = await escenario({ abono: null })
    expect((await apartarAsistente(sinAbono.funcion, 1)).monto_reserva).toBeNull()
    const sinTotal = await escenario({ permiteTotal: false })
    expect((await apartarEquipo(sinTotal.funcion, 1)).permite_pago_total).toBe(false)
    const sinPrecio = await escenario({ precio: null, abono: null })
    expect(await codigo(apartarAsistente(sinPrecio.funcion, 2))).toBe('sin_precio')
    const preventaSinPrecio = await escenario({ esPreventa: true })
    expect(await codigo(apartarEquipo(preventaSinPrecio.funcion, 2))).toBe('sin_precio')
    for (const f of [ninguna, sinPrecio, preventaSinPrecio]) expect((await ocupacion(f.funcion)).ocupadas).toBe(0)
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
    const exp = await rpc<string>(`select funcion_guardar_experiencia($1, null, '{"nombre": "Harry Potter"}'::jsonb) as r`, [WS])
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
    expect(visibles).toEqual([0, 0, 0, 0, 0])
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
      'funcion_guardar_experiencia(uuid, uuid, jsonb)', 'funcion_guardar_negocio(uuid, jsonb)',
      'funcion_cambiar_preventa(uuid, boolean, date)']) {
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
  const preparar = (ids: string[], quien: Quien = 'servidor', modalidad = 'total') =>
    rpc<Pago>(`select funcion_preparar_pago($1, $2::uuid[], $3) as r`, [WS, ids, modalidad], quien)
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
    const a1 = await apartarAsistente(e1.funcion, 2, { conv })
    const a2 = await apartarAsistente(e2.funcion, 2, { conv })
    return { e1, e2, a1, a2, conv }
  }

  it('el resumen lo calcula la base: las dos cifras (total y solo la reserva) por reserva y la suma, sin las vencidas', async () => {
    const { a1, a2 } = await dosApartados()
    type Resumen = { reservas: Array<{ monto_total: number; monto_reserva: number | null; vigente: boolean }>; total: number; solo_reserva: number | null; modalidades: string[]; vencidas: string[] }
    const resumen = (ids: string[]) => rpc<Resumen>(`select funcion_resumen_pago($1, $2::uuid[]) as r`, [WS, ids], 'servidor')
    const r = await resumen([a1.reserva_id, a2.reserva_id])
    expect([r.total, r.solo_reserva, r.modalidades, r.reservas.length, r.vencidas]).toEqual([360_000 + 300_000, 200_000 + 200_000, ['total', 'abono'], 2, []])
    expect(r.reservas.map((x) => [x.monto_total, x.monto_reserva])).toEqual([[360_000, 200_000], [300_000, 200_000]])
    await vencer(a2.reserva_id)
    const v = await resumen([a1.reserva_id, a2.reserva_id])
    expect([v.total, v.solo_reserva, v.vencidas]).toEqual([360_000, 200_000, [a2.reserva_id]])
    // Reservas de otra conversación no se juntan.
    const otra = await apartarAsistente((await escenario()).funcion, 1)
    expect(await codigo(resumen([a1.reserva_id, otra.reserva_id]))).toBe('distinta_conversacion')
    // Si una no permite el total (o no tiene abono), esa cifra no sirve para el link conjunto: no se pregunta.
    const sinTotal = await escenario({ permiteTotal: false })
    const sinAbono = await escenario({ abono: null })
    const conv = ++conversaciones
    await autorizacion(conv, 'general', 'si')
    const x = await apartarAsistente(sinTotal.funcion, 1, { conv })
    const y = await apartarAsistente(sinAbono.funcion, 1, { conv })
    expect((await resumen([x.reserva_id])).modalidades).toEqual(['abono'])
    const ambas = await resumen([x.reserva_id, y.reserva_id])
    expect([ambas.modalidades, ambas.solo_reserva, ambas.total]).toEqual([[], null, 200_000])
  })

  it('P14b: la modalidad se fija al pagar, la misma para todas las reservas del pago; la que no la permite frena el pago', async () => {
    const { a1, a2 } = await dosApartados()
    const p = await preparar([a1.reserva_id, a2.reserva_id], 'servidor', 'abono')
    expect([p.monto_esperado]).toEqual([400_000])
    const filas = await q<{ modalidad: string; monto_a_pagar: string }>(
      `select modalidad, monto_a_pagar from funcion_reservas where id = any ($1::uuid[]) order by id`, [[a1.reserva_id, a2.reserva_id]])
    expect(filas.map((x) => [x.modalidad, Number(x.monto_a_pagar)])).toEqual([['abono', 200_000], ['abono', 200_000]])
    const montos = await q<{ monto: string }>(`select monto from funcion_pago_reservas where pago_id = $1`, [p.pago_id])
    expect(montos.map((x) => Number(x.monto))).toEqual([200_000, 200_000])
    // Sin abono no se cobra «solo la reserva»; sin pago total no se cobra el total; otra palabra tampoco. Nada cambia.
    const sinAbono = await apartarAsistente((await escenario({ abono: null })).funcion, 1)
    const sinTotal = await apartarAsistente((await escenario({ permiteTotal: false })).funcion, 1)
    expect(await codigo(preparar([sinAbono.reserva_id], 'servidor', 'abono'))).toBe('modalidad_no_permitida')
    expect(await codigo(preparar([sinTotal.reserva_id], 'servidor', 'total'))).toBe('modalidad_no_permitida')
    expect(await codigo(preparar([sinTotal.reserva_id], 'servidor', 'cuotas'))).toBe('modalidad_no_permitida')
    const intacta = (await q<{ modalidad: string | null; realineada_at: string | null }>(
      `select modalidad, realineada_at from funcion_reservas where id = $1`, [sinTotal.reserva_id]))[0]
    expect(intacta).toEqual({ modalidad: null, realineada_at: null })
    expect((await preparar([sinTotal.reserva_id], 'servidor', 'abono')).monto_esperado).toBe(40_000)
  })

  it('aprobado con el monto esperado confirma todas, en una transacción; el aviso repetido no confirma dos veces', async () => {
    const { e1, e2, a1, a2 } = await dosApartados()
    const p = await preparar([a1.reserva_id, a2.reserva_id])
    expect(p.monto_esperado).toBe(660_000)
    const ref = await vincular(p.pago_id)
    const r = await registrar(ref, 'aprobado', 660_000)
    expect([r.estado, r.repetida, [...r.confirmadas].sort(), r.pendientes]).toEqual(['aprobado', false, [a1.reserva_id, a2.reserva_id].sort(), []])
    for (const id of [a1.reserva_id, a2.reserva_id]) expect((await fila(id))).toMatchObject({ estado: 'confirmada', pago_estado: 'aprobado' })
    const otra = await registrar(ref, 'aprobado', 660_000)
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
      try { await q(`select funcion_preparar_pago($1, $2::uuid[], 'total')`, [WS, [a1.reserva_id, a2.reserva_id]]) } catch (x) { return (x as { detail?: string }).detail }
    })
    expect(detalle).toBe(a2.reserva_id)
    const b = await dosApartados()
    await preparar([b.a1.reserva_id])
    expect(await codigo(preparar([b.a1.reserva_id, b.a2.reserva_id]))).toBe('reserva_en_otro_pago')
    expect(await codigo(rpc(`select funcion_preparar_pago($1, $2::uuid[], 'total') as r`, [WS, [b.a2.reserva_id]], { equipo: AJENO }))).toBe('reserva_no_existe')
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
    const r = await registrar(ref, 'aprobado', 660_000)
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
          await q(`select funcion_apartar($1, $2, 1, $3::jsonb, $4, 'asistente')`,
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

describe('la ficha en tres niveles y la preventa por función (P11 y P4)', () => {
  const HOY = `((now() at time zone 'America/Bogota')::date)`
  const FICHA = {
    nombre: '[PRUEBA] El extraño mundo de Jack',
    titulo_oferta: '  🎃💀 EL EXTRAÑO MUNDO DE JACK llega a CENA Y PELÍCULA 🎄🖤\n',
    frase_gancho: '¿Qué pasa cuando Halloween y Navidad se encuentran? 🎃🎁✨',
    intro: 'Primera línea.\n\nSegunda   línea con espacios.',
    que_incluye: ['🍽️ 5 tiempos', '  ', '🥂 2 bebidas'],
    emojis_tema: '🎃🖤',
    saludo_grupo: '🎃💀 ¡Hola!',
    relato_grupo: '💀🎁 ¡Que comience!',
    edad_minima: 6,
  }
  const guardarFicha = (ficha: unknown, id: string | null = null, quien: Quien = { equipo: EQUIPO }) =>
    rpc<string>(`select funcion_guardar_experiencia($1, $2, $3::jsonb) as r`, [WS, id, JSON.stringify(ficha)], quien)

  it('la experiencia guarda su ficha tal cual: emojis y saltos de adentro, sin las puntas; la lista sin líneas vacías', async () => {
    const id = await guardarFicha(FICHA)
    const [e] = await q<Record<string, unknown>>(`select * from funcion_experiencias where id = $1`, [id])
    expect(e.titulo_oferta).toBe('🎃💀 EL EXTRAÑO MUNDO DE JACK llega a CENA Y PELÍCULA 🎄🖤')
    expect(e.intro).toBe('Primera línea.\n\nSegunda   línea con espacios.')
    expect(e.que_incluye).toEqual(['🍽️ 5 tiempos', '🥂 2 bebidas'])
    expect([e.emojis_tema, e.saludo_grupo, e.relato_grupo, e.edad_minima]).toEqual(['🎃🖤', '🎃💀 ¡Hola!', '💀🎁 ¡Que comience!', 6])
    // Reemplaza la ficha entera: lo que no viene queda nulo.
    await guardarFicha({ nombre: 'Otra' }, id)
    const [d] = await q<Record<string, unknown>>(`select nombre, titulo_oferta, que_incluye, edad_minima from funcion_experiencias where id = $1`, [id])
    expect(d).toEqual({ nombre: 'Otra', titulo_oferta: null, que_incluye: null, edad_minima: null })
    expect(Object.keys(e)).not.toContain('info_general')
    expect(Object.keys(e)).not.toContain('historia')
  })

  it('la ficha rechaza llaves de más, tipos malos, el servidor y el rol que no edita', async () => {
    expect(await codigo(guardarFicha({ ...FICHA, condiciones: 'x' }))).toBe('dato_no_admitido')
    expect(await codigo(guardarFicha({ ...FICHA, que_incluye: 'una sola' }))).toBe('datos_invalidos')
    expect(await codigo(guardarFicha({ ...FICHA, que_incluye: Array.from({ length: 21 }, (_, i) => `cosa ${i}`) }))).toBe('datos_invalidos')
    expect(await codigo(guardarFicha({ ...FICHA, nombre: '  ' }))).toBe('datos_invalidos')
    expect(await codigo(guardarFicha({ ...FICHA, edad_minima: '6' }))).toBe('datos_invalidos')
    expect(await codigo(guardarFicha(FICHA, null, { equipo: LECTOR }))).toBe('sin_permiso')
    expect(await codigo(guardarFicha(FICHA, null, 'servidor'))).toMatch(/permission denied/)
  })

  it('el negocio: una fila por workspace, la escribe solo el equipo y la lee solo su workspace', async () => {
    const guardar = (datos: unknown, ws = WS, quien: Quien = { equipo: EQUIPO }) =>
      rpc(`select funcion_guardar_negocio($1, $2::jsonb) as r`, [ws, JSON.stringify(datos)], quien)
    await guardar({ direccion: 'AK 9 #104A-50, Bogotá', piso: 'Segundo piso', firma: 'El equipo 🕯️✨' })
    await guardar({ direccion: 'AK 9 #104A-50, Bogotá', piso: 'Segundo piso', recepcion: 'Los recibimos.', parqueadero: 'Bahía\nen frente', firma: 'El equipo 🕯️✨' })
    const filas = await siendo({ equipo: EQUIPO }, () => q<Record<string, unknown>>(`select direccion, piso, recepcion, parqueadero, firma from funcion_negocio`))
    expect(filas).toEqual([{ direccion: 'AK 9 #104A-50, Bogotá', piso: 'Segundo piso', recepcion: 'Los recibimos.', parqueadero: 'Bahía\nen frente', firma: 'El equipo 🕯️✨' }])
    expect(await siendo({ equipo: AJENO }, () => q(`select 1 from funcion_negocio`))).toEqual([])
    expect(await codigo(guardar({ direccion: 'x' }, WS, { equipo: AJENO }))).toBe('negocio_no_existe')
    expect(await codigo(guardar({ direccion: 'x' }, WS, { equipo: LECTOR }))).toBe('sin_permiso')
    expect(await codigo(guardar({ nequi: '322' }))).toBe('dato_no_admitido')
    expect(await codigo(guardar({ direccion: 'x' }, WS, 'servidor'))).toMatch(/permission denied/)
    expect(await codigo(siendo({ equipo: EQUIPO }, () => q(`update funcion_negocio set piso = 'x'`)))).toMatch(/permission denied/)
  })

  it('P4: con el interruptor encendido, la preventa rige hasta su fecha de fin (hoy inclusive) y después rige el regular', async () => {
    const precios = { precio: 180_000, preventa: 170_000, abono: 100_000, esPreventa: true }
    const hoy = await escenario({ ...precios, preventaHasta: HOY })
    const ayer = await escenario({ ...precios, preventaHasta: `${HOY} - 1` })
    const sinFecha = await escenario(precios)
    const apagada = await escenario({ ...precios, esPreventa: false })
    const t = async (f: string) => (await ocupacion(f)).tarifa
    const [hoyStr] = await q<{ d: string }>(`select to_char(${HOY}, 'YYYY-MM-DD') as d`)
    expect(await t(hoy.funcion)).toEqual({
      tarifa: 'preventa', precio_persona: 170_000, precio_completo_persona: 180_000, preventa_hasta: hoyStr.d, abono_persona: 100_000, permite_pago_total: true,
    })
    expect(await t(ayer.funcion)).toEqual({
      tarifa: 'completa', precio_persona: 180_000, precio_completo_persona: null, preventa_hasta: null, abono_persona: 100_000, permite_pago_total: true,
    })
    expect((await t(sinFecha.funcion)).tarifa).toBe('preventa')
    expect((await t(apagada.funcion)).tarifa).toBe('completa')
    // La foto del apartado sale de la misma regla.
    const a = await apartarAsistente(ayer.funcion, 2)
    expect([a.tarifa, a.precio_unitario]).toEqual(['completa', 180_000])
    const b = await apartarAsistente(hoy.funcion, 2)
    expect([b.tarifa, b.precio_unitario]).toEqual(['preventa', 170_000])
    // El asistente ve lo mismo.
    expect((await consultar(ayer.funcion)).tarifa.tarifa).toBe('completa')
  })

  it('P4: la fecha de fin de la preventa no pasa el día de la función, por ningún camino', async () => {
    const e = await escenario({ precio: 180_000, preventa: 170_000 })
    const preventa = (f: string, on: boolean, hasta: string | null, quien: Quien = { equipo: EQUIPO }) =>
      rpc<{ tarifa: string; preventa_hasta: string | null }>(`select funcion_cambiar_preventa($1, $2, $3::date) as r`, [f, on, hasta], quien)
    const [dia] = await q<{ d: string; despues: string }>(
      `select to_char((inicia_at at time zone 'America/Bogota')::date, 'YYYY-MM-DD') as d,
              to_char((inicia_at at time zone 'America/Bogota')::date + 1, 'YYYY-MM-DD') as despues
         from funcion_funciones where id = $1`, [e.funcion])
    expect(await codigo(preventa(e.funcion, true, dia.despues))).toBe('preventa_despues_de_funcion')
    expect(await preventa(e.funcion, true, dia.d)).toMatchObject({ tarifa: 'preventa', preventa_hasta: dia.d })
    // Apagada, la fecha se borra.
    expect(await preventa(e.funcion, false, dia.d)).toMatchObject({ tarifa: 'completa', preventa_hasta: null })
    expect((await q<{ h: string | null }>(`select preventa_hasta as h from funcion_funciones where id = $1`, [e.funcion]))[0].h).toBeNull()
    expect(await codigo(preventa(e.funcion, true, null, { equipo: LECTOR }))).toBe('sin_permiso')
    expect(await codigo(preventa(e.funcion, true, null, { equipo: AJENO }))).toBe('funcion_no_existe')
    expect(await codigo(preventa(e.funcion, true, null, 'servidor'))).toMatch(/permission denied/)
    // La agenda en lote y la edición tampoco la dejan pasar.
    const lote = (precios: unknown) => rpc(`select funcion_crear_funciones($1, $2, 10, null, null, $3::jsonb, $4::jsonb) as r`,
      [WS, e.campana, JSON.stringify(precios), JSON.stringify([{ fecha: '2099-10-24', hora: '13:00' }, { fecha: '2099-10-31', hora: '13:00' }])])
    expect(await codigo(lote({ es_preventa: true, preventa_hasta: '2099-10-25' }))).toBe('preventa_despues_de_funcion')
    expect(await codigo(lote({ es_preventa: true, preventa_hasta: '2099-02-30' }))).toBe('precio_invalido')
    expect(await codigo(lote({ es_preventa: true, preventa_hasta: '2099-10-20' }))).toBe('ok')
    const [creada] = await q<{ es_preventa: boolean; h: string }>(
      `select es_preventa, to_char(preventa_hasta, 'YYYY-MM-DD') as h from funcion_funciones where campana_id = $1 and inicia_at > now() + interval '1 year' order by inicia_at limit 1`, [e.campana])
    expect(creada).toEqual({ es_preventa: true, h: '2099-10-20' })
    expect(await codigo(rpc(`select funcion_editar_funcion($1, 10, 10, 'activa', null, $2::jsonb) as r`,
      [e.funcion, JSON.stringify({ es_preventa: true, preventa_hasta: dia.despues })]))).toBe('preventa_despues_de_funcion')
    // Y la tabla, al final: el CHECK.
    expect(await codigo(q(`update funcion_funciones set es_preventa = true, preventa_hasta = $2::date where id = $1`, [e.funcion, dia.despues]))).toMatch(/funcion_funciones_preventa_antes/)
  })

  it('con la preventa encendida, el abono tampoco pasa el precio regular que regirá al vencerse', async () => {
    const e = await escenario({ precio: 180_000, preventa: 170_000, abono: 100_000 })
    expect(await codigo(q(`update funcion_funciones set es_preventa = true, precio_persona = 90000 where id = $1`, [e.funcion]))).toBe('abono_sobre_precio')
  })

  it('el panel de la campaña trae la ficha nueva y la preventa de cada función', async () => {
    const e = await escenario({ precio: 180_000, preventa: 170_000, esPreventa: true, preventaHasta: HOY })
    await guardarFicha(FICHA, e.experiencia)
    const d = await rpc<{ experiencia: Record<string, unknown>; funciones: Array<{ es_preventa: boolean; preventa_hasta: string | null; tarifa: { tarifa: string } }> }>(
      `select funcion_panel_campana($1) as r`, [e.campana])
    expect(Object.keys(d.experiencia).sort()).toEqual(
      ['edad_minima', 'emojis_tema', 'experiencia_id', 'frase_gancho', 'intro', 'nombre', 'que_incluye', 'relato_grupo', 'saludo_grupo', 'titulo_oferta'])
    expect(d.experiencia.que_incluye).toEqual(['🍽️ 5 tiempos', '🥂 2 bebidas'])
    expect(d.funciones[0].es_preventa).toBe(true)
    expect(d.funciones[0].preventa_hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(d.funciones[0].tarifa.tarifa).toBe('preventa')
  })
})

describe('el plazo del saldo de la campaña (23-oct): el dato de la campaña', () => {
  const guardar = (exp: string, cod: string, precios: unknown, id: string | null = null) =>
    rpc<string>(`select funcion_guardar_campana($1, $2, $3, 'Jack octubre', $4, null, null, 'borrador', 30, $5::jsonb) as r`,
      [WS, id, exp, cod, JSON.stringify(precios)])
  const dias = async (id: string) => (await q<{ d: number }>(`select dias_saldo_antes as d from funcion_campanas where id = $1`, [id]))[0].d
  const nuevaExperiencia = () => rpc<string>(`select funcion_guardar_experiencia($1, null, '{"nombre": "[PRUEBA] Jack"}'::jsonb) as r`, [WS])

  it('viene lleno con 1, se cambia, sale en los dos paneles y la copia lo conserva', async () => {
    const exp = await nuevaExperiencia()
    const cod = codigo_()
    const id = await guardar(exp, cod, { precio_persona: 180_000 })
    expect(await dias(id)).toBe(1)
    await guardar(exp, cod, { precio_persona: 180_000, dias_saldo_antes: 3 }, id)
    expect(await dias(id)).toBe(3)
    expect((await rpc<{ dias_saldo_antes: number }>(`select funcion_panel_campana($1) as r`, [id])).dias_saldo_antes).toBe(3)
    const lista = await rpc<Array<{ campana_id: string; dias_saldo_antes: number }>>(`select funcion_panel_campanas($1) as r`, [WS])
    expect(lista.find((c) => c.campana_id === id)?.dias_saldo_antes).toBe(3)
    const copia = await rpc<string>(`select funcion_duplicar_campana($1) as r`, [id])
    expect(await dias(copia)).toBe(3)
    // Nulo o ausente = el valor por defecto (1), como los demás datos de la campaña.
    await guardar(exp, cod, { precio_persona: 180_000, dias_saldo_antes: null }, id)
    expect(await dias(id)).toBe(1)
    // Una campaña cargada por SQL sin el dato también queda en 1.
    const e = await escenario()
    expect(await dias(e.campana)).toBe(1)
  })

  it('va de 1 a 30 días, entero: la RPC y la tabla rechazan lo demás, y la pantalla aplica la misma regla', async () => {
    const exp = await nuevaExperiencia()
    for (const malo of [0, -1, 31, 1.5, '2', true]) {
      expect(await codigo(guardar(exp, codigo_(), { precio_persona: 180_000, dias_saldo_antes: malo }))).toBe('dias_saldo_invalido')
      expect(diasSaldoValido(typeof malo === 'number' ? malo : null)).toBe(false)
    }
    for (const bueno of [1, 30]) {
      expect(await codigo(guardar(exp, codigo_(), { precio_persona: 180_000, dias_saldo_antes: bueno }))).toBe('ok')
      expect(diasSaldoValido(bueno)).toBe(true)
    }
    const e = await escenario()
    expect(await codigo(q(`update funcion_campanas set dias_saldo_antes = 0 where id = $1`, [e.campana]))).toMatch(/dias_saldo_antes_check/)
    expect(await codigo(q(`update funcion_campanas set dias_saldo_antes = null where id = $1`, [e.campana]))).toMatch(/null value/)
    expect(mensajeDeError({ message: 'dias_saldo_invalido' })).toBe('Los días antes para pagar el saldo van de 1 a 30.')
  })
})

describe('el saldo: un pago más de la misma reserva (P14a a P14c, 25-oct)', () => {
  interface Pago { pago_id: string; monto_esperado: number; vence_at: string; reservas: string[]; reemplazados?: string[] }
  interface Saldo {
    reserva_id: string; monto_total: number; pagado: number; saldo: number; modalidad: string | null; plazo_at: string
    estado: 'sin_saldo' | 'pendiente' | 'pagado' | 'vencido' | null; link: { pago_id: string; url: string | null; vence_at: string; monto: number } | null
  }
  let refs = 0
  const preparar = (ids: string[], modalidad: string) =>
    rpc<Pago>(`select funcion_preparar_pago($1, $2::uuid[], $3) as r`, [WS, ids, modalidad], 'servidor')
  const prepararSaldo = (ids: string[], quien: Quien = 'servidor') =>
    rpc<Pago>(`select funcion_preparar_pago_saldo($1, $2::uuid[]) as r`, [WS, ids], quien)
  const vincular = (pago: string) => {
    const ref = `SALDO_${++refs}`
    return rpc(`select funcion_vincular_link($1, $2, 'https://checkout.ejemplo/' || $2) as r`, [pago, ref], 'servidor').then(() => ref)
  }
  const registrar = (ref: string, estado: string, monto: number | null) =>
    rpc<{ estado: string; repetida: boolean; concepto: string; confirmadas?: string[] }>(
      `select funcion_registrar_pago($1, $2, $3, $4) as r`, [WS, ref, estado, monto], 'servidor')
  const saldo = (reserva: string, quien: Quien = { equipo: EQUIPO }) => rpc<Saldo>(`select funcion_saldo($1) as r`, [reserva], quien)
  const cobrado = (reserva: string, monto: number, quien: Quien = { equipo: EQUIPO }) =>
    rpc<Saldo & { pago_id: string; links_anulados: string[] }>(`select funcion_registrar_saldo_cobrado($1, $2) as r`, [reserva, monto], quien)
  const pagoEstado = async (id: string) => (await q<{ estado: string }>(`select estado from funcion_pagos where id = $1`, [id]))[0].estado
  const num = (s: Saldo) => [Number(s.monto_total), Number(s.pagado), Number(s.saldo), s.estado]

  /** Una reserva de 2 personas ($100.000 c/u, abono $40.000) confirmada con el pago de la reserva por link: saldo $120.000. */
  async function conAbono(o: OpcionesEscenario = {}) {
    const e = await escenario(o)
    const conv = ++conversaciones
    await autorizacion(conv, 'general', 'si')
    const a = await apartarAsistente(e.funcion, 2, { conv })
    const p = await preparar([a.reserva_id], 'abono')
    await registrar(await vincular(p.pago_id), 'aprobado', p.monto_esperado)
    expect(await estado(a.reserva_id)).toBe('confirmada')
    return { e, a, conv }
  }

  it('pagado más saldo es el total: la reserva pagó $80.000 de $200.000 y su saldo es $120.000, pendiente hasta el plazo', async () => {
    const { a } = await conAbono()
    const s = await saldo(a.reserva_id)
    expect(num(s)).toEqual([200_000, 80_000, 120_000, 'pendiente'])
    expect(s.modalidad).toBe('abono')
    expect(Number(s.pagado) + Number(s.saldo)).toBe(Number(s.monto_total))
    expect(s.link).toBeNull()
    // El asistente lee lo mismo; otro workspace no la ve.
    expect(num(await saldo(a.reserva_id, 'servidor'))).toEqual(num(s))
    expect(await codigo(saldo(a.reserva_id, { equipo: AJENO }))).toBe('reserva_no_existe')
  })

  it('el plazo: fin del día de Bogotá N días antes de la función, también para una función de noche', async () => {
    const plazo = async (inicia: string, dias: number) =>
      new Date((await q<{ p: string }>(`select funcion_plazo_saldo($1::timestamptz, $2) as p`, [inicia, dias]))[0].p).toISOString()
    // Sábado 31 de octubre, 1:00 p. m. y 10:00 p. m. (en UTC ya es domingo): vence al terminar el viernes 30.
    expect(await plazo('2026-10-31T13:00:00-05:00', 1)).toBe('2026-10-31T05:00:00.000Z')
    expect(await plazo('2026-10-31T22:00:00-05:00', 1)).toBe('2026-10-31T05:00:00.000Z')
    expect(await plazo('2026-10-31T13:00:00-05:00', 3)).toBe('2026-10-29T05:00:00.000Z')
  })

  it('un pago de saldo aprobado no cambia la ocupación ni el estado de la reserva; el aviso repetido no suma dos veces', async () => {
    const { e, a } = await conAbono()
    const antes = await ocupacion(e.funcion)
    const p = await prepararSaldo([a.reserva_id])
    expect(Number(p.monto_esperado)).toBe(120_000)
    const ref = await vincular(p.pago_id)
    expect((await saldo(a.reserva_id)).link).toMatchObject({ pago_id: p.pago_id, url: `https://checkout.ejemplo/${ref}` })
    const r = await registrar(ref, 'aprobado', 120_000)
    expect([r.estado, r.concepto, r.confirmadas]).toEqual(['aprobado', 'saldo', []])
    expect(num(await saldo(a.reserva_id))).toEqual([200_000, 200_000, 0, 'pagado'])
    expect((await registrar(ref, 'aprobado', 120_000)).repetida).toBe(true)
    expect(Number((await saldo(a.reserva_id)).pagado)).toBe(200_000)
    const fila = (await q<{ estado: string; pago_estado: string }>(`select estado, pago_estado from funcion_reservas where id = $1`, [a.reserva_id]))[0]
    expect(fila).toEqual({ estado: 'confirmada', pago_estado: 'aprobado' })
    const despues = await ocupacion(e.funcion)
    expect([despues.ocupadas, despues.libres]).toEqual([antes.ocupadas, antes.libres])
  })

  it('el monto distinto deja el pago en revisar y no suma a lo pagado', async () => {
    const { a } = await conAbono()
    const p = await prepararSaldo([a.reserva_id])
    expect((await registrar(await vincular(p.pago_id), 'aprobado', 100_000)).estado).toBe('revisar')
    expect(num(await saldo(a.reserva_id))).toEqual([200_000, 80_000, 120_000, 'pendiente'])
  })

  it('no hay saldo de una reserva que pagó el total, ni de una cancelada, ni de una función que ya empezó', async () => {
    const e = await escenario()
    const t = await apartarAsistente(e.funcion, 2)
    const pt = await preparar([t.reserva_id], 'total')
    await registrar(await vincular(pt.pago_id), 'aprobado', pt.monto_esperado)
    expect(num(await saldo(t.reserva_id))).toEqual([200_000, 200_000, 0, 'sin_saldo'])
    expect(await codigo(prepararSaldo([t.reserva_id]))).toBe('sin_saldo')
    const { a: cancelada } = await conAbono()
    await cancelar(cancelada.reserva_id)
    expect(await codigo(prepararSaldo([cancelada.reserva_id]))).toBe('reserva_inactiva')
    expect((await saldo(cancelada.reserva_id)).estado).toBeNull()
    const { e: e2, a: empezo } = await conAbono()
    await q(`update funcion_funciones set inicia_at = now() - interval '1 minute' where id = $1`, [e2.funcion])
    expect(await codigo(prepararSaldo([empezo.reserva_id], { equipo: EQUIPO }))).toBe('funcion_pasada')
    // Un apartado sin pagar tampoco tiene saldo que cobrar.
    const apartada = await apartarAsistente((await escenario()).funcion, 1)
    expect(await codigo(prepararSaldo([apartada.reserva_id]))).toBe('reserva_inactiva')
    expect((await saldo(apartada.reserva_id)).estado).toBeNull()
  })

  it('un link nuevo deja vencido al anterior; si Bold igual cobra el viejo, queda en revisar', async () => {
    const { a } = await conAbono()
    const p1 = await prepararSaldo([a.reserva_id])
    const ref1 = await vincular(p1.pago_id)
    const p2 = await prepararSaldo([a.reserva_id])
    expect(p2.reemplazados).toEqual([p1.pago_id])
    expect(await pagoEstado(p1.pago_id)).toBe('vencido')
    expect((await saldo(a.reserva_id)).link?.pago_id).toBe(p2.pago_id)
    // Sigue valiendo «una reserva en un solo pago pendiente».
    expect((await q<{ n: number }>(`select count(*)::int as n from funcion_pago_reservas where reserva_id = $1 and pendiente`, [a.reserva_id]))[0].n).toBe(1)
    const tardio = await registrar(ref1, 'aprobado', 120_000)
    expect([tardio.estado, tardio.repetida]).toEqual(['revisar', false])
    expect(Number((await saldo(a.reserva_id)).pagado)).toBe(80_000)
  })

  it('el link vence en el plazo; pasado el plazo el asistente no genera otro, una persona sí, hasta la hora de la función', async () => {
    const { e, a } = await conAbono()
    const p = await prepararSaldo([a.reserva_id])
    const s = await saldo(a.reserva_id)
    expect(new Date(p.vence_at).getTime()).toBe(new Date(s.plazo_at).getTime())
    // La foto del plazo de ESTA reserva pasa a 5 días: el plazo ya pasó.
    await q(`update funcion_reservas set dias_saldo_antes = 5 where id = $1`, [a.reserva_id])
    expect((await saldo(a.reserva_id)).estado).toBe('vencido')
    expect(await codigo(prepararSaldo([a.reserva_id]))).toBe('saldo_vencido')
    expect(await codigo(prepararSaldo([a.reserva_id], { equipo: LECTOR }))).toBe('sin_permiso')
    const persona = await prepararSaldo([a.reserva_id], { equipo: EQUIPO })
    const inicia = (await q<{ i: string }>(`select inicia_at as i from funcion_funciones where id = $1`, [e.funcion]))[0].i
    expect(new Date(persona.vence_at).getTime()).toBe(new Date(inicia).getTime())
  })

  it('el plazo sale de la foto de la reserva aunque cambie la campaña', async () => {
    const { e, a } = await conAbono()
    await q(`update funcion_campanas set dias_saldo_antes = 5 where id = $1`, [e.campana])
    const s = await saldo(a.reserva_id)
    expect(s.estado).toBe('pendiente')
    expect((await q<{ d: number }>(`select dias_saldo_antes as d from funcion_reservas where id = $1`, [a.reserva_id]))[0].d).toBe(1)
    // Una reserva nueva toma el plazo nuevo.
    const nueva = await apartarAsistente(e.funcion, 1)
    expect((await q<{ d: number }>(`select dias_saldo_antes as d from funcion_reservas where id = $1`, [nueva.reserva_id]))[0].d).toBe(5)
  })

  it('cancelar con un link de saldo vivo lo anula; si Bold igual lo cobra, queda en revisar para una persona', async () => {
    const { a } = await conAbono()
    const p = await prepararSaldo([a.reserva_id])
    const ref = await vincular(p.pago_id)
    const c = await siendo({ equipo: EQUIPO }, async () => (await q<{ r: { pagos_anulados: string[] } }>(`select funcion_cancelar_reserva($1) as r`, [a.reserva_id]))[0].r)
    expect(c.pagos_anulados).toEqual([p.pago_id])
    expect(await pagoEstado(p.pago_id)).toBe('anulado')
    const r = await registrar(ref, 'aprobado', 120_000)
    expect(r.estado).toBe('revisar')
    expect(await estado(a.reserva_id)).toBe('cancelada')
  })

  it('[Saldo cobrado] con el QR de Bold: un pago saldo más, con quién y cuándo; anula el link vivo; nunca más del saldo', async () => {
    const { a } = await conAbono()
    const p = await prepararSaldo([a.reserva_id])
    await vincular(p.pago_id)
    expect(await codigo(cobrado(a.reserva_id, 120_001))).toBe('monto_invalido')
    expect(await codigo(cobrado(a.reserva_id, 0))).toBe('monto_invalido')
    expect(await codigo(cobrado(a.reserva_id, 120_000, 'servidor'))).toMatch(/permission denied/)
    expect(await codigo(cobrado(a.reserva_id, 120_000, { equipo: LECTOR }))).toBe('sin_permiso')
    expect(await codigo(cobrado(a.reserva_id, 120_000, { equipo: AJENO }))).toBe('reserva_no_existe')
    // En el evento se cobra una parte y después el resto.
    const parte = await cobrado(a.reserva_id, 50_000)
    expect(num(parte)).toEqual([200_000, 130_000, 70_000, 'pendiente'])
    expect(parte.links_anulados).toEqual([p.pago_id])
    expect(await pagoEstado(p.pago_id)).toBe('anulado')
    const fila = (await q<{ concepto: string; medio: string; estado: string; registrado_por: string; registrado_at: string | null; vence_at: string | null }>(
      `select concepto, medio, estado, registrado_por, registrado_at, vence_at from funcion_pagos where id = $1`, [parte.pago_id]))[0]
    expect([fila.concepto, fila.medio, fila.estado, fila.registrado_por, !!fila.registrado_at, fila.vence_at]).toEqual(['saldo', 'bold_qr', 'aprobado', EQUIPO, true, null])
    expect(num(await cobrado(a.reserva_id, 70_000))).toEqual([200_000, 200_000, 0, 'pagado'])
    expect(await codigo(cobrado(a.reserva_id, 1))).toBe('sin_saldo')
    expect(await estado(a.reserva_id)).toBe('confirmada')
  })

  it('la verificación a mano también es un pago: con abono deja saldo; con un link vivo no se verifica', async () => {
    const e = await escenario()
    const a = await apartarEquipo(e.funcion, 2)
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'verificado_manual', 'cuotas') as r`, [a.reserva_id]))).toBe('modalidad_no_permitida')
    await rpc(`select funcion_confirmar_pago($1, 'verificado_manual', 'abono') as r`, [a.reserva_id])
    expect(num(await saldo(a.reserva_id))).toEqual([200_000, 80_000, 120_000, 'pendiente'])
    const manual = (await q<{ medio: string; concepto: string; pasarela: string | null }>(
      `select pg.medio, pg.concepto, pg.pasarela from funcion_pagos pg join funcion_pago_reservas pr on pr.pago_id = pg.id where pr.reserva_id = $1`, [a.reserva_id]))[0]
    expect(manual).toEqual({ medio: 'manual', concepto: 'inicial', pasarela: null })
    // Una persona genera el link del saldo para una reserva sin conversación.
    expect(Number((await prepararSaldo([a.reserva_id], { equipo: EQUIPO })).monto_esperado)).toBe(120_000)
    // Con el link del pago inicial vivo, la verificación a mano espera (no se cobra dos veces).
    const b = await apartarAsistente(e.funcion, 1)
    await preparar([b.reserva_id], 'total')
    expect(await codigo(rpc(`select funcion_confirmar_pago($1, 'verificado_manual', 'total') as r`, [b.reserva_id]))).toBe('reserva_en_otro_pago')
  })

  it('un link de saldo puede cubrir varias reservas de la conversación, con la suma de los saldos exactos', async () => {
    const e1 = await escenario()
    const e2 = await escenario({ precio: 150_000, abono: 50_000 })
    const conv = ++conversaciones
    await autorizacion(conv, 'general', 'si')
    const a1 = await apartarAsistente(e1.funcion, 2, { conv })
    const a2 = await apartarAsistente(e2.funcion, 1, { conv })
    const p = await preparar([a1.reserva_id, a2.reserva_id], 'abono')
    await registrar(await vincular(p.pago_id), 'aprobado', p.monto_esperado)
    const s = await prepararSaldo([a1.reserva_id, a2.reserva_id])
    expect(Number(s.monto_esperado)).toBe(120_000 + 100_000)
    const montos = await q<{ reserva_id: string; monto: string }>(`select reserva_id, monto from funcion_pago_reservas where pago_id = $1 order by monto`, [s.pago_id])
    expect(montos.map((x) => Number(x.monto))).toEqual([100_000, 120_000])
    // La lista del día lee los saldos de una función en una sola llamada.
    const lista = await rpc<Saldo[]>(`select funcion_saldos($1) as r`, [e1.funcion])
    expect(lista.map((x) => [x.reserva_id, Number(x.saldo), x.link?.pago_id])).toEqual([[a1.reserva_id, 120_000, s.pago_id]])
    expect(await codigo(rpc(`select funcion_saldos($1) as r`, [e1.funcion], 'servidor'))).toMatch(/permission denied/)
  })
})

describe('la preventa vencida con el interruptor encendido, en los textos (23-oct)', () => {
  const HOY = `((now() at time zone 'America/Bogota')::date)`
  const FICHA = {
    titulo_oferta: '🎃💀 EL EXTRAÑO MUNDO DE JACK', frase_gancho: '¿Qué pasa cuando Halloween y Navidad se encuentran?', intro: 'Intro.',
    que_incluye: ['🍽️ 5 tiempos'], emojis_tema: '🎃🖤', saludo_grupo: 'Hola', relato_grupo: 'Fin',
  }
  const NEGOCIO = { direccion: '[PRUEBA] Calle 1', piso: '2', recepcion: 'R', parqueadero: 'P', firma: 'F' }
  interface Panel {
    nombre: string
    dias_saldo_antes: number
    funciones: Array<{ inicia_at: string; estado: 'activa'; es_preventa: boolean; ocupadas: number; capacidad: number; tarifa: TarifaPublica }>
  }
  /** Los textos con lo que devuelve la base, como los arma la pantalla (`textos-ui.tsx`). */
  const textos = async (campana: string) => {
    const c = await rpc<Panel>(`select funcion_panel_campana($1) as r`, [campana])
    const funciones: FuncionTextos[] = c.funciones.map((f) => ({ inicia_at: f.inicia_at, estado: f.estado, llena: f.ocupadas >= f.capacidad, tarifa: f.tarifa }))
    const ahoraMs = Date.now()
    return {
      c,
      post: generarOferta({ ficha: FICHA, negocio: NEGOCIO, campana: { dias_saldo_antes: c.dias_saldo_antes }, funciones, ahoraMs }).texto,
      directo: generarMensajeDirecto({ ficha: FICHA, negocio: NEGOCIO, campana: { nombre: c.nombre, dias_saldo_antes: c.dias_saldo_antes }, funciones, ahoraMs }).texto,
    }
  }
  const precios = { precio: 180_000, preventa: 170_000, abono: 100_000, esPreventa: true }

  it('vencida (ayer), rige el regular aunque el interruptor siga encendido: ni el post ni el directo anuncian preventa', async () => {
    const e = await escenario({ ...precios, preventaHasta: `${HOY} - 1` })
    const t = await textos(e.campana)
    expect(t.c.funciones[0].es_preventa).toBe(true)
    for (const x of [t.post, t.directo]) {
      expect(x).not.toMatch(/Preventa|170\.000/)
      expect(x).toContain('🎫 Boletería regular: $180.000')
    }
  })

  it('vigente (hoy, inclusive), el precio de preventa con su fecha de fin y el regular de contexto', async () => {
    const e = await escenario({ ...precios, preventaHasta: HOY })
    const t = await textos(e.campana)
    for (const x of [t.post, t.directo]) {
      expect(x).toMatch(/🎟️ Preventa: \$170\.000 por persona \(hasta el \d{1,2} de [a-z]+\)/)
      expect(x).toContain('🎫 Boletería regular: $180.000')
    }
  })

  it('el formulario aplica la misma regla que la base para la fecha de fin, también cerca de la medianoche', async () => {
    const e = await escenario({ precio: 180_000, preventa: 170_000 })
    // Sábado 24 de octubre de 2099 a las 10:00 p. m. de Bogotá: en UTC ya es el 25. El día que cuenta es el 24.
    const tarde = uuid()
    await q(`insert into funcion_funciones (id, workspace_id, campana_id, inicia_at, capacidad, cupo_asistente)
             values ($1, $2, $3, '2099-10-25T03:00:00Z', 10, 10)`, [tarde, WS, e.campana])
    for (const f of [e.funcion, tarde]) {
      const [x] = await q<{ iso: string }>(`select to_char(inicia_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as iso from funcion_funciones where id = $1`, [f])
      const dia = diaBogota(x.iso)
      const [antes, despues] = (await q<{ a: string; d: string }>(`select to_char($1::date - 1, 'YYYY-MM-DD') as a, to_char($1::date + 1, 'YYYY-MM-DD') as d`, [dia]))
        .map((r) => [r.a, r.d])[0]
      for (const hasta of [antes, dia, despues]) {
        const base = await codigo(rpc(`select funcion_cambiar_preventa($1, true, $2::date) as r`, [f, hasta]))
        expect({ hasta, base }).toEqual({ hasta, base: preventaPasaLaFuncion(hasta, dia) ? 'preventa_despues_de_funcion' : 'ok' })
      }
    }
    expect(diaBogota('2099-10-25T03:00:00Z')).toBe('2099-10-24')
  })
})
