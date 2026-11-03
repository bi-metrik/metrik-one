/**
 * El cargo con la tarjeta guardada que ePayco deja PENDIENTE (revisión antifraude eControl) y decide
 * horas después. Caso real: transacción 390720992 del 2026-10-22, «Pendiente por aprobación del
 * comercio» a las 05:01 y aceptada a las 09:28 (Bogotá). La confirmación registró el pago, pero el
 * intento siguió en `pendiente`, el registro en `cobro_pendiente` y el correo C3 no salió.
 *
 * Con el código real del webhook (`procesarEventoPasarela` + `repoPagoEnLinea` + la confirmación de
 * ePayco parseada como llega) y de la conciliación (`cobrarCuotaConTarjeta`), sobre el doble de tablas.
 * Lo simulado: la base, Resend (`fetch`), los 4 dígitos de la tarjeta, y lo que sigue a un pago que
 * no es de este caso (Plan Anual, ciclo de Valida).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import type { PasarelaAdapter, ResultadoCargo, SolicitudCargo } from '@/lib/suscripciones/pasarela/adapter'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => {
    throw new Error('la prueba no usa el cliente de servicio')
  },
}))
vi.mock('@/lib/valida-cda/plan-anual-activacion-servidor', () => ({ activarPlanAnualSiCorresponde: async () => ({ tipo: 'no_aplica' }) }))
vi.mock('@/lib/valida-registro/ciclo-servidor', () => ({ abrirCicloSiCorresponde: async () => null, detalleCiclo: () => null }))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => ({ ok: true }) }))
vi.mock('@/lib/suscripciones/pasarela/epayco', async (original) => ({
  ...(await original<typeof import('@/lib/suscripciones/pasarela/epayco')>()),
  ultimosDigitosTarjetaEpayco: async () => '0326',
}))

const { procesarEventoPasarela } = await import('@/lib/cobros/pago-en-linea')
const { repoPagoEnLinea } = await import('@/lib/cobros/pago-en-linea-servidor')
const { parsearConfirmacionEpayco } = await import('@/lib/suscripciones/pasarela/epayco')
const { cobrarCuotaConTarjeta, cobrarCuotasConTarjeta } = await import('./cobro-token-servidor')
const { cerrarCargoAprobadoTardio, cerrarRegistroConPagoRegistrado, conciliarRegistrosConCobroPendiente } = await import('./cargo-tardio-servidor')

const METRIK = 'ws-metrik'
const PAGADOR = 'ws-cda'
const SUS = 'sus-1'
const REG = 'reg-1'
const COBRO = 'f5f27bbf-1bd0-49fd-9987-1de37d77bc6f'
const REF_ONE = 'ONE-f5f27bbf1bd049fd99871de37d77bc6f-1792663287207'
const TARJETA = 'epayco:ad9559d07d9baad2f095302:ad9559b948d4942a006cdf6'
const CARGO_AT = '2026-10-22T10:01:27.207+00:00'
const AHORA = Date.parse('2026-10-22T14:28:57Z')

function base(registro: Record<string, unknown> = {}): Tablas {
  return {
    servicios_contratados: [{ id: 'sc', workspace_id: METRIK, negocio_id: null, suscripcion_id: SUS, estado: 'activo', workspace_pagador_id: PAGADOR }],
    workspaces: [{ id: PAGADOR, config_extra: { origen_registro: 'valida_autogestion', valida_pagador: { celular: '3001234567' } } }],
    suscripciones_producto: [
      {
        id: SUS,
        workspace_id: METRIK,
        workspace_cliente_id: PAGADOR,
        estado: 'activa',
        metodo_pago_pasarela: 'epayco',
        metodo_pago_ref: TARJETA,
        correo_facturacion: 'facturas@cda.co',
        numero_documento: '900990011',
        razon_social: 'CDA EJEMPLO S.A.S.',
        valida_registro_id: REG,
      },
    ],
    // «Activar y pagar»: el clic escribe el intento y la confirmación con el MISMO instante.
    valida_registros: [
      {
        id: REG,
        workspace_id: PAGADOR,
        estado: 'creado',
        correo: 'ana@cda.co',
        razon_social: 'CDA EJEMPLO S.A.S.',
        slug_creado: 'cda-ejemplo',
        metodo_pago_ref: TARJETA,
        cobro_estado: 'cobro_pendiente',
        cobro_detalle: 'ePayco dejó el cobro pendiente: lo cierra la confirmación',
        cobro_ref: null,
        cobro_intento_at: CARGO_AT,
        cobro_confirmado_at: CARGO_AT,
        ...registro,
      },
    ],
    planes_cobro: [{ id: 'p1', workspace_id: METRIK, negocio_id: null, suscripcion_id: SUS, pasarela: 'epayco', total_cuotas: 12 }],
    plan_cobro_cuotas: [
      { id: 'q1', workspace_id: METRIK, plan_cobro_id: 'p1', numero: 1, monto: 150000, fecha_vencimiento: '2026-10-22', concepto_detalle: 'Valida · cuota 1' },
      { id: 'q2', workspace_id: METRIK, plan_cobro_id: 'p1', numero: 2, monto: 150000, fecha_vencimiento: '2026-11-22', concepto_detalle: 'Valida · cuota 2' },
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
        tipo_cobro: 'programado',
        fecha: null,
        anulado_at: null,
        external_ref: 'epayco-390720992',
        notas: 'Cuota 1 de 12 · cobro con tarjeta (ePayco)',
        enlace_pago_url: null,
      },
    ],
    cobro_intentos_tarjeta: [
      {
        id: 'i1',
        workspace_id: METRIK,
        cobro_id: COBRO,
        plan_cobro_id: 'p1',
        numero_cuota: 1,
        intento: 0,
        resultado: 'pendiente',
        referencia: 'epayco-390720992',
        mensaje: 'Transacción Pendiente por aprobación del comercio',
      },
    ],
    pasarela_eventos: [],
    suscripciones_producto_eventos: [],
    notificaciones: [],
  }
}

/** El doble, con la llave única de `pasarela_eventos` (pasarela, evento_id) que pone la base. */
function dobleConEventosUnicos(t: Tablas) {
  const d = crearDoble(t)
  const from = d.db.from.bind(d.db)
  const db = {
    from: (tabla: string) => {
      const q = from(tabla) as unknown as Record<string, unknown>
      if (tabla !== 'pasarela_eventos') return q
      const insertar = q.insert as (v: Record<string, unknown>) => unknown
      return {
        ...q,
        insert: (v: Record<string, unknown>) => {
          if (t.pasarela_eventos.some((f) => f.pasarela === v.pasarela && f.evento_id === v.evento_id)) {
            return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } })
          }
          return insertar(v)
        },
      }
    },
  } as unknown as typeof d.db
  return { ...d, db }
}

