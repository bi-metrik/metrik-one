/**
 * La casilla «Calcular con IVA» sobre el doble de Supabase (2026-10-19): el servidor sabe qué
 * proveedor tiene cada línea (el mismo pedido de la tarjeta), le pone el 19 % solo a la del
 * proveedor que declara IVA, nace encendida con viajero residente, no toca una cotización enviada
 * y recalcula cuando algo cambió. Proveedores ficticios. Nada sale a la red.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso } from '../../../../test/cotizacion-pdf-doble'

const sesion = vi.hoisted(() => ({ role: 'owner' as string }))
const recalculo = vi.hoisted(() => ({ llamadas: [] as string[] }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: WS, staffId: ANA, userId: 'u-1', role: sesion.role, areas: [], error: null }),
}))
vi.mock('./cotizacion-actions', () => ({
  recalcularTotales: async (id: string) => {
    recalculo.llamadas.push(id)
    return { success: true }
  },
}))

const WS = '11111111-2222-4333-8444-555555555555'
const ANA = 'a0000000-0000-4000-8000-000000000001'
const COT = 'c0000000-0000-4000-8000-0000000000c1'
const HOTEL = 'd0000000-0000-4000-8000-000000000001'

import { claveDeFoto } from '@/lib/fotos/clave'
import { cambiarIvaDeCostos, sincronizarIvaDeCostos } from './iva-costos-actions'

const hotel = (id: string, nombre: string, ciudad: string) => ({
  id,
  cotizacion_id: COT,
  nombre,
  grupo: 'hotel',
  es_ajuste: false,
  iva_costo_pct: null,
  tarifa_pax: { casillas: { grupo_completo: { moneda: 'COP', total: 1, campos: [{ label: 'Hotel', valor: nombre }, { label: 'Ciudad', valor: ciudad }] } } },
})

function sembrar({ estado = 'borrador', declara = true as boolean | null, guardada = null as boolean | null, residente = null as boolean | null } = {}) {
  base.secuencia = 0
  base.tablas = {
    workspaces: [{ id: WS, cotizacion_template_slug: 'trappvel', config_extra: {} }],
    cotizaciones: [{ id: COT, workspace_id: WS, estado, costos_con_iva: guardada, viajero_residente: residente }],
    items: [
      hotel('i1', 'Hotel Ficticio Playa', 'Cartagena'),
      hotel('i2', 'Posada Inventada', 'Cartagena'),
      { id: 'i3', cotizacion_id: COT, nombre: 'VUELO BOG-CTG', grupo: 'vuelo', es_ajuste: false, iva_costo_pct: null, tarifa_pax: null },
    ],
    fotos_perfiles: [
      { id: HOTEL, workspace_id: WS, tipo: 'hotel', clave: claveDeFoto('hotel', 'Hotel Ficticio Playa', 'Cartagena'), nombre: 'Hotel Ficticio Playa', ciudad: 'Cartagena', iva_declarado: declara },
      { id: 'd2', workspace_id: WS, tipo: 'hotel', clave: claveDeFoto('hotel', 'Posada Inventada', 'Cartagena'), nombre: 'Posada Inventada', ciudad: 'Cartagena', iva_declarado: false },
    ],
    fotos_perfiles_alias: [],
    fotos_catalogo: [],
  }
}

const pct = (id: string) => base.tablas.items.find((i) => i.id === id)?.iva_costo_pct ?? null

beforeEach(() => {
  sesion.role = 'owner'
  recalculo.llamadas = []
  sembrar()
})

describe('casilla «Calcular con IVA»', () => {
  it('nace encendida: solo la línea del proveedor que declara IVA lleva el 19 % y se recalcula', async () => {
    const r = await sincronizarIvaDeCostos(COT)
    expect(r).toMatchObject({ ok: true, disponible: true, encendida: true, porDefecto: true, proveedoresConIva: ['Hotel Ficticio Playa'], lineasConIva: 1, cambio: true })
    expect([pct('i1'), pct('i2'), pct('i3')]).toEqual([19, null, null])
    expect(recalculo.llamadas).toEqual([COT])
    // Abrir otra vez no cambia nada ni recalcula.
    expect(await sincronizarIvaDeCostos(COT)).toMatchObject({ ok: true, cambio: false })
    expect(recalculo.llamadas).toHaveLength(1)
  })

  it('apagarla quita el IVA y queda guardada; viajero no residente también la apaga por defecto', async () => {
    await sincronizarIvaDeCostos(COT)
    expect(await cambiarIvaDeCostos(COT, { encendida: false })).toMatchObject({ ok: true, encendida: false, porDefecto: false, cambio: true })
    expect(pct('i1')).toBeNull()
    expect(base.tablas.cotizaciones[0].costos_con_iva).toBe(false)

    sembrar()
    expect(await cambiarIvaDeCostos(COT, { viajeroResidente: false })).toMatchObject({ ok: true, encendida: false, viajeroResidente: false, porDefecto: true })
    expect(pct('i1')).toBeNull()
  })

  it('sin proveedor que declare IVA no pasa nada', async () => {
    sembrar({ declara: null })
    expect(await sincronizarIvaDeCostos(COT)).toMatchObject({ ok: true, encendida: false, proveedoresConIva: [], cambio: false })
    expect(recalculo.llamadas).toEqual([])
  })

  it('una cotización enviada no cambia de precio (ni al abrir ni a mano)', async () => {
    sembrar({ estado: 'enviada' })
    expect(await sincronizarIvaDeCostos(COT)).toMatchObject({ ok: true, editable: false, cambio: false, lineasConIva: 0 })
    expect(pct('i1')).toBeNull()
    expect(await cambiarIvaDeCostos(COT, { encendida: true })).toMatchObject({ ok: false, error: expect.stringMatching(/borrador/) })
  })

  it('un rol de solo lectura no la cambia', async () => {
    sesion.role = 'read_only'
    expect(await cambiarIvaDeCostos(COT, { encendida: false })).toMatchObject({ ok: false })
    expect(await sincronizarIvaDeCostos(COT)).toMatchObject({ ok: true, cambio: false })
    expect(pct('i1')).toBeNull()
  })

  it('fuera de la propuesta de viaje la casilla no existe', async () => {
    base.tablas.workspaces[0].cotizacion_template_slug = 'generica'
    expect(await sincronizarIvaDeCostos(COT)).toMatchObject({ ok: true, disponible: false })
    expect(pct('i1')).toBeNull()
  })
})
