/**
 * El reverso del pago de un ciclo de Valida autogestionada CIERRA el plan en el acto (decisión de
 * Mauricio, 2026-10-27; condiciones de Emilio). Con el código real de la anulación por reverso
 * (`anularCobroPorReverso`), del corte (`corte-reverso-servidor.ts`), del ciclo (`ciclo-servidor.ts`) y
 * de la reactivación (`reactivacion-servidor.ts`), sobre el doble de tablas. Lo simulado: la base, Valida
 * (`llamar`), la pasarela del enlace y los dos correos (el interno y el del cliente).
 */
import { describe, expect, it, vi } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import type { PeticionValida, ResultadoValida } from '@/lib/valida-api/cliente-nucleo'
import type { CorreoSaliente, ResultadoEnvio } from '@/lib/cobros/enlace-automatico-servidor'
import type { PasarelaAdapter, SolicitudEnlacePago } from '@/lib/suscripciones/pasarela/adapter'
import type { CobroParaPago } from '@/lib/cobros/pago-en-linea'
import type { EventoPasarela } from '@/lib/suscripciones/pasarela/adapter'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => {
    throw new Error('la prueba no usa el cliente de servicio')
  },
}))

const { anularCobroPorReverso } = await import('@/lib/cobros/reverso-pasarela-servidor')
const { cortarCicloEnValida, reintentarCortesPorReverso, suspensionPorReversoEnPantalla } = await import('./corte-reverso-servidor')
const { abrirCicloSiCorresponde, reconciliarCiclosValida } = await import('./ciclo-servidor')
const { enlaceDeReactivacion, SIN_SUSPENSION } = await import('./reactivacion-servidor')
const { planSuspendidoPorReverso } = await import('./plan')
const { correoSuspensionPorReverso, frasesSuspension, corteTrasRespuesta } = await import('./corte-reverso')

const METRIK = 'ws-metrik'
const PAGADOR = 'ws-cda-prueba'
const SUS = 'sus-1'
const COBRO = 'f5f27bbf-1bd0-49fd-9987-1de37d77bc6f'
const CLIENTE = 'cli-9'
// 10:42 a. m. en Bogotá.
const AHORA = new Date('2026-10-27T15:42:00Z')
const ANULADO_EN = '2026-10-27T15:42:05.000Z'
const PLAN = {
  cliente_id: CLIENTE,
  limite_mes: 3000,
  cobro_id: COBRO,
  cuota_numero: 1,
  desde: '2026-10-22',
  hasta: '2026-11-21',
  vence_en: '2026-12-02T05:00:00.000Z',
  abierto_at: '2026-10-22T14:28:59Z',
}

function base(extra: Partial<Tablas> = {}): Tablas {
  return {
    suscripciones_producto: [{ id: SUS, workspace_id: METRIK, estado: 'activa', razon_social: 'CDA PRUEBA S.A.S.', numero_documento: '900990011' }],
    catalogo_servicios: [{ slug: 'valida-autogestion', modulo: 'valida_consulta' }],
    servicios_contratados: [
      { id: 'sc-1', workspace_id: METRIK, negocio_id: null, suscripcion_id: SUS, servicio_slug: 'valida-autogestion', workspace_pagador_id: PAGADOR, estado: 'activo', parametros: {} },
    ],
    workspaces: [
      { id: PAGADOR, slug: 'cda-prueba', config_extra: { origen_registro: 'valida_autogestion', valida_cliente_id: CLIENTE, valida_plan: PLAN } },
      { id: METRIK, slug: 'metrik', config_extra: {} },
    ],
    valida_registros: [{ id: 'r1', workspace_id: PAGADOR, estado: 'creado', usuario_id: 'u-dueña', correo: 'Gerencia@CDA.co', razon_social: 'CDA PRUEBA S.A.S.' }],
    planes_cobro: [{ id: 'p1', workspace_id: METRIK, negocio_id: null, suscripcion_id: SUS, pasarela: 'epayco', total_cuotas: 12 }],
    plan_cobro_cuotas: [{ id: 'q1', workspace_id: METRIK, plan_cobro_id: 'p1', numero: 1, tipo: 'mensual', monto: 150000, fecha_vencimiento: '2026-10-22', concepto_detalle: null }],
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
        notas: 'Cuota 1 de 12',
      },
    ],
    pasarela_eventos: [{ id: 'ev-1', pasarela: 'epayco', evento_id: '390720992-1', transaccion_id: '390720992', cobro_id: COBRO, resultado: 'registrado', detalle: 'Pago registrado.' }],
    facturas_cobro: [],
    ...extra,
  }
}

