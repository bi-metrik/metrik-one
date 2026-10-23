/**
 * El REVERSO de un pago de ePayco (estado 6, «Reversada»). Caso real: la 390720992, aprobada el
 * 2026-10-22 (cobro f5f27bbf) y reversada desde el panel de ePayco ese mismo día. ePayco NO mandó la
 * confirmación del reverso: el cobro siguió contando como pagado hasta que se anuló a mano por SQL.
 *
 * Con el código real de la confirmación (`parsearConfirmacionEpayco` + `procesarEventoPasarela` +
 * `repoPagoEnLinea`), de la anulación (`anularCobroPorReverso`) y de la conciliación
 * (`detectarReversosEpayco`), sobre el doble de tablas. Lo simulado: la base, la consulta a ePayco (un
 * adaptador doble) y Resend (`fetch`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import type { PasarelaAdapter, ResultadoCargo } from '@/lib/suscripciones/pasarela/adapter'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => {
    throw new Error('la prueba no usa el cliente de servicio')
  },
}))
vi.mock('@/lib/valida-cda/plan-anual-activacion-servidor', () => ({ activarPlanAnualSiCorresponde: async () => ({ tipo: 'no_aplica' }) }))
vi.mock('@/lib/valida-registro/ciclo-servidor', () => ({ abrirCicloSiCorresponde: async () => null, detalleCiclo: () => null }))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => ({ ok: true }) }))

const { procesarEventoPasarela } = await import('./pago-en-linea')
const { repoPagoEnLinea } = await import('./pago-en-linea-servidor')
const { detectarReversosEpayco } = await import('./reversos-epayco-servidor')
const { parsearConfirmacionEpayco } = await import('@/lib/suscripciones/pasarela/epayco')

const METRIK = 'ws-metrik'
const SUS = 'sus-1'
const COBRO = 'f5f27bbf-1bd0-49fd-9987-1de37d77bc6f'
const REF_ONE = 'ONE-f5f27bbf1bd049fd99871de37d77bc6f-1792663287207'
const AHORA = Date.parse('2026-10-23T14:00:00Z')
const HOY = '2026-10-23'

function base(extra: Partial<Tablas> = {}): Tablas {
  return {
    suscripciones_producto: [
      { id: SUS, workspace_id: METRIK, estado: 'activa', razon_social: 'AFI PRUEBA PRODUCCION 1 S.A.S.', numero_documento: '900990011' },
    ],
    cobros: [
      {
        id: COBRO,
        workspace_id: METRIK,
        negocio_id: null,
        suscripcion_id: SUS,
        plan_cobro_id: 'p1',
        numero_cuota: 1,
        monto: 150000,
        retencion_iva: 0,
        fecha: '2026-10-22',
        anulado_at: null,
        tipo_cobro: 'programado',
        fuente: 'epayco',
        external_ref: 'epayco-390720992',
        notas: 'Cuota 1 de 12 · cobro con tarjeta (ePayco)',
        enlace_pago_url: null,
      },
    ],
    // La confirmación aceptada que sí llegó.
    pasarela_eventos: [{ id: 'ev-1', pasarela: 'epayco', evento_id: '390720992-1', resultado: 'registrado' }],
    facturas_cobro: [],
    suscripciones_producto_eventos: [],
    ...extra,
  }
}

/** Un ePayco doble: `consultar` responde lo que diga el mapa por referencia. */
function epaycoDoble(respuestas: Record<string, ResultadoCargo>) {
  const consultas: string[] = []
  const adapter: PasarelaAdapter = {
    nombre: 'epayco',
    capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: true, webhook: true },
    async cobrar() {
      throw new Error('la conciliación de reversos nunca cobra')
    },
    async consultar(ref) {
      consultas.push(ref)
      return respuestas[ref] ?? { estado: 'aprobado', externalRef: ref, fecha: '2026-10-22', monto: 150000 }
    },
  }
  return { adapter, consultas }
}

const REVERSADA: ResultadoCargo = { estado: 'reversado', externalRef: 'epayco-390720992', codigo: '6', mensaje: 'Reversada' }

