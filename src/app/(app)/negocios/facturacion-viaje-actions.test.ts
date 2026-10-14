/**
 * «Facturar ya» y los datos de facturación del viaje (F5-3, Vera C4, C15/§7.4): el servidor revisa
 * quién lo pide. Forzar es de la dirección (no alcanza con corregir documentos) y exige motivo; los
 * datos se editan hasta emitir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>
let inserts: Array<{ tabla: string; fila: Fila }> = []
let updates: Array<{ tabla: string; patch: Fila }> = []
let ctx: Record<string, unknown>

function cliente() {
  return {
    from: (tabla: string) => {
      const api: Record<string, unknown> = {
        insert: async (fila: Fila) => { inserts.push({ tabla, fila }); return { error: null } },
        update: (patch: Fila) => { updates.push({ tabla, patch }); return api },
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: { nombre: 'Carolina Prueba', email: 'caro@example.com', telefono: '3001112233' }, error: null }),
        then: (r: (v: unknown) => unknown) => r({ error: null }),
      }
      return api
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente() }))
vi.mock('@/lib/idempotencia/accion', () => ({ accionIdempotente: (_o: unknown, fn: () => unknown) => fn() }))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => ({ ok: true }) }))
vi.mock('@/lib/viaje/contexto-viaje', () => ({ contextoViaje: async () => ({ ok: true, ctx }) }))

const { forzarFacturaViaje, guardarDatosFacturacionViaje } = await import('./facturacion-viaje-actions')

const LINEA = { facturacion: { por_titular: { activo: true } }, plan_pagos: { activo: true } }

beforeEach(() => {
  inserts = []
  updates = []
  ctx = {
    supabase: cliente(), workspaceId: 'ws', userId: 'p-edgar', staffId: 's-edgar', role: 'operator',
    configLinea: LINEA,
    negocio: { id: 'n1', nombre: 'Viaje', metadata: {}, contacto_id: 'c1', linea_id: 'l', etapa_actual_id: 'e', precio_aprobado: 1, estado: 'abierto' },
    puedeConfirmar: true, esDireccion: true,
  }
})

describe('forzarFacturaViaje (F5-3)', () => {
  it('la dirección con motivo: queda una aprobación forzar_factura aprobada', async () => {
    expect(await forzarFacturaViaje('n1', 'El cliente la necesita para su viático')).toEqual({ ok: true })
    expect(inserts).toEqual([{ tabla: 'aprobaciones_excepcion', fila: expect.objectContaining({ tipo: 'forzar_factura', estado: 'aprobada', entidad_tipo: 'factura', entidad_id: 'n1', motivo: 'El cliente la necesita para su viático', decidida_por: 's-edgar' }) }])
  })

  it('la comercial (no dirección) recibe un rechazo del servidor', async () => {
    ctx.esDireccion = false
    expect(await forzarFacturaViaje('n1', 'porque sí, urgente')).toMatchObject({ ok: false, error: expect.stringContaining('dirección') })
    expect(inserts).toEqual([])
  })

  it('sin motivo, ya facturado o con la línea sin la regla del viaje: no', async () => {
    expect(await forzarFacturaViaje('n1', ' ')).toMatchObject({ ok: false })
    ctx.negocio = { ...(ctx.negocio as Fila), metadata: { siigo_factura: { numero: 'FE-1' } } }
    expect(await forzarFacturaViaje('n1', 'motivo suficiente')).toMatchObject({ ok: false, error: 'Este viaje ya está facturado.' })
    ctx.negocio = { ...(ctx.negocio as Fila), metadata: {} }
    ctx.configLinea = { plan_pagos: { activo: true } }
    expect(await forzarFacturaViaje('n1', 'motivo suficiente')).toMatchObject({ ok: false })
    expect(inserts).toEqual([])
  })
})

describe('guardarDatosFacturacionViaje', () => {
  it('guarda el titular con dirección y ciudad (lo que el tercero de Siigo exige)', async () => {
    const r = await guardarDatosFacturacionViaje('n1', { tipo: 'empresa', numero_documento: '900123456', nombre: 'Corp SAS', direccion: ' CL 10   20 30 ', municipio: 'Medellín', departamento: 'Antioquia' })
    expect(r).toEqual({ ok: true })
    const meta = updates.find(u => u.tabla === 'negocios')!.patch.metadata as { titular_facturacion: Fila }
    expect(meta.titular_facturacion).toMatchObject({ tipo: 'empresa', tipo_documento: '31', numero_documento: '900123456', direccion: 'CL 10 20 30', municipio: 'Medellín', departamento: 'Antioquia' })
  })

  it('después de emitir no se cambia; quien no puede confirmar, tampoco', async () => {
    ctx.negocio = { ...(ctx.negocio as Fila), metadata: { siigo_factura: { numero: 'FE-1' } } }
    expect(await guardarDatosFacturacionViaje('n1', { tipo: 'viajero' })).toMatchObject({ ok: false })
    ctx.negocio = { ...(ctx.negocio as Fila), metadata: {} }
    ctx.puedeConfirmar = false
    expect(await guardarDatosFacturacionViaje('n1', { tipo: 'viajero' })).toMatchObject({ ok: false })
    expect(updates).toEqual([])
  })
})