const COBRO_PAGO: CobroParaPago = {
  id: COBRO,
  workspaceId: METRIK,
  negocioId: null,
  suscripcionId: SUS,
  monto: 150000,
  fecha: '2026-10-22',
  anuladoAt: null,
  tipoCobro: 'programado',
  externalRef: 'epayco-390720992',
  notas: 'Cuota 1 de 12',
}

const EVENTO: EventoPasarela = {
  tipo: 'anulado',
  eventoId: '390720992-6',
  tipoOriginal: '6 Reversada',
  transaccionId: '390720992',
  referenciaPago: 'epayco-390720992',
  referencia: null,
  idEnlace: null,
  monto: 150000,
  moneda: 'COP',
  ocurridoAt: null,
  crudo: {},
}

type R = ResultadoValida<unknown>
const OK_ANULADO: R = {
  tipo: 'ok',
  status: 200,
  datos: { ok: true, ya_anulado: false, referencia: `one-ciclo:${COBRO}`, bolsa_id: 'b1', anulado_en: ANULADO_EN, consultas_compradas: 3000, consumidas: 12, saldo_anulado: 2988, llaves_vencidas: 1 },
}
const CAIDA: R = { tipo: 'no_disponible', motivo: 'error_valida', status: 500 }

/** Valida simulada: responde, en orden, lo que se le dé (la última se repite). */
function valida(...respuestas: R[]) {
  const llamadas: PeticionValida[] = []
  const llamar = (async (p: PeticionValida) => {
    llamadas.push(p)
    return respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)]
  }) as <T>(p: PeticionValida) => Promise<ResultadoValida<T>>
  return { llamar, llamadas }
}

function correos() {
  const cliente: CorreoSaliente[] = []
  const interno: { to: string; text: string }[] = []
  return {
    cliente,
    interno,
    enviarCliente: async (m: CorreoSaliente): Promise<ResultadoEnvio> => (cliente.push(m), { ok: true, id: 'm1' }),
    enviarInterno: async (m: { to: string; text: string }) => (interno.push(m), { ok: true as const }),
  }
}

const PREVIEW = { VERCEL_ENV: 'preview', NEXT_PUBLIC_BASE_DOMAIN: 'metrikone.co' }

function config(t: Tablas) {
  return t.workspaces.find((w) => w.id === PAGADOR)?.config_extra as Record<string, unknown>
}
function corteDe(t: Tablas) {
  return ((config(t).valida_plan as Record<string, unknown>).reversado as Record<string, unknown> | undefined)?.corte as Record<string, unknown> | undefined
}

async function reversar(t: Tablas, v: ReturnType<typeof valida>, c = correos(), env: Record<string, string> = PREVIEW) {
  const { db, tablas } = crearDoble(t)
  const r = await anularCobroPorReverso(db, 'epayco', COBRO_PAGO, EVENTO, {
    enviarCorreo: c.enviarInterno as never,
    ahora: () => AHORA,
    corte: { llamar: v.llamar, enviarCorreo: c.enviarCliente, env, ahora: () => AHORA },
  })
  return { db, tablas, r, c }
}

