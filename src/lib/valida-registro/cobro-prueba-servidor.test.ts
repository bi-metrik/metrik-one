import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

vi.mock('server-only', () => ({}))
// El núcleo de la activación y el cobro por token tienen sus propias pruebas; aquí van por inyección.
vi.mock('./activacion-servidor', () => ({ activarPlanDelEspacio: vi.fn() }))

import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import {
  cancelarCobroDelEspacio,
  cobrarAlConfirmar,
  estadoCobroDelEspacio,
  ofertaCobroAlConfirmar,
  procesarCobrosTrasPrueba,
  type DepsCobroPrueba,
} from './cobro-prueba-servidor'
import { textoTrasConfirmar } from './cobro-prueba'
import type { ResultadoCobroToken } from './cobro-token-servidor'

const H = 3_600_000
// Abrió el martes 13 a las 15:00 de Bogotá; los 7 días se cumplen el martes 20 a las 15:00.
const VENCE = '2026-10-20T20:00:00.000Z'
const cron = (dia: string) => Date.parse(`${dia}T12:00:00Z`) // 07:00 de Bogotá
const ENV = { VERCEL_ENV: 'preview' }

function tablas(extra: Record<string, unknown> = {}): Tablas {
  return {
    valida_registros: [
      {
        id: 'reg-1',
        workspace_id: 'ws-cli',
        usuario_id: 'u-1',
        correo: 'gerencia@acme.co',
        razon_social: 'ACME S.A.S.',
        identificacion: '900123456',
        slug_creado: 'acme',
        estado: 'creado',
        metodo_pago_estado: 'registrado',
        metodo_pago_ref: 'epayco:cliente123:token4567',
        cobro_estado: 'programado',
        cobro_programado_at: VENCE,
        cobro_aviso_enviado_at: null,
        cobro_token_borrado_at: null,
        cobro_entorno: 'preview',
        // Aceptó los Términos en el registro (sin esto, el cobro espera).
        terminos_sha256: 'a'.repeat(64),
        ...extra,
      },
    ],
    servicios_contratados: [{ id: 'c-1', workspace_id: 'ws-metrik', negocio_id: 'n-1', workspace_pagador_id: 'ws-cli', estado: 'activo' }],
    planes_cobro: [{ id: 'plan-1', workspace_id: 'ws-metrik', negocio_id: 'n-1', pasarela: 'bold' }],
    plan_cobro_cuotas: [{ id: 'cuota-1', plan_cobro_id: 'plan-1', numero: 1 }],
    workspaces: [{ id: 'ws-cli', config_extra: { valida_pagador: { celular: '3001234567' } } }],
  }
}

function montar(t: Tablas, extra: Partial<DepsCobroPrueba> = {}) {
  const { db, tablas: tb } = crearDoble(t)
  const correos: { to: string; subject: string; idempotencyKey: string }[] = []
  const cobros: string[] = []
  const borrados: (string | null)[] = []
  let resultadoCobro: ResultadoCobroToken = { tipo: 'aprobado', cobroId: 'cobro-1', detalle: 'pagado' }
  const enrolar = vi.fn(async () => ({ candidatos: 1, creados: [], yaEstaban: 0, planExistente: 0, descartes: {}, errores: [] }))
  const activar = vi.fn(async () => ({ ok: true as const, resultado: 'activado' as const, contratoId: 'c-1' }))
  const deps: DepsCobroPrueba = {
    db,
    env: ENV,
    enviarCorreo: async (m) => {
      correos.push(m)
      return { ok: true, id: 'resend-1' }
    },
    urlCuenta: (slug) => `https://${slug}.metrikone.co/valida`,
    terminosDelRegistroListos: () => true,
    activar,
    aceptarTerminos: async () => ({ ok: true }),
    enrolar,
    pasarATarjeta: async () => true,
    cobrarCuota: async () => {
      // Cede el turno, como una llamada real a ePayco: así dos corridas a la vez se intercalan.
      await new Promise((r) => setTimeout(r, 0))
      cobros.push('cuota-1')
      return resultadoCobro
    },
    eliminarTarjeta: async (ref) => {
      borrados.push(ref)
      return { ok: true, borradas: 1 }
    },
    ...extra,
  }
  const registro = () => tb.valida_registros[0]
  return { deps, tablas: tb, correos, cobros, borrados, enrolar, activar, registro, setResultado: (r: ResultadoCobroToken) => (resultadoCobro = r) }
}

