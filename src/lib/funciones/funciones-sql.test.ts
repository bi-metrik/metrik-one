/**
 * `20261021120000_modulo_funciones.sql` corrida de verdad en Postgres en memoria (PGlite), encima de la migración real
 * del asistente (`20261021090000_asistente_chatwoot.sql`, de donde sale `chatwoot_consentimientos`).
 *
 * Son las pruebas de §5 del diseño (`proyectos/sabor-experiencias/clarity/docs/entrada/diseno-etapa2-funciones-mapa.md`):
 * no sobreventa (1-7), mesas (9-16) y datos y permisos (17-19). La 8 (concurrencia) no se puede probar aquí: PGlite
 * tiene UNA conexión y el `for update` nunca espera a nadie. La corre `scripts/funciones-concurrencia.sh` contra un
 * Postgres real en el job «Concurrencia de funciones» del CI; aquí queda solo la ráfaga en serie, que prueba la
 * cuenta pero no el candado.
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
const FUNCIONES = leer('supabase/migrations/20261021120000_modulo_funciones.sql')

const WS = '00000000-0000-4000-8000-00000000f001'
const OTRO_WS = '00000000-0000-4000-8000-00000000f002'
const EQUIPO = '00000000-0000-4000-8000-00000000f011'
const LECTOR = '00000000-0000-4000-8000-00000000f012'
const AJENO = '00000000-0000-4000-8000-00000000f013'
const HUELLA = 'a'.repeat(64)

let db: PGlite
let n = 0
const uuid = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`

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
  montaje: string | null
  funcion: string
  mesas: Record<string, string>
}

/** Una experiencia, opcionalmente un montaje con mesas (etiqueta → puestos), y una función mañana. */
async function escenario(o: {
  cupo: number
  mesas?: Record<string, number>
  minutos?: number | null
  estado?: string
  cierraVentaAt?: string | null
  ws?: string
}): Promise<Escenario> {
  const ws = o.ws ?? WS
  const experiencia = uuid()
  await q(`insert into funcion_experiencias (id, workspace_id, nombre, minutos_apartado) values ($1, $2, 'Ratatouille', $3)`, [
    experiencia, ws, o.minutos === undefined ? 30 : o.minutos,
  ])
  let montaje: string | null = null
  const mesas: Record<string, string> = {}
  if (o.mesas) {
    montaje = uuid()
    await q(`insert into funcion_montajes (id, workspace_id, experiencia_id, nombre) values ($1, $2, $3, 'Salón')`, [montaje, ws, experiencia])
    let orden = 0
    for (const [etiqueta, puestos] of Object.entries(o.mesas)) {
      const id = uuid()
      mesas[etiqueta] = id
      await q(`insert into funcion_mesas (id, workspace_id, montaje_id, etiqueta, puestos, orden) values ($1, $2, $3, $4, $5, $6)`, [
        id, ws, montaje, etiqueta, puestos, orden++,
      ])
    }
  }
  const funcion = uuid()
  await q(
    `insert into funcion_funciones (id, workspace_id, experiencia_id, montaje_id, inicia_at, cupo_total, estado, cierra_venta_at)
     values ($1, $2, $3, $4, now() + interval '1 day', $5, $6, $7)`,
    [funcion, ws, experiencia, montaje, o.cupo, o.estado ?? 'abierta', o.cierraVentaAt ?? null],
  )
  return { experiencia, montaje, funcion, mesas }
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

let conversaciones = 1000
/** Aparta como el asistente, con una conversación que ya dijo «sí» a la autorización general. */
async function apartarAsistente(funcion: string, personas: number, o: { clave?: string; conv?: number; datos?: Record<string, unknown> } = {}) {
  let conv = o.conv
  if (conv === undefined) {
    conv = ++conversaciones
    await autorizacion(conv, 'general', 'si')
  }
  const datos = { canal: 'instagram', chatwoot_cuenta_id: 1, chatwoot_conversacion_id: conv, nombre: 'Cliente', ...o.datos }
  return siendo('servidor', async () => {
    const r = await q<{ r: { reserva_id: string; estado: string; vence_at: string; repetida: boolean } }>(
      `select funcion_apartar($1, $2, $3, $4::jsonb, $5, 'asistente') as r`,
      [WS, funcion, personas, JSON.stringify(datos), o.clave ?? `clave-${uuid()}`],
    )
    return r[0].r
  })
}

/** Aparta como el equipo (origen equipo). */
async function apartarEquipo(funcion: string, personas: number, clave = `eq-${uuid()}`, ws = WS, perfil = EQUIPO) {
  return siendo({ equipo: perfil }, async () => {
    const r = await q<{ r: { reserva_id: string; estado: string } }>(
      `select funcion_apartar($1, $2, $3, '{"nombre": "Mesa del equipo"}'::jsonb, $4, 'equipo') as r`,
      [ws, funcion, personas, clave],
    )
    return r[0].r
  })
}

async function ocupacion(funcion: string, quien: Quien = { equipo: EQUIPO }) {
  return siendo(quien, async () => {
    const r = await q<{ o: { cupo_total: number; ocupadas: number; libres: number; mesas: Array<{ etiqueta: string; ocupados: number; reservas: Array<{ reserva_id: string; personas: number }> }> | null } }>(
      `select funcion_ocupacion($1) as o`,
      [funcion],
    )
    return r[0].o
  })
}

async function asignar(reserva: string, asignaciones: Array<{ mesa_id: string; personas: number }>, perfil = EQUIPO) {
  return siendo({ equipo: perfil }, () =>
    q(`select funcion_asignar_mesas($1, $2::jsonb)`, [reserva, JSON.stringify(asignaciones)]),
  )
}

async function cancelar(reserva: string) {
  return siendo({ equipo: EQUIPO }, () => q(`select funcion_cancelar_reserva($1)`, [reserva]))
}

async function vencer(reserva: string) {
  await q(`update funcion_reservas set vence_at = now() - interval '1 minute' where id = $1`, [reserva])
}

async function estado(reserva: string) {
  return (await q<{ estado: string }>(`select estado from funcion_reservas where id = $1`, [reserva]))[0].estado
}

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
    const e = await escenario({ cupo: 10 })
    for (const p of [4, 4, 2]) expect((await apartarAsistente(e.funcion, p)).estado).toBe('apartada')
    expect(await codigo(apartarAsistente(e.funcion, 1))).toBe('sin_cupo')
    expect(await codigo(apartarEquipo(e.funcion, 1))).toBe('sin_cupo')
    const o = await ocupacion(e.funcion)
    expect([o.cupo_total, o.ocupadas, o.libres]).toEqual([10, 10, 0])
  })

  it('2. un apartado vencido no cuenta: su cupo vuelve y queda vencida', async () => {
    const e = await escenario({ cupo: 4 })
    const a = await apartarAsistente(e.funcion, 4)
    expect(await codigo(apartarAsistente(e.funcion, 1))).toBe('sin_cupo')
    await vencer(a.reserva_id)
    // La lectura ya no lo cuenta aunque nadie lo haya marcado todavía.
    expect((await ocupacion(e.funcion)).libres).toBe(4)
    expect((await apartarAsistente(e.funcion, 4)).estado).toBe('apartada')
    // El apartar que tomó el candado lo marcó `vencida`, sin cron.
    expect(await estado(a.reserva_id)).toBe('vencida')
  })

  it('3. cancelar libera el cupo', async () => {
    const e = await escenario({ cupo: 3 })
    const a = await apartarEquipo(e.funcion, 3)
    expect(await codigo(apartarEquipo(e.funcion, 1))).toBe('sin_cupo')
    await cancelar(a.reserva_id)
    expect(await estado(a.reserva_id)).toBe('cancelada')
    expect((await apartarEquipo(e.funcion, 3)).estado).toBe('apartada')
  })

  it('4. la misma clave de idempotencia dos veces: una reserva, el cupo cuenta una vez', async () => {
    const e = await escenario({ cupo: 5 })
    const conv = ++conversaciones
    await autorizacion(conv, 'general', 'si')
    const a = await apartarAsistente(e.funcion, 3, { clave: 'huella-propuesta-1', conv })
    const b = await apartarAsistente(e.funcion, 3, { clave: 'huella-propuesta-1', conv })
    expect(b.reserva_id).toBe(a.reserva_id)
    expect([a.repetida, b.repetida]).toEqual([false, true])
    expect((await q(`select 1 from funcion_reservas where funcion_id = $1`, [e.funcion])).length).toBe(1)
    expect((await ocupacion(e.funcion)).ocupadas).toBe(3)
    // La misma clave con otro número de personas no es un reintento: se rechaza.
    expect(await codigo(apartarAsistente(e.funcion, 2, { clave: 'huella-propuesta-1', conv }))).toBe('clave_reusada')
  })

  it('5. confirmar un apartado vencido cuyo cupo ya se tomó: sin_cupo; con cupo libre, confirma', async () => {
    const e = await escenario({ cupo: 4 })
    const a = await apartarAsistente(e.funcion, 4)
    await vencer(a.reserva_id)
    const b = await apartarAsistente(e.funcion, 2)
    expect(await codigo(siendo('servidor', () => q(`select funcion_confirmar_pago($1, 'aprobado')`, [a.reserva_id])))).toBe('sin_cupo')
    expect(await estado(a.reserva_id)).toBe('vencida')
    // Se cancela la otra: ahora sí cabe, y la pasarela confirma.
    await cancelar(b.reserva_id)
    await siendo('servidor', () => q(`select funcion_confirmar_pago($1, 'aprobado')`, [a.reserva_id]))
    expect(await estado(a.reserva_id)).toBe('confirmada')
    expect((await ocupacion(e.funcion)).ocupadas).toBe(4)
  })

  it('confirmar: el equipo solo verifica a mano y el servidor solo aprueba', async () => {
    const e = await escenario({ cupo: 4 })
    const a = await apartarEquipo(e.funcion, 2)
    expect(await codigo(siendo({ equipo: EQUIPO }, () => q(`select funcion_confirmar_pago($1, 'aprobado')`, [a.reserva_id])))).toBe('pago_estado_invalido')
    expect(await codigo(siendo('servidor', () => q(`select funcion_confirmar_pago($1, 'verificado_manual')`, [a.reserva_id])))).toBe('pago_estado_invalido')
    await siendo({ equipo: EQUIPO }, () => q(`select funcion_confirmar_pago($1, 'verificado_manual')`, [a.reserva_id]))
    const r = (await q<{ estado: string; pago_estado: string; confirmada_por: string }>(
      `select estado, pago_estado, confirmada_por from funcion_reservas where id = $1`, [a.reserva_id],
    ))[0]
    expect(r).toEqual({ estado: 'confirmada', pago_estado: 'verificado_manual', confirmada_por: EQUIPO })
    // Una confirmada no vence aunque su vence_at haya pasado.
    await vencer(a.reserva_id)
    expect((await ocupacion(e.funcion)).ocupadas).toBe(2)
  })

  it('6. función cerrada o pasada la hora de cierre de venta: no aparta', async () => {
    const cerrada = await escenario({ cupo: 10, estado: 'cerrada' })
    expect(await codigo(apartarAsistente(cerrada.funcion, 1))).toBe('funcion_cerrada')
    const cancelada = await escenario({ cupo: 10, estado: 'cancelada' })
    expect(await codigo(apartarAsistente(cancelada.funcion, 1))).toBe('funcion_cerrada')
    const sinVenta = await escenario({ cupo: 10, cierraVentaAt: new Date(Date.now() - 60_000).toISOString() })
    expect(await codigo(apartarAsistente(sinVenta.funcion, 1))).toBe('venta_cerrada')
    // Y el asistente la ve cerrada, sin cifras de más.
    const c = await siendo('servidor', async () =>
      (await q<{ c: Record<string, unknown> }>(`select funcion_consultar_cupo($1, $2) as c`, [WS, sinVenta.funcion]))[0].c,
    )
    expect(c.estado).toBe('cerrada')
  })

  it('sin regla de apartado (HUECO 4 sin decidir): sin_regla_apartado y no aparta', async () => {
    const e = await escenario({ cupo: 10, minutos: null })
    expect(await codigo(apartarAsistente(e.funcion, 1))).toBe('sin_regla_apartado')
    expect((await q(`select 1 from funcion_reservas where funcion_id = $1`, [e.funcion])).length).toBe(0)
  })

  it('una función que ya empezó no aparta', async () => {
    const e = await escenario({ cupo: 10 })
    await q(`update funcion_funciones set inicia_at = now() - interval '1 minute' where id = $1`, [e.funcion])
    expect(await codigo(apartarEquipo(e.funcion, 1))).toBe('funcion_cerrada')
  })

  it('7. bajar el cupo por debajo de lo ocupado falla; cupo sobre los puestos del montaje falla', async () => {
    const e = await escenario({ cupo: 6, mesas: { M1: 4, M2: 4 } })
    await apartarEquipo(e.funcion, 5)
    expect(await codigo(q(`update funcion_funciones set cupo_total = 4 where id = $1`, [e.funcion]))).toBe('cupo_bajo_ocupacion')
    await q(`update funcion_funciones set cupo_total = 5 where id = $1`, [e.funcion])
    expect(await codigo(q(`update funcion_funciones set cupo_total = 9 where id = $1`, [e.funcion]))).toBe('cupo_sobre_puestos')
    const exp = (await q<{ experiencia_id: string }>(`select experiencia_id from funcion_funciones where id = $1`, [e.funcion]))[0].experiencia_id
    expect(await codigo(q(
      `insert into funcion_funciones (workspace_id, experiencia_id, montaje_id, inicia_at, cupo_total)
       values ($1, $2, $3, now() + interval '2 days', 9)`, [WS, exp, e.montaje],
    ))).toBe('cupo_sobre_puestos')
  })

  it('8 (en serie). una ráfaga de 30 apartados de 1 sobre cupo 7 deja 7 ocupadas', async () => {
    const e = await escenario({ cupo: 7 })
    // En fila a propósito: PGlite tiene una conexión, así que esto prueba la cuenta, no el candado
    // (el candado lo prueba scripts/funciones-concurrencia.sh contra un Postgres real).
    const r: string[] = []
    for (let i = 0; i < 30; i++) r.push(await codigo(apartarEquipo(e.funcion, 1)))
    expect(r.filter((x) => x === 'ok').length).toBe(7)
    expect(new Set(r.filter((x) => x !== 'ok'))).toEqual(new Set(['sin_cupo']))
    expect((await ocupacion(e.funcion)).ocupadas).toBe(7)
  })
})