describe('el reverso del pago que abrió el ciclo vigente', () => {
  it('pide a Valida anular ese ciclo, deja el plan suspendido y avisa al cliente una vez', async () => {
    const v = valida(OK_ANULADO)
    const { db, tablas, r, c } = await reversar(base(), v)
    expect(r.anulado).toBe(true)

    expect(v.llamadas).toHaveLength(1)
    expect(v.llamadas[0]).toMatchObject({ metodo: 'POST', ruta: `/autogestion/${CLIENTE}/ciclos/anular` })
    const actor = { usuario_id: 'u-dueña', correo: 'gerencia@cda.co' }
    expect(v.llamadas[0].actor).toEqual(actor)
    expect(v.llamadas[0].cuerpo).toEqual({
      actor,
      referencia: `one-ciclo:${COBRO}`,
      motivo: 'Reverso del pago epayco-390720992: la plata volvió al pagador. ONE cierra el plan en el acto.',
    })

    expect(corteDe(tablas)).toMatchObject({ estado: 'anulado', monto: 150000, intentos: 1, anulado_en: ANULADO_EN, aviso_cliente: { estado: 'enviado' } })
    expect(planSuspendidoPorReverso(config(tablas))).not.toBeNull()

    expect(c.cliente).toHaveLength(1)
    expect(c.cliente[0].to).toBe('Gerencia@CDA.co')
    expect(c.cliente[0].idempotencyKey).toBe(`valida-reverso-cliente-${COBRO}`)
    expect(c.cliente[0].text).toContain(
      'El pago de $150.000 del período 22 de octubre de 2026–21 de noviembre de 2026 fue reversado. Desde el 27 de octubre de 2026 a las 10:42 a. m., Valida no permite consultas nuevas para CDA PRUEBA S.A.S. Tus reportes y tu historial siguen disponibles. Para reactivar el plan, paga el período aquí: https://cda-prueba.metrikone.co/valida.',
    )
    // El aviso interno dice lo que pasó.
    expect(c.interno).toHaveLength(1)
    expect(c.interno[0].text).toContain('ONE CERRÓ el plan en Valida')
    expect(r.detalle).toContain('Se le avisó al cliente por correo.')

    // Repetir (la confirmación otra vez, o el cron) no vuelve a llamar ni a avisar.
    await cortarCicloEnValida(PAGADOR, { db, llamar: v.llamar, enviarCorreo: c.enviarCliente, env: PREVIEW, ahora: () => AHORA })
    const resumen = await reintentarCortesPorReverso({ db, llamar: v.llamar, enviarCorreo: c.enviarCliente, env: PREVIEW, ahora: () => AHORA })
    expect(resumen.revisados).toBe(0)
    expect(v.llamadas).toHaveLength(1)
    expect(c.cliente).toHaveLength(1)
  })

  it('/valida recibe los datos de la suspensión con la misma frase del correo', async () => {
    const { db, tablas } = await reversar(base(), valida(OK_ANULADO))
    const s = await suspensionPorReversoEnPantalla(db, PAGADOR, config(tablas))
    expect(s).toEqual({ monto: 150000, desde: '2026-10-22', hasta: '2026-11-21', anuladoEn: ANULADO_EN, razonSocial: 'CDA PRUEBA S.A.S.' })
    const f = frasesSuspension(s!)
    expect(f.desde).toBe('Desde el 27 de octubre de 2026 a las 10:42 a. m., Valida no permite consultas nuevas para CDA PRUEBA S.A.S.')
  })

  it('un pago que no abrió el ciclo vigente no corta nada', async () => {
    const t = base()
    config(t).valida_plan = { ...PLAN, cobro_id: 'otro-cobro', cuota_numero: 2 }
    const v = valida(OK_ANULADO)
    const { tablas, c } = await reversar(t, v)
    expect(v.llamadas).toHaveLength(0)
    expect(corteDe(tablas)).toBeUndefined()
    expect(c.cliente).toHaveLength(0)
  })
})

