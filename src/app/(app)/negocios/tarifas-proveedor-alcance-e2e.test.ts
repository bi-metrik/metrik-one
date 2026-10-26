/**
 * El alcance del panel «Tarifas del proveedor» (brief del 2026-10-20), de punta a punta sobre el doble
 * de Supabase: la línea escrita a mano, con el costo confirmado o sin costo, y el nombre de su
 * servicio que no se toma como proveedor. Fichas, tarifarios y precios ficticios. Nada sale a la red.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

const viaje = vi.hoisted(() => ({
  composicion: { adultos: 2, ninos: 0, infantes: 0 } as { adultos: number; ninos: number; infantes: number },
  fechas: { inicio: '2027-11-13', fin: '2027-11-17' } as { inicio: string | null; fin: string | null },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: WS, staffId: ANA, userId: 'u-1', role: 'owner', areas: [], error: null }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/cotizaciones/viaje-negocio', () => ({
  leerViajeDelNegocio: async () => ({ viaje: { composicion: viaje.composicion, fechas: viaje.fechas, destino: null, presentacion: null, nivelDetalle: 'normal' }, error: null }),
}))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({ recalcularTotales: async () => ({ success: true }), deleteItem: async () => ({ success: true }) }))

const WS = '11111111-2222-4333-8444-555555555555'
const ANA = 'a0000000-0000-4000-8000-000000000001'
const COT = 'c0000000-0000-4000-8000-0000000000c1'
const ITEM = 'f0000000-0000-4000-8000-000000000001'
const OPERADOR = 'd0000000-0000-4000-8000-000000000001'
const INVENTADA = 'd0000000-0000-4000-8000-000000000002'
const EXT = 'e0000000-0000-4000-8000-000000000001'

import { claveDeFoto } from '@/lib/fotos/clave'
import { lecturaManual, type ActividadManual } from '@/lib/cotizaciones/ingreso-manual'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'
import { tarifaConHabitaciones, resolverHabitaciones } from '@/lib/cotizaciones/habitaciones'
import { costoPendienteDelTarifario, leerTarifaPax, MENSAJE_COSTO_PENDIENTE, resolverTarifa, type LecturaCasilla } from '@/lib/cotizaciones/tarifa-pasajero'
import { confirmarTarifaPorPasajero } from './tarifa-pax-actions'
import { elegirTarifasDeLinea, fijarProveedorDeLinea, tarifasDeLinea } from './tarifas-proveedor-actions'

const RANURA = ranuraPorSlug('actividad_detalle')!
const TOUR: ActividadManual = { nombre: 'City Tour Ficticio', ciudad: 'Santa Marta', fecha: '2027-11-15', adultos: 2, ninos: 0, infantes: 0, netoAdulto: 120000, netoNino: null, netoInfante: null, opcional: false, fuente: '' }

function aMano(datos: Partial<ActividadManual> = {}, sinCosto = false): LecturaCasilla {
  const r = lecturaManual({ ranura: RANURA, entrada: { tipo: 'actividad', datos: { ...TOUR, ...datos } }, leidaEn: '2026-10-20T10:00:00Z', hoy: '2026-10-20', fuenteOpcional: true, ...(sinCosto ? { sinCosto: true } : {}) })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

const TARIFARIO = {
  canal: 'neta',
  temporadas: [{ id: 'A', nombre: 'Alta', rangos: [{ desde: '2027-11-01', hasta: '2027-11-30' }] }],
  tarifas: [{ moneda: 'COP', establecimiento: null, archivo: 'Tarifas Ficticias 2027.pdf', fuente: { pagina: 1 }, categoria: 'Tour Ficticio de Bahía', temporada_id: 'A', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 105000 }],
}

function sembrar(tarifaPax: unknown) {
  base.secuencia = 0
  viaje.composicion = { adultos: 2, ninos: 0, infantes: 0 }
  base.tablas = {
    cotizaciones: [{ id: COT, workspace_id: WS, estado: 'borrador', negocio_id: 'neg-1', convencion_margen: 'sobre_venta' }],
    items: [{ id: ITEM, cotizacion_id: COT, nombre: 'CITY TOUR FICTICIO', grupo: 'actividad', es_ajuste: false, precio_manual: false, margen_porcentaje: null, subtotal: 0, cantidad: 1, tarifa_pax: tarifaPax, proveedor_id: null }],
    rubros: [],
    profiles: [{ id: 'u-1', full_name: 'Ana Ficticia' }],
    fotos_perfiles: [
      { id: OPERADOR, workspace_id: WS, tipo: 'proveedor', clave: 'operador ficticio|santa marta', nombre: 'Operador Ficticio', ciudad: 'Santa Marta', tipo_proveedor: 'operador', tarifa_canal: null, iva_incluido: null, iva_declarado: null },
      // La ficha que antes creaba sola la tarjeta con el nombre de la actividad.
      { id: INVENTADA, workspace_id: WS, tipo: 'actividad', clave: claveDeFoto('actividad', 'City Tour Ficticio', 'Santa Marta'), nombre: 'City Tour Ficticio', ciudad: 'Santa Marta', tipo_proveedor: 'actividad', tarifa_canal: null, iva_incluido: null, iva_declarado: null },
    ],
    fotos_perfiles_alias: [],
    fotos_catalogo: [],
    proveedor_extracciones: [{ id: EXT, workspace_id: WS, proveedor_id: OPERADOR, estado: 'revisada', created_at: '2026-10-19T10:00:00Z', vigencia_desde: '2027-01-01', vigencia_hasta: '2027-12-31', vigencia_por: 'persona', monedas: {}, tarifario: TARIFARIO, expediente: {} }],
  }
}

const item = () => base.tablas.items[0] as Fila
const tarifa = () => leerTarifaPax(item().tarifa_pax)
const costoEnRubros = () => base.tablas.rubros.reduce((a, x) => a + Number(x.valor_unitario) * Number(x.cantidad), 0)

describe('línea escrita a mano con el costo confirmado', () => {
  beforeEach(async () => {
    sembrar({ casillas: { grupo_completo: aMano() } })
    expect((await confirmarTarifaPorPasajero(ITEM, null)).success).toBe(true)
  })

  it('entra confirmada (por eso el panel tiene que ofrecerse también así)', () => {
    expect(tarifa().confirmada?.costoTotalCOP).toBe(240000)
    expect(costoEnRubros()).toBe(240000)
  })

  it('el nombre de la actividad no se toma como proveedor: el panel abre el buscador', async () => {
    const r = await tarifasDeLinea(ITEM)
    expect(r).toMatchObject({ ok: true, proveedor: null, motivo: null })
  })

  it('al usar una tarifa del proveedor se reemplaza el costo confirmado por la confirmación de siempre', async () => {
    expect(await fijarProveedorDeLinea(ITEM, OPERADOR)).toEqual({ ok: true })
    // Nada cambia sin «Usar».
    const v = await tarifasDeLinea(ITEM)
    expect(v.ok && v.opciones.map((o) => [o.precio, o.fueraPor])).toEqual([[105000, []]])
    expect(costoEnRubros()).toBe(240000)
    const r = await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 0 }] })
    expect(r).toEqual({ ok: true, confirmada: true, pendiente: null, moneda: 'COP', total: 210000, aPagarAgencia: null })
    expect(costoEnRubros()).toBe(210000)
    expect(base.tablas.rubros.map((x) => [x.descripcion, x.cantidad, x.valor_unitario])).toEqual([['Adulto', 2, 105000]])
    expect(tarifa().confirmada?.costoTotalCOP).toBe(210000)
    expect(tarifa().casillas?.grupo_completo).toMatchObject({ origen: 'tarifario', total: 210000 })
    expect(tarifa().tarifaExtraida).toMatchObject({ proveedor_id: OPERADOR, filas: [{ indice_fila: 0, cantidad: 2 }] })
    expect(item().proveedor_id).toBe(OPERADOR)
  })
})

describe('línea escrita a mano sin costo (el precio sale del tarifario)', () => {
  it('sin «Adulto» no pide un número de relleno; la lectura no trae precio y queda marcada', () => {
    const l = aMano({ netoAdulto: null }, true)
    expect(l).toMatchObject({ origen: 'manual', total: 0, porTipo: [], costoPendiente: true })
    expect(l.campos.map((c) => c.label.toLowerCase())).not.toContain('precio total')
    // Sin la casilla, «Adulto» sigue siendo obligatorio.
    const r = lecturaManual({ ranura: RANURA, entrada: { tipo: 'actividad', datos: { ...TOUR, netoAdulto: null } }, leidaEn: 't', hoy: '2026-10-20', fuenteOpcional: true })
    expect(r.ok === false && r.errores.netoAdulto).toBeTruthy()
  })

  it('el costo queda pendiente (nunca un 0 confirmado) y la línea lo dice', async () => {
    sembrar({ casillas: { grupo_completo: aMano({ netoAdulto: null }, true) } })
    expect(resolverTarifa(viaje.composicion, tarifa().casillas!, RANURA.slug)).toEqual({ estado: 'sin_costo', mensaje: MENSAJE_COSTO_PENDIENTE })
    expect(costoPendienteDelTarifario(tarifa())).toBe(true)
    const c = await confirmarTarifaPorPasajero(ITEM, null)
    expect(c).toMatchObject({ success: false, codigo: 'PENDIENTE', error: MENSAJE_COSTO_PENDIENTE })
    expect(base.tablas.rubros).toEqual([])
    expect(tarifa().confirmada).toBeNull()
  })

  it('elegir la tarifa del proveedor le pone el costo y quita la marca', async () => {
    sembrar({ casillas: { grupo_completo: aMano({ netoAdulto: null }, true) } })
    expect(await tarifasDeLinea(ITEM)).toMatchObject({ ok: true, proveedor: null })
    await fijarProveedorDeLinea(ITEM, OPERADOR)
    expect(await elegirTarifasDeLinea(ITEM, { filas: [{ indice: 0 }] })).toMatchObject({ ok: true, confirmada: true, total: 210000 })
    expect(costoPendienteDelTarifario(tarifa())).toBe(false)
    expect(costoEnRubros()).toBe(210000)
  })

  it('un hotel escrito a mano sin costo y unido como habitación tampoco cuesta 0', () => {
    const hotel = lecturaManual({
      ranura: ranuraPorSlug('hotel_detalle')!,
      entrada: { tipo: 'hotel', datos: { hotel: 'Hotel Ficticio', ciudad: 'Santa Marta', entrada: '2027-11-13', salida: '2027-11-16', habitacion: 'Doble', regimen: '', incluye: '', adultos: 2, ninos: 0, infantes: 0, netoAdulto: null, netoNino: null, netoInfante: null, edadDesde: null, edadHasta: null, fuente: '' } },
      leidaEn: 't', hoy: '2026-10-20', fuenteOpcional: true, sinCosto: true,
    })
    if (!hotel.ok) throw new Error(JSON.stringify(hotel.errores))
    const t = tarifaConHabitaciones({}, [{ id: 'h1', lectura: hotel.lectura }], viaje.composicion)
    expect(resolverHabitaciones(t, viaje.composicion)).toMatchObject({ estado: 'sin_costo' })
  })
})
