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

async function correr(tablas: Tablas, opts: { enviar?: ReturnType<typeof correoFalso>; correo?: string | null; ahoraMs?: number } = {}) {
  const d = crearDoble(tablas)
  const pasarela = pasarelaFalsa()
  const enviar = opts.enviar ?? correoFalso()
  const resumen = await generarEnlacesAutomaticos(
    { hoy: HOY, ahoraMs: opts.ahoraMs ?? AHORA },
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
})