describe('condición de Emilio: con otro pago válido de la cuota el plan NO se corta', () => {
  it('un pago registrado que sigue cubriendo la cuota (cobro duplicado reversado por MéTRIK)', async () => {
    const t = base()
    t.cobros.push({ id: 'pago-2', workspace_id: METRIK, negocio_id: null, suscripcion_id: SUS, plan_cobro_id: null, numero_cuota: null, monto: 150000, retencion_iva: 0, fecha: '2026-10-22', anulado_at: null, tipo_cobro: 'regular' })
    const v = valida(OK_ANULADO)
    const { tablas, r, c } = await reversar(t, v)
    expect(v.llamadas).toHaveLength(0)
    expect(corteDe(tablas)).toMatchObject({ estado: 'no_aplica', intentos: 0 })
    expect(String(corteDe(tablas)?.detalle)).toContain('otros pagos registrados siguen cubriendo la cuota 1')
    expect(planSuspendidoPorReverso(config(tablas))).toBeNull()
    expect(c.cliente).toHaveLength(0)
    expect(r.detalle).toContain('NO se cerró el plan en Valida')
  })

  it('un segundo pago aprobado de la cuota que quedó en revisión por posible doble pago', async () => {
    const t = base()
    t.pasarela_eventos.push({ id: 'ev-2', pasarela: 'epayco', evento_id: '390720993-1', transaccion_id: '390720993', cobro_id: COBRO, resultado: 'requiere_revision', detalle: 'Entró un pago en línea (epayco-390720993) sobre una cuota que ya estaba pagada (2026-10-22, epayco-390720992): posible doble pago.' })
    const v = valida(OK_ANULADO)
    const { tablas } = await reversar(t, v)
    expect(v.llamadas).toHaveLength(0)
    expect(corteDe(tablas)).toMatchObject({ estado: 'no_aplica' })
    expect(String(corteDe(tablas)?.detalle)).toContain('390720993')
  })

  it('el segundo pago que también se reversó ya no cuenta: el plan se corta', async () => {
    const t = base()
    t.pasarela_eventos.push(
      { id: 'ev-2', pasarela: 'epayco', evento_id: '390720993-1', transaccion_id: '390720993', cobro_id: COBRO, resultado: 'requiere_revision', detalle: '…: posible doble pago.' },
      { id: 'ev-3', pasarela: 'epayco', evento_id: '390720993-6', transaccion_id: '390720993', cobro_id: COBRO, resultado: 'requiere_revision', detalle: 'reversado' },
    )
    const v = valida(OK_ANULADO)
    const { tablas } = await reversar(t, v)
    expect(v.llamadas).toHaveLength(1)
    expect(corteDe(tablas)).toMatchObject({ estado: 'anulado' })
  })
})

