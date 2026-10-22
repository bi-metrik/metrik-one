/**
 * «Busco el proveedor → elijo la tarifa → listo» (brief del 2026-10-21) de punta a punta sobre el
 * doble de Supabase: el buscador solo trae proveedores CITABLES (con extracción revisada), la que
 * está vencida para el viaje sale en gris, y la línea NACE con el costo confirmado, la ficha y el
 * origen de la tarifa. Fichas, tarifarios y precios ficticios. Ningún modelo, nada sale a la red.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

const viaje = vi.hoisted(() => ({
  composicion: { adultos: 2, ninos: 0, infantes: 0 } as { adultos: number; ninos: number; infantes: number },
  fechas: { inicio: '2027-02-01', fin: '2027-02-04' } as { inicio: string | null; fin: string | null },
}))
const sesion = vi.hoisted(() => ({ role: 'owner' as string }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: WS, staffId: ANA, userId: 'u-1', role: sesion.role, areas: [], error: null }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/cotizaciones/viaje-negocio', () => ({
  leerViajeDelNegocio: async () => ({ viaje: { composicion: viaje.composicion, fechas: viaje.fechas, destino: 'Cartagena', presentacion: null, nivelDetalle: 'normal' }, error: null }),
}))
vi.mock('@/lib/cotizaciones/por-pasos-datos', async (original) => ({
  ...(await original<typeof import('@/lib/cotizaciones/por-pasos-datos')>()),
  exigirPorPasos: async () => ({ ok: false, error: 'apagado en la prueba' }),
}))
vi.mock('@/app/(app)/negocios/cotizacion-actions', async (original) => ({
  ...(await original<typeof import('@/app/(app)/negocios/cotizacion-actions')>()),
  recalcularTotales: async () => ({ success: true }),
}))

const WS = '11111111-2222-4333-8444-555555555555'
const ANA = 'a0000000-0000-4000-8000-000000000001'
const COT = 'c0000000-0000-4000-8000-0000000000c1'
const HOTEL = 'd0000000-0000-4000-8000-000000000001'
const OPERADOR = 'd0000000-0000-4000-8000-000000000002'
const SIN_REVISAR = 'd0000000-0000-4000-8000-000000000003'
const SIN_NADA = 'd0000000-0000-4000-8000-000000000004'
const VENCIDO = 'd0000000-0000-4000-8000-000000000005'

process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'llave-de-prueba-para-firmar'

import { leerTarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'
import { descripcionVisibleDeLinea, nombreVisibleDeLinea } from '@/lib/cotizaciones/nombre-visible'
import { buscarProveedoresParaCotizacion, crearLineaConTarifa, tarifasParaLineaNueva } from './tarifas-proveedor-actions'

const fila = (x: Fila) => ({ moneda: 'COP', establecimiento: null, archivo: 'Tarifas Ficticias 2027.pdf', fuente: { pagina: 1, texto: 'cita' }, ...x })
const HOTEL_TARIFARIO = {
  canal: 'neta',
  temporadas: [{ id: 'T1', nombre: 'Baja', rangos: [{ desde: '2027-01-10', hasta: '2027-03-14' }] }],
  tarifas: [
    fila({ categoria: 'Doble Estándar', temporada_id: 'T1', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 300000, plan: 'Desayuno' }),
    fila({ categoria: 'Doble Superior', temporada_id: 'T1', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 380000, plan: 'Desayuno' }),
    fila({ categoria: 'Suite', temporada_id: 'T1', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 100, moneda: 'USD' }),
  ],
}
const TOURS = {
  canal: 'neta',
  tarifas: [
    fila({ categoria: 'Tour Ficticio de Bahía', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 105000 }),
    fila({ categoria: 'Tour Ficticio de Bahía', base_precio: 'por_persona', tipo_pasajero: 'nino', precio: 60000 }),
  ],
}
const ficha = (id: string, nombre: string, extra: Fila = {}): Fila => ({ id, workspace_id: WS, tipo: 'hotel', clave: `${nombre.toLowerCase()}|cartagena`, nombre, ciudad: 'Cartagena', tipo_proveedor: 'hotel', tarifa_canal: null, iva_incluido: null, iva_declarado: null, ...extra })
const extraccion = (id: string, proveedor: string, x: Fila = {}): Fila => ({ id, workspace_id: WS, proveedor_id: proveedor, estado: 'revisada', created_at: '2026-10-19T10:00:00Z', vigencia_desde: '2027-01-01', vigencia_hasta: '2027-12-31', vigencia_por: 'persona', monedas: {}, tarifario: HOTEL_TARIFARIO, expediente: {}, ...x })

function sembrar() {
  base.secuencia = 0
  viaje.composicion = { adultos: 2, ninos: 0, infantes: 0 }
  viaje.fechas = { inicio: '2027-02-01', fin: '2027-02-04' }
  base.tablas = {
    cotizaciones: [{ id: COT, workspace_id: WS, estado: 'borrador', negocio_id: 'neg-1', convencion_margen: 'sobre_venta' }],
    items: [],
    rubros: [],
    profiles: [{ id: 'u-1', full_name: 'Ana Ficticia' }],
    fotos_perfiles: [
      ficha(HOTEL, 'Hotel Ficticio Playa'),
      ficha(OPERADOR, 'Operador Ficticio', { tipo: 'proveedor', tipo_proveedor: 'operador' }),
      ficha(SIN_REVISAR, 'Hotel Ficticio Borrador'),
      ficha(SIN_NADA, 'Hotel Ficticio Sin Tarifas'),
      ficha(VENCIDO, 'Hotel Ficticio Vencido'),
    ],
    fotos_perfiles_alias: [],
    fotos_catalogo: [],
    proveedor_extracciones: [
      extraccion('e0000000-0000-4000-8000-000000000001', HOTEL),
      extraccion('e0000000-0000-4000-8000-000000000002', OPERADOR, { tarifario: TOURS }),
      extraccion('e0000000-0000-4000-8000-000000000003', SIN_REVISAR, { estado: 'borrador', vigencia_desde: null, vigencia_hasta: null }),
      extraccion('e0000000-0000-4000-8000-000000000005', VENCIDO, { vigencia_desde: '2026-01-01', vigencia_hasta: '2026-12-31' }),
    ],
  }
}

const lineas = () => base.tablas.items as Fila[]
const costoEnRubros = () => base.tablas.rubros.reduce((a, x) => a + Number(x.valor_unitario) * Number(x.cantidad), 0)

beforeEach(() => {
  sesion.role = 'owner'
  sembrar()
})

describe('el buscador solo trae proveedores citables (punto 1)', () => {
  it('sin texto: los que tienen extracción revisada; ni el del borrador ni el que no tiene nada', async () => {
    const r = await buscarProveedoresParaCotizacion(COT, '')
    expect(r.ok && r.fichas.map((f) => [f.nombre, f.cubre])).toEqual([
      ['Hotel Ficticio Playa', true],
      ['Operador Ficticio', true],
      // La revisada vencida para las fechas del viaje sale al final y en gris (`cubre: false`).
      ['Hotel Ficticio Vencido', false],
    ])
  })

  it('con texto: busca por el nombre y aplica el mismo criterio', async () => {
    const r = await buscarProveedoresParaCotizacion(COT, 'hotel ficticio')
    expect(r.ok && r.fichas.map((f) => f.id)).toEqual([HOTEL, VENCIDO])
    const b = await buscarProveedoresParaCotizacion(COT, 'borrador')
    expect(b).toEqual({ ok: true, fichas: [] })
  })
})

describe('la línea nace con la tarifa (puntos 2 y 3)', () => {
  it('un hotel: nombre y ciudad de la ficha, fechas y pasajeros del viaje, costo confirmado, ficha y origen guardados', async () => {
    const v = await tarifasParaLineaNueva(COT, HOTEL)
    expect(v).toMatchObject({ ok: true, tipoNueva: 'hotel', fechas: { entrada: '2027-02-01', salida: '2027-02-04', deLaLinea: false }, composicionDelViaje: true })
    const r = await crearLineaConTarifa(COT, HOTEL, { filas: [{ indice: 0 }] }, null, null, { idAceptacion: 'tarifa-prueba-hotel-1', medida: { segundos: 12.4 } })
    expect(r).toMatchObject({ ok: true, confirmada: true, pendiente: null, moneda: 'COP', total: 900000 })
    expect(lineas()).toHaveLength(1)
    const item = lineas()[0]
    expect(item.nombre).toBe('HOTEL FICTICIO PLAYA')
    expect(item.proveedor_id).toBe(HOTEL)
    const t = leerTarifaPax(item.tarifa_pax)
    expect(t.casillas?.grupo_completo).toMatchObject({ origen: 'tarifario', total: 900000 })
    expect(t.casillas?.grupo_completo?.campos).toEqual(expect.arrayContaining([
      { label: 'Hotel', valor: 'Hotel Ficticio Playa' },
      { label: 'Ciudad', valor: 'Cartagena' },
    ]))
    expect(t.tarifaExtraida).toMatchObject({ proveedor_id: HOTEL, filas: [{ indice_fila: 0, cantidad: 1, noches: 3 }], camino: 'linea_nueva', segundos: 12 })
    expect(t.confirmada).toMatchObject({ costoTotalCOP: 900000 })
    expect(costoEnRubros()).toBe(900000)
    // Ninguna línea queda pendiente ni en $0.
    expect(t.casillas?.grupo_completo?.costoPendiente).toBeUndefined()
  })

  it('un reintento con la misma llave no crea otra línea', async () => {
    await crearLineaConTarifa(COT, HOTEL, { filas: [{ indice: 0 }] }, null, null, { idAceptacion: 'tarifa-prueba-hotel-2' })
    await crearLineaConTarifa(COT, HOTEL, { filas: [{ indice: 0 }] }, null, null, { idAceptacion: 'tarifa-prueba-hotel-2' })
    expect(lineas()).toHaveLength(1)
  })

  it('un tour con una fila por tipo de pasajero: el total es el de las dos filas', async () => {
    viaje.composicion = { adultos: 2, ninos: 1, infantes: 0 }
    const v = await tarifasParaLineaNueva(COT, OPERADOR)
    expect(v).toMatchObject({ ok: true, tipoNueva: 'actividad' })
    const r = await crearLineaConTarifa(COT, OPERADOR, { filas: [{ indice: 0 }, { indice: 1 }] })
    expect(r).toMatchObject({ ok: true, confirmada: true, total: 2 * 105000 + 60000 })
    expect(costoEnRubros()).toBe(270000)
    expect(lineas()[0].proveedor_id).toBe(OPERADOR)
  })

  it('USD sin tasa: la línea entra igual, con el aviso de la tasa pendiente (no se bloquea)', async () => {
    const r = await crearLineaConTarifa(COT, HOTEL, { filas: [{ indice: 2 }] })
    expect(r).toMatchObject({ ok: true, confirmada: false, moneda: 'USD', total: 300, pendiente: expect.stringMatching(/tasa/) })
    expect(lineas()).toHaveLength(1)
    expect(leerTarifaPax(lineas()[0].tarifa_pax).casillas?.grupo_completo).toMatchObject({ origen: 'tarifario', moneda: 'USD' })
    // Con la tasa, de una vez.
    sembrar()
    const c = await crearLineaConTarifa(COT, HOTEL, { filas: [{ indice: 2 }] }, null, 4000)
    expect(c).toMatchObject({ ok: true, confirmada: true })
    expect(costoEnRubros()).toBe(1200000)
  })

  it('un proveedor sin tarifas revisadas, o vencidas para el viaje, no crea nada', async () => {
    expect(await crearLineaConTarifa(COT, SIN_REVISAR, { filas: [{ indice: 0 }] })).toMatchObject({ ok: false })
    expect(await crearLineaConTarifa(COT, VENCIDO, { filas: [{ indice: 0 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/pide el tarifario nuevo/) })
    expect(lineas()).toHaveLength(0)
  })

  it('prueba del #1229 · el nombre completo y lo que incluye llegan al documento; IVA sin respaldo vacío; un viaje de un día propone el día', async () => {
    viaje.fechas = { inicio: '2027-02-01', fin: '2027-02-01' }
    base.tablas.proveedor_extracciones[1].tarifario = {
      canal: 'neta',
      impuestos: { iva_declarado: false, iva_incluido: false, iva_pct: null },
      planes: [{ codigo: 'CA', nombre: 'CON ALMUERZO', incluye: ['ALMUERZO TÍPICO', 'Transporte en lancha'] }],
      tarifas: [
        fila({ categoria: 'PLAYA FICTICIA', plan: 'CA', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 95000 }),
        fila({ categoria: 'TOUR NOCTURNO FICTICIO', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 33000 }),
      ],
    }
    const v = await tarifasParaLineaNueva(COT, OPERADOR)
    expect(v.ok && v.ajustes?.ivaPct).toBeNull()
    const r = await crearLineaConTarifa(COT, OPERADOR, { filas: [{ indice: 0 }] }, v.ok ? v.ajustes : null)
    expect(r).toMatchObject({ ok: true, confirmada: true, total: 190000 })
    const item = lineas()[0]
    // Lo que imprime el documento del cliente (`cotizacion-pdf-actions`: nombre y descripción visibles).
    expect(nombreVisibleDeLinea(item)).toBe('Playa Ficticia con almuerzo')
    expect(descripcionVisibleDeLinea(item)).toContain('Incluye: almuerzo típico y transporte en lancha.')
    const t = leerTarifaPax(item.tarifa_pax)
    expect(t.tarifaExtraida?.iva_pct).toBeNull()
    expect(item.dia_relativo).toBe(1)
  })

  it('una cotización enviada o un rol de solo lectura no crean la línea', async () => {
    sesion.role = 'read_only'
    expect(await crearLineaConTarifa(COT, HOTEL, { filas: [{ indice: 0 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/rol/) })
    sesion.role = 'owner'
    base.tablas.cotizaciones[0].estado = 'enviada'
    expect(await crearLineaConTarifa(COT, HOTEL, { filas: [{ indice: 0 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/ya no se edita/) })
    expect(lineas()).toHaveLength(0)
  })
})
