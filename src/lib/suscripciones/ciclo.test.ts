import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  correrCicloSuscripcion,
  facturaOmitidaFase1,
  type CicloDeps,
  type PlanDeSuscripcion,
  type SuscripcionRow,
} from './ciclo'
import { POLITICA_FASE_1, type PoliticaSuspension } from './estado'
import { pasarelaManual } from './pasarela/manual'
import type { PasarelaAdapter, ResultadoCargo, SolicitudCargo } from './pasarela/adapter'

// ── Doble de Supabase: tres tablas en memoria, con insert/update de verdad ─────
// Lo que se quiere medir es qué queda ESCRITO tras cada corrida, no qué se llamó.
// Por eso el doble aplica los cambios en arreglos y las pruebas leen los arreglos.

type Fila = Record<string, unknown>
type Tablas = { cobros: Fila[]; suscripciones: Fila[]; workspaces: Fila[] }
type Registro = { tabla: string; op: 'select' | 'insert' | 'update'; payload?: Fila }

function fakeDb(tablas: Tablas, opciones: { errorAlLeerCobros?: string } = {}) {
  const registro: Registro[] = []
  let contador = 0

  function from(tabla: keyof Tablas) {
    const estado: { op: Registro['op']; payload: Fila | null; filtros: [string, unknown][] } = {
      op: 'select', payload: null, filtros: [],
    }
    const coincide = (f: Fila) => estado.filtros.every(([c, v]) => f[c] === v)

    function ejecutar() {
      registro.push({ tabla, op: estado.op, payload: estado.payload ?? undefined })
      const filas = tablas[tabla]
      if (estado.op === 'select') {
        if (tabla === 'cobros' && opciones.errorAlLeerCobros) {
          return { data: null, error: { message: opciones.errorAlLeerCobros } }
        }
        const encontradas = filas.filter(coincide)
        return { data: encontradas[0] ?? null, error: null }
      }
      if (estado.op === 'insert') {
        const p = estado.payload!
        if (tabla === 'cobros') {
          const dup = filas.find((f) => f.plan_cobro_id === p.plan_cobro_id && f.numero_cuota === p.numero_cuota)
          if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        const fila = { id: `${tabla}-${++contador}`, ...p }
        filas.push(fila)
        return { data: { id: fila.id }, error: null }
      }
      for (const f of filas) if (coincide(f)) Object.assign(f, estado.payload)
      return { data: null, error: null }
    }

    const builder = {
      select: () => builder,
      insert: (p: Fila) => { estado.op = 'insert'; estado.payload = p; return builder },
      update: (p: Fila) => { estado.op = 'update'; estado.payload = p; return builder },
      eq: (c: string, v: unknown) => { estado.filtros.push([c, v]); return builder },
      maybeSingle: async () => ejecutar(),
      single: async () => ejecutar(),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve().then(ejecutar).then(res, rej),
    }
    return builder
  }

  return { db: { from } as unknown as SupabaseClient, registro, tablas }
}

// ── Fixtures: el plan de Termotech medido en produccion ($150.000 x 6 desde 2026-09-05) ──

const WS_CLIENTE = 'ws-termotech'
const WS_COBRADOR = 'ws-metrik'

const plan: PlanDeSuscripcion = {
  id: 'plan-termotech',
  workspace_id: WS_COBRADOR,
  negocio_id: 'neg-termotech',
  monto: 150_000,
  frecuencia: 'mensual',
  fecha_inicio: '2026-09-05',
  total_cuotas: 6,
  auto_renovar: false,
  activo: true,
}

function suscripcion(extra: Partial<SuscripcionRow> = {}): SuscripcionRow {
  return {
    id: '0f8e2f4a-1c2b-4d5e-9f00-112233445566',
    workspace_id: WS_CLIENTE,
    plan_cobro_id: plan.id,
    pasarela: 'manual',
    medio_pago: null,
    estado: 'activa',
    proximo_cobro: '2026-09-05',
    intentos_fallidos: 0,
    ultimo_error: null,
    ...extra,
  }
}

function tablasBase(sus: SuscripcionRow, cobros: Fila[] = []): Tablas {
  return {
    cobros,
    suscripciones: [{ ...sus }],
    workspaces: [{ id: WS_CLIENTE, subscription_status: 'trial', subscription_expires_at: null }],
  }
}

function deps(db: SupabaseClient, extra: Partial<CicloDeps> = {}): CicloDeps {
  return { db, adapter: pasarelaManual, facturar: facturaOmitidaFase1, politica: POLITICA_FASE_1, hoy: '2026-09-05', ...extra }
}

const escrituras = (r: Registro[], tabla: string) => r.filter((x) => x.tabla === tabla && x.op !== 'select')

// ── Pasarela manual, Fase 1 ──────────────────────────────────────────────────

describe('ciclo con pasarela manual (Fase 1)', () => {
  it('deja el cobro programado de la cuota igual que el paso 1 del cron, y no toca el estado', async () => {
    const sus = suscripcion()
    const { db, registro, tablas } = fakeDb(tablasBase(sus))

    const r = await correrCicloSuscripcion(sus, plan, deps(db))

    expect(r).toMatchObject({ accion: 'cargo_pendiente', numeroCuota: 1, cobroCreado: true, estadoAntes: 'activa', estadoDespues: 'activa' })
    expect(tablas.cobros).toHaveLength(1)
    expect(tablas.cobros[0]).toMatchObject({
      workspace_id: WS_COBRADOR,          // el cobro vive donde vive el negocio: en el cobrador
      negocio_id: 'neg-termotech',
      plan_cobro_id: plan.id,
      numero_cuota: 1,
      monto: 150_000,
      tipo_cobro: 'programado',
      fecha_esperada: '2026-09-05',
      fecha: null,
      revisado: false,
      notas: 'Cuota 1 de 6',
      retencion: 0,
    })
    // Nada cambió en la suscripción ni en el workspace: cero escrituras ahí.
    expect(escrituras(registro, 'suscripciones')).toHaveLength(0)
    expect(escrituras(registro, 'workspaces')).toHaveLength(0)
    expect(tablas.workspaces[0].subscription_status).toBe('trial')
  })

  it('es idempotente: la segunda corrida no crea ni escribe nada', async () => {
    const sus = suscripcion()
    const { db, registro, tablas } = fakeDb(tablasBase(sus))

    await correrCicloSuscripcion(sus, plan, deps(db))
    const antes = registro.length
    const r2 = await correrCicloSuscripcion(sus, plan, deps(db))

    expect(r2).toMatchObject({ accion: 'cargo_pendiente', cobroCreado: false, cobroId: tablas.cobros[0].id })
    expect(tablas.cobros).toHaveLength(1)
    expect(registro.slice(antes).filter((x) => x.op !== 'select')).toHaveLength(0)
  })

  it('reusa el cobro que el paso 1 del cron ya creó (misma cuota, misma fecha)', async () => {
    const sus = suscripcion()
    const yaCreado = { id: 'cobro-del-cron', plan_cobro_id: plan.id, numero_cuota: 1, fecha: null, external_ref: null, anulado_at: null }
    const { db, tablas } = fakeDb(tablasBase(sus, [yaCreado]))

    const r = await correrCicloSuscripcion(sus, plan, deps(db))

    expect(r).toMatchObject({ accion: 'cargo_pendiente', cobroId: 'cobro-del-cron', cobroCreado: false })
    expect(tablas.cobros).toHaveLength(1)
  })

  it('cuando alguien confirmó el pago a mano, registra el pago, activa y avanza a la cuota siguiente', async () => {
    const sus = suscripcion({ estado: 'trial' })
    const pagado = { id: 'cobro-1', plan_cobro_id: plan.id, numero_cuota: 1, fecha: '2026-09-04', external_ref: null, anulado_at: null }
    const { db, tablas } = fakeDb(tablasBase(sus, [pagado]))

    const r = await correrCicloSuscripcion(sus, plan, deps(db))

    expect(r).toMatchObject({ accion: 'pago_registrado', estadoAntes: 'trial', estadoDespues: 'activa', proximoCobro: '2026-10-05' })
    expect(tablas.suscripciones[0]).toMatchObject({ estado: 'activa', intentos_fallidos: 0, ultimo_error: null, proximo_cobro: '2026-10-05' })
    expect(tablas.suscripciones[0].estado_cambiado_at).toBeTruthy()
    // La proyección que lee el gate del layout.
    expect(tablas.workspaces[0]).toMatchObject({ subscription_status: 'activa', subscription_expires_at: '2026-10-05T05:00:00Z' })
  })

  it('la última cuota pagada deja proximo_cobro en null y lo dice', async () => {
    const sus = suscripcion({ proximo_cobro: '2027-02-05' })
    const pagado = { id: 'cobro-6', plan_cobro_id: plan.id, numero_cuota: 6, fecha: '2027-02-01', external_ref: null, anulado_at: null }
    const { db, tablas } = fakeDb(tablasBase(sus, [pagado]))

    const r = await correrCicloSuscripcion(sus, plan, deps(db, { hoy: '2027-02-05' }))

    expect(r).toMatchObject({ accion: 'pago_registrado', numeroCuota: 6, proximoCobro: null })
    expect(r.detalle).toMatch(/terminó/)
    expect(tablas.suscripciones[0].proximo_cobro).toBeNull()
    expect(tablas.workspaces[0].subscription_expires_at).toBeNull()
  })

  it('vencida la gracia sin plata pasa a pendiente_pago, y con la política de Fase 1 NUNCA a suspendida', async () => {
    const sus = suscripcion()
    const { db, tablas } = fakeDb(tablasBase(sus))

    // hoy = fecha esperada + gracia + 1
    const r = await correrCicloSuscripcion(sus, plan, deps(db, { hoy: '2026-09-09' }))

    expect(r).toMatchObject({ accion: 'cargo_pendiente', estadoAntes: 'activa', estadoDespues: 'pendiente_pago' })
    expect(tablas.suscripciones[0].estado).toBe('pendiente_pago')
    expect(tablas.workspaces[0].subscription_status).toBe('pendiente_pago')

    // Diez días más tarde sigue igual: informa, no cierra la puerta.
    const sus2 = { ...sus, estado: 'pendiente_pago' as const }
    const r2 = await correrCicloSuscripcion(sus2, plan, deps(db, { hoy: '2026-09-19' }))
    expect(r2.estadoDespues).toBe('pendiente_pago')
    expect(tablas.workspaces[0].subscription_status).toBe('pendiente_pago')
  })

  it('dentro de la gracia no pasa nada: el día 3 después del vencimiento todavía es activa', async () => {
    const sus = suscripcion()
    const { db, tablas } = fakeDb(tablasBase(sus))
    const r = await correrCicloSuscripcion(sus, plan, deps(db, { hoy: '2026-09-08' }))
    expect(r.estadoDespues).toBe('activa')
    expect(tablas.suscripciones[0].estado).toBe('activa')
  })

  it('con suspensión automática (decisión de Mauricio, Fase 2) la cuota vencida suspende en la misma corrida', async () => {
    const sus = suscripcion()
    const { db, tablas } = fakeDb(tablasBase(sus))
    const politica: PoliticaSuspension = { diasGracia: 0, maxIntentos: 3, suspenderAutomaticamente: true }

    const r = await correrCicloSuscripcion(sus, plan, deps(db, { hoy: '2026-09-06', politica }))

    expect(r.estadoDespues).toBe('suspendida')
    expect(tablas.workspaces[0].subscription_status).toBe('suspendida')
  })

  it('el pago sobre una suspendida la reactiva (hasta el recibo del pago)', async () => {
    const sus = suscripcion({ estado: 'suspendida', intentos_fallidos: 3 })
    const pagado = { id: 'cobro-1', plan_cobro_id: plan.id, numero_cuota: 1, fecha: '2026-09-20', external_ref: null, anulado_at: null }
    const { db, tablas } = fakeDb(tablasBase(sus, [pagado]))

    const r = await correrCicloSuscripcion(sus, plan, deps(db, { hoy: '2026-09-20' }))

    expect(r).toMatchObject({ accion: 'pago_registrado', estadoDespues: 'activa' })
    expect(tablas.suscripciones[0]).toMatchObject({ estado: 'activa', intentos_fallidos: 0 })
    expect(tablas.workspaces[0].subscription_status).toBe('activa')
  })
})

// ── Cuándo el ciclo se detiene ───────────────────────────────────────────────

describe('ciclo: casos en que no hay nada que cobrar', () => {
  it('plan sin cuotas desde proximo_cobro: no escribe nada', async () => {
    const sus = suscripcion({ proximo_cobro: '2027-03-01' })
    const { db, registro } = fakeDb(tablasBase(sus))
    const r = await correrCicloSuscripcion(sus, plan, deps(db, { hoy: '2027-03-01' }))
    expect(r.accion).toBe('plan_terminado')
    expect(registro).toHaveLength(0)
  })

  it('sin proximo_cobro: no escribe nada', async () => {
    const sus = suscripcion({ proximo_cobro: null })
    const { db, registro } = fakeDb(tablasBase(sus))
    const r = await correrCicloSuscripcion(sus, plan, deps(db))
    expect(r.accion).toBe('plan_terminado')
    expect(registro).toHaveLength(0)
  })

  it('una cuota anulada no se cobra ni se recrea: se reporta y queda escrito', async () => {
    const sus = suscripcion()
    const anulado = { id: 'cobro-1', plan_cobro_id: plan.id, numero_cuota: 1, fecha: null, external_ref: null, anulado_at: '2026-09-02T00:00:00Z' }
    const { db, tablas } = fakeDb(tablasBase(sus, [anulado]))
    const r = await correrCicloSuscripcion(sus, plan, deps(db))
    expect(r.accion).toBe('error')
    expect(tablas.suscripciones[0].ultimo_error).toMatch(/anulada/)
    expect(tablas.cobros).toHaveLength(1)
  })

  it('un error de lectura no revienta el lote: devuelve error y deja el motivo en ultimo_error', async () => {
    const sus = suscripcion()
    const { db, tablas } = fakeDb(tablasBase(sus), { errorAlLeerCobros: 'timeout' })
    const r = await correrCicloSuscripcion(sus, plan, deps(db))
    expect(r.accion).toBe('error')
    expect(r.detalle).toMatch(/timeout/)
    expect(tablas.suscripciones[0].ultimo_error).toMatch(/timeout/)
  })
})

// ── Factura antes del cargo ──────────────────────────────────────────────────

describe('ciclo: la factura va antes del cargo', () => {
  function adapterEspia(respuesta: ResultadoCargo) {
    const llamadas: { cobrar: SolicitudCargo[]; consultar: string[] } = { cobrar: [], consultar: [] }
    const adapter: PasarelaAdapter = {
      nombre: 'epayco',
      capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: false, webhook: true },
      async cobrar(s) { llamadas.cobrar.push(s); return respuesta },
      async consultar(ref) { llamadas.consultar.push(ref); return respuesta },
    }
    return { adapter, llamadas }
  }

  it('si la factura falla NO se cobra, y el motivo queda en ultimo_error', async () => {
    const sus = suscripcion({ pasarela: 'epayco' })
    const { db, tablas } = fakeDb(tablasBase(sus))
    const { adapter, llamadas } = adapterEspia({ estado: 'aprobado', externalRef: 'tx-1', fecha: '2026-09-05', monto: 150_000 })

    const r = await correrCicloSuscripcion(sus, plan, deps(db, {
      adapter,
      facturar: async () => ({ ok: false, error: 'Siigo 429' }),
    }))

    expect(r.accion).toBe('factura_fallida')
    expect(llamadas.cobrar).toHaveLength(0)
    expect(tablas.suscripciones[0].ultimo_error).toBe('factura: Siigo 429')
    expect(tablas.cobros[0].fecha).toBeNull()
  })

  it('una factura que lanza se trata igual que una que falla', async () => {
    const sus = suscripcion({ pasarela: 'epayco' })
    const { db } = fakeDb(tablasBase(sus))
    const { adapter, llamadas } = adapterEspia({ estado: 'aprobado', externalRef: 'tx-1', fecha: '2026-09-05', monto: 150_000 })
    const r = await correrCicloSuscripcion(sus, plan, deps(db, { adapter, facturar: async () => { throw new Error('red') } }))
    expect(r.accion).toBe('factura_fallida')
    expect(llamadas.cobrar).toHaveLength(0)
  })

  it('la referencia de la factura viaja en la solicitud de cargo', async () => {
    const sus = suscripcion({ pasarela: 'epayco' })
    const { db } = fakeDb(tablasBase(sus))
    const { adapter, llamadas } = adapterEspia({ estado: 'aprobado', externalRef: 'tx-1', fecha: '2026-09-05', monto: 150_000 })
    await correrCicloSuscripcion(sus, plan, deps(db, { adapter, facturar: async () => ({ ok: true, omitida: false, referencia: 'FV-1-77' }) }))
    expect(llamadas.cobrar[0]).toMatchObject({ facturaRef: 'FV-1-77', referencia: 'sub-0f8e2f4a1c2b-c1', monto: 150_000, moneda: 'COP', workspaceId: WS_CLIENTE })
  })
})

