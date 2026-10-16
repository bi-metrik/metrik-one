/**
 * La suscripción de Valida EN PRUEBA (2026-10-16): nace al registrarse, una sola por espacio, y
 * «Cancelar prueba» la cierra con la misma acción desde `/valida` y desde `/suscripcion`.
 * La activación que la pasa a activa (sin duplicar) se prueba en PGlite:
 * `src/lib/suscripciones-producto/migracion-sql.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'

vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => undefined }))

const { asegurarSuscripcionEnPrueba } = await import('./suscripcion-prueba-servidor')
const { cancelarCobroDelEspacio } = await import('./cobro-prueba-servidor')

const METRIK = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const WS = 'ws-cli'
const REF = 'epayco:DiYPdhgncppes9KAb:XCX92PZqBKfmcWFbA'

function tablas(extra: Partial<Tablas> = {}): Tablas {
  return {
    valida_registros: [
      {
        id: 'reg-1',
        workspace_id: WS,
        estado: 'creado',
        usuario_id: 'u-1',
        razon_social: 'CDA PRUEBAS FUTURAS',
        identificacion: '987643872',
        dv: '6',
        correo: 'gerencia@cda.co',
        aceptado_at: '2026-10-16T16:30:54.137Z',
        prueba_vence_en: '2026-10-23T16:30:55.044Z',
        origen: 'afi',
        origen_fuente: 'codigo_afi',
        metodo_pago_estado: 'registrado',
        metodo_pago_ref: REF,
        slug_creado: 'cda-pruebas-futuras',
        cobro_estado: 'programado',
        cobro_programado_at: '2026-10-23T16:30:55.044Z',
      },
    ],
    suscripciones_producto: [],
    suscripciones_producto_eventos: [],
    ...extra,
  }
}

describe('la suscripción nace en prueba al registrarse', () => {
  it('crea UNA fila en prueba, del cobrador, con la empresa declarada, el plan, el fin de la prueba y la tarjeta', async () => {
    const d = crearDoble(tablas())
    const r = await asegurarSuscripcionEnPrueba(d.db, { workspaceId: WS })
    expect(r.tipo).toBe('creada')
    expect(d.tablas.suscripciones_producto).toHaveLength(1)
    expect(d.tablas.suscripciones_producto[0]).toMatchObject({
      workspace_id: METRIK,
      producto: 'valida',
      workspace_cliente_id: WS,
      nombre: 'Valida — CDA PRUEBAS FUTURAS',
      numero_documento: '987643872',
      dv: '6',
      correo_facturacion: 'gerencia@cda.co',
      plan_slug: 'valida-cda-licencia',
      estado: 'prueba',
      prueba_desde: '2026-10-16T16:30:54.137Z',
      prueba_hasta: '2026-10-23T16:30:55.044Z',
      origen_comercial: 'afi',
      valida_registro_id: 'reg-1',
      metodo_pago_pasarela: 'epayco',
      metodo_pago_ref: REF,
      creado_por: 'u-1',
    })
    expect(d.tablas.suscripciones_producto_eventos).toEqual([expect.objectContaining({ tipo: 'prueba', workspace_id: METRIK })])
  })

  it('es idempotente: el reintento del registro no crea otra, y completa el fin de la prueba si faltaba', async () => {
    const d = crearDoble(tablas())
    d.tablas.valida_registros[0].prueba_vence_en = null
    await asegurarSuscripcionEnPrueba(d.db, { workspaceId: WS })
    expect(d.tablas.suscripciones_producto[0].prueba_hasta).toBeNull()
    d.tablas.valida_registros[0].prueba_vence_en = '2026-10-23T16:30:55.044Z'
    const r = await asegurarSuscripcionEnPrueba(d.db, { workspaceId: WS })
    expect(r.tipo).toBe('ya_estaba')
    expect(d.tablas.suscripciones_producto).toHaveLength(1)
    expect(d.tablas.suscripciones_producto[0].prueba_hasta).toBe('2026-10-23T16:30:55.044Z')
  })

  it('sin tarjeta, la fila nace sin medio de pago; sin registro, no hace nada', async () => {
    const d = crearDoble(tablas())
    Object.assign(d.tablas.valida_registros[0], { metodo_pago_estado: 'sin_metodo', metodo_pago_ref: null })
    await asegurarSuscripcionEnPrueba(d.db, { workspaceId: WS })
    expect(d.tablas.suscripciones_producto[0]).toMatchObject({ metodo_pago_pasarela: null, metodo_pago_ref: null })
    expect(await asegurarSuscripcionEnPrueba(crearDoble(tablas({ valida_registros: [] })).db, { workspaceId: WS })).toEqual({ tipo: 'sin_registro' })
  })

  it('un espacio que ya tiene su suscripción activa no recibe una en prueba', async () => {
    const d = crearDoble(tablas({ suscripciones_producto: [{ id: 's-1', workspace_id: METRIK, producto: 'valida', workspace_cliente_id: WS, estado: 'activa' }] }))
    expect(await asegurarSuscripcionEnPrueba(d.db, { workspaceId: WS })).toEqual({ tipo: 'ya_estaba', suscripcionId: 's-1' })
    expect(d.tablas.suscripciones_producto).toHaveLength(1)
  })
})

describe('«Cancelar prueba» cierra también la suscripción en prueba', () => {
  it('el cobro queda cancelado, la suscripción en prueba pasa a cancelada con su motivo y su línea de bitácora', async () => {
    const d = crearDoble(tablas())
    await asegurarSuscripcionEnPrueba(d.db, { workspaceId: WS })
    const r = await cancelarCobroDelEspacio(
      { db: d.db, ahoraMs: Date.parse('2026-10-17T15:00:00Z'), eliminarTarjeta: async () => ({ ok: true, borradas: 1 }) },
      { workspaceId: WS, por: 'boton' },
    )
    expect(r.tipo).toBe('cancelada')
    expect(d.tablas.valida_registros[0].cobro_estado).toBe('cancelado')
    expect(d.tablas.suscripciones_producto[0]).toMatchObject({
      estado: 'cancelada',
      cancelada_at: '2026-10-17T15:00:00.000Z',
      cancelacion_motivo: 'Canceló la prueba con «Cancelar prueba».',
    })
    expect(d.tablas.suscripciones_producto_eventos.map((e) => e.tipo)).toEqual(['prueba', 'prueba_cancelada'])
  })

  it('una suscripción ya activa no se toca al cancelar', async () => {
    const d = crearDoble(tablas({ suscripciones_producto: [{ id: 's-1', workspace_id: METRIK, producto: 'valida', workspace_cliente_id: WS, estado: 'activa' }] }))
    await cancelarCobroDelEspacio({ db: d.db, eliminarTarjeta: async () => ({ ok: true, borradas: 1 }) }, { workspaceId: WS, por: 'boton' })
    expect(d.tablas.suscripciones_producto[0].estado).toBe('activa')
  })
})
