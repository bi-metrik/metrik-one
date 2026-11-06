import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { crearDoble, type Fila, type Tablas } from '../../../test/tablas-doble'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { generarEnlacesAutomaticos } from '@/lib/cobros/enlace-automatico-servidor'
import { avisarSuspendidasPorPago } from './aviso-suspendida-servidor'
import { cancelarSuscripcionesVencidas, enlaceDeReactivacionCda, NO_CANCELADA, reactivarCdaSiCorresponde } from './cancelada-servidor'
import { MOTIVO_ANULACION_16_4, TEXTO_REACTIVAR_EXIGE_V15 } from './venta-16-4'
import { procesarPeriodosNoVendidos } from './venta-16-4-servidor'

/**
 * La 16.4 al vender un período (Emilio, 5-nov-2026) contra tablas en memoria que se escriben de verdad: el
 * enlace automático del cron (con la MISMA función del botón), el paso 8f, la Suscripción por pago (8d), la
 * Cancelada (8e) y la reactivación. Las fechas son las reales: Maxitec con base 22-dic-2026 y su cuota 4
 * (23-dic–22-ene, vence 27-dic) ya creada; Caquetá con base 16-ene-2027.
 */

const SLUG_DOC = 'terminos-suscripcion-valida-cda'
const BASE_CONCEPTO = 'Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS)'
const SHA_V15 = 'e'.repeat(64)

/** Las formas exactas que exige el generador de la v1.5 (`datosDelTextoV15`). */
function textoV15(razon: string, base: string, fin12: string) {
  return [
    `**EL CLIENTE**: ${razon}, NIT 900.000.000-1`,
    'La fecha de renovación del Cliente es el día 23 de cada mes.',
    `Hasta el **${fin12}**, fecha en que vencía el plazo.`,
    `Desde el **${base}**, o desde el día siguiente al fin del último período pagado si es posterior, sin esa aceptación no se pueden hacer consultas.`,
  ].join('\n\n')
}

const MAXITEC = { razon: 'MAXITEC S.A.S.', base: '22 de diciembre de 2026', fin12: '21 de diciembre de 2026' }
const CAQUETA = { razon: 'CDA DEL CAQUETA LTDA', base: '16 de enero de 2027', fin12: '15 de enero de 2027' }

function cuota(n: number, vence: string, periodo: string): Fila {
  return {
    id: `q${n}`,
    workspace_id: 'ws-metrik',
    plan_cobro_id: 'plan-cda',
    numero: n,
    tipo: 'cuota',
    monto: 150000,
    fecha_vencimiento: vence,
    concepto_detalle: `${BASE_CONCEPTO} · periodo del ${periodo}`,
    anulada_at: null,
  }
}

const pagado = (n: number, fecha: string): Fila => ({
  id: `c${n}`,
  tipo_cobro: 'programado',
  plan_cobro_id: 'plan-cda',
  numero_cuota: n,
  negocio_id: 'neg-cda',
  workspace_id: 'ws-metrik',
  monto: 150000,
  monto_anulado: null,
  anulado_at: null,
  fecha,
  retencion_iva: 0,
})

