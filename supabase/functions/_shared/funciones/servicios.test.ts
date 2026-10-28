import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { apartar, campanaDeLaConversacion, campanasActivas, consultarCupo, generarLinkPago, generarLinkSaldo, resumenPago, saldoReserva, verFuncionesDisponibles } from './servicios'
import { cuerpoLinkBold, expiracionBold, pasarelaBold, pasarelaEnMemoria } from './pasarela'
import { funcionesEnMemoria, type CampanaEnMemoria, type FuncionEnMemoria } from './memoria'
import { datosDeApartado, puertoFuncionesSupabase, type ClienteFunciones } from './supabase'
import { codigoDeError, type PropuestaApartado, type PuertoFunciones } from './tipos'
import { diaBogota, plazoSaldo } from './fecha-texto'
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
  asociarAnuncio(campanaId: string, adId: string): Promise<void>
  /** El aviso aprobado de la pasarela, con el monto esperado. */
  aprobar(pagoId: string, referencia: string): Promise<void>
  /** Cambia la foto del plazo del saldo de una reserva (para probar el plazo vencido sin reloj). */
  cambiarPlazo(reservaId: string, dias: number): Promise<void>
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
      // Un arreglo viaja como arreglo de uuid (como lo convierte PostgREST); un objeto, como jsonb.
      const esObjeto = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v)
      const valores = claves.map((k) => (esObjeto(args[k]) ? JSON.stringify(args[k]) : args[k]))
      const lista = claves.map((k, i) => `${k} => $${i + 1}${esObjeto(args[k]) ? '::jsonb' : Array.isArray(args[k]) ? '::uuid[]' : ''}`).join(', ')
      try {
        const r = await comoServidor(() => db.query<{ r: unknown }>(`select public.${nombre}(${lista}) as r`, valores))
        return { data: r.rows[0].r, error: null }
      } catch (e) {
        return { data: null, error: { message: (e as Error).message, details: (e as { detail?: string }).detail ?? null } }
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
    asociarAnuncio: async (c, ad) => m.asociarAnuncio(c, ad),
    aprobar: async (pagoId) => m.aprobarPago(pagoId),
    cambiarPlazo: async (rid, dias) => m.cambiarPlazo(rid, dias),
  }
}

