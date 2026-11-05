import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import { asuntoCorreoSuspendida, textoCorreoSuspendida } from './aviso-suspendida'
import { avisarSuspendidasPorPago } from './aviso-suspendida-servidor'

/**
 * El correo del día en que un CDA entra en Suspendida por pago (Términos v1.5, 11.2; D6 y D8): cuándo
 * sale, a quién, una sola vez, y con su fila en `avisos_cliente`.
 */

const SLUG_DOC = 'terminos-suscripcion-valida-cda'

function tablas(extra: Partial<Tablas> = {}): Tablas {
  return {
    servicios_contratados: [
      {
        id: 'sc-caq',
        servicio_slug: 'valida-cda-licencia',
        estado: 'activo',
        workspace_id: 'ws-metrik',
        workspace_pagador_id: 'ws-caq',
        empresa_id: 'emp-caq',
        negocio_id: 'neg-caq',
        aceptante_designado_id: 'per-designada',
      },
      // El contrato viejo, cancelado, del mismo CDA: no se mira.
      { id: 'sc-viejo', servicio_slug: 'valida-cda-licencia', estado: 'cancelado', workspace_id: 'ws-metrik', workspace_pagador_id: 'ws-caq', empresa_id: 'emp-caq', negocio_id: 'neg-viejo', aceptante_designado_id: 'per-designada' },
    ],
    documentos_contractuales_versiones: [
      { slug: SLUG_DOC, version: 'v1.3', empresa_id: 'emp-caq', vigente_desde: '2026-09-24', rige_por_aviso: false, publicada_at: null },
      { slug: SLUG_DOC, version: 'v1.4', empresa_id: 'emp-caq', vigente_desde: '2026-11-06', rige_por_aviso: true, publicada_at: '2026-10-07T17:59:49Z' },
      { slug: SLUG_DOC, version: 'v1.5', empresa_id: 'emp-caq', vigente_desde: '2026-12-01', rige_por_aviso: true, publicada_at: '2026-11-01T05:00:00Z' },
    ],
    planes_cobro: [{ id: 'plan-caq', negocio_id: 'neg-caq', workspace_id: 'ws-metrik' }],
    plan_cobro_cuotas: [
      { id: 'q1', plan_cobro_id: 'plan-caq', numero: 1, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-09-30', concepto_detalle: 'Suscripción VALIDA · Plan CDA — periodo del 23-sep al 22-oct' },
      { id: 'q2', plan_cobro_id: 'plan-caq', numero: 2, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-10-27', concepto_detalle: 'Suscripción VALIDA · Plan CDA — periodo del 23-oct al 22-nov' },
      { id: 'q3', plan_cobro_id: 'plan-caq', numero: 3, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-11-27', concepto_detalle: 'Suscripción VALIDA · Plan CDA — periodo del 23-nov al 22-dic' },
      { id: 'q4', plan_cobro_id: 'plan-caq', numero: 4, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-12-27', concepto_detalle: 'Suscripción VALIDA · Plan CDA — periodo del 23-dic al 22-ene' },
    ],
    cobros: [
      // Cuota 1 pagada; la 2 con su enlace vigente; la 3 programada sin enlace.
      { plan_cobro_id: 'plan-caq', numero_cuota: 1, negocio_id: 'neg-caq', monto: 150000, monto_anulado: null, anulado_at: null, fecha: '2026-09-29', retencion_iva: 0 },
      {
        plan_cobro_id: 'plan-caq', numero_cuota: 2, negocio_id: 'neg-caq', monto: 150000, monto_anulado: null, anulado_at: null, fecha: null, retencion_iva: 0,
        enlace_pago_url: 'https://checkout.bold.co/payment/LNK_ABC', enlace_pago_expira: '2026-12-20T00:00:00Z',
      },
      { plan_cobro_id: 'plan-caq', numero_cuota: 3, negocio_id: 'neg-caq', monto: 150000, monto_anulado: null, anulado_at: null, fecha: null, retencion_iva: 0 },
    ],
    empresas: [{ id: 'emp-caq', nombre: 'CDA Caquetá', razon_social: 'CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA', email_fiscal: 'Facturacion@CdaCaqueta.co ' }],
    workspaces: [{ id: 'ws-caq', slug: 'cda-caqueta', name: 'CDA Caquetá' }],
    avisos_cliente: [],
    ...extra,
  }
}

function correr(t: Tablas, hoy: string, enviar?: (m: { to: string; subject: string; text: string; idempotencyKey: string }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>) {
  const { db, tablas: tt } = crearDoble(t)
  const enviados: { to: string; subject: string; text: string; idempotencyKey: string }[] = []
  return {
    tt,
    enviados,
    correr: (dia = hoy) =>
      avisarSuspendidasPorPago({
        db,
        hoy: dia,
        ahoraISO: `${dia}T12:00:00Z`,
        correoDePersona: async (id) => (id === 'per-designada' ? 'gerencia@cdacaqueta.co' : null),
        urlPagos: (slug) => `https://${slug}.metrikone.co/suscripcion?tab=pagos`,
        enviarCorreo: async (m) => {
          enviados.push(m)
          return enviar ? enviar(m) : { ok: true, id: `re_${enviados.length}` }
        },
      }),
  }
}

describe('cuándo sale (transición 11.7: Suspendida desde el 6-dic)', () => {
  it('del 1 al 5-dic (gracia) no sale nada', async () => {
    for (const dia of ['2026-11-04', '2026-11-30', '2026-12-01', '2026-12-05']) {
      const x = correr(tablas(), dia)
      const r = await x.correr()
      expect(x.enviados, dia).toEqual([])
      expect(r.suspendidos, dia).toBe(0)
    }
  })

  it('el 6-dic sale a los correos registrados y a la persona designada, cada uno con su fila', async () => {
    const x = correr(tablas(), '2026-12-06')
    const r = await x.correr()
    expect(x.enviados.map((m) => m.to).sort()).toEqual(['facturacion@cdacaqueta.co', 'gerencia@cdacaqueta.co'])
    expect(r.suspendidos).toBe(1)
    const asunto = 'Valida: la suscripción de CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA está Suspendida por pago desde el 6 de diciembre de 2026'
    expect(x.enviados[0].subject).toBe(asunto)
    expect(x.tt.avisos_cliente).toHaveLength(2)
    for (const f of x.tt.avisos_cliente) {
      expect(f).toMatchObject({ workspace_id: 'ws-metrik', negocio_id: 'neg-caq', canal: 'email', estado: 'enviado', titulo: asunto })
    }
    expect(new Set(x.enviados.map((m) => m.idempotencyKey)).size).toBe(2)
  })

  it('una sola vez: la corrida del mismo día y la del día siguiente no repiten', async () => {
    const x = correr(tablas(), '2026-12-06')
    await x.correr()
    const r2 = await x.correr()
    const r3 = await x.correr('2026-12-07')
    expect(x.enviados).toHaveLength(2)
    expect(r2.yaAvisados).toBe(2)
    expect(r3.yaAvisados).toBe(2)
  })

  it('si el cron no corrió el 6, sale en la primera corrida dentro de la Suspendida, con la fecha de entrada', async () => {
    const x = correr(tablas(), '2026-12-09')
    await x.correr()
    expect(x.enviados[0].subject).toMatch(/desde el 6 de diciembre de 2026$/)
  })

  it('un envío fallido se reintenta en la corrida siguiente; el que salió no', async () => {
    let falla = true
    const x = correr(tablas(), '2026-12-06', async (m) => (falla && m.to.startsWith('gerencia') ? { ok: false, error: 'resend_500' } : { ok: true, id: 'x' }))
    const r1 = await x.correr()
    expect(r1.fallidos).toEqual([{ servicioContratadoId: 'sc-caq', destino: 'gerencia@cdacaqueta.co', error: 'resend_500' }])
    falla = false
    await x.correr()
    expect(x.enviados.map((m) => m.to)).toEqual(
      expect.arrayContaining(['facturacion@cdacaqueta.co', 'gerencia@cdacaqueta.co', 'gerencia@cdacaqueta.co']),
    )
    expect(x.enviados).toHaveLength(3)
    expect(x.tt.avisos_cliente.map((f) => f.estado).sort()).toEqual(['enviado', 'enviado', 'fallido'])
  })

  it('con las dos cuotas de la transición pagadas no sale', async () => {
    const t = tablas()
    for (const c of t.cobros) c.fecha = '2026-12-03'
    const x = correr(t, '2026-12-06')
    await x.correr()
    expect(x.enviados).toEqual([])
  })

  it('sin la v1.5 registrada (o sin publicar) no existe «Suspendida por pago»: no sale', async () => {
    const t = tablas()
    t.documentos_contractuales_versiones = t.documentos_contractuales_versiones.map((d) =>
      d.version === 'v1.5' ? { ...d, publicada_at: '2026-12-31T00:00:00Z' } : d,
    )
    const x = correr(t, '2026-12-06')
    const r = await x.correr()
    expect(x.enviados).toEqual([])
    expect(r.omitidos).toEqual([{ servicioContratadoId: 'sc-caq', motivo: 'sin_v15' }])
  })

  it('una dirección repetida (el correo de facturación es el de la persona designada) sale una vez', async () => {
    const t = tablas()
    t.empresas[0].email_fiscal = 'GERENCIA@cdacaqueta.co'
    const x = correr(t, '2026-12-06')
    await x.correr()
    expect(x.enviados.map((m) => m.to)).toEqual(['gerencia@cdacaqueta.co'])
  })
})

describe('período v1.5 (del 23-dic): Suspendida desde el 29-dic', () => {
  it('con la transición pagada y la cuota 4 sin pagar: nada el 28-dic, el correo el 29-dic', async () => {
    const t = tablas()
    for (const c of t.cobros) c.fecha = '2026-11-25'
    const x28 = correr(t, '2026-12-28')
    await x28.correr()
    expect(x28.enviados).toEqual([])
    const x29 = correr(tablas({ cobros: t.cobros }), '2026-12-29')
    await x29.correr()
    expect(x29.enviados).toHaveLength(2)
    expect(x29.enviados[0].subject).toMatch(/desde el 29 de diciembre de 2026$/)
    expect(x29.enviados[0].text).toContain('no está pagado el período del 23 de diciembre de 2026 al 22 de enero de 2027')
    expect(x29.enviados[0].text).toContain('desde el 23 de enero de 2027 la suscripción queda Cancelada')
  })
})

describe('el texto', () => {
  it('nombra los dos períodos de la transición, cuánto falta, el enlace vigente y Suscripción', async () => {
    const x = correr(tablas(), '2026-12-06')
    await x.correr()
    const texto = x.enviados[0].text
    expect(texto).toContain('porque no están pagados los períodos del 23 de octubre al 22 de noviembre de 2026 y del 23 de noviembre al 22 de diciembre de 2026')
    expect(texto).toContain('Período del 23 de octubre al 22 de noviembre de 2026: $150.000. Pagar en línea: https://checkout.bold.co/payment/LNK_ABC')
    expect(texto).toContain('Período del 23 de noviembre al 22 de diciembre de 2026: $150.000. Se paga desde Suscripción (enlace abajo).\n')
    const html = x.enviados[0] as unknown as { html: string }
    expect(html.html).toContain('href="https://cda-caqueta.metrikone.co/suscripcion?tab=pagos" style="color:')
    expect(html.html).toContain('Pagar en Suscripción')
    expect(html.html).toContain('escríbenos a mauricio.moreno@metrik.com.co o al WhatsApp +57 315 950 9103.')
    expect(texto).toContain('https://cda-caqueta.metrikone.co/suscripcion?tab=pagos')
    expect(texto).toContain('desde el 31 de diciembre de 2026 la suscripción queda Cancelada')
  })

  it('texto completo con un solo período (para Vera)', () => {
    const d = {
      razonSocial: 'CENTRO DE DIAGNOSTICO AUTOMOTOR EL CARMEN SAS',
      suspendidaDesde: '2026-12-06',
      canceladaDesde: '2026-12-31',
      periodos: [{ periodo: 'del 23 de noviembre al 22 de diciembre de 2026', saldo: 150000, enlacePago: 'https://checkout.bold.co/payment/LNK_X' }],
      urlPagos: 'https://cda-elcarmen.metrikone.co/suscripcion?tab=pagos',
    }
    expect(asuntoCorreoSuspendida(d)).toBe('Valida: la suscripción de CENTRO DE DIAGNOSTICO AUTOMOTOR EL CARMEN SAS está Suspendida por pago desde el 6 de diciembre de 2026')
    expect(textoCorreoSuspendida(d)).toMatchInlineSnapshot(`
      "Hola.

      Desde el 6 de diciembre de 2026, la suscripción de Valida de CENTRO DE DIAGNOSTICO AUTOMOTOR EL CARMEN SAS está Suspendida por pago, porque no está pagado el período del 23 de noviembre al 22 de diciembre de 2026 (cláusula 11.2 de los Términos).

      Mientras esté Suspendida por pago, tu equipo no puede hacer consultas nuevas, individuales ni masivas. Sí puede entrar a Valida, ver el historial, descargar los reportes ya generados y descargar la bitácora.

      Si se paga, las consultas vuelven y tu fecha de renovación no cambia. Si no se paga, desde el 31 de diciembre de 2026 la suscripción queda Cancelada.

      Para volver a consultar hay que pagar este período:
      Período del 23 de noviembre al 22 de diciembre de 2026: $150.000. Pagar en línea: https://checkout.bold.co/payment/LNK_X

      La persona designada por tu empresa puede ver y pagar el período en la sección Suscripción de MéTRIK ONE: https://cda-elcarmen.metrikone.co/suscripcion?tab=pagos

      Si ya hiciste este pago, no tienes que hacer nada: las consultas vuelven cuando el pago quede registrado (cláusula 11.5).

      Si tienes alguna duda con el pago, escríbenos a mauricio.moreno@metrik.com.co o al WhatsApp +57 315 950 9103.

      METRIK IA S.A.S."
    `)
  })

  it('texto completo con dos períodos (Caquetá; para Vera)', () => {
    const d = {
      razonSocial: 'CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA',
      suspendidaDesde: '2026-12-06',
      canceladaDesde: '2026-12-31',
      periodos: [
        { periodo: 'del 23 de octubre al 22 de noviembre de 2026', saldo: 150000, enlacePago: 'https://checkout.bold.co/payment/LNK_X' },
        { periodo: 'del 23 de noviembre al 22 de diciembre de 2026', saldo: 150000, enlacePago: null },
      ],
      urlPagos: 'https://cda-caqueta.metrikone.co/suscripcion?tab=pagos',
    }
    expect(textoCorreoSuspendida(d)).toMatchInlineSnapshot(`
      "Hola.

      Desde el 6 de diciembre de 2026, la suscripción de Valida de CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA está Suspendida por pago, porque no están pagados los períodos del 23 de octubre al 22 de noviembre de 2026 y del 23 de noviembre al 22 de diciembre de 2026 (cláusula 11.2 de los Términos).

      Mientras esté Suspendida por pago, tu equipo no puede hacer consultas nuevas, individuales ni masivas. Sí puede entrar a Valida, ver el historial, descargar los reportes ya generados y descargar la bitácora.

      Si se paga, las consultas vuelven y tu fecha de renovación no cambia. Si no se paga, desde el 31 de diciembre de 2026 la suscripción queda Cancelada.

      Para volver a consultar hay que pagar todos estos períodos:
      Período del 23 de octubre al 22 de noviembre de 2026: $150.000. Pagar en línea: https://checkout.bold.co/payment/LNK_X
      Período del 23 de noviembre al 22 de diciembre de 2026: $150.000. Se paga desde Suscripción (enlace abajo).

      La persona designada por tu empresa puede ver y pagar los períodos en la sección Suscripción de MéTRIK ONE: https://cda-caqueta.metrikone.co/suscripcion?tab=pagos

      Si ya hiciste este pago, no tienes que hacer nada: las consultas vuelven cuando el pago quede registrado (cláusula 11.5).

      Si tienes alguna duda con el pago, escríbenos a mauricio.moreno@metrik.com.co o al WhatsApp +57 315 950 9103.

      METRIK IA S.A.S."
    `)
  })
})