/** Un CDA al día hasta el 22-dic (cuotas 1 a 3 pagadas) con la cuota 4 creada y sin pagar. */
function tablas(cda: { razon: string; base: string; fin12: string }, extra: { aceptada?: string; cancelada?: string } = {}): Tablas {
  return {
    servicios_contratados: [
      {
        id: 'sc-cda',
        servicio_slug: 'valida-cda-licencia',
        estado: extra.cancelada ? 'pausado' : 'activo',
        cancelada_desde: extra.cancelada ?? null,
        reactivada_desde: null,
        reactivacion_cobro_id: null,
        workspace_id: 'ws-metrik',
        workspace_pagador_id: 'ws-cda',
        empresa_id: 'emp-cda',
        negocio_id: 'neg-cda',
        vigente_desde: '2026-09-23',
        aceptante_designado_id: 'per-designada',
        parametros: { licencias: 2, precio_mensual: 150000 },
      },
    ],
    documentos_contractuales_versiones: [
      { slug: SLUG_DOC, version: 'v1.4', empresa_id: 'emp-cda', vigente_desde: '2026-11-06', rige_por_aviso: true, publicada_at: '2026-10-07T17:59:49Z' },
      {
        slug: SLUG_DOC,
        version: 'v1.5',
        empresa_id: 'emp-cda',
        vigente_desde: '2026-12-01',
        rige_por_aviso: true,
        publicada_at: '2026-11-01T05:00:00Z',
        texto_md: textoV15(cda.razon, cda.base, cda.fin12),
        pdf_sha256: SHA_V15,
      },
    ],
    aceptaciones_terminos: extra.aceptada
      ? [{ id: 'a1', documento_sha256: SHA_V15, estado: 'aceptado', negocio_id: 'neg-cda', created_at: extra.aceptada }]
      : [],
    planes_cobro: [
      { id: 'plan-cda', negocio_id: 'neg-cda', workspace_id: 'ws-metrik', fecha_inicio: '2026-09-23', auto_renovar: true, pasarela: 'bold', total_cuotas: 4, concepto_detalle_template: BASE_CONCEPTO },
    ],
    plan_cobro_cuotas: [
      cuota(1, '2026-09-30', '23-sep al 22-oct'),
      cuota(2, '2026-10-27', '23-oct al 22-nov'),
      cuota(3, '2026-11-27', '23-nov al 22-dic'),
      cuota(4, '2026-12-27', '23-dic al 22-ene'),
    ],
    cobros: [pagado(1, '2026-10-02'), pagado(2, '2026-11-04'), pagado(3, '2026-11-25')],
    empresas: [{ id: 'emp-cda', nombre: 'CDA', razon_social: cda.razon, email_fiscal: 'facturacion@cda.test' }],
    workspaces: [
      { id: 'ws-cda', slug: 'maxitec', name: 'CDA', pais: 'CO' },
      { id: 'ws-metrik', slug: 'metrik', name: 'MéTRIK', config_extra: { cobros: { pasarela_en_linea: 'bold' } } },
    ],
    profiles: [{ id: 'per-designada', full_name: 'Persona Designada', workspace_id: 'ws-cda' }],
    tarjetas_pago_cda: [],
    cobro_intentos_tarjeta: [],
    licencias_adicionales: [],
    avisos_cliente: [],
    activity_log: [],
  }
}

function pasarela() {
  const crear = vi.fn(async (s: { cobroId: string; expiraMs: number }) => ({
    ok: true as const,
    idEnlace: 'LNK',
    url: `https://checkout.bold.co/payment/LNK_${s.cobroId}`,
    expira: new Date(s.expiraMs).toISOString(),
  }))
  const adapter = { id: 'bold', crearEnlacePago: crear, faltaConfiguracion: () => null } as unknown as PasarelaAdapter
  return { crear, adapterPara: (x: string) => (x === 'bold' ? adapter : null) }
}

const enviar = () => vi.fn(async () => ({ ok: true as const, id: 're_1' }))

async function cronEnlace(t: Tablas, hoy: string) {
  const d = crearDoble(t)
  const p = pasarela()
  const correo = enviar()
  const resumen = await generarEnlacesAutomaticos(
    { hoy, ahoraMs: Date.parse(`${hoy}T12:00:00Z`) },
    { db: d.db, adapterPara: p.adapterPara, enviarCorreo: correo, correoDePersona: async () => 'gerencia@cda.test', urlSuscripcion: (s) => `https://${s}.metrikone.co/suscripcion` },
  )
  return { ...d, resumen, crear: p.crear, correo }
}

function paso8f(t: Tablas) {
  const d = crearDoble(t)
  const correos: { to: string; subject: string; text: string }[] = []
  return {
    ...d,
    correos,
    correr: (hoy: string) =>
      procesarPeriodosNoVendidos({
        db: d.db,
        hoy,
        ahoraISO: `${hoy}T12:00:00Z`,
        correoDePersona: async () => 'gerencia@cda.test',
        urlValida: (s) => `https://${s}.metrikone.co/valida`,
        enviarCorreo: async (m) => {
          correos.push(m)
          return { ok: true, id: `re_${correos.length}` }
        },
      }),
  }
}