/** La confirmación de ePayco tal como llega (ya verificada la firma), con `?ref=` de ONE. */
function confirmacion(estado: '1' | '2' | '3', texto: string) {
  const form = new URLSearchParams({
    x_ref_payco: '390720992',
    x_transaction_id: '3907209921792663289',
    x_cod_transaction_state: estado,
    x_transaction_state: texto,
    x_amount: '150000',
    x_currency_code: 'COP',
    x_transaction_date: '2026-10-22 09:28:40',
    x_id_invoice: REF_ONE,
    ref: REF_ONE,
  }).toString()
  const e = parsearConfirmacionEpayco(form)
  if (!e) throw new Error('confirmación ilegible')
  return e
}

const adapterNulo = { nombre: 'epayco' } as unknown as PasarelaAdapter

function epayco(consulta: ResultadoCargo) {
  const cargos: SolicitudCargo[] = []
  const consultas: string[] = []
  const adapter = {
    nombre: 'epayco',
    capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: false, webhook: true },
    cobrar: async (s: SolicitudCargo) => {
      cargos.push(s)
      return { estado: 'error', mensaje: 'no debía cobrar', reintentable: false } as ResultadoCargo
    },
    consultar: async (ref: string) => {
      consultas.push(ref)
      return consulta
    },
  } as unknown as PasarelaAdapter
  return { adapterPara: (p: string) => (p === 'epayco' ? adapter : null), adapter, cargos, consultas }
}