describe('mesas', () => {
  it('9. asignar dentro de los puestos pasa; pasarse da mesa_llena', async () => {
    const e = await escenario({ cupo: 8, mesas: { M1: 4, M2: 4 } })
    const a = await apartarEquipo(e.funcion, 4)
    await asignar(a.reserva_id, [{ mesa_id: e.mesas.M1, personas: 4 }])
    const b = await apartarEquipo(e.funcion, 2)
    expect(await codigo(asignar(b.reserva_id, [{ mesa_id: e.mesas.M1, personas: 2 }]))).toBe('mesa_llena')
    const o = await ocupacion(e.funcion)
    expect(o.mesas!.map((m) => [m.etiqueta, m.ocupados])).toEqual([['M1', 4], ['M2', 0]])
    expect(o.mesas![0].reservas).toEqual([expect.objectContaining({ reserva_id: a.reserva_id, personas: 4 })])
  })

  it('10. una mesa de otro montaje: mesa_de_otro_montaje', async () => {
    const e = await escenario({ cupo: 4, mesas: { M1: 4 } })
    const otro = await escenario({ cupo: 4, mesas: { X1: 4 } })
    const a = await apartarEquipo(e.funcion, 2)
    expect(await codigo(asignar(a.reserva_id, [{ mesa_id: otro.mesas.X1, personas: 2 }]))).toBe('mesa_de_otro_montaje')
    expect((await q(`select 1 from funcion_reserva_mesas where reserva_id = $1`, [a.reserva_id])).length).toBe(0)
  })

  it('11. repartir 6 en dos mesas de 4 (4 + 2); si no suman 6: personas_no_cuadran', async () => {
    const e = await escenario({ cupo: 8, mesas: { M1: 4, M2: 4 } })
    const a = await apartarEquipo(e.funcion, 6)
    expect(await codigo(asignar(a.reserva_id, [{ mesa_id: e.mesas.M1, personas: 4 }, { mesa_id: e.mesas.M2, personas: 1 }]))).toBe('personas_no_cuadran')
    expect(await codigo(asignar(a.reserva_id, [{ mesa_id: e.mesas.M1, personas: 4 }]))).toBe('personas_no_cuadran')
    await asignar(a.reserva_id, [{ mesa_id: e.mesas.M1, personas: 4 }, { mesa_id: e.mesas.M2, personas: 2 }])
    const o = await ocupacion(e.funcion)
    expect(o.mesas!.map((m) => m.ocupados)).toEqual([4, 2])
  })

  it('12. dos reservas comparten mesa hasta llenarla', async () => {
    const e = await escenario({ cupo: 6, mesas: { M1: 4, M2: 2 } })
    const a = await apartarEquipo(e.funcion, 2)
    const b = await apartarEquipo(e.funcion, 2)
    const c = await apartarEquipo(e.funcion, 1)
    await asignar(a.reserva_id, [{ mesa_id: e.mesas.M1, personas: 2 }])
    await asignar(b.reserva_id, [{ mesa_id: e.mesas.M1, personas: 2 }])
    expect(await codigo(asignar(c.reserva_id, [{ mesa_id: e.mesas.M1, personas: 1 }]))).toBe('mesa_llena')
    const m1 = (await ocupacion(e.funcion)).mesas!.find((m) => m.etiqueta === 'M1')!
    expect(m1.ocupados).toBe(4)
    expect(m1.reservas.map((r) => r.reserva_id).sort()).toEqual([a.reserva_id, b.reserva_id].sort())
  })

  it('13. mover a otra mesa libera la anterior', async () => {
    const e = await escenario({ cupo: 8, mesas: { M1: 4, M2: 4 } })
    const a = await apartarEquipo(e.funcion, 4)
    await asignar(a.reserva_id, [{ mesa_id: e.mesas.M1, personas: 4 }])
    await asignar(a.reserva_id, [{ mesa_id: e.mesas.M2, personas: 4 }])
    expect((await ocupacion(e.funcion)).mesas!.map((m) => m.ocupados)).toEqual([0, 4])
    // Y liberar (asignación vacía) la deja sin mesa.
    await asignar(a.reserva_id, [])
    expect((await ocupacion(e.funcion)).mesas!.map((m) => m.ocupados)).toEqual([0, 0])
  })

  it('14. cancelar o vencer una reserva libera su mesa', async () => {
    const e = await escenario({ cupo: 8, mesas: { M1: 4, M2: 4 } })
    const a = await apartarEquipo(e.funcion, 4)
    const b = await apartarEquipo(e.funcion, 4)
    await asignar(a.reserva_id, [{ mesa_id: e.mesas.M1, personas: 4 }])
    await asignar(b.reserva_id, [{ mesa_id: e.mesas.M2, personas: 4 }])
    await cancelar(a.reserva_id)
    await vencer(b.reserva_id)
    // Vencido sin marcar: la lectura ya no lo sienta.
    expect((await ocupacion(e.funcion)).mesas!.map((m) => m.ocupados)).toEqual([0, 0])
    // Al marcarlo (cualquier operación con el candado), la fila de la mesa desaparece.
    await apartarEquipo(e.funcion, 1)
    expect(await estado(b.reserva_id)).toBe('vencida')
    expect((await q(`select 1 from funcion_reserva_mesas where reserva_id in ($1, $2)`, [a.reserva_id, b.reserva_id])).length).toBe(0)
    expect(await codigo(asignar(b.reserva_id, [{ mesa_id: e.mesas.M2, personas: 4 }]))).toBe('reserva_inactiva')
  })

  it('15. borrar una mesa con asignaciones futuras, o bajarle los puestos: falla', async () => {
    const e = await escenario({ cupo: 4, mesas: { M1: 4, M2: 4, M3: 2 } })
    const a = await apartarEquipo(e.funcion, 3)
    await asignar(a.reserva_id, [{ mesa_id: e.mesas.M1, personas: 3 }])
    expect(await codigo(q(`delete from funcion_mesas where id = $1`, [e.mesas.M1]))).toBe('mesa_con_asignaciones')
    expect(await codigo(q(`update funcion_mesas set puestos = 2 where id = $1`, [e.mesas.M1]))).toBe('mesa_con_asignaciones')
    // Bajarle a 3 (lo asignado) sí; subirla también.
    await q(`update funcion_mesas set puestos = 3 where id = $1`, [e.mesas.M1])
    await q(`update funcion_mesas set puestos = 6 where id = $1`, [e.mesas.M1])
    // Una mesa sin asignaciones se borra, mientras el montaje siga cubriendo el cupo.
    await q(`delete from funcion_mesas where id = $1`, [e.mesas.M3])
    // Cambiar el montaje de una función con reservas sentadas: prohibido.
    const otro = await escenario({ cupo: 4, mesas: { X1: 4 } })
    expect(await codigo(q(`update funcion_funciones set montaje_id = $2 where id = $1`, [e.funcion, otro.montaje]))).not.toBe('ok')
  })

  it('la mesa no puede dejar al montaje con menos puestos que el cupo de una función futura', async () => {
    const e = await escenario({ cupo: 8, mesas: { M1: 4, M2: 4 } })
    expect(await codigo(q(`update funcion_mesas set puestos = 3 where id = $1`, [e.mesas.M2]))).toBe('cupo_sobre_puestos')
    expect(await codigo(q(`delete from funcion_mesas where id = $1`, [e.mesas.M2]))).toBe('cupo_sobre_puestos')
  })

  it('16. apartar no tiene cómo asignar mesa, y funcion_asignar_mesas no es ejecutable con la llave del asistente', async () => {
    const e = await escenario({ cupo: 4, mesas: { M1: 4 } })
    expect(await codigo(apartarAsistente(e.funcion, 2, { datos: { mesa_id: e.mesas.M1 } }))).toBe('dato_no_admitido')
    expect(await codigo(apartarAsistente(e.funcion, 2, { datos: { mesas: [{ mesa_id: e.mesas.M1, personas: 2 }] } }))).toBe('dato_no_admitido')
    const a = await apartarAsistente(e.funcion, 2, { datos: { preferencia_mesa: 'cerca de la pantalla' } })
    expect((await q<{ preferencia_mesa: string }>(`select preferencia_mesa from funcion_reservas where id = $1`, [a.reserva_id]))[0].preferencia_mesa).toBe('cerca de la pantalla')
    expect((await q(`select 1 from funcion_reserva_mesas where reserva_id = $1`, [a.reserva_id])).length).toBe(0)
    expect(await codigo(siendo('servidor', () =>
      q(`select funcion_asignar_mesas($1, $2::jsonb)`, [a.reserva_id, JSON.stringify([{ mesa_id: e.mesas.M1, personas: 2 }])]),
    ))).toMatch(/permission denied/)
    expect(await codigo(siendo('servidor', () => q(`select funcion_cancelar_reserva($1)`, [a.reserva_id])))).toMatch(/permission denied/)
    const priv = (await q<{ srv: boolean; auth: boolean }>(
      `select has_function_privilege('service_role', 'public.funcion_asignar_mesas(uuid, jsonb)', 'execute') as srv,
              has_function_privilege('authenticated', 'public.funcion_asignar_mesas(uuid, jsonb)', 'execute') as auth`,
    ))[0]
    expect(priv).toEqual({ srv: false, auth: true })
  })

  it('una función sin montaje tiene cupo y reservas, sin mapa', async () => {
    const e = await escenario({ cupo: 4 })
    const a = await apartarEquipo(e.funcion, 2)
    const o = await ocupacion(e.funcion)
    expect([o.ocupadas, o.mesas]).toEqual([2, null])
    expect(await codigo(asignar(a.reserva_id, [{ mesa_id: uuid(), personas: 2 }]))).toBe('funcion_sin_montaje')
  })
})