const fila = (t: Tablas, tabla: string, id: string) => (t[tabla] as Fila[]).find((x) => x.id === id) as Fila

describe('16.4: el enlace de Maxitec del período 23-dic–22-ene (base 22-dic)', () => {
  it('sin la v1.5 aceptada NO sale: ni enlace, ni cobro programado, ni correo', async () => {
    // El 20-dic-2026 es domingo: el cron genera el primer día hábil, el lunes 21. Se prueban los dos días.
    for (const hoy of ['2026-12-20', '2026-12-21', '2026-12-27']) {
      const r = await cronEnlace(tablas(MAXITEC), hoy)
      expect(r.crear, hoy).not.toHaveBeenCalled()
      expect(r.correo, hoy).not.toHaveBeenCalled()
      expect(r.resumen.generados, hoy).toEqual([])
      expect((r.tablas.cobros as Fila[]).some((c) => c.numero_cuota === 4), hoy).toBe(false)
    }
    const lunes = await cronEnlace(tablas(MAXITEC), '2026-12-21')
    expect(lunes.resumen.omitidas).toEqual([
      {
        cuotaId: 'q4',
        motivo:
          'Para pagar el período del 23 de diciembre al 22 de enero primero hay que aceptar la versión 1.5 de los Términos (cláusula 16.4). La persona designada la acepta en Valida.',
      },
    ])
    expect(lunes.resumen.errores).toEqual([])
  })

  it('con la v1.5 aceptada (antes de que empiece el período) SÍ sale, con su correo', async () => {
    const r = await cronEnlace(tablas(MAXITEC, { aceptada: '2026-12-15T15:00:00Z' }), '2026-12-21')
    expect(r.resumen.generados.map((g) => g.numero)).toEqual([4])
    expect(r.crear).toHaveBeenCalledTimes(1)
    expect(r.correo).toHaveBeenCalledTimes(1)
    // El 20-dic (domingo) tampoco sale, pero por el calendario, no por la 16.4.
    const domingo = await cronEnlace(tablas(MAXITEC, { aceptada: '2026-12-15T15:00:00Z' }), '2026-12-20')
    expect(domingo.resumen.omitidas).toEqual([{ cuotaId: 'q4', motivo: 'dia_no_habil_CO' }])
  })

  it('aceptada DESPUÉS de que empezó el período (24-dic), ese período ya no se vende', async () => {
    const r = await cronEnlace(tablas(MAXITEC, { aceptada: '2026-12-24T15:00:00Z' }), '2026-12-24')
    expect(r.crear).not.toHaveBeenCalled()
  })
})

describe('16.4: los períodos que empiezan antes de la base se venden normal', () => {
  it('Caquetá (base 16-ene): el enlace del 23-dic–22-ene sale sin la v1.5 aceptada', async () => {
    const r = await cronEnlace(tablas(CAQUETA), '2026-12-21')
    expect(r.resumen.generados.map((g) => g.numero)).toEqual([4])
    expect(r.correo).toHaveBeenCalledTimes(1)
  })
})