const AVISADO = { cobro_aviso_enviado_at: new Date(cron('2026-10-18')).toISOString() }

describe('el aviso de 48 horas', () => {
  it('sale una vez, con la fecha y la hora, aunque el cron corra dos veces', async () => {
    const m = montar(tablas())
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-18') })
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-18') + 60_000 })
    expect(m.correos).toHaveLength(1)
    expect(m.correos[0].to).toBe('gerencia@acme.co')
    expect(m.correos[0].subject).toContain('20 de octubre de 2026, 3:00')
    expect(m.correos[0].idempotencyKey).toBe('valida-aviso-cobro-reg-1')
    expect(m.registro().cobro_aviso_enviado_at).toBe(new Date(cron('2026-10-18')).toISOString())
    expect(m.cobros).toEqual([])
  })

  it('si Resend falla, se suelta y la corrida siguiente lo vuelve a intentar', async () => {
    const m = montar(tablas(), { enviarCorreo: async () => ({ ok: false, error: 'resend_500' }) })
    const r = await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-18') })
    expect(r.avisosFallidos).toHaveLength(1)
    expect(m.registro().cobro_aviso_enviado_at).toBeNull()
  })
})

describe('el cobro en la fecha fija', () => {
  it('el cron del martes 07:00 (antes de las 15:00) no cobra; el del miércoles sí', async () => {
    const m = montar(tablas(AVISADO))
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-20') })
    expect(m.cobros).toEqual([])
    expect(m.registro().cobro_estado).toBe('programado')
    const r = await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(m.cobros).toEqual(['cuota-1'])
    expect(r.cobrados).toBe(1)
    expect(m.registro().cobro_estado).toBe('cobrado')
  })

  it('enrola con la cuota 1 el día del cobro (ancla = ahora)', async () => {
    const m = montar(tablas(AVISADO))
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(m.enrolar).toHaveBeenCalledWith(expect.objectContaining({ contratoId: 'c-1', anclaAt: new Date(cron('2026-10-21')).toISOString() }))
  })

  it('idempotente: dos corridas seguidas o A LA VEZ cobran una sola vez', async () => {
    const m = montar(tablas(AVISADO))
    await Promise.all([
      procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') }),
      procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') }),
    ])
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-22') })
    expect(m.cobros).toEqual(['cuota-1'])
  })

  it('rechazado: queda rechazado, sin reintento con la tarjeta (7.5 y Términos 3.6)', async () => {
    const m = montar(tablas(AVISADO))
    m.setResultado({ tipo: 'rechazado', cobroId: 'cobro-1', mensaje: 'Fondos insuficientes' })
    const r = await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(r.rechazados).toBe(1)
    expect(m.registro().cobro_estado).toBe('rechazado')
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-22') })
    expect(m.cobros).toHaveLength(1)
  })

  it('un error dudoso de ePayco queda en revisar y el plan sale de la tarjeta: nadie lo vuelve a cobrar', async () => {
    const m = montar(tablas(AVISADO), {})
    m.tablas.planes_cobro[0].pasarela = 'epayco'
    m.setResultado({ tipo: 'error', mensaje: 'ePayco no respondió a tiempo' })
    const r = await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(r.aRevisar).toHaveLength(1)
    expect(m.registro().cobro_estado).toBe('revisar')
    expect(m.tablas.planes_cobro[0].pasarela).toBe('manual')
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-22') })
    expect(m.cobros).toHaveLength(1)
  })

  it('si falla ANTES del cobro (activación), no cobra y la fila vuelve a programado para reintentar', async () => {
    const m = montar(tablas(AVISADO), { activar: async () => ({ ok: false, error: 'error' }) })
    const r = await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(m.cobros).toEqual([])
    expect(r.reintentar).toHaveLength(1)
    expect(m.registro().cobro_estado).toBe('programado')
  })

  it('un NIT que ya es cliente con contrato no se cobra: lo revisa una persona', async () => {
    const m = montar(tablas(AVISADO), { activar: async () => ({ ok: false, error: 'nit_con_contrato' }) })
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(m.cobros).toEqual([])
    expect(m.registro().cobro_estado).toBe('revisar')
  })

  it('sin Términos aceptados en el registro (hoy), no reclama ni cobra: espera', async () => {
    const m = montar(tablas(AVISADO), { terminosDelRegistroListos: () => false })
    const r = await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(r.esperandoTerminos).toBe(1)
    expect(m.cobros).toEqual([])
    expect(m.activar).not.toHaveBeenCalled()
    expect(m.registro()).toMatchObject({ cobro_estado: 'programado', cobro_detalle: 'esperando_terminos' })
  })

  it('un registro sin Términos aceptados (de antes del 2026-10-14) tampoco se cobra: espera', async () => {
    const m = montar(tablas({ ...AVISADO, terminos_sha256: null }))
    const r = await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(r.esperandoTerminos).toBe(1)
    expect(m.cobros).toEqual([])
    expect(m.activar).not.toHaveBeenCalled()
    expect(m.registro()).toMatchObject({ cobro_estado: 'programado', cobro_detalle: 'esperando_terminos' })
  })

  it('un preview no toca los registros de producción (usan la misma base)', async () => {
    const m = montar(tablas({ ...AVISADO, cobro_entorno: 'production' }))
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(m.cobros).toEqual([])
    expect(m.registro().cobro_estado).toBe('programado')
  })
})

