import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import { DIAS_GRACIA_CICLO } from './plan'
import { avisarSuspensionesProximas, correoAvisoSuspension, debeAvisarSuspension } from './suspension-servidor'

const DIA = 24 * 3_600_000
// La cuota de noviembre vence el 18; con 5 días de gracia la bolsa vence el 23 a la medianoche.
const VENCE = '2026-11-23T05:00:00.000Z'

function tablas(extra: Partial<Tablas> = {}): Tablas {
  return {
    workspaces: [
      {
        id: 'ws-cli',
        slug: 'acme',
        config_extra: {
          origen_registro: 'valida_autogestion',
          valida_plan: { cliente_id: 'c', cobro_id: 'cobro-1', cuota_numero: 1, limite_mes: 3000, desde: '2026-10-18', hasta: '2026-11-17', vence_en: VENCE },
        },
      },
      // Un CDA de hoy: no es autogestionado, no se mira.
      { id: 'ws-cda', slug: 'cda', config_extra: { valida_plan: { vence_en: VENCE, cliente_id: 'x', cobro_id: 'y', cuota_numero: 1 } } },
    ],
    servicios_contratados: [{ id: 'c-1', workspace_pagador_id: 'ws-cli', estado: 'activo' }],
    valida_registros: [{ id: 'reg-1', workspace_id: 'ws-cli', estado: 'creado', correo: 'g@acme.co', razon_social: 'ACME S.A.S.', aviso_suspension_para: null }],
    ...extra,
  }
}

describe('cuándo se avisa', () => {
  it('desde el día siguiente al vencimiento de la cuota hasta antes de suspender', () => {
    const vence = Date.parse(VENCE)
    const cuota = vence - DIAS_GRACIA_CICLO * DIA
    expect(debeAvisarSuspension(VENCE, cuota)).toBe(false)
    expect(debeAvisarSuspension(VENCE, cuota + DIA)).toBe(true)
    expect(debeAvisarSuspension(VENCE, vence - 1)).toBe(true)
    expect(debeAvisarSuspension(VENCE, vence)).toBe(false)
  })
  it('la gracia es una sola perilla: con 10 días el aviso sale antes', () => {
    const vence = Date.parse(VENCE)
    expect(debeAvisarSuspension(VENCE, vence - 8 * DIA, 5)).toBe(false)
    expect(debeAvisarSuspension(VENCE, vence - 8 * DIA, 10)).toBe(true)
  })
})

describe('el aviso', () => {
  it('sale una vez por vencimiento, solo a cuentas autogestionadas con contrato activo', async () => {
    const { db, tablas: t } = crearDoble(tablas())
    const correos: { to: string; subject: string }[] = []
    const deps = {
      db,
      ahoraMs: Date.parse(VENCE) - 2 * DIA,
      enviarCorreo: async (m: { to: string; subject: string }) => {
        correos.push(m)
        return { ok: true as const, id: 'x' }
      },
      urlPago: (s: string) => `https://${s}.metrikone.co/suscripcion`,
    }
    await avisarSuspensionesProximas(deps)
    await avisarSuspensionesProximas(deps)
    expect(correos).toHaveLength(1)
    expect(correos[0].to).toBe('g@acme.co')
    expect(t.valida_registros[0].aviso_suspension_para).toBe(VENCE)
  })

  it('sin contrato activo (retirado) no avisa', async () => {
    const { db } = crearDoble(tablas({ servicios_contratados: [{ id: 'c-1', workspace_pagador_id: 'ws-cli', estado: 'terminado' }] }))
    const correos: unknown[] = []
    await avisarSuspensionesProximas({ db, ahoraMs: Date.parse(VENCE) - 2 * DIA, enviarCorreo: async (m) => (correos.push(m), { ok: true, id: null }) })
    expect(correos).toEqual([])
  })

  it('si el correo falla, se suelta para la corrida siguiente', async () => {
    const { db, tablas: t } = crearDoble(tablas())
    const r = await avisarSuspensionesProximas({ db, ahoraMs: Date.parse(VENCE) - 2 * DIA, enviarCorreo: async () => ({ ok: false, error: 'resend_500' }) })
    expect(r.fallidos).toHaveLength(1)
    expect(t.valida_registros[0].aviso_suspension_para).toBeNull()
  })

  it('el texto dice hasta cuándo y dónde pagar', () => {
    const c = correoAvisoSuspension({ razonSocial: 'ACME S.A.S.', venceEn: VENCE, urlPago: 'https://acme.metrikone.co/suscripcion' })
    expect(c.text).toContain('Si no se paga antes del')
    expect(c.text).toContain('https://acme.metrikone.co/suscripcion')
  })
})
