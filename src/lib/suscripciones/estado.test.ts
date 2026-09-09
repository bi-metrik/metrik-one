import { describe, it, expect } from 'vitest'
import {
  accesoWorkspace,
  esEstadoSuscripcion,
  esPasarela,
  POLITICA_FASE_1,
  transicionar,
  type EstadoMaquina,
  type PoliticaSuspension,
} from './estado'

const en = (estado: EstadoMaquina['estado'], intentosFallidos = 0): EstadoMaquina => ({ estado, intentosFallidos })

const SUSPENDE_SOLA: PoliticaSuspension = { diasGracia: 0, maxIntentos: 2, suspenderAutomaticamente: true }

describe('transicionar — el pago manda', () => {
  it('el primer pago activa el trial y deja los intentos en cero', () => {
    const t = transicionar(en('trial', 2), 'pago_recibido')
    expect(t).toEqual({ ok: true, siguiente: { estado: 'activa', intentosFallidos: 0 }, cambio: true })
  })

  it('el pago reactiva desde pendiente_pago y desde suspendida', () => {
    // "hasta el recibo del pago": la suspension no es terminal.
    expect(transicionar(en('pendiente_pago', 1), 'pago_recibido')).toMatchObject({ siguiente: { estado: 'activa', intentosFallidos: 0 } })
    expect(transicionar(en('suspendida', 3), 'pago_recibido')).toMatchObject({ siguiente: { estado: 'activa', intentosFallidos: 0 } })
  })

  it('un pago sobre una activa sin fallos no reporta cambio', () => {
    expect(transicionar(en('activa'), 'pago_recibido')).toMatchObject({ ok: true, cambio: false })
  })
})

describe('transicionar — vencimiento', () => {
  it('activa y trial pasan a pendiente_pago al vencer', () => {
    expect(transicionar(en('activa'), 'vencimiento')).toMatchObject({ siguiente: { estado: 'pendiente_pago' }, cambio: true })
    expect(transicionar(en('trial'), 'vencimiento')).toMatchObject({ siguiente: { estado: 'pendiente_pago' }, cambio: true })
  })

  it('un segundo vencimiento sobre pendiente_pago no cambia nada (idempotente)', () => {
    expect(transicionar(en('pendiente_pago'), 'vencimiento')).toMatchObject({ ok: true, cambio: false })
  })

  it('el vencimiento NUNCA suspende por si solo, ni con la politica automatica', () => {
    // Suspender es un evento aparte, para que quede escrito quien lo decidio.
    expect(transicionar(en('pendiente_pago'), 'vencimiento', SUSPENDE_SOLA)).toMatchObject({ siguiente: { estado: 'pendiente_pago' } })
  })
})

describe('transicionar — cargos fallidos y politica', () => {
  it('Fase 1: agotar los intentos NO suspende, se queda en pendiente_pago', () => {
    let m = en('activa')
    for (let i = 0; i < POLITICA_FASE_1.maxIntentos + 2; i++) {
      const t = transicionar(m, 'cargo_fallido', POLITICA_FASE_1)
      if (!t.ok) throw new Error('no debe ser terminal')
      m = t.siguiente
    }
    expect(m.estado).toBe('pendiente_pago')
    expect(m.intentosFallidos).toBe(POLITICA_FASE_1.maxIntentos + 2)
  })

  it('con suspension automatica, el intento que alcanza el maximo suspende', () => {
    const uno = transicionar(en('activa'), 'cargo_fallido', SUSPENDE_SOLA)
    expect(uno).toMatchObject({ siguiente: { estado: 'pendiente_pago', intentosFallidos: 1 } })
    const dos = transicionar(en('pendiente_pago', 1), 'cargo_fallido', SUSPENDE_SOLA)
    expect(dos).toMatchObject({ siguiente: { estado: 'suspendida', intentosFallidos: 2 } })
  })

  it('un maxIntentos de cero se trata como uno: el primer fallo ya agota', () => {
    const t = transicionar(en('activa'), 'cargo_fallido', { ...SUSPENDE_SOLA, maxIntentos: 0 })
    expect(t).toMatchObject({ siguiente: { estado: 'suspendida', intentosFallidos: 1 } })
  })

  it('un fallo sobre una suspendida solo cuenta el intento', () => {
    expect(transicionar(en('suspendida', 3), 'cargo_fallido', SUSPENDE_SOLA)).toMatchObject({ siguiente: { estado: 'suspendida', intentosFallidos: 4 } })
  })
})

describe('transicionar — suspender y cancelar', () => {
  it('suspender es explicito y no mira la politica', () => {
    expect(transicionar(en('activa'), 'suspender', POLITICA_FASE_1)).toMatchObject({ siguiente: { estado: 'suspendida' }, cambio: true })
  })

  it('cancelar sale desde cualquier estado y conserva el contador', () => {
    for (const e of ['trial', 'activa', 'pendiente_pago', 'suspendida'] as const) {
      expect(transicionar(en(e, 2), 'cancelar')).toMatchObject({ siguiente: { estado: 'cancelada', intentosFallidos: 2 } })
    }
  })

  it('cancelada es terminal: ningun evento la mueve, ni el pago', () => {
    for (const ev of ['pago_recibido', 'vencimiento', 'cargo_fallido', 'suspender', 'cancelar'] as const) {
      expect(transicionar(en('cancelada'), ev)).toEqual({ ok: false, motivo: 'terminal' })
    }
  })
})

describe('accesoWorkspace — el gate del layout', () => {
  it('solo suspendida cierra la puerta', () => {
    expect(accesoWorkspace('suspendida', false)).toBe('suspendido')
    for (const s of ['trial', 'activa', 'pendiente_pago', 'cancelada']) {
      expect(accesoWorkspace(s, false)).toBe('permitido')
    }
  })

  it('los valores heredados de produccion y el NULL pasan (retrocompatibilidad)', () => {
    // Medido el 2026-09-08: trial x12, active x4, active_pro x1. Ninguno se puede
    // quedar afuera por un vocabulario que nadie migro.
    for (const s of ['trial', 'active', 'active_pro', null, undefined, '']) {
      expect(accesoWorkspace(s, false)).toBe('permitido')
    }
  })

  it('el platform_admin entra aunque el workspace este suspendido', () => {
    expect(accesoWorkspace('suspendida', true)).toBe('permitido')
  })
})

describe('guardas de vocabulario', () => {
  it('reconoce los cinco estados y nada mas', () => {
    expect(esEstadoSuscripcion('activa')).toBe(true)
    expect(esEstadoSuscripcion('active')).toBe(false)
    expect(esEstadoSuscripcion(null)).toBe(false)
  })

  it('reconoce las cuatro pasarelas de la suscripcion', () => {
    expect(esPasarela('manual')).toBe(true)
    expect(esPasarela('wompi')).toBe(true)
    expect(esPasarela('bold')).toBe(true)
    expect(esPasarela('epayco')).toBe(true)
    // `mixto` es un valor heredado de planes_cobro; en suscripciones no existe.
    expect(esPasarela('mixto')).toBe(false)
  })
})