describe('el ensayo de un preview (cobro directo de la tarjeta de prueba, sin plan)', () => {
  it('solo con VALIDA_COBRO_ENSAYO=1, fuera de producción, y cobra una sola vez', async () => {
    const directos: unknown[] = []
    const m = montar(tablas(AVISADO), {
      terminosDelRegistroListos: () => false,
      env: { VERCEL_ENV: 'preview', VALIDA_COBRO_ENSAYO: '1' },
      cobrarDirecto: async (s) => {
        directos.push(s)
        return { estado: 'aprobado', externalRef: 'epayco-123', fecha: '2026-10-21', monto: 150_000 }
      },
    })
    const r = await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-22') })
    expect(directos).toHaveLength(1)
    expect(directos[0]).toMatchObject({ monto: 150_000, medioPago: { token_ref: 'epayco:cliente123:token4567' } })
    expect(r.ensayos).toEqual([{ registroId: 'reg-1', estado: 'cobrado' }])
    expect(m.registro()).toMatchObject({ cobro_estado: 'cobrado', cobro_ref: 'epayco-123' })
    expect(m.activar).not.toHaveBeenCalled()
  })

  it('en producción no hay ensayo', async () => {
    const directos: unknown[] = []
    const m = montar(tablas({ ...AVISADO, cobro_entorno: 'production' }), {
      terminosDelRegistroListos: () => false,
      env: { VERCEL_ENV: 'production', VALIDA_COBRO_ENSAYO: '1' },
      cobrarDirecto: async () => {
        directos.push(1)
        return { estado: 'aprobado', externalRef: 'x', fecha: '2026-10-21', monto: 1 }
      },
    })
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(directos).toEqual([])
  })
})