/** La confirmación del reverso como la mandaría ePayco (ya verificada la firma). */
function confirmacionReverso(): string {
  return new URLSearchParams({
    x_ref_payco: '390720992',
    x_transaction_id: '390720992',
    x_cod_transaction_state: '6',
    x_transaction_state: 'Reversada',
    x_amount: '150000',
    x_currency_code: 'COP',
    x_transaction_date: '2026-10-22 16:00:00',
    x_test_request: 'FALSE',
    ref: REF_ONE,
  }).toString()
}

let correos: { to: string[]; subject: string; text: string }[]
beforeEach(() => {
  correos = []
  vi.stubEnv('RESEND_API_KEY', 're_prueba')
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (!String(url).includes('api.resend.com')) throw new Error(`fetch inesperado: ${url}`)
    correos.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ id: 'mail-1' }), { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/**
 * El doble con la llave única de `pasarela_eventos` (pasarela, evento_id): sin ella, la segunda
 * notificación del mismo evento no se distinguiría de una nueva.
 */
function crear(t: Tablas) {
  const doble = crearDoble(t)
  const from = doble.db.from.bind(doble.db)
  const db = {
    from: (tabla: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = from(tabla) as any
      if (tabla !== 'pasarela_eventos') return q
      const insertar = q.insert
      q.insert = (v: Record<string, unknown>) => {
        if (doble.tablas.pasarela_eventos.some((e) => e.pasarela === v.pasarela && e.evento_id === v.evento_id)) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "pasarela_eventos_unico"' } })
        }
        return insertar(v)
      }
      return q
    },
  } as unknown as typeof doble.db
  return { db, tablas: doble.tablas }
}

function cobroDe(t: Tablas) {
  return t.cobros.find((c) => c.id === COBRO) as Record<string, unknown>
}