let correos: { to: string[]; subject: string; idem: string | null }[] = []

beforeEach(() => {
  correos = []
  vi.stubEnv('RESEND_API_KEY', 're_prueba')
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (!String(url).startsWith('https://api.resend.com/')) throw new Error(`fetch inesperado: ${url}`)
    const body = JSON.parse(String(init.body)) as { to: string[]; subject: string }
    correos.push({ to: body.to, subject: body.subject, idem: (init.headers as Record<string, string>)['Idempotency-Key'] ?? null })
    return new Response(JSON.stringify({ id: `re-${correos.length}` }), { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('(a) ePayco aprueba DESPUÉS un cargo que quedó pendiente', () => {
  it('registra el pago, cierra el intento y el registro, y manda el C3 una sola vez', async () => {
    const d = dobleConEventosUnicos(base())
    const repo = repoPagoEnLinea(d.db, 'epayco', adapterNulo)

    // 05:01: la confirmación «Pendiente» no hace nada (como hoy).
    const pendiente = await procesarEventoPasarela(confirmacion('3', 'Pendiente'), repo, '2026-10-22')
    expect(pendiente.resultado).toBe('ignorado')
    expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('pendiente')

    // 09:28: la aceptación tras la revisión del comercio.
    const r = await procesarEventoPasarela(confirmacion('1', 'Aceptada'), repo, '2026-10-22')
    expect(r.resultado).toBe('registrado')
    expect(d.tablas.cobros[0]).toMatchObject({ fecha: '2026-10-22', external_ref: 'epayco-390720992', fuente: 'epayco' })
    expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('aprobado')
    expect(d.tablas.valida_registros[0]).toMatchObject({ cobro_estado: 'cobrado', cobro_ref: 'epayco-390720992' })
    expect(correos).toHaveLength(1)
    expect(correos[0]).toMatchObject({ to: ['ana@cda.co'], idem: `valida-cobro-confirmado-${REG}` })
    expect(correos[0].subject).toContain('0326')
    expect(r.detalle).toContain('Correo del cobro (C3) enviado')

    // ePayco reintenta la misma confirmación: duplicado, nada se repite.
    const otra = await procesarEventoPasarela(confirmacion('1', 'Aceptada'), repo, '2026-10-22')
    expect(otra.resultado).toBe('duplicado')
    expect(correos).toHaveLength(1)
  })

  it('un cobro del día 7 (sin «Activar y pagar») cierra el intento y el registro, sin C3 (como en el acto)', async () => {
    const d = dobleConEventosUnicos(base({ cobro_confirmado_at: null }))
    const r = await procesarEventoPasarela(confirmacion('1', 'Aceptada'), repoPagoEnLinea(d.db, 'epayco', adapterNulo), '2026-10-22')
    expect(r.resultado).toBe('registrado')
    expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('aprobado')
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('cobrado')
    expect(correos).toHaveLength(0)
  })

  it('un cargo aprobado EN EL ACTO no se toca: el intento ya está cerrado y el registro en cobrando', async () => {
    const t = base({ cobro_estado: 'cobrando' })
    t.cobro_intentos_tarjeta[0].resultado = 'aprobado'
    const d = dobleConEventosUnicos(t)
    const r = await procesarEventoPasarela(confirmacion('1', 'Aceptada'), repoPagoEnLinea(d.db, 'epayco', adapterNulo), '2026-10-22')
    expect(r.resultado).toBe('registrado')
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('cobrando')
    expect(correos).toHaveLength(0)
  })
})

describe('(b) ePayco rechaza DESPUÉS un cargo que quedó pendiente', () => {
  it('del «Activar y pagar»: intento rechazado, referencia liberada, plan a enlace, registro vuelve a la prueba, a revisión', async () => {
    const d = dobleConEventosUnicos(base())
    const r = await procesarEventoPasarela(confirmacion('2', 'Rechazada'), repoPagoEnLinea(d.db, 'epayco', adapterNulo), '2026-10-22')
    expect(r.resultado).toBe('requiere_revision')
    expect(r.cobroId).toBe(COBRO)
    expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('rechazado')
    // Sin soltar la referencia, la cuota quedaba «pendiente» para siempre y sin enlace.
    expect(d.tablas.cobros[0]).toMatchObject({ external_ref: null, fecha: null })
    // La rama del rechazo en el acto: cuota 1 → enlace (Condiciones 7.5) y la línea en la bitácora.
    expect(d.tablas.planes_cobro[0].pasarela).toBe('bold')
    expect(d.tablas.suscripciones_producto_eventos.some((e) => e.tipo === 'cobro_tarjeta_rechazado')).toBe(true)
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('programado')
    expect(d.tablas.valida_registros[0].cobro_confirmacion_rechazada_at).toBeTruthy()
    expect(d.tablas.pasarela_eventos[0]).toMatchObject({ evento_id: '390720992-2', resultado: 'requiere_revision', cobro_id: COBRO })
    expect(correos).toHaveLength(0)
  })

  it('del día 7: el registro queda rechazado', async () => {
    const d = dobleConEventosUnicos(base({ cobro_confirmado_at: null }))
    await procesarEventoPasarela(confirmacion('2', 'Rechazada'), repoPagoEnLinea(d.db, 'epayco', adapterNulo), '2026-10-22')
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('rechazado')
  })

  it('un rechazo sin cargo pendiente de esa transacción se ignora como antes', async () => {
    const t = base()
    t.cobro_intentos_tarjeta[0].referencia = 'epayco-111'
    const d = dobleConEventosUnicos(t)
    const r = await procesarEventoPasarela(confirmacion('2', 'Rechazada'), repoPagoEnLinea(d.db, 'epayco', adapterNulo), '2026-10-22')
    expect(r.resultado).toBe('ignorado')
    expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('pendiente')
    expect(d.tablas.cobros[0].external_ref).toBe('epayco-390720992')
    expect(d.tablas.planes_cobro[0].pasarela).toBe('epayco')
  })
})

describe('(c) la conciliación consulta a ePayco el cargo pendiente', () => {
  it('aprobado: entra por el camino de la confirmación con el id 390720992-1; la confirmación que llega después es duplicado', async () => {
    const d = dobleConEventosUnicos(base())
    const e = epayco({ estado: 'aprobado', externalRef: 'epayco-390720992', fecha: '2026-10-22', monto: 150000 })
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara, ahoraMs: AHORA }, { cobradorId: METRIK, cuotaId: 'q1' })
    expect(r.tipo).toBe('aprobado')
    expect(e.consultas).toEqual(['epayco-390720992'])
    expect(e.cargos).toHaveLength(0)
    expect(d.tablas.pasarela_eventos).toHaveLength(1)
    expect(d.tablas.pasarela_eventos[0]).toMatchObject({ evento_id: '390720992-1', resultado: 'registrado', cobro_id: COBRO })
    expect(d.tablas.cobros[0].fecha).toBe('2026-10-22')
    expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('aprobado')
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('cobrado')
    expect(correos).toHaveLength(1)

    const tarde = await procesarEventoPasarela(confirmacion('1', 'Aceptada'), repoPagoEnLinea(d.db, 'epayco', e.adapter), '2026-10-22')
    expect(tarde.resultado).toBe('duplicado')
    expect(correos).toHaveLength(1)
    // Y otra corrida del cron: la cuota ya está pagada, ni consulta ni cobra.
    const otra = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara, ahoraMs: AHORA }, { cobradorId: METRIK, cuotaId: 'q1' })
    expect(otra.tipo).toBe('pagada')
    expect(e.consultas).toHaveLength(1)
  })

  it('rechazado: el id lleva el código del estado (390720992-4) y aplica la rama del rechazo', async () => {
    const d = dobleConEventosUnicos(base())
    const e = epayco({ estado: 'rechazado', externalRef: 'epayco-390720992', codigo: '4', mensaje: 'Fallida', reintentable: false })
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara, ahoraMs: AHORA }, { cobradorId: METRIK, cuotaId: 'q1' })
    expect(r.tipo).toBe('rechazado')
    expect(e.cargos).toHaveLength(0)
    expect(d.tablas.pasarela_eventos[0]).toMatchObject({ evento_id: '390720992-4', resultado: 'requiere_revision' })
    expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('rechazado')
    expect(d.tablas.cobros[0].external_ref).toBeNull()
    expect(d.tablas.planes_cobro[0].pasarela).toBe('bold')
  })

  it('pendiente, o una consulta que falló: no cambia nada y nunca cobra otra vez', async () => {
    for (const consulta of [
      { estado: 'pendiente', externalRef: 'epayco-390720992' },
      { estado: 'error', mensaje: 'ePayco no consultó la transacción', reintentable: true },
    ] as ResultadoCargo[]) {
      const d = dobleConEventosUnicos(base())
      const e = epayco(consulta)
      const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara, ahoraMs: AHORA }, { cobradorId: METRIK, cuotaId: 'q1' })
      expect(r.tipo).toBe('pendiente_previo')
      expect(e.cargos).toHaveLength(0)
      expect(d.tablas.pasarela_eventos).toHaveLength(0)
      expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('pendiente')
    }
  })

  it('el cron concilia un cargo pendiente también en un día sin intento del calendario', async () => {
    const t = base({ cobro_estado: 'cobrado' })
    // La cuota 1 ya pagada; la 2 quedó pendiente el día de su vencimiento y hoy es el día 1 de mora.
    Object.assign(t.cobros[0], { fecha: '2026-10-22' })
    t.cobro_intentos_tarjeta[0].resultado = 'aprobado'
    const C2 = 'a1b2c3d4-0000-4000-8000-000000000002'
    t.cobros.push({ ...t.cobros[0], id: C2, numero_cuota: 2, fecha: null, external_ref: 'epayco-500' })
    t.cobro_intentos_tarjeta.push({ id: 'i2', workspace_id: METRIK, cobro_id: C2, plan_cobro_id: 'p1', numero_cuota: 2, intento: 0, resultado: 'pendiente', referencia: 'epayco-500' })
    const d = dobleConEventosUnicos(t)
    const e = epayco({ estado: 'aprobado', externalRef: 'epayco-500', fecha: '2026-11-23', monto: 150000 })
    const r = await cobrarCuotasConTarjeta({ db: d.db, adapterPara: e.adapterPara, hoy: '2026-11-23', ahoraMs: AHORA })
    expect(e.consultas).toEqual(['epayco-500'])
    expect(e.cargos).toHaveLength(0)
    expect(r.aprobadas).toBe(1)
    expect(d.tablas.cobros[1].fecha).toBe('2026-11-23')
    expect(d.tablas.cobro_intentos_tarjeta[1].resultado).toBe('aprobado')
  })
})