describe('16.4: el período no vendido nunca deja al CDA en Suspendida ni Cancelada', () => {
  it('Maxitec sin aceptar: ni correo de Suspendida (29-dic) ni Cancelada (23-ene, 1-feb); el contrato sigue activo', async () => {
    const t = tablas(MAXITEC)
    const d = crearDoble(t)
    const correos: unknown[] = []
    const deps = (hoy: string) => ({
      db: d.db,
      hoy,
      ahoraISO: `${hoy}T12:00:00Z`,
      correoDePersona: async () => 'gerencia@cda.test',
      enviarCorreo: async (m: unknown) => {
        correos.push(m)
        return { ok: true as const, id: 're' }
      },
    })
    const s = await avisarSuspendidasPorPago(deps('2026-12-29'))
    expect(s.suspendidos).toBe(0)
    for (const hoy of ['2027-01-23', '2027-02-01']) {
      const c = await cancelarSuscripcionesVencidas(deps(hoy))
      expect(c.canceladas, hoy).toEqual([])
    }
    expect(correos).toEqual([])
    expect(fila(t, 'servicios_contratados', 'sc-cda')).toMatchObject({ estado: 'activo', cancelada_desde: null })
  })

  it('control: el mismo CDA CON la v1.5 aceptada sí queda Cancelada el 23-ene si no paga (el período se vendió)', async () => {
    const t = tablas(MAXITEC, { aceptada: '2026-12-15T15:00:00Z' })
    const d = crearDoble(t)
    const c = await cancelarSuscripcionesVencidas({ db: d.db, hoy: '2027-01-23', ahoraISO: '2027-01-23T12:00:00Z', correoDePersona: async () => null, enviarCorreo: async () => ({ ok: true, id: 're' }) })
    expect(c.canceladas).toEqual([{ servicioContratadoId: 'sc-cda', canceladaDesde: '2027-01-23' }])
  })
})

describe('16.4: el período no vendido se anula al terminar (paso 8f)', () => {
  it('el 22-ene no pasa nada; el 23-ene la cuota 4 queda anulada con su motivo, sin renovación, y el contrato activo', async () => {
    const t = tablas(MAXITEC)
    // Un cobro programado viejo de la cuota 4 (sin pagar): se anula con ella.
    ;(t.cobros as Fila[]).push({ ...pagado(4, ''), id: 'c4', fecha: null })
    const x = paso8f(t)
    const r1 = await x.correr('2027-01-22')
    expect(r1.cuotasAnuladas).toEqual([])
    expect(fila(t, 'plan_cobro_cuotas', 'q4').anulada_at).toBe(null)
    const r2 = await x.correr('2027-01-23')
    expect(r2.cuotasAnuladas).toEqual([{ servicioContratadoId: 'sc-cda', cuotaId: 'q4' }])
    expect(fila(t, 'plan_cobro_cuotas', 'q4')).toMatchObject({ anulada_at: '2027-01-23T12:00:00Z', anulacion_motivo: MOTIVO_ANULACION_16_4 })
    expect(MOTIVO_ANULACION_16_4).toBe('16.4: período no vendido sin aceptación de la v1.5')
    expect(fila(t, 'cobros', 'c4')).toMatchObject({ monto: 0, monto_anulado: 150000, anulacion_motivo: MOTIVO_ANULACION_16_4 })
    for (const id of ['q1', 'q2', 'q3']) expect(fila(t, 'plan_cobro_cuotas', id).anulada_at, id).toBe(null)
    expect(fila(t, 'planes_cobro', 'plan-cda').auto_renovar).toBe(false)
    expect(fila(t, 'servicios_contratados', 'sc-cda')).toMatchObject({ estado: 'activo', cancelada_desde: null })
    expect(x.correos).toEqual([])
    // Idempotente.
    const n = x.escrituras.length
    expect((await x.correr('2027-01-24')).cuotasAnuladas).toEqual([])
    expect(x.escrituras.slice(n)).toEqual([])
  })

  it('con la v1.5 aceptada antes de la base no se anula nada', async () => {
    const t = tablas(MAXITEC, { aceptada: '2026-12-15T15:00:00Z' })
    const r = await paso8f(t).correr('2027-01-23')
    expect(r.cuotasAnuladas).toEqual([])
    expect(fila(t, 'plan_cobro_cuotas', 'q4').anulada_at).toBe(null)
  })
})