// ── Pasarelas con cargo (contrato que la Fase 2 tiene que cumplir) ───────────

describe('ciclo con un adaptador que cobra', () => {
  function adapterFijo(respuestas: ResultadoCargo[]) {
    const llamadas: { cobrar: SolicitudCargo[]; consultar: string[] } = { cobrar: [], consultar: [] }
    let i = 0
    const next = () => respuestas[Math.min(i++, respuestas.length - 1)]
    const adapter: PasarelaAdapter = {
      nombre: 'epayco',
      capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: false, webhook: true },
      async cobrar(s) { llamadas.cobrar.push(s); return next() },
      async consultar(ref) { llamadas.consultar.push(ref); return next() },
    }
    return { adapter, llamadas }
  }

  it('aprobado: marca el cobro pagado con la referencia y la fuente, activa y avanza', async () => {
    const sus = suscripcion({ pasarela: 'epayco', estado: 'trial' })
    const { db, tablas } = fakeDb(tablasBase(sus))
    const { adapter } = adapterFijo([{ estado: 'aprobado', externalRef: 'tx-999', fecha: '2026-09-05', monto: 150_000 }])

    const r = await correrCicloSuscripcion(sus, plan, deps(db, { adapter }))

    expect(r).toMatchObject({ accion: 'cargo_aprobado', estadoDespues: 'activa', proximoCobro: '2026-10-05' })
    expect(tablas.cobros[0]).toMatchObject({ fecha: '2026-09-05', external_ref: 'tx-999', fuente: 'epayco', vencido: false })
    expect(tablas.workspaces[0].subscription_status).toBe('activa')
  })

  it('rechazado: suma el intento, deja el error, y con Fase 1 se queda en pendiente_pago aunque agote', async () => {
    const sus = suscripcion({ pasarela: 'epayco' })
    const { db, tablas } = fakeDb(tablasBase(sus))
    const { adapter } = adapterFijo([{ estado: 'rechazado', externalRef: null, codigo: '51', mensaje: 'fondos insuficientes', reintentable: true }])

    let actual = sus
    for (let i = 1; i <= 4; i++) {
      const r = await correrCicloSuscripcion(actual, plan, deps(db, { adapter, hoy: `2026-09-0${5 + i}` }))
      expect(r.accion).toBe('cargo_rechazado')
      actual = { ...actual, ...(tablas.suscripciones[0] as unknown as Partial<SuscripcionRow>) }
    }
    expect(tablas.suscripciones[0]).toMatchObject({ estado: 'pendiente_pago', intentos_fallidos: 4, ultimo_error: '51: fondos insuficientes' })
    expect(tablas.workspaces[0].subscription_status).toBe('pendiente_pago')
  })

  it('rechazado con suspensión automática: el intento que alcanza el máximo suspende', async () => {
    const politica: PoliticaSuspension = { diasGracia: 3, maxIntentos: 2, suspenderAutomaticamente: true }
    const sus = suscripcion({ pasarela: 'epayco', estado: 'pendiente_pago', intentos_fallidos: 1 })
    const { db, tablas } = fakeDb(tablasBase(sus))
    const { adapter } = adapterFijo([{ estado: 'rechazado', externalRef: null, codigo: '05', mensaje: 'no autorizada', reintentable: false }])

    const r = await correrCicloSuscripcion(sus, plan, deps(db, { adapter, politica }))

    expect(r.estadoDespues).toBe('suspendida')
    expect(tablas.suscripciones[0].ultimo_error).toBe('05: no autorizada (no reintentable)')
    expect(tablas.workspaces[0].subscription_status).toBe('suspendida')
  })

  it('pendiente con referencia (link de pago): la anota en el cobro y la corrida siguiente SONDEA en vez de volver a cobrar', async () => {
    const sus = suscripcion({ pasarela: 'bold' })
    const { db, tablas } = fakeDb(tablasBase(sus))
    const { adapter, llamadas } = adapterFijo([
      { estado: 'pendiente', externalRef: 'LNK_abc', linkPago: 'https://checkout.bold.co/payment/LNK_abc' },
      { estado: 'aprobado', externalRef: 'LNK_abc', fecha: '2026-09-06', monto: 150_000 },
    ])

    const r1 = await correrCicloSuscripcion(sus, plan, deps(db, { adapter }))
    expect(r1).toMatchObject({ accion: 'cargo_pendiente', estadoDespues: 'activa' })
    expect(tablas.cobros[0]).toMatchObject({ external_ref: 'LNK_abc', fuente: 'epayco', fecha: null })
    expect(llamadas).toEqual({ cobrar: [expect.any(Object)], consultar: [] })

    const r2 = await correrCicloSuscripcion(sus, plan, deps(db, { adapter, hoy: '2026-09-06' }))
    expect(r2.accion).toBe('cargo_aprobado')
    expect(llamadas.cobrar).toHaveLength(1)            // no se cobró dos veces
    expect(llamadas.consultar).toEqual(['LNK_abc'])
    expect(tablas.cobros[0].fecha).toBe('2026-09-06')
  })

  it('un adaptador que lanza se registra como error sin mover el estado', async () => {
    const sus = suscripcion({ pasarela: 'epayco' })
    const { db, tablas } = fakeDb(tablasBase(sus))
    const adapter: PasarelaAdapter = {
      nombre: 'epayco',
      capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: false, webhook: true },
      async cobrar() { throw new Error('ECONNRESET') },
      async consultar() { throw new Error('ECONNRESET') },
    }
    const r = await correrCicloSuscripcion(sus, plan, deps(db, { adapter }))
    expect(r).toMatchObject({ accion: 'error', estadoDespues: 'activa', detalle: 'ECONNRESET' })
    expect(tablas.suscripciones[0]).toMatchObject({ estado: 'activa', ultimo_error: 'ECONNRESET' })
  })
})
