import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// El núcleo de la activación y el cobro por token tienen sus propias pruebas; aquí van por inyección.
vi.mock('./activacion-servidor', () => ({ activarPlanDelEspacio: vi.fn() }))

import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import { cancelarCobroDelEspacio, estadoCobroDelEspacio, procesarCobrosTrasPrueba, type DepsCobroPrueba } from './cobro-prueba-servidor'
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