describe('Valida caída, rechazos finales y el correo', () => {
  it('Valida no responde: queda pendiente y el cron lo reintenta hasta anularlo (el correo sale ese mismo día)', async () => {
    const v = valida(CAIDA, OK_ANULADO)
    const { db, tablas, c } = await reversar(base(), v)
    expect(corteDe(tablas)).toMatchObject({ estado: 'pendiente', intentos: 1 })
    expect(String(corteDe(tablas)?.detalle)).toContain('error_valida 500')
    expect(c.cliente).toHaveLength(0)
    expect(c.interno[0].text).toContain('ONE pidió cerrar el plan en Valida y no se pudo todavía')

    const tarde = new Date('2026-10-27T22:00:00Z')
    const resumen = await reintentarCortesPorReverso({ db, llamar: v.llamar, enviarCorreo: c.enviarCliente, env: PREVIEW, ahora: () => tarde })
    expect(resumen).toMatchObject({ revisados: 1, anulados: 1, avisos: 1, pendientes: [], errores: [] })
    expect(v.llamadas).toHaveLength(2)
    expect(v.llamadas[1].cuerpo).toEqual(v.llamadas[0].cuerpo)
    expect(corteDe(tablas)).toMatchObject({ estado: 'anulado', intentos: 2 })
    expect(c.cliente).toHaveLength(1)
  })

  it.each([
    ['409 ciclo_reemplazado', { tipo: 'rechazada', status: 409, codigo: 'ciclo_reemplazado', mensaje: '' } as R],
    ['404 ciclo_no_existe', { tipo: 'rechazada', status: 404, codigo: 'ciclo_no_existe', mensaje: '' } as R],
    ['404 cliente_no_existe', { tipo: 'rechazada', status: 404, codigo: 'cliente_no_existe', mensaje: '' } as R],
  ])('%s: se registra como final y el cron no lo reintenta', async (codigo, respuesta) => {
    const v = valida(respuesta)
    const { db, tablas, c } = await reversar(base(), v)
    expect(corteDe(tablas)).toMatchObject({ estado: 'final', intentos: 1 })
    expect(String(corteDe(tablas)?.detalle)).toContain(codigo)
    const resumen = await reintentarCortesPorReverso({ db, llamar: v.llamar, enviarCorreo: c.enviarCliente, env: PREVIEW, ahora: () => AHORA })
    expect(resumen.revisados).toBe(0)
    expect(v.llamadas).toHaveLength(1)
    expect(c.cliente).toHaveLength(0)
    expect(planSuspendidoPorReverso(config(tablas))).toBeNull()
  })

  it('un 404 que no es de la ruta (Valida sin desplegar) se reintenta, no se da por final', () => {
    const previo = { estado: 'pendiente' as const, monto: 150000, intentos: 0 }
    const r = corteTrasRespuesta(previo, { tipo: 'rechazada', status: 404, codigo: 'error_desconocido', mensaje: '' }, AHORA.toISOString())
    expect(r.estado).toBe('pendiente')
  })

  it('en producción, sin el visto bueno de Vera, el corte se hace y el correo queda retenido', async () => {
    const { tablas, c } = await reversar(base(), valida(OK_ANULADO), correos(), { VERCEL_ENV: 'production' })
    expect(corteDe(tablas)).toMatchObject({ estado: 'anulado', aviso_cliente: { estado: 'retenido' } })
    expect(c.cliente).toHaveLength(0)
  })

  it('el correo que no salió el día del corte ya no sale al día siguiente', async () => {
    const c = correos()
    const fallido = { ...c, enviarCliente: async () => ({ ok: false as const, error: 'resend_500' }) }
    const { db, tablas } = await reversar(base(), valida(OK_ANULADO), fallido)
    expect(corteDe(tablas)).toMatchObject({ aviso_cliente: { estado: 'fallido' } })
    const manana = new Date('2026-10-28T12:00:00Z')
    await reintentarCortesPorReverso({ db, llamar: valida(OK_ANULADO).llamar, enviarCorreo: c.enviarCliente, env: PREVIEW, ahora: () => manana })
    expect(corteDe(tablas)).toMatchObject({ aviso_cliente: { estado: 'vencido' } })
    expect(c.cliente).toHaveLength(0)
  })

  it('el texto del correo es el de Emilio', () => {
    const m = correoSuspensionPorReverso({ monto: 150000, desde: '2026-10-22', hasta: '2026-11-21', anuladoEn: ANULADO_EN, razonSocial: 'ACME S.A.S.', url: 'https://acme.metrikone.co/valida' })
    expect(m.text).toBe(
      [
        'Hola:',
        'El pago de $150.000 del período 22 de octubre de 2026–21 de noviembre de 2026 fue reversado. Desde el 27 de octubre de 2026 a las 10:42 a. m., Valida no permite consultas nuevas para ACME S.A.S. Tus reportes y tu historial siguen disponibles. Para reactivar el plan, paga el período aquí: https://acme.metrikone.co/valida.',
        'METRIK IA S.A.S.',
      ].join('\n\n'),
    )
  })
})