describe('Cancelar prueba (7.3)', () => {
  it('no se cobra, se pide borrar la tarjeta y el cron ya no la toca', async () => {
    const m = montar(tablas(AVISADO))
    const c = await cancelarCobroDelEspacio(m.deps, { workspaceId: 'ws-cli', por: 'boton' })
    expect(c).toEqual({ tipo: 'cancelada', tarjetaBorrada: true })
    expect(m.borrados).toEqual(['epayco:cliente123:token4567'])
    expect(m.registro()).toMatchObject({ cobro_estado: 'cancelado', cobro_cancelado_por: 'boton', metodo_pago_estado: 'eliminado' })
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(m.cobros).toEqual([])
    expect(m.borrados).toHaveLength(1)
  })

  it('si ePayco no borra, el cron lo reintenta hasta que borre', async () => {
    let falla = true
    const m = montar(tablas(), {
      eliminarTarjeta: async () => (falla ? { ok: false, error: 'ePayco caído' } : { ok: true, borradas: 1 }),
    })
    expect(await cancelarCobroDelEspacio(m.deps, { workspaceId: 'ws-cli', por: 'boton' })).toEqual({ tipo: 'cancelada', tarjetaBorrada: false })
    expect(m.registro().cobro_token_borrado_at ?? null).toBeNull()
    falla = false
    const r = await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-15') })
    expect(r.tarjetasBorradas).toBe(1)
    expect(m.registro().metodo_pago_estado).toBe('eliminado')
  })

  it('cuando una corrida ya empezó a cobrar, es tarde', async () => {
    const m = montar(tablas({ cobro_estado: 'cobrando' }))
    expect(await cancelarCobroDelEspacio(m.deps, { workspaceId: 'ws-cli', por: 'boton' })).toEqual({ tipo: 'tarde', estado: 'cobrando' })
    expect(m.borrados).toEqual([])
  })

  it('se respeta aunque pasó la hora, mientras no se haya cobrado', async () => {
    const m = montar(tablas(AVISADO))
    const c = await cancelarCobroDelEspacio({ ...m.deps, ahoraMs: Date.parse(VENCE) + 2 * H }, { workspaceId: 'ws-cli', por: 'boton' })
    expect(c.tipo).toBe('cancelada')
  })

  it('dos veces: la segunda dice que ya estaba', async () => {
    const m = montar(tablas())
    await cancelarCobroDelEspacio(m.deps, { workspaceId: 'ws-cli', por: 'boton' })
    expect(await cancelarCobroDelEspacio(m.deps, { workspaceId: 'ws-cli', por: 'boton' })).toEqual({ tipo: 'ya_cancelada' })
  })

  it('un registro sin tarjeta no tiene nada que cancelar', async () => {
    const m = montar(tablas({ cobro_estado: null }))
    expect(await cancelarCobroDelEspacio(m.deps, { workspaceId: 'ws-cli', por: 'boton' })).toEqual({ tipo: 'sin_cobro' })
  })
})

describe('lo que muestra la cuenta', () => {
  it('la fecha y la hora en que se cumplen los 7 días, y si se puede cancelar', async () => {
    const m = montar(tablas())
    expect(await estadoCobroDelEspacio(m.deps.db, 'ws-cli', ENV)).toMatchObject({
      estado: 'programado',
      programadoAt: VENCE,
      cobroDesde: VENCE,
      puedeCancelar: true,
    })
  })
})