describe('conciliación: ePayco reporta reversado y la confirmación no llegó', () => {
  it('anula el cobro con los campos de la anulación manual, avisa a MéTRIK y deja el evento en revisión', async () => {
    const { db, tablas } = crear(base())
    const { adapter, consultas } = epaycoDoble({ 'epayco-390720992': REVERSADA })
    const r = await detectarReversosEpayco({ db, hoy: HOY, ahoraMs: AHORA, adapterPara: () => adapter })

    expect(consultas).toEqual(['epayco-390720992'])
    expect(r.reversados).toEqual([{ cobroId: COBRO, referencia: 'epayco-390720992', resultado: 'requiere_revision' }])
    const c = cobroDe(tablas)
    expect(c.monto).toBe(0)
    expect(c.monto_anulado).toBe(150000)
    expect(typeof c.anulado_at).toBe('string')
    expect(c.anulado_por).toBeNull()
    expect(String(c.anulacion_motivo)).toContain('ePayco reversó el pago epayco-390720992')
    expect(String(c.notas)).toMatch(/^ANULADO 2026-10-23 — ePayco reversó/)
    // La fecha del pago se conserva: la cuota no vuelve a cobrarse sola (lo decide una persona).
    expect(c.fecha).toBe('2026-10-22')

    // El evento: el mismo id que la confirmación del reverso.
    const ev = tablas.pasarela_eventos.find((e) => e.evento_id === '390720992-6')
    expect(ev?.resultado).toBe('requiere_revision')
    expect(String(ev?.detalle)).toContain('NO canceló la suscripción ni cerró el ciclo')

    // La suscripción no se tocó.
    expect(tablas.suscripciones_producto[0].estado).toBe('activa')

    // Un correo, interno, a MéTRIK.
    expect(correos).toHaveLength(1)
    expect(correos[0].to).toEqual(['mauricio.moreno@metrik.com.co'])
    expect(correos[0].subject).toContain('AFI PRUEBA PRODUCCION 1 S.A.S.')
    expect(correos[0].text).toContain('El cobro no tenía factura')
  })

  it('un cobro ya anulado no se vuelve a consultar ni a avisar (segunda corrida)', async () => {
    const { db } = crear(base())
    const { adapter, consultas } = epaycoDoble({ 'epayco-390720992': REVERSADA })
    await detectarReversosEpayco({ db, hoy: HOY, ahoraMs: AHORA, adapterPara: () => adapter })
    const r2 = await detectarReversosEpayco({ db, hoy: HOY, ahoraMs: AHORA, adapterPara: () => adapter })
    expect(r2.revisados).toBe(0)
    expect(consultas).toHaveLength(1)
    expect(correos).toHaveLength(1)
  })

  it('con factura ya emitida: no la toca y avisa que hace falta la nota crédito', async () => {
    const factura = { id: 'f1', cobro_id: COBRO, numero: 'FE-12', fecha_emision: '2026-10-22' }
    const { db, tablas } = crear(base({ facturas_cobro: [factura] }))
    const { adapter } = epaycoDoble({ 'epayco-390720992': REVERSADA })
    await detectarReversosEpayco({ db, hoy: HOY, ahoraMs: AHORA, adapterPara: () => adapter })
    expect(tablas.facturas_cobro).toEqual([factura])
    expect(correos[0].text).toContain('YA tenía la factura FE-12')
    expect(correos[0].text).toContain('nota crédito')
    expect(String(tablas.pasarela_eventos.find((e) => e.evento_id === '390720992-6')?.detalle)).toContain('nota crédito')
  })

  it('aprobado, pendiente o una consulta fallida no anulan nada', async () => {
    for (const r of [
      { estado: 'aprobado', externalRef: 'epayco-390720992', fecha: '2026-10-22', monto: 150000 },
      { estado: 'pendiente', externalRef: 'epayco-390720992' },
      { estado: 'error', mensaje: 'ePayco no respondió', reintentable: true },
    ] as ResultadoCargo[]) {
      const { db, tablas } = crear(base())
      const { adapter } = epaycoDoble({ 'epayco-390720992': r })
      const res = await detectarReversosEpayco({ db, hoy: HOY, ahoraMs: AHORA, adapterPara: () => adapter })
      expect(cobroDe(tablas).monto).toBe(150000)
      expect(res.reversados).toEqual([])
      expect(res.errores).toHaveLength(r.estado === 'error' ? 1 : 0)
    }
    expect(correos).toHaveLength(0)
  })

  it('solo consulta cobros pagados con ePayco, sin anular, dentro de la ventana', async () => {
    const otros = [
      // Fuera de la ventana de 60 días.
      { id: 'viejo', fecha: '2026-08-01', external_ref: 'epayco-1' },
      // Ya anulado.
      { id: 'anulado', fecha: '2026-10-20', external_ref: 'epayco-2', anulado_at: '2026-10-21T00:00:00Z' },
      // Sin pagar (un link pendiente).
      { id: 'sin-pago', fecha: null, external_ref: '123456' },
      // Pagado por Bold.
      { id: 'bold', fecha: '2026-10-20', external_ref: 'bold-9', fuente: 'bold' },
      // Una cuota pagada a mano.
      { id: 'manual', fecha: '2026-10-20', external_ref: 'transferencia', fuente: 'manual' },
    ].map((o) => ({ ...base().cobros[0], fuente: 'epayco', anulado_at: null, ...o }))
    const { db } = crear(base({ cobros: [...base().cobros, ...otros] }))
    const { adapter, consultas } = epaycoDoble({})
    await detectarReversosEpayco({ db, hoy: HOY, ahoraMs: AHORA, adapterPara: () => adapter })
    expect(consultas).toEqual(['epayco-390720992'])
  })

  it('con ePayco apagado no consulta nada', async () => {
    const { db } = crear(base())
    const r = await detectarReversosEpayco({ db, hoy: HOY, ahoraMs: AHORA, adapterPara: () => null })
    expect(r.apagado).toBe(true)
    expect(r.revisados).toBe(0)
  })
})