function bancoBase(ws: string): Banco {
  const experiencias = new Map<string, string>()
  return {
    ws,
    puerto: puertoFuncionesSupabase(clientePGlite(pg)),
    async agregarCampana(c) {
      let exp = experiencias.get(c.experiencia)
      if (!exp) {
        exp = hex('e')
        experiencias.set(c.experiencia, exp)
        await pg.query(`insert into funcion_experiencias (id, workspace_id, nombre) values ($1, $2, $3)`, [exp, c.workspaceId, c.experiencia])
      }
      const publicada = c.publicada ?? true
      await pg.query(
        `insert into funcion_campanas (id, workspace_id, experiencia_id, nombre, codigo, estado, agenda_publicada_at, minutos_apartado,
           precio_persona, precio_preventa_persona, abono_persona, permite_pago_total, dias_saldo_antes)
         values ($1, $2, $3, $4, upper($5), $6, $7, $8, $9, $10, $11, $12, $13)`,
        [c.id, c.workspaceId, exp, c.nombre, c.codigo, c.estado ?? (publicada ? 'activa' : 'borrador'), publicada ? new Date().toISOString() : null,
          c.minutosApartado, c.precioPersona, c.precioPreventaPersona ?? null, c.abonoPersona ?? null, c.permitePagoTotal ?? true, c.diasSaldoAntes ?? 1],
      )
    },
    async agregarFuncion(f) {
      const ws = (await pg.query<{ w: string }>(`select workspace_id as w from funcion_campanas where id = $1`, [f.campanaId])).rows[0].w
      await pg.query(
        `insert into funcion_funciones (id, workspace_id, campana_id, inicia_at, capacidad, cupo_asistente, estado, cierra_venta_at,
           es_preventa, preventa_hasta, precio_persona, precio_preventa_persona, abono_persona, permite_pago_total, archivada_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $15, $10, $11, $12, $13, $14)`,
        [f.id, ws, f.campanaId, f.iniciaAt, f.capacidad, f.cupoAsistente ?? f.capacidad, f.estado ?? 'activa', f.cierraVentaAt ?? null,
          f.esPreventa ?? false, f.precioPersona ?? null, f.precioPreventaPersona ?? null, f.abonoPersona ?? null, f.permitePagoTotal ?? null,
          f.archivada ? new Date().toISOString() : null, f.preventaHasta ?? null],
      )
    },
    async apartarEquipo(funcionId, personas) {
      const perfil = hex('d')
      await pg.query(`insert into profiles values ($1, $2, 'operator')`, [perfil, ws])
      await pg.exec(`select set_config('prueba.uid', '${perfil}', false); set role authenticated`)
      try {
        await pg.query(`select funcion_apartar($1, $2, $3, '{}'::jsonb, $4, 'equipo')`, [ws, funcionId, personas, `eq-${hex('a')}`])
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
    async asociarAnuncio(campanaId, adId) {
      await pg.query(`insert into funcion_campana_anuncios (workspace_id, campana_id, ad_id) values ($1, $2, $3)`, [ws, campanaId, adId])
    },
    async solicitudDe(rid) {
      return (await pg.query<{ s: string | null }>(`select solicitud_cliente as s from funcion_reservas where id = $1`, [rid])).rows[0]?.s ?? null
    },
    async aprobar(pagoId, referencia) {
      const monto = (await pg.query<{ m: string }>(`select monto_esperado as m from funcion_pagos where id = $1`, [pagoId])).rows[0].m
      const r = await clientePGlite(pg).rpc('funcion_registrar_pago', { p_workspace_id: ws, p_referencia: referencia, p_estado: 'aprobado', p_monto_recibido: Number(monto) })
      if (r.error) throw new Error(r.error.message)
    },
    async cambiarPlazo(rid, dias) {
      await pg.query(`update funcion_reservas set dias_saldo_antes = $2 where id = $1`, [rid, dias])
    },
  }
}

const manana = (h = 0) => new Date(Date.now() + 24 * HORA + h * HORA).toISOString()

function propuesta(l: LlaveConversacion, funcionId: string, personas: number, extra: Partial<PropuestaApartado> = {}): PropuestaApartado {
  return {
    llave: l, canal: 'instagram', funcionId, personas, nombre: 'Cliente', documento: null, telefono: null,
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
  await pg.exec(leer('supabase/migrations/20261026220000_funciones_puerta_cerrada.sql'))
  await pg.exec(leer('supabase/migrations/20261026210000_funciones_saldo_plazo_cero.sql'))
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

  it('consultar_cupo devuelve un estado y la tarifa, sin números; apartar no sobrevende el cupo del asistente', async () => {
    const c = await campana()
    const f = await funcion(c, { capacidad: 7, cupoAsistente: 5 })
    const c0 = await consultarCupo(b.puerto, b.ws, f, 5)
    expect(c0.ok && Object.keys(c0.cupo).sort()).toEqual(['alternativas', 'campana_codigo', 'estado', 'funcion_id', 'inicia_at', 'inicia_texto', 'tarifa'])
    expect(c0.ok && [c0.cupo.estado, c0.cupo.tarifa.precio_persona, c0.cupo.alternativas]).toEqual(['alcanza', 180_000, []])
    const c6 = await consultarCupo(b.puerto, b.ws, f, 6)
    expect(c6.ok && c6.cupo.estado).toBe('llena_para_asistente')
    const c8 = await consultarCupo(b.puerto, b.ws, f, 8)
    expect(c8.ok && c8.cupo.estado).toBe('llena')

    const a = await apartar(b.puerto, propuesta(await autorizada(), f, 3))
    expect(a.ok && [a.estado, a.repetida, a.montoTotal, a.montoReserva, a.permitePagoTotal, a.campanaId]).toEqual(['apartada', false, 540_000, 300_000, true, c.id])
    expect(await apartar(b.puerto, propuesta(await autorizada(), f, 3))).toMatchObject({ ok: false, error: 'sin_cupo', estado: 'llena_para_asistente' })
    expect((await apartar(b.puerto, propuesta(await autorizada(), f, 2))).ok).toBe(true)
    const c1 = await consultarCupo(b.puerto, b.ws, f, 1)
    expect(c1.ok && c1.cupo.estado).toBe('llena_para_asistente')
  })

  it('lo que agrega el equipo le resta al asistente', async () => {
    const f = await funcion(await campana(), { capacidad: 10, cupoAsistente: 6 })
    await b.apartarEquipo(f, 4)
    const c2 = await consultarCupo(b.puerto, b.ws, f, 2)
    expect(c2.ok && c2.cupo.estado).toBe('alcanza')
    const c3 = await consultarCupo(b.puerto, b.ws, f, 3)
    expect(c3.ok && c3.cupo.estado).toBe('llena_para_asistente')
    expect(await apartar(b.puerto, propuesta(await autorizada(), f, 3))).toMatchObject({ ok: false, error: 'sin_cupo' })
  })

  it('el abono y la preventa: el monto lo calcula ONE', async () => {
    const c = await campana({ precioPreventaPersona: 150_000 })
    const f = await funcion(c, { esPreventa: true })
    const t = await consultarCupo(b.puerto, b.ws, f)
    expect(t.ok && t.cupo.tarifa).toEqual({ tarifa: 'preventa', precio_persona: 150_000, precio_completo_persona: 180_000, preventa_hasta: null, abono_persona: 100_000, permite_pago_total: true })
    const a = await apartar(b.puerto, propuesta(await autorizada(), f, 2))
    expect(a.ok && [a.tarifa, a.precioUnitario, a.montoTotal, a.montoReserva, a.permitePagoTotal]).toEqual(['preventa', 150_000, 300_000, 200_000, true])
  })

  it('P4: la preventa rige hasta su fecha de fin (hoy inclusive); vencida, rige el regular con el interruptor encendido', async () => {
    const c = await campana({ precioPreventaPersona: 150_000 })
    const hoy = diaBogota(Date.now())
    const ayer = diaBogota(Date.now() - 86_400_000)
    const vigente = await funcion(c, { esPreventa: true, preventaHasta: hoy })
    const vencida = await funcion(c, { esPreventa: true, preventaHasta: ayer })
    const v = await consultarCupo(b.puerto, b.ws, vigente)
    expect(v.ok && v.cupo.tarifa).toEqual({ tarifa: 'preventa', precio_persona: 150_000, precio_completo_persona: 180_000, preventa_hasta: hoy, abono_persona: 100_000, permite_pago_total: true })
    const x = await consultarCupo(b.puerto, b.ws, vencida)
    expect(x.ok && x.cupo.tarifa).toEqual({ tarifa: 'completa', precio_persona: 180_000, precio_completo_persona: null, preventa_hasta: null, abono_persona: 100_000, permite_pago_total: true })
    const a = await apartar(b.puerto, propuesta(await autorizada(), vencida, 1))
    expect(a.ok && [a.tarifa, a.precioUnitario]).toEqual(['completa', 180_000])
  })

  it('modalidad_no_permitida (al apartar sin ninguna forma de pago; al pagar, la que la función no tiene) y sin_precio', async () => {
    const ninguna = await funcion(await campana({ abonoPersona: null, permitePagoTotal: false }))
    expect(await apartar(b.puerto, propuesta(await autorizada(), ninguna, 1))).toEqual({ ok: false, error: 'modalidad_no_permitida' })
    const sinAbono = await funcion(await campana({ abonoPersona: null }))
    const a = await apartar(b.puerto, propuesta(await autorizada(), sinAbono, 1))
    if (!a.ok) throw new Error(a.error)
    expect([a.montoReserva, a.permitePagoTotal]).toEqual([null, true])
    const doble = pasarelaEnMemoria()
    expect(await generarLinkPago(b.puerto, doble.pasarela, b.ws, [a.reservaId], 'abono', 'x')).toEqual({ ok: false, error: 'modalidad_no_permitida' })
    expect(doble.pedidos()).toEqual([])
    expect((await generarLinkPago(b.puerto, doble.pasarela, b.ws, [a.reservaId], 'total', 'x')).ok).toBe(true)
    const sinPrecio = await funcion(await campana({ precioPersona: null, abonoPersona: null }))
    expect(await apartar(b.puerto, propuesta(await autorizada(), sinPrecio, 1))).toEqual({ ok: false, error: 'sin_precio' })
  })

  it('la misma huella dos veces es la misma reserva y la misma foto', async () => {
    const f = await funcion(await campana(), { capacidad: 4 })
    const p = propuesta(await autorizada(), f, 3)
    const a = await apartar(b.puerto, p)
    const r = await apartar(b.puerto, p)
    expect(a.ok && r.ok && r.reservaId === a.reservaId && r.repetida && r.montoTotal === a.montoTotal).toBe(true)
    // Capacidad 4 y cupo del asistente 4, con 3 apartadas: 2 más no caben ni en la capacidad.
    const c = await consultarCupo(b.puerto, b.ws, f, 2)
    expect(c.ok && c.cupo.estado).toBe('llena')
    const c1 = await consultarCupo(b.puerto, b.ws, f, 1)
    expect(c1.ok && c1.cupo.estado).toBe('alcanza')
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
    const co = await consultarCupo(b.puerto, b.ws, oculta)
    expect(co.ok && co.cupo.estado).toBe('no_disponible')
    expect(await apartar(b.puerto, propuesta(l, oculta, 1))).toEqual({ ok: false, error: 'funcion_no_existe' })
    const pausada = await funcion(await campana({ estado: 'pausada' }))
    expect(await apartar(b.puerto, propuesta(l, pausada, 1))).toEqual({ ok: false, error: 'campana_no_activa' })
    const activa = await campana()
    const fPausada = await funcion(activa, { estado: 'pausada' })
    expect(await apartar(b.puerto, propuesta(l, fPausada, 1))).toEqual({ ok: false, error: 'funcion_no_activa' })
    const ventaCerrada = await funcion(activa, { iniciaAt: manana(1), cierraVentaAt: new Date(Date.now() - HORA).toISOString() })
    expect(await apartar(b.puerto, propuesta(l, ventaCerrada, 1))).toEqual({ ok: false, error: 'venta_cerrada' })
    const archivada = await funcion(activa, { iniciaAt: manana(2), archivada: true })
    const ca = await consultarCupo(b.puerto, b.ws, archivada)
    expect(ca.ok && ca.cupo.estado).toBe('no_disponible')
    expect(await consultarCupo(b.puerto, '00000000-0000-4000-8000-0000000dffff', archivada)).toEqual({ ok: false, error: 'funcion_no_existe' })
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

  it('el resumen de pago lo arma ONE: las dos cifras (total y solo la reserva) por reserva y en la suma, sin las vencidas', async () => {
    const l = await autorizada()
    const a = await apartar(b.puerto, propuesta(l, await funcion(await campana()), 2))
    const c = await apartar(b.puerto, propuesta(l, await funcion(await campana({ precioPersona: 150_000 }), { iniciaAt: manana(5) }), 2))
    if (!a.ok || !c.ok) throw new Error('no apartó')
    const r = await resumenPago(b.puerto, b.ws, [a.reservaId, c.reservaId])
    expect(r.ok && [r.dato.total, r.dato.solo_reserva, r.dato.modalidades, r.dato.vencidas]).toEqual([360_000 + 300_000, 200_000 + 200_000, ['total', 'abono'], []])
    expect(r.ok && r.dato.reservas.map((x) => [x.monto_total, x.monto_reserva, x.permite_pago_total])).toEqual([[360_000, 200_000, true], [300_000, 200_000, true]])
    await b.vencer(c.reservaId)
    const v = await resumenPago(b.puerto, b.ws, [a.reservaId, c.reservaId])
    expect(v.ok && [v.dato.total, v.dato.solo_reserva, v.dato.vencidas]).toEqual([360_000, 200_000, [c.reservaId]])
    // Una reserva sin pago total: la suma no ofrece el total (no se pregunta).
    const sinTotal = await apartar(b.puerto, propuesta(l, await funcion(await campana({ permitePagoTotal: false }), { iniciaAt: manana(7) }), 1))
    if (!sinTotal.ok) throw new Error(sinTotal.error)
    const st = await resumenPago(b.puerto, b.ws, [a.reservaId, sinTotal.reservaId])
    expect(st.ok && [st.dato.modalidades, st.dato.solo_reserva]).toEqual([['abono'], 300_000])
    const otra = await apartar(b.puerto, propuesta(await autorizada(), await funcion(await campana()), 1))
    if (!otra.ok) throw new Error(otra.error)
    expect(await resumenPago(b.puerto, b.ws, [a.reservaId, otra.reservaId])).toEqual({ ok: false, error: 'distinta_conversacion' })
  })

  it('generar_link_pago: un link de monto fijo que vence con sus apartados realineados; no dos veces sobre lo mismo', async () => {
    const l = await autorizada()
    const a = await apartar(b.puerto, propuesta(l, await funcion(await campana()), 2))
    const c = await apartar(b.puerto, propuesta(l, await funcion(await campana(), { iniciaAt: manana(6) }), 1))
    if (!a.ok || !c.ok) throw new Error('no apartó')
    const doble = pasarelaEnMemoria()
    // P14b: el cliente eligió «solo la reserva»: vale para las dos reservas del link.
    const link = await generarLinkPago(b.puerto, doble.pasarela, b.ws, [a.reservaId, c.reservaId], 'abono', 'Sabor: 2 funciones')
    if (!link.ok) throw new Error(link.error)
    expect(link.dato.monto).toBe(200_000 + 100_000)
    const [pedido] = doble.pedidos()
    expect(pedido.cuerpo).toEqual({
      amount_type: 'CLOSE', amount: { currency: 'COP', total_amount: 300_000 }, description: 'Sabor: 2 funciones',
      expiration_date: Date.parse(link.dato.venceAt),
    })
    expect(Date.parse(link.dato.venceAt) - Date.now()).toBeGreaterThan(25 * 60_000)
    // Las dos ya están en un pago pendiente.
    expect(await generarLinkPago(b.puerto, doble.pasarela, b.ws, [c.reservaId], 'total', 'x')).toEqual({ ok: false, error: 'reserva_en_otro_pago' })
  })

  it('generar_link_pago con un apartado vencido: apartado_vencido, y la pasarela ni se llama', async () => {
    const l = await autorizada()
    const a = await apartar(b.puerto, propuesta(l, await funcion(await campana()), 1))
    if (!a.ok) throw new Error(a.error)
    await b.vencer(a.reservaId)
    const doble = pasarelaEnMemoria()
    expect(await generarLinkPago(b.puerto, doble.pasarela, b.ws, [a.reservaId], 'total', 'x')).toEqual({ ok: false, error: 'apartado_vencido' })
    expect(doble.pedidos()).toEqual([])
  })

  it('el saldo (P14): pagar solo la reserva deja saldo; su link es por el saldo exacto, vence en el plazo y se puede generar de nuevo', async () => {
    const l = await autorizada()
    const iniciaAt = manana(8)
    const a = await apartar(b.puerto, propuesta(l, await funcion(await campana(), { iniciaAt }), 2))
    if (!a.ok) throw new Error(a.error)
    const doble = pasarelaEnMemoria()
    // Sin pagar no hay saldo que cobrar.
    expect(await generarLinkSaldo(b.puerto, doble.pasarela, b.ws, [a.reservaId], 'x')).toEqual({ ok: false, error: 'reserva_inactiva' })
    const inicial = await generarLinkPago(b.puerto, doble.pasarela, b.ws, [a.reservaId], 'abono', 'Reserva')
    if (!inicial.ok) throw new Error(inicial.error)
    await b.aprobar(inicial.dato.pagoId, inicial.dato.referencia)
    const s = await saldoReserva(b.puerto, a.reservaId)
    expect(s.ok && [s.dato.monto_total, s.dato.pagado, s.dato.saldo, s.dato.estado, s.dato.modalidad, s.dato.link]).toEqual([360_000, 200_000, 160_000, 'pendiente', 'abono', null])
    expect(s.ok && Date.parse(s.dato.plazo_at)).toBe(Date.parse(plazoSaldo(iniciaAt, 1)))
    const l1 = await generarLinkSaldo(b.puerto, doble.pasarela, b.ws, [a.reservaId], 'Saldo')
    if (!l1.ok) throw new Error(l1.error)
    expect([l1.dato.monto, Date.parse(l1.dato.venceAt)]).toEqual([160_000, Date.parse(plazoSaldo(iniciaAt, 1))])
    expect(doble.pedidos().at(-1)?.cuerpo.amount.total_amount).toBe(160_000)
    // Un link nuevo deja vencido al anterior: el vivo es el nuevo.
    const l2 = await generarLinkSaldo(b.puerto, doble.pasarela, b.ws, [a.reservaId], 'Saldo')
    if (!l2.ok) throw new Error(l2.error)
    const vivo = await saldoReserva(b.puerto, a.reservaId)
    expect(vivo.ok && vivo.dato.link?.pago_id).toBe(l2.dato.pagoId)
    await b.aprobar(l2.dato.pagoId, l2.dato.referencia)
    const pagado = await saldoReserva(b.puerto, a.reservaId)
    expect(pagado.ok && [pagado.dato.pagado, pagado.dato.saldo, pagado.dato.estado, pagado.dato.link]).toEqual([360_000, 0, 'pagado', null])
    expect(await generarLinkSaldo(b.puerto, doble.pasarela, b.ws, [a.reservaId], 'x')).toEqual({ ok: false, error: 'sin_saldo' })
  })

  it('el saldo (P14): quien pagó el total no tiene saldo; pasado el plazo el asistente no genera link', async () => {
    const l = await autorizada()
    const f = await funcion(await campana(), { iniciaAt: manana(9) })
    const t = await apartar(b.puerto, propuesta(l, f, 1))
    const r = await apartar(b.puerto, propuesta(await autorizada(), f, 1))
    if (!t.ok || !r.ok) throw new Error('no apartó')
    const doble = pasarelaEnMemoria()
    const pt = await generarLinkPago(b.puerto, doble.pasarela, b.ws, [t.reservaId], 'total', 'x')
    const pr = await generarLinkPago(b.puerto, doble.pasarela, b.ws, [r.reservaId], 'abono', 'x')
    if (!pt.ok || !pr.ok) throw new Error('sin link')
    await b.aprobar(pt.dato.pagoId, pt.dato.referencia)
    await b.aprobar(pr.dato.pagoId, pr.dato.referencia)
    const st = await saldoReserva(b.puerto, t.reservaId)
    expect(st.ok && [st.dato.saldo, st.dato.estado]).toEqual([0, 'sin_saldo'])
    expect(await generarLinkSaldo(b.puerto, doble.pasarela, b.ws, [t.reservaId], 'x')).toEqual({ ok: false, error: 'sin_saldo' })
    await b.cambiarPlazo(r.reservaId, 30)
    const sv = await saldoReserva(b.puerto, r.reservaId)
    expect(sv.ok && [sv.dato.saldo, sv.dato.estado]).toEqual([80_000, 'vencido'])
    expect(await generarLinkSaldo(b.puerto, doble.pasarela, b.ws, [r.reservaId], 'x')).toEqual({ ok: false, error: 'saldo_vencido' })
  })

  it('el saldo con plazo 0 (26-oct): el plazo y el link valen hasta que empieza la función', async () => {
    const l = await autorizada()
    const iniciaAt = manana(9)
    const r = await apartar(b.puerto, propuesta(l, await funcion(await campana(), { iniciaAt }), 1))
    if (!r.ok) throw new Error(r.error)
    const doble = pasarelaEnMemoria()
    const pr = await generarLinkPago(b.puerto, doble.pasarela, b.ws, [r.reservaId], 'abono', 'x')
    if (!pr.ok) throw new Error(pr.error)
    await b.aprobar(pr.dato.pagoId, pr.dato.referencia)
    await b.cambiarPlazo(r.reservaId, 0)
    expect(plazoSaldo(iniciaAt, 0)).toBe(new Date(iniciaAt).toISOString())
    const s = await saldoReserva(b.puerto, r.reservaId)
    expect(s.ok && [s.dato.saldo, s.dato.estado, Date.parse(s.dato.plazo_at)]).toEqual([80_000, 'pendiente', Date.parse(iniciaAt)])
    const ls = await generarLinkSaldo(b.puerto, doble.pasarela, b.ws, [r.reservaId], 'Saldo')
    if (!ls.ok) throw new Error(ls.error)
    expect([ls.dato.monto, Date.parse(ls.dato.venceAt)]).toEqual([80_000, Date.parse(iniciaAt)])
  })

  it('P10: la campaña de la conversación, por anuncio o por código; sin publicar o sin dato, null', async () => {
    const c = await campana({ codigo: `ad-${++n}` })
    await b.asociarAnuncio(c.id, `1202087654${n}`)
    const porAnuncio = await campanaDeLaConversacion(b.puerto, b.ws, { adId: `1202087654${n}` })
    expect(porAnuncio.ok && porAnuncio.dato).toMatchObject({ campana_id: c.id, activa: true })
    const porCodigo = await campanaDeLaConversacion(b.puerto, b.ws, { adId: 'otro-anuncio', codigo: c.codigo.toLowerCase() })
    expect(porCodigo.ok && porCodigo.dato?.campana_id).toBe(c.id)
    const borrador = await campana({ publicada: false })
    expect(await campanaDeLaConversacion(b.puerto, b.ws, { codigo: borrador.codigo })).toEqual({ ok: true, dato: null })
    expect(await campanaDeLaConversacion(b.puerto, b.ws, {})).toEqual({ ok: true, dato: null })
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

describe('alternativas: el doble da lo mismo que la base', () => {
  /** El mismo escenario en un banco: una función llena para el asistente y candidatas con etiqueta. */
  async function escenario(b: Banco) {
    const base = Date.now() + 48 * HORA
    const en = (h: number) => new Date(base + h * HORA).toISOString()
    const ids: Record<string, string> = {}
    const camp = async (nombre: string, experiencia: string, o: Partial<CampanaEnMemoria> = {}) => {
      const c: CampanaEnMemoria = { id: hex('c'), workspaceId: b.ws, codigo: `A-${++n}`, nombre, experiencia, minutosApartado: 30, precioPersona: 180_000, abonoPersona: 100_000, ...o }
      await b.agregarCampana(c)
      return c
    }
    const fun = async (etiqueta: string, c: CampanaEnMemoria, h: number, o: Partial<FuncionEnMemoria> = {}) => {
      ids[etiqueta] = hex('f')
      await b.agregarFuncion({ id: ids[etiqueta], campanaId: c.id, iniciaAt: en(h), capacidad: 10, ...o })
    }
    const hp = await camp('HP octubre', 'Harry Potter')
    await fun('pedida', hp, 0, { capacidad: 4, cupoAsistente: 2 })
    await fun('+2h', hp, 2)
    await fun('-3h', hp, -3)
    await fun('+2d', hp, 48)
    await fun('pausada', hp, 1, { estado: 'pausada' })
    await fun('archivada', hp, 0.5, { archivada: true })
    await fun('no-caben', hp, 1.5, { capacidad: 1 })
    const jack = await camp('Jack noviembre', 'Jack')
    await fun('jack-1', jack, 24)
    await fun('jack-2', jack, 5)
    const oculta = await camp('Borrador', 'Ratatouille', { publicada: false })
    await fun('oculta', oculta, 3)
    const misma = await camp('HP otra tanda', 'Harry Potter')
    await fun('misma-experiencia', misma, 4)
    await b.apartarEquipo(ids.pedida, 2)
    const nombre = (id: string) => Object.entries(ids).find(([, v]) => v === id)?.[0] ?? id
    return { ids, nombre }
  }

  it('mismo estado, mismas alternativas en el mismo orden, y lo mismo al fallar apartar', async () => {
    const salidas: unknown[] = []
    for (const crear of [bancoMemoria, bancoBase]) {
      const ws = `00000000-0000-4000-8000-0000000e${(++espacios).toString(16).padStart(4, '0')}`
      await pg.query(`insert into workspaces (id, slug) values ($1, $2)`, [ws, `alt-${espacios}`])
      const b = crear(ws)
      const { ids, nombre } = await escenario(b)
      const c = await consultarCupo(b.puerto, ws, ids.pedida, 2)
      if (!c.ok) throw new Error(c.error)
      const l = { workspaceId: ws, cuentaId: 1, conversacionId: ++conv }
      await b.autorizar(l, 'si')
      const a = await apartar(b.puerto, propuesta(l, ids.pedida, 2))
      if (a.ok) throw new Error('apartó una llena')
      const ver = (alts: typeof c.cupo.alternativas) => alts.map((x) => [nombre(x.funcion_id), x.grupo, x.alcanza, x.inicia_texto, x.tarifa.precio_persona])
      salidas.push({ estado: c.cupo.estado, alternativas: ver(c.cupo.alternativas), apartar: [a.error, a.estado, ver(a.alternativas ?? [])] })
      // Sin las tres de la misma campaña, entran las de otras experiencias por fecha (nunca otra tanda de la misma).
      for (const x of ['+2h', '-3h', '+2d']) await b.apartarEquipo(ids[x], 10)
      const d = await consultarCupo(b.puerto, ws, ids.pedida, 2)
      if (!d.ok) throw new Error(d.error)
      salidas.push(ver(d.cupo.alternativas))
    }
    const [memEstado, memSin, baseEstado, baseSin] = salidas
    expect(memEstado).toEqual(baseEstado)
    expect(memSin).toEqual(baseSin)
    expect((memEstado as { estado: string }).estado).toBe('llena_para_asistente')
    expect((memEstado as { alternativas: unknown[][] }).alternativas.map((x) => x.slice(0, 2))).toEqual([['+2h', 'misma_campana'], ['-3h', 'misma_campana'], ['+2d', 'misma_campana']])
    expect((memSin as unknown[][]).map((x) => x.slice(0, 2))).toEqual([['jack-2', 'otra_experiencia'], ['jack-1', 'otra_experiencia']])
  })
})

describe('ningún servicio del asistente devuelve un número de cupo', () => {
  it('ni consultar_cupo, ni ver_funciones_disponibles, ni campanas_activas, ni apartar al fallar', async () => {
    for (const crear of [bancoMemoria, bancoBase]) {
      const ws = `00000000-0000-4000-8000-0000000e${(++espacios).toString(16).padStart(4, '0')}`
      await pg.query(`insert into workspaces (id, slug) values ($1, $2)`, [ws, `num-${espacios}`])
      const b = crear(ws)
      const c: CampanaEnMemoria = { id: hex('c'), workspaceId: ws, codigo: `N-${++n}`, nombre: 'HP', experiencia: 'HP', minutosApartado: 30, precioPersona: 1000, abonoPersona: 500 }
      await b.agregarCampana(c)
      const f = hex('f')
      await b.agregarFuncion({ id: f, campanaId: c.id, iniciaAt: manana(), capacidad: 4, cupoAsistente: 2 })
      await b.agregarFuncion({ id: hex('f'), campanaId: c.id, iniciaAt: manana(3), capacidad: 4 })
      await b.apartarEquipo(f, 2)
      const l = { workspaceId: ws, cuentaId: 1, conversacionId: ++conv }
      await b.autorizar(l, 'si')
      const cupo = await consultarCupo(b.puerto, ws, f, 1)
      const disponibles = await verFuncionesDisponibles(b.puerto, ws)
      const activas = await campanasActivas(b.puerto, ws)
      const fallido = await apartar(b.puerto, propuesta(l, f, 1))
      if (!cupo.ok || !disponibles.ok || !activas.ok || fallido.ok) throw new Error('el escenario no salió como se esperaba')
      // Lo que devuelve cada servicio (sin el sobre `{ ok, cupo }` / `{ ok, dato }`).
      const salidas = [cupo.cupo, disponibles.dato, activas.dato, { estado: fallido.estado, alternativas: fallido.alternativas }]
      const claves: string[] = []
      const recorrer = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(recorrer)
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { claves.push(k); recorrer(x) }
      }
      salidas.forEach(recorrer)
      expect(claves.length).toBeGreaterThan(10)
      expect(claves.filter((k) => /cupo|libre|ocupad|capacidad|puesto/i.test(k))).toEqual([])
    }
  })
})

describe('pasarela', () => {
  it('expiration_date en milisegundos (SIN VERIFICAR en el sandbox): 13 dígitos, como los ejemplos de Bold', () => {
    const v = expiracionBold('2026-10-24T18:30:00.000Z')
    expect(v).toBe(Date.parse('2026-10-24T18:30:00.000Z'))
    expect(String(v)).toHaveLength(13)
    expect(() => expiracionBold('mañana')).toThrow()
  })

  it('el cuerpo de Bold va con monto fijo y entero', () => {
    expect(cuerpoLinkBold({ pagoId: 'p', monto: 380_000, venceAt: '2026-10-24T18:30:00Z', descripcion: 'x' }).amount_type).toBe('CLOSE')
    expect(() => cuerpoLinkBold({ pagoId: 'p', monto: 1.5, venceAt: '2026-10-24T18:30:00Z', descripcion: 'x' })).toThrow()
  })

  it('el adaptador de Bold no llama a nadie por su cuenta: usa el `enviar` que le den', async () => {
    const enviados: unknown[] = []
    const bold = pasarelaBold(async (cuerpo) => {
      enviados.push(cuerpo)
      return { referencia: 'LNK_X', url: 'https://checkout.ejemplo/LNK_X' }
    })
    expect(await bold.crearLink({ pagoId: 'p', monto: 100_000, venceAt: '2026-10-24T18:30:00Z', descripcion: 'x' })).toEqual({
      ok: true, referencia: 'LNK_X', url: 'https://checkout.ejemplo/LNK_X',
    })
    expect(enviados).toHaveLength(1)
    const caida = pasarelaBold(async () => { throw new Error('503') })
    expect((await caida.crearLink({ pagoId: 'p', monto: 100_000, venceAt: '2026-10-24T18:30:00Z', descripcion: 'x' })).ok).toBe(false)
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

  it('el plazo del saldo en TS es el de la base, también de noche y cerca de la medianoche', async () => {
    const casos: Array<[string, number]> = [
      ['2026-10-31T13:00:00-05:00', 1], ['2026-10-31T22:00:00-05:00', 1], ['2026-10-31T00:30:00-05:00', 1],
      ['2026-11-01T23:59:00-05:00', 3], ['2026-12-01T10:00:00-05:00', 30],
    ]
    for (const [inicia, dias] of casos) {
      const base = (await pg.query<{ p: string }>(`select funcion_plazo_saldo($1::timestamptz, $2) as p`, [inicia, dias])).rows[0].p
      expect([inicia, dias, plazoSaldo(inicia, dias)]).toEqual([inicia, dias, new Date(base).toISOString()])
    }
    expect(plazoSaldo('2026-10-31T13:00:00-05:00', 1)).toBe('2026-10-31T05:00:00.000Z')
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
    expect(await generarLinkPago(m.puerto, pasarelaEnMemoria().pasarela, l.workspaceId, [hex('a')], 'cuotas' as never, 'x')).toEqual({ ok: false, error: 'modalidad_no_permitida' })
    expect(await saldoReserva(m.puerto, 'no-es-uuid')).toEqual({ ok: false, error: 'reserva_no_existe' })
    expect(await apartar(m.puerto, propuesta(l, hex('f'), 1, { atribucion: { fuente: 'equipo' as never, ref: null } }))).toEqual({ ok: false, error: 'datos_invalidos' })
    expect(await apartar(m.puerto, propuesta(l, hex('f'), 1, { huellaPropuesta: ' ' }))).toEqual({ ok: false, error: 'datos_invalidos' })
  })
})