describe('(d) el registro que quedó en cobro_pendiente con el pago ya registrado', () => {
  /** Lo que quedó en producción el 2026-10-22: el pago registrado y el evento cerrado, nada más. */
  function comoQuedo22Oct(registro: Record<string, unknown> = {}) {
    const t = base(registro)
    Object.assign(t.cobros[0], { fecha: '2026-10-22', fuente: 'epayco' })
    t.pasarela_eventos.push({ pasarela: 'epayco', evento_id: '390720992-1', resultado: 'registrado' })
    return dobleConEventosUnicos(t)
  }
  const deps = (d: ReturnType<typeof dobleConEventosUnicos>) => ({ db: d.db, ahoraMs: AHORA, ultimos4: async () => '0326' })

  it('el caso real: la confirmación ya no vuelve y la conciliación del cargo no mira una cuota pagada; el cron (7e) lo cierra con el C3 una vez', async () => {
    const d = comoQuedo22Oct()
    // La confirmación repetida es duplicado (el evento ya está cerrado): por ahí no se cierra nada.
    const otra = await procesarEventoPasarela(confirmacion('1', 'Aceptada'), repoPagoEnLinea(d.db, 'epayco', adapterNulo), '2026-10-22')
    expect(otra.resultado).toBe('duplicado')
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('cobro_pendiente')

    const r = await conciliarRegistrosConCobroPendiente(deps(d))
    expect(r.revisados).toBe(1)
    expect(r.errores).toEqual([])
    expect(r.cerrados).toHaveLength(1)
    expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('aprobado')
    expect(d.tablas.valida_registros[0]).toMatchObject({ cobro_estado: 'cobrado', cobro_ref: 'epayco-390720992' })
    expect(correos).toHaveLength(1)
    expect(correos[0]).toMatchObject({ to: ['ana@cda.co'], idem: `valida-cobro-confirmado-${REG}` })

    // Otra corrida: ya no hay registros en cobro_pendiente.
    const segunda = await conciliarRegistrosConCobroPendiente(deps(d))
    expect(segunda.revisados).toBe(0)
    expect(correos).toHaveLength(1)
  })

  it('la confirmación llega ANTES de que el cargo escriba cobro_pendiente: el cargo lo cierra al terminar, con el C3 una vez', async () => {
    const d = dobleConEventosUnicos(base({ cobro_estado: 'cobrando' }))
    const r = await procesarEventoPasarela(confirmacion('1', 'Aceptada'), repoPagoEnLinea(d.db, 'epayco', adapterNulo), '2026-10-22')
    expect(r.resultado).toBe('registrado')
    expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('aprobado')
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('cobrando')
    expect(correos).toHaveLength(0)

    // El cargo escribe ahora `cobro_pendiente` (registrarResultado) y mira otra vez.
    d.tablas.valida_registros[0].cobro_estado = 'cobro_pendiente'
    const cierre = await cerrarRegistroConPagoRegistrado(deps(d), REG)
    expect(cierre).toMatchObject({ tipo: 'cerrado', revisar: false })
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('cobrado')
    expect(correos).toHaveLength(1)

    expect(await cerrarRegistroConPagoRegistrado(deps(d), REG)).toEqual({ tipo: 'sin_cambio', motivo: 'no_esta_en_cobro_pendiente' })
    expect((await procesarEventoPasarela(confirmacion('1', 'Aceptada'), repoPagoEnLinea(d.db, 'epayco', adapterNulo), '2026-10-22')).resultado).toBe('duplicado')
    expect(correos).toHaveLength(1)
  })

  it('sin pago registrado no toca nada (lo cierra la confirmación o la conciliación del cargo)', async () => {
    const d = dobleConEventosUnicos(base())
    const r = await conciliarRegistrosConCobroPendiente(deps(d))
    expect(r).toMatchObject({ revisados: 1, cerrados: [], errores: [] })
    expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('pendiente')
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('cobro_pendiente')
    expect(correos).toHaveLength(0)
  })

  it('el cierre lee el pago de la base: sin pago registrado no cierra el intento ni el registro', async () => {
    const d = dobleConEventosUnicos(base())
    const cobro = { id: COBRO, workspaceId: METRIK, negocioId: null, suscripcionId: SUS, monto: 150000, fecha: '2026-10-22', anuladoAt: null, tipoCobro: 'programado', externalRef: 'epayco-390720992', notas: null }
    expect(await cerrarCargoAprobadoTardio(deps(d), cobro)).toBeNull()
    expect(d.tablas.cobro_intentos_tarjeta[0].resultado).toBe('pendiente')
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('cobro_pendiente')
    expect(correos).toHaveLength(0)
  })

  it('un pago anulado no cierra el registro', async () => {
    const d = comoQuedo22Oct()
    d.tablas.cobros[0].anulado_at = '2026-10-22T16:42:00Z'
    expect(await cerrarRegistroConPagoRegistrado(deps(d), REG)).toEqual({ tipo: 'sin_cambio', motivo: 'cuota_1_sin_pago' })
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('cobro_pendiente')
    expect(correos).toHaveLength(0)
  })

  it('la cuota 1 pagada por OTRO medio (un enlace): el registro pasa a cobrado, sin el C3 que nombra la tarjeta', async () => {
    const d = comoQuedo22Oct()
    d.tablas.cobros[0].external_ref = 'bold-LNK-77'
    const r = await cerrarRegistroConPagoRegistrado(deps(d), REG)
    expect(r.tipo).toBe('cerrado')
    expect(d.tablas.valida_registros[0]).toMatchObject({ cobro_estado: 'cobrado', cobro_ref: 'bold-LNK-77' })
    expect(correos).toHaveLength(0)
  })
})