describe('/ciclos con una referencia anulada (409 ciclo_anulado)', () => {
  it('es estado final: no queda pendiente ni rompe el paso 8', async () => {
    const t = base()
    // Un ciclo de la cuota 2, pagado, cuya referencia Valida dice anulada.
    t.plan_cobro_cuotas.push({ id: 'q2', workspace_id: METRIK, plan_cobro_id: 'p1', numero: 2, tipo: 'mensual', monto: 150000, fecha_vencimiento: '2026-11-22', concepto_detalle: null })
    t.cobros.push({ id: 'cobro-2', workspace_id: METRIK, negocio_id: null, suscripcion_id: SUS, plan_cobro_id: 'p1', numero_cuota: 2, monto: 150000, fecha: '2026-11-22', anulado_at: null, tipo_cobro: 'programado' })
    const { db } = crearDoble(t)
    const v = valida({ tipo: 'rechazada', status: 409, codigo: 'ciclo_anulado', mensaje: '' })
    const r = await abrirCicloSiCorresponde('cobro-2', { db, llamar: v.llamar, ahora: AHORA })
    expect(r.tipo).toBe('ciclo_anulado')
    const resumen = await reconciliarCiclosValida({ db, llamar: v.llamar, ahora: AHORA })
    expect(resumen).toMatchObject({ abiertos: 0, pendientes: [], errores: [] })
  })
})