describe('confirmación del reverso (webhook) y conciliación, en cualquier orden', () => {
  it('llega la confirmación del reverso (6): anula una vez; la conciliación después ya no lo ve', async () => {
    const { db, tablas } = crear(base())
    const { adapter, consultas } = epaycoDoble({ 'epayco-390720992': REVERSADA })
    const evento = parsearConfirmacionEpayco(confirmacionReverso())!
    expect(evento).toMatchObject({ tipo: 'anulado', eventoId: '390720992-6', referenciaPago: 'epayco-390720992' })
    const s = await procesarEventoPasarela(evento, repoPagoEnLinea(db, 'epayco', adapter), HOY)
    expect(s.resultado).toBe('requiere_revision')
    expect(cobroDe(tablas).monto).toBe(0)

    // Repetida por ePayco: duplicado.
    const s2 = await procesarEventoPasarela(evento, repoPagoEnLinea(db, 'epayco', adapter), HOY)
    expect(s2.resultado).toBe('duplicado')

    const r = await detectarReversosEpayco({ db, hoy: HOY, ahoraMs: AHORA, adapterPara: () => adapter })
    expect(r.revisados).toBe(0)
    expect(consultas).toHaveLength(0)
    expect(cobroDe(tablas).monto_anulado).toBe(150000)
    expect(correos).toHaveLength(1)
  })

  it('la conciliación primero y la confirmación del reverso después: la segunda es duplicado', async () => {
    const { db, tablas } = crear(base())
    const { adapter } = epaycoDoble({ 'epayco-390720992': REVERSADA })
    await detectarReversosEpayco({ db, hoy: HOY, ahoraMs: AHORA, adapterPara: () => adapter })
    const s = await procesarEventoPasarela(parsearConfirmacionEpayco(confirmacionReverso())!, repoPagoEnLinea(db, 'epayco', adapter), HOY)
    expect(s.resultado).toBe('duplicado')
    expect(cobroDe(tablas).monto_anulado).toBe(150000)
    expect(correos).toHaveLength(1)
  })

  it('el cobro anulado a mano antes (lo que pasó con f5f27bbf): el reverso no lo pisa ni avisa', async () => {
    const t = base()
    Object.assign(t.cobros[0], { monto: 0, monto_anulado: 150000, anulado_at: '2026-10-22T21:00:00Z', anulado_por: 'perfil-mauricio', anulacion_motivo: 'Reversado a mano' })
    const { db, tablas } = crear(t)
    const { adapter } = epaycoDoble({})
    const s = await procesarEventoPasarela(parsearConfirmacionEpayco(confirmacionReverso())!, repoPagoEnLinea(db, 'epayco', adapter), HOY)
    expect(s.resultado).toBe('ignorado')
    expect(cobroDe(tablas)).toMatchObject({ monto_anulado: 150000, anulado_por: 'perfil-mauricio', anulacion_motivo: 'Reversado a mano' })
    expect(correos).toHaveLength(0)
  })

  it('la confirmación del reverso sin `ref`: encuentra el cobro por la transacción', async () => {
    const { db, tablas } = crear(base())
    const { adapter } = epaycoDoble({})
    const crudo = new URLSearchParams(confirmacionReverso())
    crudo.delete('ref')
    const s = await procesarEventoPasarela(parsearConfirmacionEpayco(crudo.toString())!, repoPagoEnLinea(db, 'epayco', adapter), HOY)
    expect(s.resultado).toBe('requiere_revision')
    expect(cobroDe(tablas).monto).toBe(0)
  })

  it('Bold (VOID_APPROVED) no anula solo: sigue en revisión', async () => {
    const t = base()
    Object.assign(t.cobros[0], { fuente: 'bold', external_ref: 'bold-TX1' })
    const { db, tablas } = crear(t)
    const { adapter } = epaycoDoble({})
    const s = await procesarEventoPasarela(
      {
        tipo: 'anulado',
        eventoId: 'bold-evt',
        tipoOriginal: 'VOID_APPROVED',
        transaccionId: 'TX1',
        referenciaPago: 'bold-TX1',
        referencia: REF_ONE,
        idEnlace: null,
        monto: null,
        moneda: 'COP',
        ocurridoAt: null,
        crudo: {},
      },
      repoPagoEnLinea(db, 'bold', { ...adapter, nombre: 'bold' }),
      HOY,
    )
    expect(s.resultado).toBe('requiere_revision')
    expect(cobroDe(tablas).monto).toBe(150000)
    expect(correos).toHaveLength(0)
  })
})
