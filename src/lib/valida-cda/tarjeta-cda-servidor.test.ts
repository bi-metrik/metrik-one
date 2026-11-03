/**
 * Registrar, cambiar y quitar la tarjeta del pago automático de un CDA, y cobrar lo atrasado con el clic
 * (Términos v1.5, 2.4; diseño del 2026-10-30), sobre tablas en memoria.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => null }))
vi.mock('@/lib/valida-api/terminos-servidor', () => ({ documentosDelCliente: async () => ({ ok: false, motivo: 'base' }) }))
vi.mock('@/lib/valida-api/contexto', () => ({ origenPeticion: async () => ({ ip: null, userAgent: null }) }))
vi.mock('./pago-servidor', () => ({ leerCuentaCda: async () => ({ estado: 'no_disponible', motivo: 'base' }) }))
vi.mock('@/lib/valida-registro/cobro-token-servidor', () => ({ cobrarCuotaConTarjeta: async () => ({ tipo: 'error', mensaje: 'no' }) }))
const actividad: string[] = []
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_db: unknown, fila: { contenido: string }) => {
    actividad.push(fila.contenido)
  },
}))

const { cobrarPendienteConTarjeta, quitarTarjetaCda, registrarTarjetaCda, vistaPagoAutomatico } = await import('./tarjeta-cda-servidor')
const { textoAutorizacionTarjeta } = await import('./tarjeta-cda')

const METRIK = 'ws-metrik'
const CDA = 'ws-cda'
const REF_NUEVA = 'epayco:CustNuevo1234:TokNuevo5678'
const REF_VIEJA = 'epayco:CustViejo1234:TokViejo5678'
const PLAN = 'Suscripción VALIDA · Plan CDA — mensual'
const AUTORIZACION = textoAutorizacionTarjeta(23)

function doc(aceptada: boolean): DocumentoContractual {
  return {
    documentoId: 'd15',
    slug: 'terminos-suscripcion-valida-cda',
    titulo: 'Términos',
    version: 'v1.5',
    textoMd: 'La fecha de renovación del Cliente es el día 23 de cada mes.',
    pdfSha256: 'x',
    vigenteDesde: '2026-12-01',
    vigenteHasta: null,
    aceptadoAt: aceptada ? '2026-11-02T15:00:00Z' : null,
    aceptadoPor: null,
    aceptadoCalidad: null,
    aceptadoCanal: null,
    rigePorAviso: true,
    publicadaAt: '2026-11-01T05:00:00Z',
  }
}

const ctx = (p: { designado?: boolean } = {}) =>
  ({
    tipo: 'ok',
    producto: 'valida_cda',
    entrada: { hoy: '2026-11-02', usuarioEfectivoId: 'u-ana', servicioContratadoId: 'sc' },
    workspaceId: CDA,
    usuarioId: 'u-ana',
    designadoId: p.designado === false ? 'u-otro' : 'u-ana',
    soloLectura: false,
    contrato: { id: 'sc', negocioId: 'n1', cobradorId: METRIK },
  }) as never

const cuenta = async () => ({
  estado: 'ok' as const,
  cuotas: [
    { cuotaId: 'q1', numero: 1, tipo: 'cuota', monto: 150000, fechaVencimiento: '2026-09-30', concepto: `${PLAN} · periodo del 23-sep al 22-oct`, enlacePagoUrl: null, enlacePagoExpira: null },
    { cuotaId: 'q2', numero: 2, tipo: 'cuota', monto: 150000, fechaVencimiento: '2026-10-27', concepto: `${PLAN} · periodo del 23-oct al 22-nov`, enlacePagoUrl: null, enlacePagoExpira: null },
  ],
  cobros: [],
  pagos: [],
})

function tablas(conTarjeta = false): Tablas {
  return {
    planes_cobro: [{ id: 'p1', workspace_id: METRIK, negocio_id: 'n1', pasarela: conTarjeta ? 'epayco' : 'bold' }],
    cobro_intentos_tarjeta: [],
    tarjetas_pago_cda: conTarjeta
      ? [
          {
            id: 't0',
            workspace_id: METRIK,
            workspace_cliente_id: CDA,
            servicio_contratado_id: 'sc',
            negocio_id: 'n1',
            plan_cobro_id: 'p1',
            estado: 'activa',
            metodo_pago_ref: REF_VIEJA,
            ultimos4: '1111',
            titular: {},
            celular: '3001234567',
            correo: 'ana@cda.co',
            cobro_desde: '2026-10-30',
            dia_renovacion: 23,
            terminos_vigente_desde: '2026-12-01',
            ip: null,
          },
        ]
      : [],
  }
}

const TARJETA = { token: 'TokNuevo5678', nombres: 'Ana', apellidos: 'Pérez', tipoDocumento: 'CC', documento: '1012345678', celular: '3001234567' }

function deps(d: ReturnType<typeof crearDoble>, p: { aceptada?: boolean } = {}) {
  const borradas: string[] = []
  const clientes: unknown[] = []
  return {
    borradas,
    clientes,
    deps: {
      db: d.db,
      documentos: async () => ({ ok: true as const, documentos: [doc(p.aceptada ?? true)] }),
      cuenta,
      ahoraMs: Date.parse('2026-11-02T15:00:00Z'),
      epaycoHabilitado: true,
      registrarCliente: async (x: unknown) => {
        clientes.push(x)
        return { ok: true as const, ref: REF_NUEVA, customerId: 'CustNuevo1234' }
      },
      ultimos4: async () => '4242',
      eliminarTarjeta: async (ref: string) => {
        borradas.push(ref)
        return { ok: true as const, borradas: 1 }
      },
      origen: async () => ({ ip: '190.1.2.3', userAgent: 'Prueba' }),
    },
  }
}

beforeEach(() => {
  actividad.length = 0
})

describe('registrar la tarjeta', () => {
  it('sin la v1.5 aceptada no se registra nada (D2)', async () => {
    const d = crearDoble(tablas())
    const x = deps(d, { aceptada: false })
    const r = await registrarTarjetaCda(ctx(), { tarjeta: TARJETA, autorizacionMostrada: AUTORIZACION, acepta: true }, { correo: 'ana@cda.co' }, x.deps)
    expect(r).toEqual({ ok: false, error: 'Para registrar la tarjeta primero acepta la versión 1.5 de los Términos.' })
    expect(x.clientes).toHaveLength(0)
    expect(d.tablas.tarjetas_pago_cda).toHaveLength(0)
  })

  it('quien no es la persona designada no registra (D1)', async () => {
    const d = crearDoble(tablas())
    const x = deps(d)
    const r = await registrarTarjetaCda(ctx({ designado: false }), { tarjeta: TARJETA, autorizacionMostrada: AUTORIZACION, acepta: true }, { correo: 'x@cda.co' }, x.deps)
    expect(r.ok).toBe(false)
    expect(x.clientes).toHaveLength(0)
  })

  it('sin la casilla, o con otro texto en la casilla, no se registra', async () => {
    const d = crearDoble(tablas())
    const x = deps(d)
    expect((await registrarTarjetaCda(ctx(), { tarjeta: TARJETA, autorizacionMostrada: AUTORIZACION, acepta: false }, { correo: 'a@b.co' }, x.deps)).ok).toBe(false)
    const otro = await registrarTarjetaCda(ctx(), { tarjeta: TARJETA, autorizacionMostrada: textoAutorizacionTarjeta(5), acepta: true }, { correo: 'a@b.co' }, x.deps)
    expect(otro.ok).toBe(false)
    expect(x.clientes).toHaveLength(0)
  })

  it('la primera tarjeta: la constancia, cobro_desde = hoy, el plan pasa a la tarjeta', async () => {
    const d = crearDoble(tablas())
    const x = deps(d)
    const r = await registrarTarjetaCda(ctx(), { tarjeta: TARJETA, autorizacionMostrada: AUTORIZACION, acepta: true }, { correo: 'ana@cda.co' }, x.deps)
    expect(r).toEqual({ ok: true, ultimos4: '4242' })
    expect(d.tablas.tarjetas_pago_cda).toHaveLength(1)
    expect(d.tablas.tarjetas_pago_cda[0]).toMatchObject({
      estado: 'activa',
      metodo_pago_ref: REF_NUEVA,
      ultimos4: '4242',
      cobro_desde: '2026-11-02',
      dia_renovacion: 23,
      terminos_documento_id: 'd15',
      terminos_vigente_desde: '2026-12-01',
      autorizacion_texto: AUTORIZACION,
      usuario_id: 'u-ana',
      ip: '190.1.2.3',
      correo: 'ana@cda.co',
      celular: '3001234567',
    })
    expect(d.tablas.tarjetas_pago_cda[0].autorizacion_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(d.tablas.planes_cobro[0].pasarela).toBe('epayco')
    // El documento del TITULAR, no el NIT del CDA.
    expect(x.clientes[0]).toMatchObject({ cardTokenId: 'TokNuevo5678', pagador: { tipoDocumento: 'CC', documento: '1012345678', email: 'ana@cda.co' } })
  })

  it('cambiarla: cierra la anterior, conserva desde qué día cobra sola y pide borrar la vieja en ePayco', async () => {
    const d = crearDoble(tablas(true))
    const x = deps(d)
    const r = await registrarTarjetaCda(ctx(), { tarjeta: TARJETA, autorizacionMostrada: AUTORIZACION, acepta: true }, { correo: 'ana@cda.co' }, x.deps)
    expect(r.ok).toBe(true)
    const [vieja, nueva] = d.tablas.tarjetas_pago_cda
    expect(vieja).toMatchObject({ estado: 'reemplazada', cerrada_por: 'u-ana', borrado_epayco: 'ok' })
    expect(nueva).toMatchObject({ estado: 'activa', cobro_desde: '2026-10-30' })
    expect(x.borradas).toEqual([REF_VIEJA])
    expect(actividad[0]).toMatch(/^Cambió la tarjeta terminada en 4242/)
  })
})

describe('quitar la tarjeta', () => {
  it('se cierra, el plan vuelve a Bold y se pide a ePayco borrarla', async () => {
    const d = crearDoble(tablas(true))
    const x = deps(d)
    const r = await quitarTarjetaCda(ctx(), x.deps)
    expect(r).toEqual({ ok: true, borrada: true })
    expect(d.tablas.tarjetas_pago_cda[0]).toMatchObject({ estado: 'quitada', borrado_epayco: 'ok' })
    expect(d.tablas.planes_cobro[0].pasarela).toBe('bold')
    expect(x.borradas).toEqual([REF_VIEJA])
  })
})

describe('lo atrasado, con el clic (D3)', () => {
  it('la vista ofrece el pendiente con su pregunta, y el cobro exige la huella de lo confirmado', async () => {
    const d = crearDoble(tablas(true))
    const x = deps(d)
    const vista = await vistaPagoAutomatico(ctx(), x.deps)
    expect(vista?.tipo).toBe('activa')
    if (vista?.tipo !== 'activa' || !vista.pendiente?.cobrable) throw new Error('sin pendiente cobrable')
    expect(vista.resumen).toBe('Pago automático activo · tarjeta terminada en 1111 · próximo cobro 23 de noviembre')
    expect(vista.pendiente.texto).toBe('Tienes pendiente $300.000 (períodos 23-sep al 22-oct de 2026 y 23-oct al 22-nov de 2026).')
    expect(vista.pendiente.pregunta).toBe('¿Pagarlo ahora con esta tarjeta?')

    const cobros: { cuotaId: string; intento: number; manual: true }[] = []
    const cobrar = async (p: { cobradorId: string; cuotaId: string; intento: number; manual: true }) => {
      cobros.push(p)
      return { tipo: 'aprobado' as const, cobroId: 'c', detalle: 'ok' }
    }
    expect((await cobrarPendienteConTarjeta(ctx(), 'otra-huella', { ...x.deps, cobrar })).ok).toBe(false)
    expect(cobros).toHaveLength(0)
    const r = await cobrarPendienteConTarjeta(ctx(), vista.pendiente.huella, { ...x.deps, cobrar })
    expect(r).toEqual({ ok: true, texto: 'Listo: se cobraron $300.000 a tu tarjeta terminada en 1111.' })
    expect(cobros.map((c) => [c.cuotaId, c.intento, c.manual])).toEqual([
      ['q1', 0, true],
      ['q2', 0, true],
    ])
  })

  it('un rechazo frena los siguientes y lo dice', async () => {
    const d = crearDoble(tablas(true))
    const x = deps(d)
    const vista = await vistaPagoAutomatico(ctx(), x.deps)
    if (vista?.tipo !== 'activa' || !vista.pendiente?.cobrable) throw new Error('sin pendiente cobrable')
    let n = 0
    const cobrar = async () =>
      ++n === 1 ? { tipo: 'aprobado' as const, cobroId: 'c', detalle: 'ok' } : { tipo: 'rechazado' as const, cobroId: 'c', mensaje: 'Fondos insuficientes' }
    const r = await cobrarPendienteConTarjeta(ctx(), vista.pendiente.huella, { ...x.deps, cobrar })
    expect(r).toEqual({
      ok: false,
      error: 'Se cobraron $150.000. El banco rechazó el cobro del período 23-oct al 22-nov de 2026: Fondos insuficientes. No se cobró ese período; puedes pagarlo con el enlace de pago.',
    })
  })

  it('sin la v1.5 aceptada, la vista lleva a aceptarla; sin tarjeta, a registrarla', async () => {
    const d = crearDoble(tablas())
    expect(await vistaPagoAutomatico(ctx(), deps(d, { aceptada: false }).deps)).toEqual({ tipo: 'acepta_v15' })
    expect(await vistaPagoAutomatico(ctx(), deps(d).deps)).toEqual({ tipo: 'sin_tarjeta' })
    expect(await vistaPagoAutomatico(ctx({ designado: false }), deps(d).deps)).toBeNull()
  })
})
