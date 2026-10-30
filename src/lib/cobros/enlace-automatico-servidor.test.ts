import { describe, it, expect, vi } from 'vitest'
import { crearDoble, type Fila, type Tablas } from '../../../test/tablas-doble'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { generarEnlacesAutomaticos, type CorreoSaliente, type ResultadoEnvio } from './enlace-automatico-servidor'

/**
 * La cadena completa: selección → `generarEnlacePagoCuota` (la función del botón, sin dobles) →
 * correo → `avisos_cliente` → `activity_log`, contra tablas en memoria que se escriben de verdad.
 * La pasarela y el envío del correo son dobles; nada sale de la máquina.
 */

const HOY = '2026-09-25'
const AHORA = Date.parse('2026-09-25T12:00:00Z')
const CONCEPTO = 'Licencia VALIDA · Starter — periodo del 23/10/2026 al 22/11/2026'

function tablasBase(extra: Partial<Tablas> = {}): Tablas {
  return {
    workspaces: [
      { id: 'wsM', slug: 'metrik', name: 'MéTRIK', config_extra: { cobros: { pasarela_en_linea: 'bold' } } },
      { id: 'wsC', slug: 'cda-pruebas', name: 'CDA Pruebas', config_extra: {} },
    ],
    servicios_contratados: [
      {
        id: 'sc1', workspace_id: 'wsM', negocio_id: 'n1', estado: 'activo', vigente_desde: '2026-09-01',
        aceptante_designado_id: 'p1', workspace_pagador_id: 'wsC',
      },
    ],
    profiles: [{ id: 'p1', full_name: 'Ana María Prueba', workspace_id: 'wsC' }],
    // Inactivo a propósito: el plan de pruebas de cda-pruebas está así y tiene que recibir enlace.
    planes_cobro: [{ id: 'plan1', workspace_id: 'wsM', negocio_id: 'n1', total_cuotas: 3, pasarela: 'manual', activo: false }],
    plan_cobro_cuotas: [
      { id: 'q1', workspace_id: 'wsM', plan_cobro_id: 'plan1', numero: 1, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-09-20', concepto_detalle: CONCEPTO },
      { id: 'q2', workspace_id: 'wsM', plan_cobro_id: 'plan1', numero: 2, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-10-01', concepto_detalle: CONCEPTO },
      { id: 'q3', workspace_id: 'wsM', plan_cobro_id: 'plan1', numero: 3, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-11-01', concepto_detalle: CONCEPTO },
    ],
    cobros: [],
    avisos_cliente: [],
    activity_log: [],
    ...extra,
  }
}

function pasarelaFalsa() {
  let n = 0
  const crear = vi.fn(async (s: { cobroId: string; expiraMs: number }) => ({
    ok: true as const,
    idEnlace: `LNK_${++n}`,
    url: `https://checkout.test/${s.cobroId}/${s.expiraMs}`,
    expira: new Date(s.expiraMs).toISOString(),
  }))
  const adapter = { id: 'bold', crearEnlacePago: crear, faltaConfiguracion: () => null } as unknown as PasarelaAdapter
  return { crear, adapterPara: (x: string) => (x === 'bold' ? adapter : null) }
}

function correoFalso(r: ResultadoEnvio = { ok: true, id: 'resend-1' }) {
  return vi.fn(async (_m: CorreoSaliente) => r)
}

async function correr(tablas: Tablas, opts: { enviar?: ReturnType<typeof correoFalso>; correo?: string | null; ahoraMs?: number; hoy?: string } = {}) {
  const d = crearDoble(tablas)
  const pasarela = pasarelaFalsa()
  const enviar = opts.enviar ?? correoFalso()
  const resumen = await generarEnlacesAutomaticos(
    { hoy: opts.hoy ?? HOY, ahoraMs: opts.ahoraMs ?? AHORA },
    {
      db: d.db,
      adapterPara: pasarela.adapterPara,
      enviarCorreo: enviar,
      correoDePersona: async () => (opts.correo === undefined ? 'ana@cda.test' : opts.correo),
      urlSuscripcion: (slug) => `https://${slug}.metrikone.co/suscripcion`,
    },
  )
  return { ...d, pasarela, enviar, resumen }
}

const programado = (t: Tablas, numero: number) =>
  (t.cobros as Fila[]).find((c) => c.plan_cobro_id === 'plan1' && c.numero_cuota === numero && c.tipo_cobro === 'programado')

describe('generarEnlacesAutomaticos', () => {
  it('genera el enlace de la vencida y de la que vence en la ventana; la de noviembre no', async () => {
    const r = await correr(tablasBase())
    expect(r.resumen.generados.map((g) => g.numero)).toEqual([1, 2])
    expect(r.pasarela.crear).toHaveBeenCalledTimes(2)
    // El cobro programado nace SIN pagar (fecha null explícita) y con el enlace.
    const c1 = programado(r.tablas, 1)!
    expect(c1.fecha).toBeNull()
    expect(String(c1.enlace_pago_url)).toContain('https://checkout.test/')
    expect(programado(r.tablas, 3)).toBeUndefined()
    // No emite cuentas de cobro ni toca el cronograma.
    expect(r.escrituras.some((e) => e.tabla === 'cuentas_cobro_emitidas' || e.tabla === 'plan_cobro_cuotas')).toBe(false)
  })

  it('manda un correo por enlace a la persona designada, con botón a su /suscripcion', async () => {
    const r = await correr(tablasBase())
    expect(r.enviar).toHaveBeenCalledTimes(2)
    const m = r.enviar.mock.calls[0][0]
    expect(m.to).toBe('ana@cda.test')
    expect(m.html).toContain('href="https://cda-pruebas.metrikone.co/suscripcion"')
    expect(m.html).not.toContain('checkout.test')
    expect(m.text).toContain('Hola, Ana.')
    expect(m.text).toContain('$150.000')
    expect(m.text).toContain('del 23 de octubre al 22 de noviembre de 2026')
    expect(m.subject).toContain('MéTRIK')
    // Registro: una fila por correo en avisos_cliente, con el id de Resend para los acuses.
    expect(r.tablas.avisos_cliente).toHaveLength(2)
    expect(r.tablas.avisos_cliente[0]).toMatchObject({ workspace_id: 'wsM', negocio_id: 'n1', canal: 'email', estado: 'enviado', destino: 'ana@cda.test', proveedor_id: 'resend-1' })
    // Y la generación queda en el timeline como automática.
    expect(r.tablas.activity_log).toHaveLength(2)
    expect(String(r.tablas.activity_log[0].contenido)).toMatch(/^Enlace de pago en línea generado automáticamente para la cuota 1 por \$150\.000/)
    expect(r.tablas.activity_log[0].autor_id).toBeNull()
  })

  it('es idempotente: la segunda corrida del mismo día no crea enlaces ni manda correos', async () => {
    const tablas = tablasBase()
    await correr(tablas)
    const segunda = await correr(tablas)
    expect(segunda.pasarela.crear).not.toHaveBeenCalled()
    expect(segunda.enviar).not.toHaveBeenCalled()
    expect(segunda.resumen.generados).toEqual([])
    expect(segunda.resumen.descartadas.enlace_vigente).toBe(2)
    expect(tablas.avisos_cliente).toHaveLength(2)
    expect((tablas.cobros as Fila[]).filter((c) => c.tipo_cobro === 'programado')).toHaveLength(2)
  })

  it('cuando el enlace vence, la corrida siguiente genera uno nuevo y avisa una vez más', async () => {
    const tablas = tablasBase()
    await correr(tablas)
    const url1 = programado(tablas, 1)!.enlace_pago_url
    const ocho = await correr(tablas, { ahoraMs: AHORA + 8 * 86_400_000 })
    expect(ocho.resumen.generados.map((g) => g.numero)).toContain(1)
    expect(programado(tablas, 1)!.enlace_pago_url).not.toBe(url1)
    expect(ocho.enviar).toHaveBeenCalled()
  })

  it('pagadas y anuladas quedan fuera: ni enlace ni correo', async () => {
    const r = await correr(
      tablasBase({
        cobros: [
          { id: 'c1', workspace_id: 'wsM', negocio_id: 'n1', plan_cobro_id: 'plan1', numero_cuota: 1, tipo_cobro: 'programado', monto: 150000, fecha: '2026-09-19', anulado_at: null },
          { id: 'c2', workspace_id: 'wsM', negocio_id: 'n1', plan_cobro_id: 'plan1', numero_cuota: 2, tipo_cobro: 'programado', monto: 0, fecha: null, anulado_at: '2026-09-21T00:00:00Z' },
        ],
      }),
    )
    expect(r.pasarela.crear).not.toHaveBeenCalled()
    expect(r.enviar).not.toHaveBeenCalled()
    expect(r.resumen.descartadas).toMatchObject({ pagada: 1, anulada: 1 })
  })

  it('plan manual sin pasarela en línea en el espacio: nada', async () => {
    const t = tablasBase()
    t.workspaces[0].config_extra = {}
    const r = await correr(t)
    expect(r.resumen.candidatas).toBe(0)
    expect(r.pasarela.crear).not.toHaveBeenCalled()
  })

  it('contrato terminado: nada', async () => {
    const t = tablasBase()
    t.servicios_contratados[0].estado = 'terminado'
    const r = await correr(t)
    expect(r.pasarela.crear).not.toHaveBeenCalled()
  })

  it('una cuota cubierta por un pago anterior (FIFO) no recibe enlace: la decide la función del botón', async () => {
    const r = await correr(
      tablasBase({
        // Un pago suelto del negocio que cubre la cuota 1 completa: la 1 queda cubierta, la 2 no.
        cobros: [{ id: 'suelto', workspace_id: 'wsM', negocio_id: 'n1', plan_cobro_id: null, numero_cuota: null, tipo_cobro: 'pago', monto: 150000, fecha: '2026-09-18', anulado_at: null }],
      }),
    )
    expect(r.resumen.generados.map((g) => g.numero)).toEqual([2])
    expect(r.resumen.omitidas.map((o) => o.cuotaId)).toEqual(['q1'])
    expect(r.resumen.errores).toEqual([])
  })

  it('sin persona designada: genera el enlace y deja el aviso omitido, con su motivo', async () => {
    const t = tablasBase()
    t.servicios_contratados[0].aceptante_designado_id = null
    const r = await correr(t)
    expect(r.enviar).not.toHaveBeenCalled()
    expect(r.resumen.generados).toHaveLength(2)
    expect(r.tablas.avisos_cliente.map((a) => [a.estado, a.motivo])).toEqual([
      ['omitido', 'sin_designado'],
      ['omitido', 'sin_designado'],
    ])
  })

  it('si Resend rechaza, el aviso queda fallido y no se reintenta con otro enlace al día siguiente', async () => {
    const tablas = tablasBase()
    const r = await correr(tablas, { enviar: correoFalso({ ok: false, error: 'resend_422' }) })
    expect(tablas.avisos_cliente.map((a) => a.estado)).toEqual(['fallido', 'fallido'])
    expect(r.resumen.generados.every((g) => g.aviso === 'fallido')).toBe(true)
    const otra = await correr(tablas)
    expect(otra.enviar).not.toHaveBeenCalled()
  })

  it('si otro proceso guardó un enlace entre la lectura y la escritura, gana el primero y no hay correo', async () => {
    const tablas = tablasBase()
    const d = crearDoble(tablas)
    const enviar = correoFalso()
    const base = pasarelaFalsa().adapterPara('bold')!
    // La pasarela «tarda»: mientras crea el enlace, el botón guarda otro en el mismo cobro.
    const lento = {
      ...base,
      crearEnlacePago: async (s: { cobroId: string; expiraMs: number; monto: number; descripcion: string; referencia: string }) => {
        const fila = (tablas.cobros as Fila[]).find((c) => c.id === s.cobroId)!
        fila.enlace_pago_url = 'https://checkout.test/del-boton'
        fila.enlace_pago_expira = '2026-10-02T12:00:00.000Z'
        return base.crearEnlacePago!(s)
      },
    } as PasarelaAdapter
    const resumen = await generarEnlacesAutomaticos(
      { hoy: HOY, ahoraMs: AHORA },
      { db: d.db, adapterPara: (x) => (x === 'bold' ? lento : null), enviarCorreo: enviar, correoDePersona: async () => 'ana@cda.test' },
    )
    expect(resumen.generados).toEqual([])
    expect(resumen.errores).toHaveLength(2)
    expect(enviar).not.toHaveBeenCalled()
    expect(programado(tablas, 1)!.enlace_pago_url).toBe('https://checkout.test/del-boton')
  })

  describe('día hábil del país del cliente que paga (decisión 2026-09-27)', () => {
    it('un sábado no genera enlace ni manda correo, y el lunes sale todo lo que quedó', async () => {
      const tablas = tablasBase()
      const sabado = await correr(tablas, { hoy: '2026-09-26', ahoraMs: Date.parse('2026-09-26T15:00:00Z') })
      expect(sabado.pasarela.crear).not.toHaveBeenCalled()
      expect(sabado.enviar).not.toHaveBeenCalled()
      expect(sabado.resumen.omitidas.map((o) => o.motivo)).toEqual(['dia_no_habil_CO', 'dia_no_habil_CO'])
      expect(tablas.avisos_cliente).toHaveLength(0)
      // No se pierde: el lunes habil la misma cuota sigue candidata y se genera y avisa.
      const lunes = await correr(tablas, { hoy: '2026-09-28', ahoraMs: Date.parse('2026-09-28T13:00:00Z') })
      expect(lunes.pasarela.crear).toHaveBeenCalled()
      expect(lunes.enviar).toHaveBeenCalled()
      expect(lunes.resumen.omitidas).toEqual([])
    })

    it('un festivo colombiano frena al cliente colombiano', async () => {
      const r = await correr(tablasBase(), { hoy: '2026-10-12', ahoraMs: Date.parse('2026-10-12T13:00:00Z') })
      expect(r.pasarela.crear).not.toHaveBeenCalled()
      expect(r.resumen.omitidas.every((o) => o.motivo === 'dia_no_habil_CO')).toBe(true)
    })

    it('el país es el del espacio que PAGA: un pagador de otro país no se frena por un festivo colombiano', async () => {
      const tablas = tablasBase()
      tablas.workspaces = (tablas.workspaces as Fila[]).map((w) => (w.id === 'wsC' ? { ...w, pais: 'MX' } : { ...w, pais: 'CO' }))
      const r = await correr(tablas, { hoy: '2026-10-12', ahoraMs: Date.parse('2026-10-12T13:00:00Z') })
      expect(r.pasarela.crear).toHaveBeenCalled()
      expect(r.resumen.omitidas.filter((o) => o.motivo.startsWith('dia_no_habil'))).toEqual([])
    })
  })
})

describe('planes que cobran con la tarjeta guardada (pasarela epayco)', () => {
  const conTarjeta = (extra: Partial<Tablas> = {}) =>
    tablasBase({ planes_cobro: [{ id: 'plan1', workspace_id: 'wsM', negocio_id: 'n1', total_cuotas: 3, pasarela: 'epayco', activo: false }], ...extra })

  it('sin rechazo de la tarjeta, ninguna cuota recibe enlace (se pagaría dos veces)', async () => {
    const r = await correr(conTarjeta({ cobro_intentos_tarjeta: [] }))
    expect(r.pasarela.crear).not.toHaveBeenCalled()
    expect(r.resumen.conTarjetaSinRechazo).toBe(2)
  })

  it('la cuota que la tarjeta rechazó recibe su enlace y su correo el mismo día (día 0 de Carmen)', async () => {
    const r = await correr(conTarjeta({ cobro_intentos_tarjeta: [{ plan_cobro_id: 'plan1', numero_cuota: 2, intento: 0, resultado: 'rechazado' }] }))
    expect(r.resumen.generados.map((g) => g.numero)).toEqual([2])
    expect(r.enviar).toHaveBeenCalledTimes(1)
    expect(r.resumen.conTarjetaSinRechazo).toBe(1)
    // El correo del día 0 dice que la tarjeta no pasó (Términos de autoservicio 3.6).
    const m = r.enviar.mock.calls[0][0]
    expect(m.subject).toBe('No pudimos cobrar tu cuota con MéTRIK a la tarjeta: puedes pagarla en línea')
    expect(m.text).toContain('No pudimos cobrar la cuota 2 de CDA Pruebas a la tarjeta que registraste en ePayco: la tarjeta rechazó el cobro.')
    expect(m.html).toContain('la tarjeta rechazó el cobro')
  })

  describe('un CDA con el pago automático (Términos v1.5, 2.4)', () => {
    // q1: período del 23-ago (atrasado); q2: período del 23-sep, después del registro del 22-sep.
    const cda = (extra: Partial<Tablas> = {}) => {
      const t = conTarjeta(extra)
      const cuotas = t.plan_cobro_cuotas as Fila[]
      cuotas[0].concepto_detalle = 'Licencia VALIDA · Starter — periodo del 23/08/2026 al 22/09/2026'
      cuotas[1].concepto_detalle = 'Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026'
      t.tarjetas_pago_cda = [
        {
          id: 't1', workspace_id: 'wsM', workspace_cliente_id: 'wsC', servicio_contratado_id: 'sc1', negocio_id: 'n1', plan_cobro_id: 'plan1',
          estado: 'activa', metodo_pago_ref: 'epayco:Cust1234:Tok12345', ultimos4: '1234', titular: {}, celular: '3001234567', correo: 'ana@cda.test',
          cobro_desde: '2026-09-22', dia_renovacion: 23, terminos_vigente_desde: '2026-12-01', ip: null,
        },
      ]
      return t
    }

    it('lo atrasado sigue recibiendo su enlace (la tarjeta nunca lo cobra sola); lo de la tarjeta, no', async () => {
      const r = await correr(cda({ cobro_intentos_tarjeta: [] }))
      expect(r.resumen.generados.map((g) => g.numero)).toEqual([1])
      expect(r.resumen.conTarjetaSinRechazo).toBe(1)
      expect(r.enviar.mock.calls[0][0].text).not.toContain('tarjeta')
    })

    it('rechazada la del período de la tarjeta: enlace y correo con la tarjeta, el reintento y la pausa', async () => {
      const r = await correr(cda({ cobro_intentos_tarjeta: [{ plan_cobro_id: 'plan1', numero_cuota: 2, intento: 0, resultado: 'rechazado' }] }))
      expect(r.resumen.generados.map((g) => g.numero)).toEqual([1, 2])
      const m = r.enviar.mock.calls.map((c) => c[0]).find((x) => x.subject.startsWith('No pudimos'))!
      expect(m.subject).toBe('No pudimos cobrar tu período a la tarjeta terminada en 1234: puedes pagarlo en línea')
      expect(m.text).toMatch(/No pudimos cobrar el período del \d+ de \p{L}+ al \d+ de \p{L}+ de \d{4} de CDA Pruebas a tu tarjeta terminada en 1234\. Puedes pagarlo en línea desde la sección Suscripción de MéTRIK ONE\./u)
      expect(m.text).toContain('Reintentamos el cobro a tu tarjeta el 26 de septiembre de 2026. Si no se paga, las consultas nuevas se pausan desde el 6 de diciembre de 2026.')
      expect(m.html).toContain('Reintentamos el cobro a tu tarjeta el 26 de septiembre de 2026.')
    })
  })

  it('el primer cobro rechazado (el plan volvió al enlace, Condiciones 7.5) también lo dice; la otra cuota, no', async () => {
    const r = await correr(tablasBase({ cobro_intentos_tarjeta: [{ plan_cobro_id: 'plan1', numero_cuota: 1, intento: 0, resultado: 'rechazado' }] }))
    expect(r.resumen.generados.map((g) => g.numero)).toEqual([1, 2])
    const [c1, c2] = r.enviar.mock.calls.map((c) => c[0])
    expect(c1.text).toContain('la tarjeta rechazó el cobro')
    expect(c2.text).not.toContain('tarjeta')
    expect(c2.subject).not.toContain('No pudimos cobrar')
  })
})

describe('generarEnlacesAutomaticos sobre una suscripción (suscripciones_producto)', () => {
  function deSuscripcion(): Tablas {
    return tablasBase({
      servicios_contratados: [
        {
          id: 'sc1', workspace_id: 'wsM', negocio_id: null, suscripcion_id: 's1', estado: 'activo', vigente_desde: '2026-09-01',
          aceptante_designado_id: 'p1', workspace_pagador_id: 'wsC',
        },
      ],
      planes_cobro: [{ id: 'plan1', workspace_id: 'wsM', negocio_id: null, suscripcion_id: 's1', total_cuotas: 3, pasarela: 'manual', activo: false }],
      suscripciones_producto: [{ id: 's1', workspace_id: 'wsM', workspace_cliente_id: 'wsC', datos_fiscales: {} }],
      suscripciones_producto_eventos: [],
    })
  }

  it('genera el enlace, el cobro cuelga de la suscripción y el aviso va a su bitácora (no a avisos_cliente ni a activity_log)', async () => {
    const r = await correr(deSuscripcion())
    expect(r.resumen.errores).toEqual([])
    expect(r.resumen.generados.map((g) => g.numero)).toEqual([1, 2])
    expect(r.resumen.generados[0]).toMatchObject({ negocioId: null, suscripcionId: 's1' })
    const c1 = programado(r.tablas, 1)!
    expect(c1).toMatchObject({ negocio_id: null, suscripcion_id: 's1', fecha: null })
    expect(r.enviar).toHaveBeenCalledTimes(2)
    expect(r.tablas.avisos_cliente).toHaveLength(0)
    expect(r.tablas.activity_log).toHaveLength(0)
    const tipos = (r.tablas.suscripciones_producto_eventos as Fila[]).map((e) => e.tipo)
    expect(tipos.filter((t) => t === 'aviso_enlace')).toHaveLength(2)
    expect(tipos.filter((t) => t === 'enlace_pago')).toHaveLength(2)
  })

  it('un contrato de negocio no le presta su plan a una suscripción con el mismo espacio', async () => {
    const t = deSuscripcion()
    // El contrato de la suscripción está cancelado; uno de negocio vivo en el mismo espacio no la cubre.
    t.servicios_contratados[0].estado = 'cancelado'
    t.servicios_contratados.push({ id: 'sc2', workspace_id: 'wsM', negocio_id: 'n9', estado: 'activo', vigente_desde: '2026-09-01', workspace_pagador_id: 'wsC' })
    const r = await correr(t)
    expect(r.resumen.generados).toEqual([])
  })
})
