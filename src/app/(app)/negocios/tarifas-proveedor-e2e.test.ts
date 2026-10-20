/**
 * Las tarifas del proveedor dentro de la cotización, de punta a punta sobre el doble de Supabase
 * (Mauricio, 2026-10-19): la línea guarda su proveedor, ONE ofrece las tarifas de la extracción
 * REVISADA y la persona elige; el costo entra por la confirmación de siempre (rubros, margen del
 * proveedor, tasa). Fichas, tarifarios y precios ficticios. Ningún modelo, nada sale a la red.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

const sesion = vi.hoisted(() => ({ role: 'owner' as string }))
const viaje = vi.hoisted(() => ({
  composicion: { adultos: 2, ninos: 0, infantes: 0 } as { adultos: number; ninos: number; infantes: number },
  fechas: { inicio: '2027-02-01', fin: '2027-02-04' } as { inicio: string | null; fin: string | null },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: WS, staffId: ANA, userId: 'u-1', role: sesion.role, areas: [], error: null }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/cotizaciones/viaje-negocio', () => ({
  leerViajeDelNegocio: async () => ({ viaje: { composicion: viaje.composicion, fechas: viaje.fechas, destino: null, presentacion: null, nivelDetalle: 'normal' }, error: null }),
}))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({ recalcularTotales: async () => ({ success: true }), deleteItem: async () => ({ success: true }) }))

const WS = '11111111-2222-4333-8444-555555555555'
const OTRO_WS = '99999999-2222-4333-8444-555555555555'
const ANA = 'a0000000-0000-4000-8000-000000000001'
const COT = 'c0000000-0000-4000-8000-0000000000c1'
const ITEM = 'f0000000-0000-4000-8000-000000000001'
const HOTEL = 'd0000000-0000-4000-8000-000000000001'
const CADENA = 'd0000000-0000-4000-8000-000000000002'
const SUCURSAL = 'd0000000-0000-4000-8000-000000000003'
const AJENO = 'd0000000-0000-4000-8000-0000000000ff'
const EXT = 'e0000000-0000-4000-8000-000000000001'

import { leerTarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'
import { confirmarTarifaPorPasajero } from './tarifa-pax-actions'
import { buscarFichasParaLinea, elegirTarifasDeLinea, fijarProveedorDeLinea, tarifasDeLinea } from './tarifas-proveedor-actions'

const fila = (x: Fila) => ({ moneda: 'COP', establecimiento: null, archivo: 'Tarifas Ficticias 2027.pdf', fuente: { pagina: 1, texto: 'cita' }, ...x })
const TARIFARIO = {
  canal: 'neta',
  temporadas: [{ id: 'T1', nombre: 'Baja', rangos: [{ desde: '2027-01-10', hasta: '2027-03-14' }] }, { id: 'T2', nombre: 'Alta', rangos: [{ desde: '2027-03-15', hasta: '2027-04-05' }] }],
  tarifas: [
    fila({ categoria: 'Doble Estándar', temporada_id: 'T1', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 300000, plan: 'Desayuno' }),
    fila({ categoria: 'Doble Estándar', temporada_id: 'T2', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 400000, plan: 'Desayuno' }),
    fila({ categoria: 'Doble Estándar', temporada_id: 'T1', base_precio: 'por_persona_noche', tipo_pasajero: 'adulto', precio: 160000 }),
    fila({ categoria: 'Doble Estándar', temporada_id: 'T1', base_precio: 'por_persona_noche', tipo_pasajero: 'nino', precio: 80000 }),
    fila({ categoria: 'Suite', temporada_id: 'T1', ocupacion: 'doble', base_precio: 'por_habitacion_noche', precio: 100, moneda: 'USD' }),
  ],
}
const extraccion = (x: Fila = {}): Fila => ({ id: EXT, workspace_id: WS, proveedor_id: HOTEL, estado: 'revisada', created_at: '2026-10-19T10:00:00Z', vigencia_desde: '2027-01-01', vigencia_hasta: '2027-12-31', vigencia_por: 'persona', monedas: {}, tarifario: TARIFARIO, expediente: {}, ...x })
const ficha = (id: string, nombre: string, extra: Fila = {}): Fila => ({ id, workspace_id: WS, tipo: 'hotel', clave: `${nombre.toLowerCase()}|cartagena`, nombre, ciudad: 'Cartagena', tipo_proveedor: 'hotel', tarifa_canal: null, iva_incluido: null, iva_declarado: null, ...extra })

function sembrar({ estado = 'borrador' } = {}) {
  base.secuencia = 0
  viaje.composicion = { adultos: 2, ninos: 0, infantes: 0 }
  viaje.fechas = { inicio: '2027-02-01', fin: '2027-02-04' }
  base.tablas = {
    cotizaciones: [{ id: COT, workspace_id: WS, estado, negocio_id: 'neg-1', convencion_margen: 'sobre_venta' }],
    items: [{ id: ITEM, cotizacion_id: COT, nombre: 'Opción 1', grupo: 'hotel', es_ajuste: false, precio_manual: false, margen_porcentaje: null, subtotal: 0, cantidad: 1, tarifa_pax: null, proveedor_id: null }],
    rubros: [],
    profiles: [{ id: 'u-1', full_name: 'Ana Ficticia' }],
    fotos_perfiles: [
      ficha(HOTEL, 'Hotel Ficticio Playa'),
      ficha(CADENA, 'Cadena Ficticia'),
      ficha(SUCURSAL, 'Cadena Ficticia Centro', { tarifario_de_id: CADENA, tarifario_establecimiento: 'Cadena Ficticia Centro' }),
      { ...ficha(AJENO, 'Hotel Ficticio Ajeno'), workspace_id: OTRO_WS },
    ],
    fotos_perfiles_alias: [],
    fotos_catalogo: [],
    proveedor_extracciones: [extraccion()],
  }
}

const item = () => base.tablas.items[0]
const tarifa = () => leerTarifaPax(item().tarifa_pax)

beforeEach(() => {
  sesion.role = 'owner'
  sembrar()
})

describe('la línea guarda su proveedor', () => {
  it('sin proveedor, la línea abre el buscador; fijar una ficha del espacio la guarda, una de otro espacio no', async () => {
    expect(await tarifasDeLinea(ITEM)).toMatchObject({ ok: true, proveedor: null, opciones: [] })
    const b = await buscarFichasParaLinea(ITEM, 'ficticio')
    expect(b.ok && b.fichas.map((f) => f.id)).toEqual([HOTEL])
    expect(await buscarFichasParaLinea(ITEM, 'a')).toEqual({ ok: true, fichas: [] })
    expect(await fijarProveedorDeLinea(ITEM, AJENO)).toMatchObject({ ok: false })
    expect(item().proveedor_id).toBeNull()
    expect(await fijarProveedorDeLinea(ITEM, HOTEL)).toEqual({ ok: true })
    expect(item().proveedor_id).toBe(HOTEL)
    expect(await tarifasDeLinea(ITEM)).toMatchObject({ ok: true, proveedor: { id: HOTEL, por: 'linea', enlace: `/proveedores/${HOTEL}` }, motivo: null })
  })

  it('una cotización enviada o un rol de solo lectura no la cambian', async () => {
    sesion.role = 'read_only'
    expect(await fijarProveedorDeLinea(ITEM, HOTEL)).toMatchObject({ ok: false, error: expect.stringMatching(/rol/) })
    sesion.role = 'owner'
    sembrar({ estado: 'enviada' })
    expect(await fijarProveedorDeLinea(ITEM, HOTEL)).toMatchObject({ ok: false, error: expect.stringMatching(/ya no se edita/) })
    expect(item().proveedor_id).toBeNull()
  })
})

describe('por qué no hay tarifas, en llano', () => {
  it('proveedor sin carga cerrada', async () => {
    item().proveedor_id = HOTEL
    base.tablas.proveedor_extracciones = [extraccion({ estado: 'borrador', vigencia_desde: null, vigencia_hasta: null })]
    expect(await tarifasDeLinea(ITEM)).toMatchObject({ ok: true, opciones: [], motivo: expect.stringMatching(/no se ha cerrado/) })
  })

  it('proveedor sin extracción', async () => {
    item().proveedor_id = HOTEL
    base.tablas.proveedor_extracciones = []
    expect(await tarifasDeLinea(ITEM)).toMatchObject({ ok: true, motivo: expect.stringMatching(/no tiene tarifario extraído/) })
  })

  it('la vigencia confirmada no cubre las fechas del viaje (no la de hoy)', async () => {
    item().proveedor_id = HOTEL
    viaje.fechas = { inicio: '2028-02-01', fin: '2028-02-04' }
    const r = await tarifasDeLinea(ITEM)
    expect(r).toMatchObject({ ok: true, opciones: [], motivo: expect.stringMatching(/vale del 1 ene 2027 al 31 dic 2027 y no cubre las fechas del viaje/) })
    expect(await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 0 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/no cubre/) })
    expect(item().tarifa_pax).toBeNull()
  })

  it('una extracción de otro espacio no se usa', async () => {
    item().proveedor_id = HOTEL
    base.tablas.proveedor_extracciones = [extraccion({ workspace_id: OTRO_WS })]
    expect(await tarifasDeLinea(ITEM)).toMatchObject({ ok: true, motivo: expect.stringMatching(/no tiene tarifario extraído/) })
  })
})

describe('ofrecer y elegir', () => {
  beforeEach(() => {
    item().proveedor_id = HOTEL
  })

  it('ofrece las tarifas con el filtro a la vista; nada se elige solo', async () => {
    const r = await tarifasDeLinea(ITEM)
    expect(r.ok && r.opciones.map((o) => [o.indice, o.fueraPor])).toEqual([[0, []], [1, ['temporada']], [2, []], [3, ['pasajero']], [4, []]])
    expect(r.ok && r.ajustes).toEqual({ canal: 'neta', comisionPct: null, ivaIncluido: false, ivaPct: 19 })
    expect(item().tarifa_pax).toBeNull()
    expect(base.tablas.rubros).toEqual([])
  })

  it('elegir por habitación: el costo entra a rubros y la tarifa guarda su origen', async () => {
    const r = await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 0 }] })
    expect(r).toEqual({ ok: true, confirmada: true, pendiente: null, moneda: 'COP', total: 900000, aPagarAgencia: null })
    expect(base.tablas.rubros.reduce((a, x) => a + Number(x.valor_unitario) * Number(x.cantidad), 0)).toBe(900000)
    const t = tarifa()
    expect(t.casillas?.grupo_completo).toMatchObject({ origen: 'tarifario', total: 900000, moneda: 'COP' })
    expect(t.tarifaExtraida).toMatchObject({ extraccion_id: EXT, proveedor_id: HOTEL, filas: [{ indice_fila: 0, cantidad: 1, noches: 3, tipo: null }], canal: 'neta', moneda: 'COP', por: 'Ana Ficticia' })
    expect(t.confirmada).toMatchObject({ costoTotalCOP: 900000 })
    expect(item().nombre).toBe('HOTEL FICTICIO PLAYA')
    // La vista dice qué tarifa tiene elegida la línea.
    const v = await tarifasDeLinea(ITEM)
    expect(v.ok && v.elegida?.filas[0].indice_fila).toBe(0)
  })

  it('la ficha reconocida por nombre se guarda en la línea al elegir', async () => {
    item().proveedor_id = null
    item().tarifa_pax = { casillas: { grupo_completo: { moneda: 'COP', total: 1, porTipo: [], campos: [{ label: 'Hotel', valor: 'Hotel Ficticio Playa' }, { label: 'Ciudad', valor: 'Cartagena' }], leidaEn: '2026-10-01T00:00:00Z', alertas: [], identidad: {} } } }
    base.tablas.fotos_perfiles[0].clave = (await import('@/lib/fotos/clave')).claveDeFoto('hotel', 'Hotel Ficticio Playa', 'Cartagena')
    const v = await tarifasDeLinea(ITEM)
    expect(v.ok && v.proveedor).toMatchObject({ id: HOTEL, por: 'nombre' })
    expect(await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 0 }] })).toMatchObject({ ok: true, confirmada: true })
    expect(item().proveedor_id).toBe(HOTEL)
  })

  it('por persona con niño e infante: una tarifa por pasajero; el infante que no paga se marca', async () => {
    viaje.composicion = { adultos: 2, ninos: 1, infantes: 1 }
    expect(await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 2 }, { indice: 3 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/Falta la tarifa de 1 infante/) })
    expect(base.tablas.rubros).toEqual([])
    const r = await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 2 }, { indice: 3 }], noPagan: ['infante'] })
    expect(r).toMatchObject({ ok: true, confirmada: true, total: 2 * 160000 * 3 + 80000 * 3 })
    expect(base.tablas.rubros.map((x) => [x.descripcion, x.cantidad, x.valor_unitario])).toEqual([['Adulto', 2, 480000], ['Niño', 1, 240000], ['Infante', 1, 0]])
  })

  it('tarifa en USD: pide la tasa como hoy y la confirma con ella', async () => {
    const r = await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 4 }] })
    expect(r).toMatchObject({ ok: true, confirmada: false, moneda: 'USD', total: 300, pendiente: expect.stringMatching(/tasa de cambio/) })
    expect(base.tablas.rubros).toEqual([])
    expect(tarifa().casillas?.grupo_completo).toMatchObject({ origen: 'tarifario', moneda: 'USD' })
    const c = await confirmarTarifaPorPasajero(ITEM, 4000)
    expect(c.success).toBe(true)
    expect(tarifa().confirmada).toMatchObject({ moneda: 'USD', tasa: 4000, costoTotalCOP: 1200000 })
    // O de una vez, con la tasa al elegir.
    sembrar()
    item().proveedor_id = HOTEL
    expect(await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 4 }] }, null, 4000)).toMatchObject({ ok: true, confirmada: true })
  })

  it('comisionable: los rubros llevan el neto y el margen sale del proveedor (como un pantallazo con los dos precios)', async () => {
    const r = await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 0 }] }, { canal: 'comisionable', comisionPct: 10 })
    expect(r).toMatchObject({ ok: true, confirmada: true, total: 900000, aPagarAgencia: 810000 })
    expect(tarifa().confirmada?.costoTotalCOP).toBe(810000)
    expect(Number(item().margen_porcentaje)).toBeCloseTo(10, 6)
    expect(tarifa().tarifaExtraida).toMatchObject({ canal: 'comisionable', comision_pct: 10 })
  })

  it('IVA incluido en el precio: el costo se guarda sin IVA', async () => {
    const r = await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 0 }] }, { ivaIncluido: true })
    expect(r).toMatchObject({ ok: true, total: 756302.52 })
    expect(tarifa().confirmada?.costoTotalCOP).toBeCloseTo(756302.52, 2)
  })

  it('una extracción nueva sin revisar no tapa la revisada', async () => {
    base.tablas.proveedor_extracciones.push(extraccion({ id: 'e0000000-0000-4000-8000-000000000002', estado: 'borrador', created_at: '2026-10-20T10:00:00Z', vigencia_desde: null, vigencia_hasta: null, tarifario: { tarifas: [] } }))
    const r = await tarifasDeLinea(ITEM)
    expect(r).toMatchObject({ ok: true, motivo: null, nuevaPorRevisar: true })
    expect(r.ok && r.opciones).toHaveLength(5)
    expect(await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 0 }] })).toMatchObject({ ok: true })
    expect(tarifa().tarifaExtraida?.extraccion_id).toBe(EXT)
  })

  it('tarifario de cadena: la sucursal usa el de la cadena con su establecimiento', async () => {
    item().proveedor_id = SUCURSAL
    base.tablas.proveedor_extracciones = [extraccion({ proveedor_id: CADENA, tarifario: { tarifas: [fila({ establecimiento: 'Cadena Ficticia Centro', categoria: 'Estándar', base_precio: 'por_grupo', precio: 500000 }), fila({ establecimiento: 'Cadena Ficticia Playa', categoria: 'Estándar', base_precio: 'por_grupo', precio: 700000 })] } })]
    const r = await tarifasDeLinea(ITEM)
    expect(r.ok && r.opciones.map((o) => [o.establecimiento, o.precio])).toEqual([['Cadena Ficticia Centro', 500000]])
    expect(await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 0 }] })).toMatchObject({ ok: true, total: 500000 })
    expect(tarifa().tarifaExtraida).toMatchObject({ proveedor_id: SUCURSAL, tarifario_de_id: CADENA, filas: [{ indice_fila: 0 }] })
  })

  it('un precio del navegador no entra: el servidor recalcula con la extracción', async () => {
    const r = await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 0, precio: 1 } as never] })
    expect(r).toMatchObject({ ok: true, total: 900000 })
    expect(await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 42 }] })).toMatchObject({ ok: false })
  })

  it('en una cotización enviada no se elige', async () => {
    sembrar({ estado: 'enviada' })
    item().proveedor_id = HOTEL
    expect(await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 0 }] })).toMatchObject({ ok: false, error: expect.stringMatching(/ya no se edita/) })
    expect(item().tarifa_pax).toBeNull()
    expect(base.tablas.rubros).toEqual([])
  })
})