describe('16.4: un abono PARCIAL a un período no vendido (Vera)', () => {
  it('no es mora (ni Suspendida ni Cancelada), no se anula solo y deja una nota para revisión manual, una vez', async () => {
    const t = tablas(MAXITEC)
    ;(t.cobros as Fila[]).push({ ...pagado(4, '2026-12-26'), id: 'c4', monto: 50000 })
    const d = crearDoble(t)
    const deps = (hoy: string) => ({ db: d.db, hoy, ahoraISO: `${hoy}T12:00:00Z`, correoDePersona: async () => null, enviarCorreo: async () => ({ ok: true as const, id: 're' }) })
    expect((await avisarSuspendidasPorPago(deps('2026-12-29'))).suspendidos).toBe(0)
    expect((await cancelarSuscripcionesVencidas(deps('2027-01-23'))).canceladas).toEqual([])
    const r = await procesarPeriodosNoVendidos(deps('2027-01-23'))
    expect(r.cuotasAnuladas).toEqual([])
    expect(r.conAbono).toEqual([{ servicioContratadoId: 'sc-cda', cuotaId: 'q4' }])
    expect(fila(t, 'plan_cobro_cuotas', 'q4').anulada_at).toBe(null)
    const notas = (t.activity_log as Fila[]).filter((a) => String(a.contenido).includes('abono parcial'))
    expect(notas).toHaveLength(1)
    expect(String(notas[0].contenido)).toContain('del 2026-12-23 al 2027-01-22 no se vendió (sin la v1.5 aceptada) y tiene un abono parcial de $50.000')
    await procesarPeriodosNoVendidos(deps('2027-01-24'))
    expect((t.activity_log as Fila[]).filter((a) => String(a.contenido).includes('abono parcial'))).toHaveLength(1)
    expect(fila(t, 'servicios_contratados', 'sc-cda')).toMatchObject({ estado: 'activo', cancelada_desde: null })
  })
})

describe('16.4: el período pagado de todos modos (transferencia) se presta', () => {
  it('no se anula, y se avisa una vez que el siguiente no se vende sin la v1.5', async () => {
    const t = tablas(MAXITEC)
    ;(t.cobros as Fila[]).push(pagado(4, '2026-12-26'))
    const x = paso8f(t)
    const r = await x.correr('2026-12-27')
    expect(r.prestados).toEqual([{ servicioContratadoId: 'sc-cda', desde: '2026-12-23' }])
    expect(x.correos.map((m) => m.to).sort()).toEqual(['facturacion@cda.test', 'gerencia@cda.test'])
    expect(x.correos[0].subject).toBe(
      'Valida: recibimos tu pago del período del 23 de diciembre al 22 de enero; acepta la versión 1.5 para continuar después',
    )
    expect(x.correos[0].text).toContain('Durante ese período puedes seguir haciendo consultas en Valida.')
    expect(x.correos[0].text).toContain('a más tardar el 23 de enero de 2027: sin esa aceptación, el período siguiente no se ofrece ni se cobra.')
    expect(x.correos[0].text).toContain('https://maxitec.metrikone.co/valida')
    await x.correr('2026-12-28')
    expect(x.correos).toHaveLength(2)
    // Y al terminar el período no se anula: está pagado.
    expect((await x.correr('2027-01-23')).cuotasAnuladas).toEqual([])
  })
})