describe('datos y permisos', () => {
  it('17. restricciones sin autorización sensible: sin_autorizacion_sensible; borrar la autorización las borra', async () => {
    const e = await escenario({ cupo: 4 })
    const conv = ++conversaciones
    await autorizacion(conv, 'general', 'si')
    const a = await apartarAsistente(e.funcion, 2, { conv })
    const guardar = (consentimiento: string | null) => siendo('servidor', () =>
      q(`select funcion_guardar_restricciones($1, 'sin gluten', $2)`, [a.reserva_id, consentimiento]))

    expect(await codigo(guardar(null))).toBe('sin_autorizacion_sensible')
    // La general no sirve para el dato sensible.
    const general = (await q<{ id: string }>(`select id from chatwoot_consentimientos where conversacion_id = $1`, [conv]))[0].id
    expect(await codigo(guardar(general))).toBe('sin_autorizacion_sensible')
    // Una sensible de otra conversación tampoco.
    const otraConv = await autorizacion(conv + 50_000, 'sensible', 'si')
    expect(await codigo(guardar(otraConv))).toBe('sin_autorizacion_sensible')
    // Un «no» sensible tampoco.
    const no = await autorizacion(conv, 'sensible', 'no')
    expect(await codigo(guardar(no))).toBe('sin_autorizacion_sensible')
    // La directa, sin función, la frena el CHECK.
    expect(await codigo(q(`update funcion_reservas set restricciones = 'maní' where id = $1`, [a.reserva_id]))).toMatch(/restricciones_autorizadas/)

    const si = await autorizacion(conv, 'sensible', 'si')
    await guardar(si)
    expect((await q<{ restricciones: string }>(`select restricciones from funcion_reservas where id = $1`, [a.reserva_id]))[0].restricciones).toBe('sin gluten')

    // Supresión: se borra la autorización y se van las restricciones.
    await q(`delete from chatwoot_consentimientos where id = $1`, [si])
    const r = (await q<{ restricciones: string | null; consentimiento_sensible_id: string | null }>(
      `select restricciones, consentimiento_sensible_id from funcion_reservas where id = $1`, [a.reserva_id],
    ))[0]
    expect(r).toEqual({ restricciones: null, consentimiento_sensible_id: null })
  })

  it('una reserva del equipo (sin conversación) no guarda restricciones (E6 abierto)', async () => {
    const e = await escenario({ cupo: 4 })
    const a = await apartarEquipo(e.funcion, 2)
    const sensible = await autorizacion(++conversaciones, 'sensible', 'si')
    expect(await codigo(siendo({ equipo: EQUIPO }, () =>
      q(`select funcion_guardar_restricciones($1, 'vegano', $2)`, [a.reserva_id, sensible])))).toBe('sin_autorizacion_sensible')
  })

  it('18. apartar sin autorización general: sin_autorizacion; un «no» posterior la retira', async () => {
    const e = await escenario({ cupo: 4 })
    const sin = ++conversaciones
    expect(await codigo(apartarAsistente(e.funcion, 1, { conv: sin }))).toBe('sin_autorizacion')
    const retirada = ++conversaciones
    await autorizacion(retirada, 'general', 'si')
    await autorizacion(retirada, 'general', 'no')
    expect(await codigo(apartarAsistente(e.funcion, 1, { conv: retirada }))).toBe('sin_autorizacion')
    // La autorización de la misma conversación en OTRO workspace no cuenta.
    const ajena = ++conversaciones
    await autorizacion(ajena, 'general', 'si', OTRO_WS)
    expect(await codigo(apartarAsistente(e.funcion, 1, { conv: ajena }))).toBe('sin_autorizacion')
    expect((await ocupacion(e.funcion)).ocupadas).toBe(0)
  })

  it('19. authenticated de otro workspace no ve ni escribe nada; nadie escribe las tablas directo', async () => {
    const e = await escenario({ cupo: 4, mesas: { M1: 4 } })
    const a = await apartarEquipo(e.funcion, 2)

    const visibles = await siendo({ equipo: AJENO }, () =>
      Promise.all(['funcion_experiencias', 'funcion_montajes', 'funcion_mesas', 'funcion_funciones', 'funcion_reservas', 'funcion_reserva_mesas']
        .map(async (t) => (await q(`select 1 from ${t}`)).length)),
    )
    expect(visibles).toEqual([0, 0, 0, 0, 0, 0])
    const propias = await siendo({ equipo: EQUIPO }, async () => (await q(`select 1 from funcion_reservas where id = $1`, [a.reserva_id])).length)
    expect(propias).toBe(1)

    expect(await codigo(siendo({ equipo: AJENO }, () => q(`select funcion_ocupacion($1)`, [e.funcion])))).toBe('funcion_no_existe')
    expect(await codigo(apartarEquipo(e.funcion, 1, `aj-${uuid()}`, WS, AJENO))).toBe('funcion_no_existe')
    expect(await codigo(siendo({ equipo: AJENO }, () => q(`select funcion_cancelar_reserva($1)`, [a.reserva_id])))).toBe('reserva_no_existe')
    expect(await codigo(asignar(a.reserva_id, [{ mesa_id: e.mesas.M1, personas: 2 }], AJENO))).toBe('reserva_no_existe')
    expect(await estado(a.reserva_id)).toBe('apartada')

    // Un rol de solo lectura del mismo workspace ve, pero no escribe.
    expect(await codigo(siendo({ equipo: LECTOR }, () => q(`select funcion_ocupacion($1)`, [e.funcion])))).toBe('ok')
    expect(await codigo(siendo({ equipo: LECTOR }, () => q(`select funcion_cancelar_reserva($1)`, [a.reserva_id])))).toBe('sin_permiso')

    // Escritura directa (lo que haría PostgREST): ni authenticated ni service_role.
    for (const quien of [{ equipo: EQUIPO }, 'servidor'] as Quien[]) {
      expect(await codigo(siendo(quien, () => q(`update funcion_reservas set personas = 1 where id = $1`, [a.reserva_id])))).toMatch(/permission denied/)
      expect(await codigo(siendo(quien, () => q(`delete from funcion_reservas where id = $1`, [a.reserva_id])))).toMatch(/permission denied/)
      expect(await codigo(siendo(quien, () => q(
        `insert into funcion_reserva_mesas (reserva_id, mesa_id, workspace_id, funcion_id, montaje_id, personas, asignada_por)
         values ($1, $2, $3, $4, $5, 2, $6)`, [a.reserva_id, e.mesas.M1, WS, e.funcion, e.montaje, EQUIPO])))).toMatch(/permission denied/)
    }
    // anon no ejecuta ninguna RPC del módulo.
    const anon = (await q<{ f: string; x: boolean }>(
      `select p.oid::regprocedure::text as f, has_function_privilege('anon', p.oid, 'execute') as x
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'funcion\\_%'`,
    ))
    expect(anon.length).toBeGreaterThan(10)
    expect(anon.filter((r) => r.x).map((r) => r.f)).toEqual([])
  })

  it('el asistente solo ve cupo libre y si está agotada, de funciones futuras de su workspace', async () => {
    const e = await escenario({ cupo: 4, mesas: { M1: 4 } })
    await apartarAsistente(e.funcion, 4)
    const c = await siendo('servidor', async () =>
      (await q<{ c: Record<string, unknown> }>(`select funcion_consultar_cupo($1, $2) as c`, [WS, e.funcion]))[0].c,
    )
    expect(Object.keys(c).sort()).toEqual(['agotada', 'cupo_libre', 'estado', 'funcion_id', 'inicia_at'])
    expect([c.cupo_libre, c.agotada]).toEqual([0, true])
    expect(await codigo(siendo('servidor', () => q(`select funcion_consultar_cupo($1, $2)`, [OTRO_WS, e.funcion])))).toBe('funcion_no_existe')
    expect(await codigo(siendo({ equipo: EQUIPO }, () => q(`select funcion_consultar_cupo($1, $2)`, [WS, e.funcion])))).toMatch(/permission denied/)
  })

  it('el cliente queda en contactos: se crea por teléfono la primera vez y se reusa después', async () => {
    const e = await escenario({ cupo: 6 })
    const a = await apartarAsistente(e.funcion, 1, { datos: { canal: 'whatsapp', telefono: '+57 300 111 2233', nombre: 'Ana' } })
    const b = await apartarAsistente(e.funcion, 1, { datos: { canal: 'whatsapp', telefono: '573001112233', nombre: 'Ana P.' } })
    const filas = await q<{ contacto_id: string; telefono: string }>(
      `select contacto_id, telefono from funcion_reservas where id in ($1, $2)`, [a.reserva_id, b.reserva_id],
    )
    expect(filas[0].contacto_id).toBeTruthy()
    expect(filas[0].contacto_id).toBe(filas[1].contacto_id)
    expect(filas[0].telefono).toBe('573001112233')
    expect((await q(`select 1 from contactos where telefono = '573001112233'`)).length).toBe(1)
  })

  it('la llave de módulo `funciones` queda en las listas de la base', async () => {
    await q(`insert into workspace_modulos (workspace_id, modulo) values ($1, 'funciones')`, [WS])
    await q(`insert into catalogo_servicios (modulo) values ('funciones')`)
    await q(`insert into documentos_contractuales_versiones (modulo) values ('funciones')`)
    expect(await codigo(q(`insert into workspace_modulos (workspace_id, modulo) values ($1, 'sabor')`, [WS]))).toMatch(/workspace_modulos_modulo/)
  })
})
