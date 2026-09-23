import { describe, it, expect, vi } from 'vitest'
import { crearDoble, type Fila, type Tablas } from '../../../test/tablas-doble'
import type { EventoPasarela, PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { cuotasConEstado, type CobroRecibido, type CuotaDeServicio } from '@/lib/valida-cda/pago-pendiente'
import { pctRetencionIvaDelEspacio, retencionIvaDeCuota } from './retencion-iva'
import { generarEnlacePagoCuota } from './enlace-pago-cuota-servidor'
import { procesarEventoPasarela } from './pago-en-linea'
import { repoPagoEnLinea } from './pago-en-linea-servidor'
import { referenciaEnlaceCobro } from './referencia-enlace'
import { cobradoConfirmado } from './saldo-negocio'

/**
 * Retención de IVA del cliente sobre las cuotas de MeTRIK (acta Carmen y Felipe, 2026-09-23, A).
 * El caso del acta: cuota de 2.380.000 (base 2.000.000 + IVA 380.000), cliente responsable de IVA,
 * retiene el 15% del IVA = 57.000 → enlace por 2.323.000 y, pagado, saldo 0 con 57.000 de retención.
 */

describe('pctRetencionIvaDelEspacio: el espacio cobrador lo declara por dato', () => {
  it('lee cobros.retencion_iva_pagador_pct', () => {
    expect(pctRetencionIvaDelEspacio({ cobros: { retencion_iva_pagador_pct: 15 } })).toBe(15)
    expect(pctRetencionIvaDelEspacio({ cobros: { retencion_iva_pagador_pct: '15' } })).toBe(15)
  })

  it('sin el dato, o con uno absurdo, no hay retención', () => {
    expect(pctRetencionIvaDelEspacio(null)).toBe(0)
    expect(pctRetencionIvaDelEspacio({ cobros: { pasarela_en_linea: 'bold' } })).toBe(0)
    expect(pctRetencionIvaDelEspacio({ cobros: { retencion_iva_pagador_pct: 0 } })).toBe(0)
    expect(pctRetencionIvaDelEspacio({ cobros: { retencion_iva_pagador_pct: 150 } })).toBe(0)
    expect(pctRetencionIvaDelEspacio({ cobros: { retencion_iva_pagador_pct: 'quince' } })).toBe(0)
  })
})

describe('retencionIvaDeCuota', () => {
  it('el caso del acta: 15% de 380.000 = 57.000', () => {
    expect(retencionIvaDeCuota({ ivaCuota: 380000, pagadorResponsableIva: true, pct: 15 })).toBe(57000)
  })

  it('cliente no responsable de IVA, o sin dato en el RUT: sin retención', () => {
    expect(retencionIvaDeCuota({ ivaCuota: 380000, pagadorResponsableIva: false, pct: 15 })).toBe(0)
    expect(retencionIvaDeCuota({ ivaCuota: 380000, pagadorResponsableIva: null, pct: 15 })).toBe(0)
  })

  it('cuota excluida o sin IVA declarado: sin retención', () => {
    expect(retencionIvaDeCuota({ ivaCuota: 0, pagadorResponsableIva: true, pct: 15 })).toBe(0)
    expect(retencionIvaDeCuota({ ivaCuota: null, pagadorResponsableIva: true, pct: 15 })).toBe(0)
  })

  it('espacio que no declara la retención: sin retención', () => {
    expect(retencionIvaDeCuota({ ivaCuota: 380000, pagadorResponsableIva: true, pct: 0 })).toBe(0)
  })
})

describe('el reparto FIFO cuenta la retención de IVA como cubierta', () => {
  const cuotas: CuotaDeServicio[] = [
    { cuotaId: 'q1', numero: 1, tipo: 'cuota', monto: 2380000, fechaVencimiento: '2026-10-05', concepto: null, enlacePagoUrl: null, enlacePagoExpira: null },
    { cuotaId: 'q2', numero: 2, tipo: 'cuota', monto: 2380000, fechaVencimiento: '2026-11-05', concepto: null, enlacePagoUrl: null, enlacePagoExpira: null },
  ]
  const estados = (cobros: CobroRecibido[]) =>
    cuotasConEstado({ cuotas, cobros, hoy: '2026-10-20', ahoraISO: '2026-10-20T12:00:00Z' })

  it('pagada por el neto con su retención: saldo 0, no queda vencida', () => {
    const [q1, q2] = estados([{ monto: 2323000, retencionIva: 57000, estado: 'pagado' }])
    expect(q1).toMatchObject({ estado: 'pagada', saldo: 0 })
    expect(q2).toMatchObject({ estado: 'pendiente', saldo: 2380000 })
  })

  it('sin la retención, los 57.000 quedarían como deuda vencida (lo que la regla evita)', () => {
    const [q1] = estados([{ monto: 2323000, estado: 'pagado' }])
    expect(q1).toMatchObject({ estado: 'vencida', saldo: 57000 })
  })

  it('la retención de un cobro programado (sin pagar) no cubre nada', () => {
    const [q1] = estados([{ monto: 2323000, retencionIva: 57000, estado: 'programado' }])
    expect(q1).toMatchObject({ estado: 'vencida', saldo: 2380000 })
  })

  it('el saldo del negocio también la cuenta, solo en los pagos confirmados', () => {
    expect(
      cobradoConfirmado([
        { monto: 2323000, retencion_iva: 57000, fecha: '2026-10-01' },
        { monto: 2323000, retencion_iva: 57000, fecha: null },
      ]),
    ).toBe(2380000)
  })
})

// ── La cadena completa: enlace → pago en línea → saldo ─────────────────────────────────

const WS = 'wsM'
const COBRO_ID = '0f8e2f4a-1c2b-4d5e-9f00-112233445566'
const AHORA = Date.parse('2026-10-01T15:00:00Z')

function tablas(p: { responsableIva: boolean | null; ivaCuota: number; pct?: number | null }): Tablas {
  return {
    workspaces: [
      {
        id: WS,
        config_extra: { cobros: { pasarela_en_linea: 'bold', ...(p.pct === null ? {} : { retencion_iva_pagador_pct: p.pct ?? 15 }) } },
      },
    ],
    planes_cobro: [{ id: 'plan1', workspace_id: WS, negocio_id: 'n1', total_cuotas: 6, pasarela: 'manual' }],
    plan_cobro_cuotas: [
      { id: 'q1', workspace_id: WS, plan_cobro_id: 'plan1', numero: 1, tipo: 'cuota', monto: 2380000, iva: p.ivaCuota, fecha_vencimiento: '2026-10-05', concepto_detalle: 'Clarity · cuota 1' },
      { id: 'q2', workspace_id: WS, plan_cobro_id: 'plan1', numero: 2, tipo: 'cuota', monto: 2380000, iva: p.ivaCuota, fecha_vencimiento: '2026-11-05', concepto_detalle: 'Clarity · cuota 2' },
    ],
    servicios_contratados: [{ id: 'sc1', workspace_id: WS, negocio_id: 'n1', estado: 'activo' }],
    negocios: [{ id: 'n1', workspace_id: WS, empresa_id: 'e1' }],
    empresas: [{ id: 'e1', workspace_id: WS, responsable_iva: p.responsableIva }],
    // El cobro programado de la cuota 1 ya existe (lo crea el paso 1 del cron o la plantilla).
    cobros: [
      {
        id: COBRO_ID, workspace_id: WS, negocio_id: 'n1', plan_cobro_id: 'plan1', numero_cuota: 1, tipo_cobro: 'programado',
        monto: 2380000, retencion: 0, retencion_iva: 0, retencion_iva_estado: null, fecha: null, anulado_at: null,
        external_ref: null, notas: 'Cuota 1 de 6', enlace_pago_url: null, enlace_pago_expira: null,
      },
    ],
    pasarela_eventos: [],
    notificaciones: [],
    activity_log: [],
  }
}

function pasarelaFalsa() {
  const crear = vi.fn(async (s: { cobroId: string; monto: number; expiraMs: number }) => ({
    ok: true as const,
    idEnlace: 'LNK_1',
    url: `https://checkout.bold.co/payment/LNK_1?m=${s.monto}`,
    expira: new Date(s.expiraMs).toISOString(),
  }))
  const adapter = { id: 'bold', crearEnlacePago: crear, faltaConfiguracion: () => null } as unknown as PasarelaAdapter
  return { crear, adapter, adapterPara: (x: string) => (x === 'bold' ? adapter : null) }
}

function pagoAprobado(monto: number): EventoPasarela {
  return {
    tipo: 'aprobado',
    eventoId: 'evt-1',
    tipoOriginal: 'SALE_APPROVED',
    transaccionId: 'TX1',
    referenciaPago: 'bold-TX1',
    referencia: referenciaEnlaceCobro(COBRO_ID, AHORA),
    idEnlace: 'LNK_1',
    monto,
    moneda: 'COP',
    ocurridoAt: '2026-10-02T10:00:00-05:00',
    crudo: {},
  }
}

async function enlaceYPago(t: Tablas, pagado: (monto: number) => number) {
  const d = crearDoble(t)
  const pasarela = pasarelaFalsa()
  const enlace = await generarEnlacePagoCuota({ workspaceId: WS, cuotaId: 'q1', ahoraMs: AHORA }, { db: d.db, adapterPara: pasarela.adapterPara })
  if (!enlace.ok) throw new Error(enlace.error)
  const salida = await procesarEventoPasarela(pagoAprobado(pagado(enlace.monto ?? 0)), repoPagoEnLinea(d.db, 'bold', pasarela.adapter), '2026-10-02')
  const cobro = (t.cobros as Fila[]).find((c) => c.id === COBRO_ID)!
  const cuotas = (t.plan_cobro_cuotas as Fila[]).map(
    (q): CuotaDeServicio => ({
      cuotaId: q.id as string, numero: q.numero as number, tipo: 'cuota', monto: q.monto as number,
      fechaVencimiento: q.fecha_vencimiento as string, concepto: null, enlacePagoUrl: null, enlacePagoExpira: null,
    }),
  )
  const cobros = (t.cobros as Fila[]).map(
    (c): CobroRecibido => ({ monto: Number(c.monto), retencionIva: Number(c.retencion_iva ?? 0), estado: c.fecha ? 'pagado' : 'programado' }),
  )
  const [q1] = cuotasConEstado({ cuotas, cobros, hoy: '2026-10-02', ahoraISO: '2026-10-02T15:00:00Z' })
  return { enlace, salida, cobro, q1, crear: pasarela.crear }
}

describe('enlace por el neto y conciliación con la retención (caso del acta)', () => {
  it('2.380.000 gravada, cliente responsable de IVA: enlace por 2.323.000; pagado, saldo 0 con 57.000 de retención', async () => {
    const t = tablas({ responsableIva: true, ivaCuota: 380000 })
    const r = await enlaceYPago(t, (m) => m)

    expect(r.crear).toHaveBeenCalledTimes(1)
    expect(r.crear.mock.calls[0][0].monto).toBe(2323000)
    expect(r.enlace).toMatchObject({ ok: true, estado: 'generado', monto: 2323000, retencionIva: 57000 })

    expect(r.salida.resultado).toBe('registrado')
    expect(r.cobro).toMatchObject({
      monto: 2323000,
      retencion_iva: 57000,
      retencion_iva_estado: 'certificado_pendiente',
      retencion: 57000,
      fecha: '2026-10-02',
    })
    expect(r.q1).toMatchObject({ estado: 'pagada', saldo: 0 })
  })

  it('cliente NO responsable de IVA: enlace por el total, sin retención', async () => {
    const t = tablas({ responsableIva: false, ivaCuota: 380000 })
    const r = await enlaceYPago(t, (m) => m)
    expect(r.crear.mock.calls[0][0].monto).toBe(2380000)
    expect(r.cobro).toMatchObject({ monto: 2380000, retencion_iva: 0, retencion_iva_estado: null })
    expect(r.q1).toMatchObject({ estado: 'pagada', saldo: 0 })
  })

  it('cliente sin dato de IVA en el RUT (null): enlace por el total, sin retención', async () => {
    const t = tablas({ responsableIva: null, ivaCuota: 380000 })
    const r = await enlaceYPago(t, (m) => m)
    expect(r.crear.mock.calls[0][0].monto).toBe(2380000)
    expect(r.cobro).toMatchObject({ retencion_iva: 0, retencion_iva_estado: null })
  })

  it('cuota excluida (iva 0): enlace por el total, sin retención', async () => {
    const t = tablas({ responsableIva: true, ivaCuota: 0 })
    const r = await enlaceYPago(t, (m) => m)
    expect(r.crear.mock.calls[0][0].monto).toBe(2380000)
    expect(r.cobro).toMatchObject({ monto: 2380000, retencion_iva: 0, retencion_iva_estado: null })
    expect(r.q1).toMatchObject({ estado: 'pagada', saldo: 0 })
  })

  it('espacio sin la retención declarada: enlace por el total aunque la cuota y el cliente califiquen', async () => {
    const t = tablas({ responsableIva: true, ivaCuota: 380000, pct: null })
    const r = await enlaceYPago(t, (m) => m)
    expect(r.crear.mock.calls[0][0].monto).toBe(2380000)
    expect(r.cobro).toMatchObject({ retencion_iva: 0, retencion_iva_estado: null })
  })

  it('el cliente pagó el total sin retener: se quita la retención y no queda excedente para la cuota 2', async () => {
    const t = tablas({ responsableIva: true, ivaCuota: 380000 })
    const r = await enlaceYPago(t, () => 2380000)
    expect(r.salida.resultado).toBe('registrado')
    expect(r.cobro).toMatchObject({ monto: 2380000, retencion_iva: 0, retencion_iva_estado: null, retencion: 0 })
    expect(r.q1).toMatchObject({ estado: 'pagada', saldo: 0 })
    expect(String(r.cobro.notas)).toContain('sin retención de IVA')
    expect(String(r.cobro.notas)).not.toContain('de más')
  })

  it('si el dato del cliente cambia antes de regenerar el enlace, se limpia la retención vieja', async () => {
    const t = tablas({ responsableIva: true, ivaCuota: 380000 })
    const d = crearDoble(t)
    const pasarela = pasarelaFalsa()
    await generarEnlacePagoCuota({ workspaceId: WS, cuotaId: 'q1', ahoraMs: AHORA }, { db: d.db, adapterPara: pasarela.adapterPara })
    ;(t.empresas as Fila[])[0].responsable_iva = false
    // Ocho días después el enlace venció y se regenera.
    const r = await generarEnlacePagoCuota(
      { workspaceId: WS, cuotaId: 'q1', ahoraMs: AHORA + 8 * 86_400_000 },
      { db: d.db, adapterPara: pasarela.adapterPara },
    )
    expect(r).toMatchObject({ ok: true, estado: 'generado', monto: 2380000, retencionIva: 0 })
    expect((t.cobros as Fila[])[0]).toMatchObject({ monto: 2380000, retencion_iva: 0, retencion_iva_estado: null, retencion: 0 })
  })
})