describe('16.4: la reactivación antes y después de la base', () => {
  const ahora = (dia: string) => Date.parse(`${dia}T15:00:00Z`)

  it('Caquetá Cancelada: el 10-ene (antes de la base) reactiva sin aceptar; desde el 16-ene exige la v1.5', async () => {
    const p = pasarela()
    const antes = crearDoble(tablas(CAQUETA, { cancelada: '2026-12-31' }))
    const r1 = await enlaceDeReactivacionCda({ contratoId: 'sc-cda', workspacePagadorId: 'ws-cda' }, { db: antes.db, adapterPara: p.adapterPara, ahoraMs: ahora('2027-01-10') })
    expect(r1.ok).toBe(true)
    for (const dia of ['2027-01-16', '2027-01-20']) {
      const x = crearDoble(tablas(CAQUETA, { cancelada: '2026-12-31' }))
      const r = await enlaceDeReactivacionCda({ contratoId: 'sc-cda', workspacePagadorId: 'ws-cda' }, { db: x.db, adapterPara: p.adapterPara, ahoraMs: ahora(dia) })
      expect(r, dia).toEqual({ ok: false, error: TEXTO_REACTIVAR_EXIGE_V15 })
      expect(x.escrituras, dia).toEqual([])
    }
    const aceptada = crearDoble(tablas(CAQUETA, { cancelada: '2026-12-31', aceptada: '2027-01-19T15:00:00Z' }))
    const r3 = await enlaceDeReactivacionCda({ contratoId: 'sc-cda', workspacePagadorId: 'ws-cda' }, { db: aceptada.db, adapterPara: p.adapterPara, ahoraMs: ahora('2027-01-20') })
    expect(r3.ok).toBe(true)
  })

  it('Maxitec sin Cancelada, que acepta tarde (10-ene): paga un período desde el día del pago y el contrato vuelve a empezar', async () => {
    const p = pasarela()
    // Sin aceptar: no hay nada que pagar por este camino (manda la 16.4, no la reactivación).
    const sin = crearDoble(tablas(MAXITEC))
    expect(await enlaceDeReactivacionCda({ contratoId: 'sc-cda', workspacePagadorId: 'ws-cda' }, { db: sin.db, adapterPara: p.adapterPara, ahoraMs: ahora('2027-01-10') })).toEqual({
      ok: false,
      error: TEXTO_REACTIVAR_EXIGE_V15,
    })
    // Aceptada antes de la base: la suscripción continúa; no hay «volver a empezar».
    const antes = crearDoble(tablas(MAXITEC, { aceptada: '2026-12-15T15:00:00Z' }))
    expect(await enlaceDeReactivacionCda({ contratoId: 'sc-cda', workspacePagadorId: 'ws-cda' }, { db: antes.db, adapterPara: p.adapterPara, ahoraMs: ahora('2027-01-10') })).toEqual({
      ok: false,
      error: NO_CANCELADA,
    })

    const t = tablas(MAXITEC, { aceptada: '2027-01-10T14:00:00Z' })
    const x = crearDoble(t)
    const r = await enlaceDeReactivacionCda({ contratoId: 'sc-cda', workspacePagadorId: 'ws-cda' }, { db: x.db, adapterPara: p.adapterPara, ahoraMs: ahora('2027-01-10') })
    expect(r.ok).toBe(true)
    const cobroId = fila(t, 'servicios_contratados', 'sc-cda').reactivacion_cobro_id as string
    expect(cobroId).toBeTruthy()
    // El pago se aprueba el 10-ene: plan nuevo desde ese día, el contrato sigue activo y sin Cancelada.
    ;(t.cobros as Fila[]).find((c) => c.id === cobroId)!.fecha = '2027-01-10'
    const re = await reactivarCdaSiCorresponde(x.db, cobroId)
    expect(re).toMatchObject({ revisar: false, reactivada: '2027-01-10' })
    expect(fila(t, 'servicios_contratados', 'sc-cda')).toMatchObject({ estado: 'activo', cancelada_desde: null, reactivada_desde: '2027-01-10' })
    expect(fila(t, 'planes_cobro', 'plan-cda').auto_renovar).toBe(false)
    const nuevo = (t.planes_cobro as Fila[]).find((pl) => pl.id !== 'plan-cda') as Fila
    expect(nuevo).toMatchObject({ fecha_inicio: '2027-01-10', auto_renovar: true })
    // Una segunda llamada (webhook repetido, o el cron) no hace nada.
    expect(await reactivarCdaSiCorresponde(x.db, cobroId)).toBe(null)
    // El 23-ene, el período del plan viejo que no se vendió se anula igual (16.4).
    const r8f = await procesarPeriodosNoVendidos({ db: x.db, hoy: '2027-01-23', ahoraISO: '2027-01-23T12:00:00Z', enviarCorreo: async () => ({ ok: true, id: 'x' }) })
    expect(r8f.cuotasAnuladas).toEqual([{ servicioContratadoId: 'sc-cda', cuotaId: 'q4' }])
    expect(fila(t, 'plan_cobro_cuotas', 'q4').anulacion_motivo).toBe(MOTIVO_ANULACION_16_4)
  })
})