describe('reactivar: pagar el período', () => {
  function pasarela() {
    const pedidos: SolicitudEnlacePago[] = []
    const adapter = {
      nombre: 'epayco',
      capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: true, webhook: true },
      cobrar: async () => {
        throw new Error('no cobra')
      },
      consultar: async () => {
        throw new Error('no consulta')
      },
      crearEnlacePago: async (s: SolicitudEnlacePago) => {
        pedidos.push(s)
        return { ok: true as const, idEnlace: `L${pedidos.length}`, url: `https://pago.test/L${pedidos.length}`, expira: new Date(s.expiraMs).toISOString() }
      },
    } as unknown as PasarelaAdapter
    return { adapter, pedidos }
  }

  it('crea un cobro aparte por el valor del período, con enlace; pagado, abre el ciclo del mismo período y levanta la suspensión', async () => {
    const { db, tablas } = await reversar(base(), valida(OK_ANULADO))
    const p = pasarela()
    const ahoraMs = AHORA.getTime()
    const r = await enlaceDeReactivacion(PAGADOR, { db, adapterPara: () => p.adapter, ahoraMs })
    expect(r).toEqual({ ok: true, url: 'https://pago.test/L1' })

    const recobroId = (config(tablas).valida_plan as { reversado: { recobro_cobro_id: string } }).reversado.recobro_cobro_id
    const recobro = tablas.cobros.find((c) => c.id === recobroId) as Record<string, unknown>
    expect(recobro).toMatchObject({ workspace_id: METRIK, suscripcion_id: SUS, plan_cobro_id: null, numero_cuota: null, monto: 150000, tipo_cobro: 'programado', fecha: null, enlace_pago_url: 'https://pago.test/L1' })
    expect(p.pedidos[0]).toMatchObject({ cobroId: recobroId, monto: 150000 })
    expect(p.pedidos[0].descripcion).toBe('Valida · reactivación del período 22/10/2026 a 21/11/2026')
    // El cobro reversado no se toca.
    expect(tablas.cobros.find((c) => c.id === COBRO)).toMatchObject({ monto: 0, monto_anulado: 150000 })

    // Pedirlo otra vez devuelve el mismo enlace vigente.
    expect(await enlaceDeReactivacion(PAGADOR, { db, adapterPara: () => p.adapter, ahoraMs })).toEqual({ ok: true, url: 'https://pago.test/L1' })
    expect(p.pedidos).toHaveLength(1)

    // Se paga (el webhook registra el pago) y se abre el ciclo con su propia referencia.
    recobro.fecha = '2026-10-27'
    const v = valida({ tipo: 'ok', status: 201, datos: { ya_registrada: false, vence_en: '2026-12-02T05:00:00.000Z' } })
    const abierto = await abrirCicloSiCorresponde(recobroId, { db, llamar: v.llamar, ahora: AHORA })
    expect(abierto.tipo).toBe('abierto')
    expect(v.llamadas[0]).toMatchObject({ ruta: `/autogestion/${CLIENTE}/ciclos` })
    expect(v.llamadas[0].cuerpo).toMatchObject({ referencia: `one-ciclo:${recobroId}`, consultas: 3000, precio_total: 150000 })
    expect(config(tablas).valida_plan).toMatchObject({ cobro_id: recobroId, cuota_numero: 1, desde: '2026-10-22', hasta: '2026-11-21' })
    expect(planSuspendidoPorReverso(config(tablas))).toBeNull()
    expect(await enlaceDeReactivacion(PAGADOR, { db, adapterPara: () => p.adapter, ahoraMs })).toEqual({ ok: false, error: SIN_SUSPENSION })
  })

  it('el paso 8 abre el ciclo de un pago de reactivación que el webhook no alcanzó', async () => {
    const { db, tablas } = await reversar(base(), valida(OK_ANULADO))
    await enlaceDeReactivacion(PAGADOR, { db, adapterPara: () => pasarela().adapter, ahoraMs: AHORA.getTime() })
    const recobroId = (config(tablas).valida_plan as { reversado: { recobro_cobro_id: string } }).reversado.recobro_cobro_id
    ;(tablas.cobros.find((c) => c.id === recobroId) as Record<string, unknown>).fecha = '2026-10-27'
    const v = valida({ tipo: 'ok', status: 201, datos: { ya_registrada: false } })
    const resumen = await reconciliarCiclosValida({ db, llamar: v.llamar, ahora: AHORA })
    expect(resumen.abiertos).toBe(1)
    expect(v.llamadas).toHaveLength(1)
    expect(planSuspendidoPorReverso(config(tablas))).toBeNull()
  })

  it('para la mora y la pestaña Pagos la cuota reversada NO cuenta como pagada; el pago de reactivación la cubre', async () => {
    const { cuotasConEstado } = await import('@/lib/valida-cda/pago-pendiente')
    const { db, tablas } = await reversar(base(), valida(OK_ANULADO))
    // El mismo criterio de `mis_cobros_de_servicio`: anulado > sin fecha (programado) > pagado.
    const leer = () =>
      cuotasConEstado({
        cuotas: [{ cuotaId: 'q1', numero: 1, tipo: 'mensual', monto: 150000, fechaVencimiento: '2026-10-22', concepto: null, enlacePagoUrl: null, enlacePagoExpira: null }],
        cobros: tablas.cobros.map((c) => ({ monto: Number(c.monto ?? 0), estado: c.anulado_at ? ('anulado' as const) : c.fecha === null ? ('programado' as const) : ('pagado' as const) })),
        hoy: '2026-10-27',
        ahoraISO: AHORA.toISOString(),
      })[0].estado
    expect(leer()).toBe('vencida')
    await enlaceDeReactivacion(PAGADOR, { db, adapterPara: () => pasarela().adapter, ahoraMs: AHORA.getTime() })
    const recobroId = (config(tablas).valida_plan as { reversado: { recobro_cobro_id: string } }).reversado.recobro_cobro_id
    ;(tablas.cobros.find((c) => c.id === recobroId) as Record<string, unknown>).fecha = '2026-10-27'
    expect(leer()).toBe('pagada')
  })

  it('sin suspensión no hay nada que pagar', async () => {
    const { db } = crearDoble(base())
    expect(await enlaceDeReactivacion(PAGADOR, { db, adapterPara: () => pasarela().adapter })).toEqual({ ok: false, error: SIN_SUSPENSION })
  })
})