describe('el cobro del primer mes AL CONFIRMAR (Condiciones v2.1, 7.1 literal a)', () => {
  // Aceptó las Condiciones v2.1 (las que contemplan este cobro). Jueves 15: le quedan 5 días de prueba.
  const V21 = { condiciones_version: 'condiciones-2.1+aviso-1.3+terminos-auto-2.1' }
  const JUEVES = cron('2026-10-15') + 6 * H
  const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')
  const TEXTO_11 =
    'Usaste tus 10 consultas de prueba. Activa tu plan ahora: se cobran $150.000 a tu tarjeta terminada en 0326 por el primer mes, y después cada mes en esta misma fecha hasta que te retires. [Activar y pagar $150.000]'
  const conTablas = (extra: Record<string, unknown>) => ({ ...tablas(extra), activity_log: [] as Record<string, unknown>[] })
  const confirmar = (m: ReturnType<typeof montar>, extra: Partial<{ usuarioId: string; agotada: boolean; huella: string; ahoraMs: number }> = {}) =>
    cobrarAlConfirmar(
      { ...m.deps, ahoraMs: extra.ahoraMs ?? JUEVES, ultimos4: async () => '0326' },
      { workspaceId: 'ws-cli', usuarioId: 'u-1', agotada: true, ip: '181.50.1.2', huella: sha(TEXTO_11), ...extra },
    )

  it('consulta 11: al confirmar cobra YA (sin aviso de 48 h ni día 7), activa el plan y deja la constancia de lo que vio y de quién', async () => {
    const m = montar(conTablas(V21))
    const r = await confirmar(m)
    expect(r).toEqual({ tipo: 'cobrado', ultimos4: '0326' })
    expect(m.cobros).toEqual(['cuota-1'])
    expect(m.activar).toHaveBeenCalledWith({ workspaceId: 'ws-cli', usuarioId: 'u-1' })
    // El mes nace hoy: la cuota 1 y las siguientes se anclan al día de la confirmación.
    expect(m.enrolar).toHaveBeenCalledWith(expect.objectContaining({ contratoId: 'c-1', anclaAt: new Date(JUEVES).toISOString() }))
    expect(m.registro()).toMatchObject({
      cobro_estado: 'cobrado',
      cobro_confirmado_at: new Date(JUEVES).toISOString(),
      cobro_confirmado_por: 'u-1',
      cobro_confirmado_ip: '181.50.1.2',
      cobro_confirmado_texto: TEXTO_11,
    })
  })

  it('C3: después del cobro sale UN correo con la fecha, el valor y los 4 dígitos (y ningún aviso de 48 h)', async () => {
    const m = montar(conTablas(V21))
    await confirmar(m)
    expect(m.correos).toHaveLength(1)
    expect(m.correos[0]).toMatchObject({ to: 'gerencia@acme.co', idempotencyKey: 'valida-cobro-confirmado-reg-1' })
    expect(m.correos[0].subject).toBe('Cobramos $150.000 por tu plan de Valida (tarjeta terminada en 0326)')
    expect((m.correos[0] as unknown as { text: string }).text).toMatch(/jueves, 15 de octubre de 2026/)
  })

  it('C8: si el texto que arma el servidor al cobrar no es el que se mostró, no cobra', async () => {
    const m = montar(conTablas(V21))
    // La pantalla mostró otros 4 dígitos (ePayco respondió distinto entre la oferta y el clic).
    const r = await confirmar(m, { huella: sha(TEXTO_11.replace('0326', '9999')) })
    expect(r).toEqual({ tipo: 'no_disponible', motivo: 'texto_distinto' })
    // Y la variante de «Activar plan» no vale con la huella de la consulta 11.
    expect(await confirmar(m, { agotada: false })).toEqual({ tipo: 'no_disponible', motivo: 'texto_distinto' })
    expect(m.cobros).toEqual([])
    expect(m.registro().cobro_estado).toBe('programado')
    expect(m.registro().cobro_confirmado_at ?? null).toBeNull()
  })

  it('C6: sin los 4 dígitos de ePayco no se ofrece ni se cobra al confirmar: queda para el día 7', async () => {
    const m = montar(conTablas(V21))
    const sinDigitos = { ...m.deps, ultimos4: async () => null }
    expect(await ofertaCobroAlConfirmar(sinDigitos, { workspaceId: 'ws-cli', usuarioId: 'u-1', agotada: true })).toEqual({ disponible: false, motivo: 'sin_ultimos4' })
    expect(
      await cobrarAlConfirmar({ ...sinDigitos, ahoraMs: JUEVES }, { workspaceId: 'ws-cli', usuarioId: 'u-1', agotada: true, ip: null, huella: sha(TEXTO_11) }),
    ).toEqual({ tipo: 'no_disponible', motivo: 'sin_ultimos4' })
    expect(m.cobros).toEqual([])
  })

  it('la oferta trae el texto de la pantalla y su huella', async () => {
    const m = montar(conTablas(V21))
    const o = await ofertaCobroAlConfirmar({ ...m.deps, ultimos4: async () => '0326' }, { workspaceId: 'ws-cli', usuarioId: 'u-1', agotada: true })
    expect(o).toMatchObject({ disponible: true, valor: 150_000, ultimos4: '0326', titulo: 'Usaste tus 10 consultas de prueba', huella: sha(TEXTO_11) })
  })

  it('no hay doble cobro: el cron del día 7 (y los siguientes) ya no cobra', async () => {
    const m = montar(conTablas(V21))
    await confirmar(m)
    const avisos = await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-18') })
    const dia7 = await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-22') })
    expect(m.cobros).toEqual(['cuota-1'])
    expect(avisos.avisos).toBe(0)
    expect(dia7.cobrados).toBe(0)
  })

  it('no hay doble cobro aunque el clic y el cron del día 7 lleguen A LA VEZ', async () => {
    const m = montar(conTablas({ ...V21, ...AVISADO }))
    const [clic] = await Promise.all([
      confirmar(m, { ahoraMs: cron('2026-10-21') }),
      procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') }),
    ])
    expect(m.cobros).toEqual(['cuota-1'])
    expect(['cobrado', 'en_curso', 'no_disponible']).toContain(clic.tipo)
    expect((await confirmar(m)).tipo).toBe('no_disponible')
    expect(m.cobros).toHaveLength(1)
  })

  it('tarjeta rechazada al confirmar: lo dice claro, sin plan, conserva la prueba y el cobro del día 7 sigue en pie (intento 1)', async () => {
    const intentos: unknown[] = []
    const m = montar(conTablas(V21), {
      cobrarCuota: async (_d, p) => {
        intentos.push(p)
        return intentos.length === 1 ? { tipo: 'rechazado', cobroId: 'cobro-1', mensaje: 'Fondos insuficientes' } : { tipo: 'aprobado', cobroId: 'cobro-1', detalle: 'pagado' }
      },
    })
    // El intento 0 de la cuota 1 quedó rechazado (lo anota `cobrarCuotaConTarjeta`).
    m.tablas.cobro_intentos_tarjeta = [{ plan_cobro_id: 'plan-1', numero_cuota: 1, intento: 0, resultado: 'rechazado' }]
    const r = await confirmar(m)
    expect(r).toEqual({ tipo: 'rechazado', mensaje: 'Fondos insuficientes', ultimos4: '0326' })
    expect(textoTrasConfirmar(r.tipo, { valor: 150_000, ultimos4: '0326' })).toBe(
      'No se pudo cobrar a tu tarjeta terminada en 0326: el pago fue rechazado. No se cobró nada y tu plan no quedó activo. Conservas lo que te queda de la prueba. Te enviamos al correo un enlace para pagar con otro medio; si no pagas ni cancelas, el cobro se intenta otra vez al cumplirse los 7 días.',
    )
    // Conserva la prueba: vuelve a programado, con el mismo plazo, y no se le ofrece otra confirmación.
    expect(m.registro()).toMatchObject({ cobro_estado: 'programado', cobro_programado_at: VENCE, cobro_confirmacion_rechazada_at: new Date(JUEVES).toISOString() })
    expect(m.correos).toEqual([])
    expect(await confirmar(m)).toEqual({ tipo: 'no_disponible', motivo: 'confirmacion_rechazada' })
    // Antes del día 7, nada.
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-17') })
    expect(intentos).toHaveLength(1)
    // El aviso de 48 h y el día 7: el cobro del literal (b), como intento 1 de la cuota 1.
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-18') })
    expect(m.correos.map((c) => c.idempotencyKey)).toEqual(['valida-aviso-cobro-reg-1'])
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(intentos).toEqual([
      { cobradorId: 'ws-metrik', cuotaId: 'cuota-1', intento: 0, reintentoTrasConfirmacion: false },
      { cobradorId: 'ws-metrik', cuotaId: 'cuota-1', intento: 1, reintentoTrasConfirmacion: true },
    ])
    expect(m.registro().cobro_estado).toBe('cobrado')
  })

  it('si el cobro del día 7 tras la confirmación rechazada también falla, se cierra (7.5 literal b)', async () => {
    const m = montar(conTablas({ ...V21, ...AVISADO, cobro_confirmacion_rechazada_at: new Date(JUEVES).toISOString() }))
    m.tablas.cobro_intentos_tarjeta = [{ plan_cobro_id: 'plan-1', numero_cuota: 1, intento: 0, resultado: 'rechazado' }]
    m.setResultado({ tipo: 'rechazado', cobroId: 'cobro-1', mensaje: 'Fondos insuficientes' })
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(m.registro().cobro_estado).toBe('rechazado')
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-22') })
    expect(m.cobros).toHaveLength(1)
  })

  it('si la activación falla antes del cobro: no cobra, la fila vuelve a programado y el día 7 sigue en pie', async () => {
    let falla = true
    const m = montar(conTablas({ ...V21, ...AVISADO }), {
      activar: async () => (falla ? { ok: false, error: 'error' } : { ok: true, resultado: 'activado', contratoId: 'c-1' }),
    })
    expect((await confirmar(m)).tipo).toBe('reintentar')
    expect(m.cobros).toEqual([])
    expect(m.registro().cobro_estado).toBe('programado')
    falla = false
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(m.cobros).toEqual(['cuota-1'])
  })

  it('C8: un intento anterior sin cobro queda en activity_log antes de pisarlo; sin bitácora no se cobra', async () => {
    const previo = { cobro_confirmado_at: '2026-10-14T15:00:00.000Z', cobro_confirmado_por: 'u-1', cobro_confirmado_ip: '1.2.3.4', cobro_confirmado_texto: 'Texto visto antes' }
    const m = montar(conTablas({ ...V21, ...previo }))
    expect((await confirmar(m)).tipo).toBe('cobrado')
    expect(m.tablas.activity_log).toHaveLength(1)
    expect(m.tablas.activity_log[0]).toMatchObject({ workspace_id: 'ws-cli', entidad_tipo: 'workspace', entidad_id: 'ws-cli', tipo: 'sistema' })
    expect(String(m.tablas.activity_log[0].contenido)).toContain('Texto visto antes')
    expect(m.registro().cobro_confirmado_texto).toBe(TEXTO_11)

    // Sin la tabla de la bitácora (el insert falla): no se pisa ni se cobra.
    const sinLog = montar(conTablas({ ...V21, ...previo }))
    const base = sinLog.deps.db as unknown as { from: (t: string) => unknown }
    const rechaza = { insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'la base rechazó la fila' } }) }) }) }
    sinLog.deps.db = { ...base, from: (t: string) => (t === 'activity_log' ? rechaza : base.from(t)) } as never
    const r = await confirmar(sinLog)
    expect(r).toEqual({ tipo: 'no_disponible', motivo: 'sin_bitacora' })
    expect(sinLog.cobros).toEqual([])
    expect(sinLog.registro().cobro_confirmado_texto).toBe('Texto visto antes')
  })

  it('SIN confirmación no se cobra antes del día 7, aunque haya agotado las 10 consultas y vea la oferta', async () => {
    const m = montar(conTablas(V21))
    const oferta = await ofertaCobroAlConfirmar({ ...m.deps, ultimos4: async () => '0326' }, { workspaceId: 'ws-cli', usuarioId: 'u-1', agotada: true })
    expect(oferta.disponible).toBe(true)
    for (const dia of ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']) {
      await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron(dia) })
    }
    expect(m.cobros).toEqual([])
    expect(m.activar).not.toHaveBeenCalled()
    expect(m.registro().cobro_estado).toBe('programado')
    expect(m.registro().cobro_confirmado_at ?? null).toBeNull()
    // El día 7, el de siempre.
    await procesarCobrosTrasPrueba({ ...m.deps, ahoraMs: cron('2026-10-21') })
    expect(m.cobros).toEqual(['cuota-1'])
  })

  it('no se ofrece ni se cobra: a quien aceptó la v2.0, a otra persona, a otro despliegue, tras cancelar ni sin Términos', async () => {
    const casos: [Record<string, unknown>, string, string][] = [
      [{ condiciones_version: 'condiciones-2.0+aviso-1.2+terminos-auto-2.0' }, 'u-1', 'condiciones_sin_cobro_al_confirmar'],
      [V21, 'u-otra', 'no_es_la_persona'],
      [{ ...V21, cobro_entorno: 'production' }, 'u-1', 'otro_entorno'],
      [{ ...V21, cobro_estado: 'cancelado', cobro_cancelado_at: '2026-10-14T00:00:00Z' }, 'u-1', 'sin_cobro_programado'],
      [{ ...V21, terminos_sha256: null }, 'u-1', 'esperando_terminos'],
    ]
    for (const [extra, usuarioId, motivo] of casos) {
      const m = montar(conTablas(extra))
      expect(await ofertaCobroAlConfirmar({ ...m.deps, ultimos4: async () => '0326' }, { workspaceId: 'ws-cli', usuarioId, agotada: true })).toEqual({ disponible: false, motivo })
      expect(await confirmar(m, { usuarioId })).toEqual({ tipo: 'no_disponible', motivo })
      expect(m.cobros).toEqual([])
      expect(m.activar).not.toHaveBeenCalled()
    }
  })
})
