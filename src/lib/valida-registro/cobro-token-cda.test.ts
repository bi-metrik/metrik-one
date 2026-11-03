/**
 * El pago automático con tarjeta de un CDA (Términos v1.5, 2.4; diseño del 2026-10-30) sobre el mismo motor
 * del autoservicio: lo atrasado nunca se cobra solo (D3), intentos solo el día 0 (la fecha de renovación)
 * y el día 3 (D4), y el plan sigue en la tarjeta tras un rechazo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import type { PasarelaAdapter, ResultadoCargo, SolicitudCargo } from '@/lib/suscripciones/pasarela/adapter'

vi.mock('@/lib/cobros/pago-en-linea', () => ({
  procesarEventoPasarela: async () => ({ resultado: 'registrado', detalle: 'Pago registrado.', cobroId: 'x' }),
}))
vi.mock('@/lib/cobros/pago-en-linea-servidor', () => ({ repoPagoEnLinea: () => ({}) }))
const actividad: string[] = []
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_db: unknown, fila: { contenido: string }) => {
    actividad.push(fila.contenido)
  },
}))

const { cobrarCuotasConTarjeta, cobrarCuotaConTarjeta } = await import('./cobro-token-servidor')

const METRIK = 'ws-metrik'
const CDA = 'ws-cda'
const REF = 'epayco:DiYPdhgncppes9KAb:XCX92PZqBKfmcWFbA'
const PLAN = 'Suscripción VALIDA · Plan CDA — mensual'

function base(): Tablas {
  const cuota = (numero: number, desde: string, hasta: string, vence: string) => ({
    id: `q${numero}`,
    workspace_id: METRIK,
    plan_cobro_id: 'p1',
    numero,
    monto: 150000,
    fecha_vencimiento: vence,
    concepto_detalle: `${PLAN} · periodo del ${desde} al ${hasta}`,
  })
  return {
    servicios_contratados: [{ id: 'sc', workspace_id: METRIK, negocio_id: 'n1', estado: 'activo', workspace_pagador_id: CDA }],
    // Un CDA: su espacio no es autogestionado y no tiene registro de autoservicio.
    workspaces: [{ id: CDA, config_extra: { modo_vitrina: true } }],
    valida_registros: [],
    planes_cobro: [{ id: 'p1', workspace_id: METRIK, negocio_id: 'n1', pasarela: 'epayco', total_cuotas: 3 }],
    // Debe el 23-sep y el 23-oct; el 23-nov ya está creado.
    plan_cobro_cuotas: [
      cuota(1, '23-sep', '22-oct', '2026-09-30'),
      cuota(2, '23-oct', '22-nov', '2026-10-27'),
      cuota(3, '23-nov', '22-dic', '2026-11-27'),
    ],
    cobros: [],
    cobro_intentos_tarjeta: [],
    tarjetas_pago_cda: [
      {
        id: 't1',
        workspace_id: METRIK,
        workspace_cliente_id: CDA,
        servicio_contratado_id: 'sc',
        negocio_id: 'n1',
        plan_cobro_id: 'p1',
        estado: 'activa',
        metodo_pago_ref: REF,
        ultimos4: '1234',
        titular: { nombre: 'Ana Pérez Gómez', nombres: 'Ana', apellidos: 'Pérez Gómez', tipo_documento: 'CC', documento: '1012345678' },
        celular: '3001234567',
        correo: 'ana@cda.co',
        // Registró la tarjeta el 30-oct.
        cobro_desde: '2026-10-30',
        dia_renovacion: 23,
        terminos_vigente_desde: '2026-12-01',
        ip: '190.1.2.3',
      },
    ],
  }
}

function epayco(secuencia: ResultadoCargo[]) {
  const cargos: SolicitudCargo[] = []
  const adapter = {
    nombre: 'epayco',
    capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: false, webhook: true },
    cobrar: async (s: SolicitudCargo) => {
      cargos.push(s)
      return secuencia[Math.min(cargos.length - 1, secuencia.length - 1)]
    },
    consultar: async () => secuencia[0],
  } as unknown as PasarelaAdapter
  return { adapterPara: (p: string) => (p === 'epayco' ? adapter : null), cargos }
}

const RECHAZO: ResultadoCargo = { estado: 'rechazado', externalRef: 'epayco-9', codigo: '2', mensaje: 'Fondos insuficientes', reintentable: false }
const APROBADO: ResultadoCargo = { estado: 'aprobado', externalRef: 'epayco-10', fecha: '2026-11-23', monto: 150000 }

beforeEach(() => {
  actividad.length = 0
})

const dias = (desde: string, hasta: string) => {
  const out: string[] = []
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= Date.parse(`${hasta}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

describe('el cron (paso 7b) con la tarjeta de un CDA', () => {
  it('rechazada siempre: un intento el 23-nov y otro el 26-nov, ninguno después; lo atrasado nunca', async () => {
    const d = crearDoble(base())
    const e = epayco([RECHAZO])
    const vistos: string[] = []
    for (const hoy of dias('2026-10-30', '2026-12-05')) {
      const antes = e.cargos.length
      await cobrarCuotasConTarjeta({ db: d.db, adapterPara: e.adapterPara, hoy, ahoraMs: Date.parse(`${hoy}T12:00:00Z`) })
      if (e.cargos.length > antes) vistos.push(hoy)
    }
    expect(vistos).toEqual(['2026-11-23', '2026-11-26'])
    expect(e.cargos.map((c) => c.numeroCuota)).toEqual([3, 3])
    expect(d.tablas.cobro_intentos_tarjeta.map((f) => [f.numero_cuota, f.intento, f.resultado])).toEqual([
      [3, 0, 'rechazado'],
      [3, 1, 'rechazado'],
    ])
    // El plan sigue en la tarjeta: la regla del primer cobro del autoservicio no aplica.
    expect(d.tablas.planes_cobro[0].pasarela).toBe('epayco')
    expect(actividad[0]).toMatch(/intento del día 0: Fondos insuficientes\. Se manda el enlace de pago y se reintenta con la tarjeta el día 3\./)
    expect(actividad[1]).toMatch(/intento del día 3: .*Último intento con la tarjeta \(Términos v1\.5, 2\.4\)/)
  })

  it('el cargo va con el titular, el correo, el celular y la IP de la autorización', async () => {
    const d = crearDoble(base())
    const e = epayco([APROBADO])
    const r = await cobrarCuotasConTarjeta({ db: d.db, adapterPara: e.adapterPara, hoy: '2026-11-23' })
    expect(r.aprobadas).toBe(1)
    expect(e.cargos).toHaveLength(1)
    const c = e.cargos[0]
    expect(c.monto).toBe(150000)
    expect(c.medioPago).toMatchObject({ tipo: 'tarjeta', token_ref: REF, pasarela: 'epayco' })
    expect(c.cliente).toMatchObject({
      nombre: 'Ana',
      apellido: 'Pérez Gómez',
      email: 'ana@cda.co',
      documento: '1012345678',
      tipoDocumento: 'CC',
      celular: '3001234567',
      ip: '190.1.2.3',
    })
  })

  it('el día 6 sin pagar: el plan queda frenado y no se intenta', async () => {
    const d = crearDoble(base())
    const e = epayco([RECHAZO])
    const r = await cobrarCuotasConTarjeta({ db: d.db, adapterPara: e.adapterPara, hoy: '2026-11-29' })
    expect(e.cargos).toHaveLength(0)
    expect(r.fueraDeGraciaCda).toBe(1)
  })

  it('una tarjeta quitada no cobra: sin tarjeta activa el plan no es de un CDA con pago automático', async () => {
    const t = base()
    t.tarjetas_pago_cda[0].estado = 'quitada'
    const d = crearDoble(t)
    const e = epayco([APROBADO])
    await cobrarCuotasConTarjeta({ db: d.db, adapterPara: e.adapterPara, hoy: '2026-11-23' })
    expect(e.cargos).toHaveLength(0)
  })
})

describe('una cuota sola (cobrarCuotaConTarjeta)', () => {
  it('un período atrasado no se cobra sin la orden de la persona designada (D3)', async () => {
    const d = crearDoble(base())
    const e = epayco([APROBADO])
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara }, { cobradorId: METRIK, cuotaId: 'q2', intento: 0 })
    expect(r).toEqual({ tipo: 'no_aplica', motivo: 'periodo_atrasado_sin_orden' })
    expect(e.cargos).toHaveLength(0)
  })

  it('con su clic (`manual`) sí, también la cuota 1 y sin pasar el plan a Bold si se rechaza', async () => {
    const d = crearDoble(base())
    const e = epayco([RECHAZO])
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara }, { cobradorId: METRIK, cuotaId: 'q1', intento: 1, manual: true })
    expect(r.tipo).toBe('rechazado')
    expect(e.cargos).toHaveLength(1)
    expect(d.tablas.planes_cobro[0].pasarela).toBe('epayco')
    expect(actividad[0]).toMatch(/Cobro pedido por la persona designada; sin reintento automático/)
  })

  it('no hay intento del día 7 para un CDA (D4)', async () => {
    const d = crearDoble(base())
    const e = epayco([APROBADO])
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara }, { cobradorId: METRIK, cuotaId: 'q3', intento: 2 })
    expect(r).toEqual({ tipo: 'no_aplica', motivo: 'fuera_del_calendario_cda' })
    expect(e.cargos).toHaveLength(0)
  })
})
