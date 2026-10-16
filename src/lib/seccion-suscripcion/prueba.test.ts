/**
 * La sección Suscripción durante la prueba gratis de Valida (2026-10-16): quién la ve, qué muestra, y que
 * los CDA (con contrato) siguen por su camino de siempre.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import { resolverSuscripcionEnPrueba, type DepsSuscripcionEnPrueba } from './prueba'
import type { SaldoBolsa } from '@/lib/valida/corte-bolsa'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }))
vi.mock('@/app/(app)/valida/cancelar-prueba-acciones', () => ({ cancelarPruebaValida: async () => ({ ok: true, texto: 'x' }) }))

const WS = 'ws-cli'
const FIN = '2026-10-23T16:30:55.044Z'

function tablas(extra: Partial<Tablas> = {}): Tablas {
  return {
    workspaces: [{ id: WS, config_extra: { origen_registro: 'valida_autogestion', valida_prueba: { cliente_id: 'c', consultas: 10, vence_en: FIN } } }],
    valida_registros: [{ id: 'reg-1', workspace_id: WS, estado: 'creado', usuario_id: 'u-1' }],
    suscripciones_producto: [
      {
        id: 's-1',
        workspace_cliente_id: WS,
        producto: 'valida',
        valida_registro_id: 'reg-1',
        estado: 'prueba',
        razon_social: 'CDA PRUEBAS FUTURAS',
        metodo_pago_ref: 'epayco:abcd:efgh',
        prueba_hasta: FIN,
        created_at: '2026-10-16T16:30:54Z',
      },
    ],
    servicios_contratados: [],
    ...extra,
  }
}

const saldo: SaldoBolsa = { saldo: 7, compradas: 10, venceEn: FIN, bloqueada: false, motivo: null, esPrueba: true }

function deps(t: Tablas, extra: Partial<DepsSuscripcionEnPrueba> = {}): DepsSuscripcionEnPrueba {
  return {
    db: crearDoble(t).db,
    esAutogestion: (c) => (c as { origen_registro?: string } | null)?.origen_registro === 'valida_autogestion',
    pruebaDeConfig: (c) => ((c ?? {}) as { valida_prueba?: { cliente_id: string; consultas: number; vence_en: string } }).valida_prueba ?? null,
    cobro: async () => ({ estado: 'programado', cobroDesde: FIN, puedeCancelar: true }),
    saldo: async () => saldo,
    ultimos4: async () => '0326',
    ...extra,
  }
}

const persona = { workspaceId: WS, usuarioRealId: 'u-1', usuarioEfectivoId: 'u-1', impersonando: false, rolReal: 'owner' }

describe('quién ve la Suscripción en prueba', () => {
  it('la persona que se registró: plan en prueba, consultas usadas, primer cobro, tarjeta y cancelar', async () => {
    const s = await resolverSuscripcionEnPrueba(deps(tablas()), persona)
    expect(s).toMatchObject({
      suscripcionId: 's-1',
      estado: 'prueba',
      soloLectura: false,
      consultas: { usadas: 3, total: 10, restantes: 7 },
      ultimos4: '0326',
      prueba: { finIso: FIN, cobro: { estado: 'programado', precio: 150_000, puedeCancelar: true, boton: 'Cancelar prueba' } },
    })
  })

  it('otra persona del espacio no la ve (la ruta da 404); «Ver como» la ve en solo lectura, sin cancelar', async () => {
    expect(await resolverSuscripcionEnPrueba(deps(tablas()), { ...persona, usuarioRealId: 'u-2', usuarioEfectivoId: 'u-2' })).toBeNull()
    const verComo = await resolverSuscripcionEnPrueba(deps(tablas()), { ...persona, usuarioRealId: 'admin', impersonando: true })
    expect(verComo).toMatchObject({ soloLectura: true, prueba: { cobro: { puedeCancelar: false } } })
  })

  it('con contrato (un CDA, o la prueba ya activada) no aplica: manda la sección de siempre', async () => {
    const t = tablas({ servicios_contratados: [{ id: 'sc', workspace_pagador_id: WS, estado: 'activo' }] })
    expect(await resolverSuscripcionEnPrueba(deps(t), persona)).toBeNull()
  })

  it('un espacio que no es del registro autogestionado (los 4 CDA, AFI) no aplica', async () => {
    const t = tablas({ workspaces: [{ id: WS, config_extra: { modo_vitrina: true } }] })
    expect(await resolverSuscripcionEnPrueba(deps(t), persona)).toBeNull()
  })

  it('cancelada se sigue viendo mientras dura la prueba; vencida, desaparece', async () => {
    const t = tablas()
    t.suscripciones_producto[0].estado = 'cancelada'
    const cancelada = await resolverSuscripcionEnPrueba(deps(t, { cobro: async () => ({ estado: 'cancelado', cobroDesde: '2999-01-01T00:00:00Z', puedeCancelar: false }) }), persona)
    expect(cancelada).toMatchObject({ estado: 'cancelada', ultimos4: null })
    const vencida = await resolverSuscripcionEnPrueba(deps(t, { cobro: async () => ({ estado: 'cancelado', cobroDesde: '2020-01-01T00:00:00Z', puedeCancelar: false }) }), persona)
    expect(vencida).toBeNull()
  })
})

describe('la pantalla de /suscripcion en prueba', () => {
  it('muestra «En prueba», las consultas usadas, el primer cobro con la cláusula exacta, la tarjeta y «Cancelar prueba»', async () => {
    const { SuscripcionEnPruebaVista } = await import('@/app/(app)/suscripcion/suscripcion-en-prueba')
    const s = await resolverSuscripcionEnPrueba(deps(tablas()), persona)
    const html = renderToStaticMarkup(React.createElement(SuscripcionEnPruebaVista, { s: s! }))
    expect(html).toContain('>En prueba<')
    expect(html).toContain('data-consultas-usadas="3/10"')
    expect(html).toMatch(/data-primer-cobro[^>]*>.*\$150\.000.*viernes, 23 de octubre de 2026/)
    expect(html).toContain('Terminada en 0326')
    expect(html).toContain('data-texto-clausula')
    // La misma acción de /valida: el componente de la franja, con el nombre exacto.
    expect(html).toContain('>Cancelar prueba<')
    expect(html).toContain('href="/valida/activar"')
  })

  it('en solo lectura no hay botones', async () => {
    const { SuscripcionEnPruebaVista } = await import('@/app/(app)/suscripcion/suscripcion-en-prueba')
    const s = await resolverSuscripcionEnPrueba(deps(tablas()), { ...persona, usuarioRealId: 'admin', impersonando: true })
    const html = renderToStaticMarkup(React.createElement(SuscripcionEnPruebaVista, { s: s! }))
    expect(html).toContain('data-solo-lectura')
    expect(html).not.toContain('Cancelar prueba')
    expect(html).not.toContain('Activar plan')
  })
})
