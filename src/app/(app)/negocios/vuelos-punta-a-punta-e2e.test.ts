/**
 * Los vuelos de punta a punta (brief del 2026-10-08, Trappvel): el reporte de Alejandra de que el
 * PDF de COT-2026-0025 no traía los vuelos completos, y el check «Va en la cotización» para vuelos.
 *
 * Prueba fija del caso, ANONIMIZADO y escrito a mano con la forma de COT-2026-0025 (no es un
 * volcado): San Andrés - Providencia, 23–28 nov 2026, dos vuelos en dos ranuras —Avianca BOG–ADZ
 * ida y regreso, SATENA ADZ–PVA ida y regreso: dos aerolíneas en el mismo viaje—, dos ranuras de
 * hotel con alternativas, tres tarifas (Económica fuera de la propuesta, Recomendada y Premium) y
 * NINGUNA con `es_principal`. Los vuelos no están en ningún `itinerario_opciones`: son fijos y
 * entran en todas las tarifas solos.
 *
 * Corre las ACCIONES reales (PDF, recálculo, el check) sobre un doble de Supabase que escribe, y
 * lee el TEXTO del PDF renderizado: lo que el cliente ve, no las props.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(), workspaceId: WS, userId: 'p-asesora', staffId: 's-asesora', role: 'operator',
    areas: [], impersonating: false, realRole: 'operator', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => true }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({
  almacenamientoExternoDe: async () => ({
    subirArchivo: async (a: { nombre: string }) => ({ referencia: `sbext://one-documentos/${a.nombre}`, path: '', bytes: 0, sha256: '' }),
  }),
}))
vi.mock('@/lib/google-drive', () => ({
  uploadFileToDrive: async () => { throw new Error('Drive no debe llamarse') },
  createDriveFolder: async () => { throw new Error('Drive no debe llamarse') },
}))
vi.mock('@/lib/pdf/pdf-render-client', () => ({
  isPdfRenderConfigured: () => false,
  renderViaService: async () => { throw new Error('no debería llamarse') },
}))
vi.mock('@/lib/cotizaciones/viaje-negocio', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/viaje-negocio')>()),
  leerViajeDelNegocio: async () => ({
    viaje: {
      composicion: { adultos: 6, ninos: 1, infantes: 1 },
      fechas: { inicio: '2026-11-23', fin: '2026-11-28' },
      destino: 'San Andrés - Providencia',
      presentacion: null,
      nivelDetalle: 'normal',
    },
    error: null,
  }),
}))

const WS = 'ws-trappvel'
const COT = 'cot-providencia'
const NEG = 'neg-providencia'

import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { recalcularTotales } from './cotizacion-actions'
import { actualizarDiaDeItem, marcarActividadEnCotizacion } from './itinerario-actions'
import { textoDelPDF } from '@/lib/pdf/texto-del-pdf'
import { vuelosDeItems } from '@/lib/cotizaciones/detalle-viaje'
import { leerTarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'

const { default: TarjetaOpcion } = await import('./tarjeta-opcion')

// ── El caso ───────────────────────────────────────────────────────────────────

const campos = (pares: Record<string, string>) => Object.entries(pares).map(([label, valor]) => ({ label, valor }))
const casilla = (nombre: string, total: number, pares: Record<string, string>) => ({
  casillas: { grupo_completo: { nombre, total, moneda: 'COP', leidaEn: '2026-10-06T20:50:00Z', campos: campos(pares) } },
})
const equipaje = (bodega: boolean) => ({
  personal: true, mano: false, bodega,
  piezas: { personal: { cantidad: null, pesoKg: null }, mano: { cantidad: 0, pesoKg: null }, bodega: { cantidad: bodega ? null : 0, pesoKg: null } },
})
const tramo = (sentido: 'ida' | 'regreso', origen: string, destino: string, fecha: string, salida: string, llegada: string, numero: string, bodega: boolean, escala: string | null = null) => ({
  sentido, origen, destino, fecha, salida, llegada, numero, escala, directo: sentido === 'ida' ? escala === null : null, equipaje: equipaje(bodega),
})

function linea(id: string, costo: number, precio: number, extra: Fila): Fila {
  return {
    id, cotizacion_id: COT, descripcion: null, opcion_de: null, es_ajuste: false, cantidad: 1,
    subtotal: costo, descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: precio, precio_manual: true,
    unidad: null, tramos: null, tarifa_pax: null, dia_relativo: null, entra_al_precio: true, mostrar_en_sugeridos: true,
    base_iva: null, cargo_destino_valor: null, cargo_destino_moneda: null,
    ...extra,
  }
}

const hotel = (nombre: string, ciudad: string, entrada: string, salida: string, noches: string) =>
  casilla(nombre, 0, { Hotel: nombre, Ciudad: ciudad, 'Check-in': entrada, 'Check-out': salida, Noches: noches, Habitación: 'Doble', Régimen: 'Alojamiento y desayuno' })

const PRECIO = {
  avianca: 7_300_000,
  satena: 3_870_000,
  posada: 1_450_000,
  aguaDulce: 5_120_000,
  verdeMar: 6_720_000,
  lordPierre: 7_550_000,
  traslado: 494_000,
}
const RECOMENDADA = PRECIO.avianca + PRECIO.satena + PRECIO.posada + PRECIO.verdeMar + PRECIO.traslado
const PREMIUM = PRECIO.avianca + PRECIO.satena + PRECIO.aguaDulce + PRECIO.lordPierre + PRECIO.traslado

function sembrar() {
  base.secuencia = 0
  base.tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null,
      codigo: 'COT-2026-0099', consecutivo: 'COT-2026-0099', modo: 'detallada',
      descripcion: 'Viaje San Andrés - Providencia', estado: 'borrador', valor_total: 0, costo_total: 0,
      margen_porcentaje: null, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null,
      piso_margen_pct: 5, aviso_margen_pct: 10, fecha_envio: null, fecha_validez: null,
      condiciones_pago: null, notas: null, lugar_entrega: null, documento_cliente: null, terminos_condiciones: null,
      tarifa_aceptada_id: null,
    }],
    items: [
      linea('v-avianca', 6_208_000, PRECIO.avianca, {
        nombre: 'AVIANCA BOGOTÁ–SAN ANDRÉS ISLA', grupo: 'vuelo: Vuelo Bogotá–San Andrés Isla', orden: 1,
        tarifa_pax: casilla('Avianca Bogotá–San Andrés Isla', 6_208_000, { Aerolínea: 'Avianca', Origen: 'Bogotá', Destino: 'San Andrés Isla', Escalas: '0', Tarifa: 'BASIC Economy' }),
        tramos: [
          tramo('ida', 'Bogotá', 'San Andrés Isla', '2026-11-23', '06:50', '09:00', '9782', false),
          tramo('regreso', 'San Andrés Isla', 'Bogotá', '2026-11-28', '18:45', '20:55', '9779', false),
        ],
      }),
      linea('v-satena', 3_292_000, PRECIO.satena, {
        nombre: 'SATENA SAN ANDRÉS ISLA ADZ–PROVIDENCIA PVA', grupo: 'vuelo 2: Vuelo San Andrés Isla–Providencia', orden: 2,
        tarifa_pax: casilla('SATENA San Andrés Isla ADZ–Providencia PVA', 3_292_000, { Aerolínea: 'SATENA', Origen: 'San Andrés Isla ADZ', Destino: 'Providencia PVA', Escalas: '0', Tarifa: 'ECONO Economy' }),
        tramos: [
          tramo('ida', 'San Andrés Isla ADZ', 'Providencia PVA', '2026-11-23', '11:40', '12:17', '8814', true),
          tramo('regreso', 'Providencia PVA', 'San Andrés Isla ADZ', '2026-11-25', '10:30', '11:06', '8833', true),
        ],
      }),
      linea('h-agua-dulce', 4_352_000, PRECIO.aguaDulce, { nombre: 'HOTEL CABAÑAS AGUA DULCE · PROVIDENCIA', grupo: 'hotel: Hotel en Providencia', orden: 3, tarifa_pax: hotel('Hotel Cabañas Agua Dulce', 'Providencia', '2026-11-23', '2026-11-25', '2') }),
      linea('h-posada', 1_229_000, PRECIO.posada, { nombre: 'POSADA ENILDA · PROVIDENCIA', grupo: 'hotel: Hotel en Providencia', orden: 4, tarifa_pax: hotel('Posada Enilda', 'Providencia', '2026-11-23', '2026-11-25', '2') }),
      linea('h-lord-pierre', 6_420_000, PRECIO.lordPierre, { nombre: 'LORD PIERRE · SAN ANDRÉS', grupo: 'hotel 2: Hotel en San Andrés', orden: 5, tarifa_pax: hotel('Lord Pierre', 'San Andrés', '2026-11-25', '2026-11-28', '3') }),
      linea('h-verde-mar', 5_712_000, PRECIO.verdeMar, { nombre: 'VERDE MAR · SAN ANDRÉS', grupo: 'hotel 2: Hotel en San Andrés', orden: 6, tarifa_pax: hotel('Verde Mar', 'San Andrés', '2026-11-25', '2026-11-28', '3') }),
      linea('t-providencia', 420_000, PRECIO.traslado, { nombre: 'AEROPUERTO - HOTEL PROVIDENCIA - AEROPUERTO', grupo: 'traslado: Traslado en Providencia', orden: 7 }),
    ],
    cotizacion_itinerarios: [
      { id: 't-eco', workspace_id: WS, cotizacion_id: COT, nombre: 'Económica', orden: 1, va_en_propuesta: false, es_principal: false },
      { id: 't-rec', workspace_id: WS, cotizacion_id: COT, nombre: 'Recomendada', orden: 2, va_en_propuesta: true, es_principal: false },
      { id: 't-pre', workspace_id: WS, cotizacion_id: COT, nombre: 'Premium', orden: 3, va_en_propuesta: true, es_principal: false },
    ],
    // Solo los hoteles: los vuelos no están en ninguna tarifa (son fijos), como en COT-2026-0025.
    itinerario_opciones: [
      { itinerario_id: 't-eco', item_id: 'h-posada' }, { itinerario_id: 't-eco', item_id: 'h-verde-mar' },
      { itinerario_id: 't-rec', item_id: 'h-posada' }, { itinerario_id: 't-rec', item_id: 'h-verde-mar' },
      { itinerario_id: 't-pre', item_id: 'h-agua-dulce' }, { itinerario_id: 't-pre', item_id: 'h-lord-pierre' },
    ],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: 'linea-viaje', nombre: 'N1 26 1', carpeta_url: null, empresa_id: null, precio_aprobado: null, etapa_actual_id: 'e1' }],
    lineas_negocio: [{ id: 'linea-viaje', config_extra: { margen: { piso_pct: 5, aviso_pct: 10, convencion: 'sobre_venta', default_pct: 15 } } }],
    etapas_negocio: [{ id: 'e1', linea_id: 'linea-viaje', orden: 1, config_extra: {} }],
    bloque_configs: [], rubros: [], item_adicionales: [], activity_log: [], decisiones_combinacion: [],
    negocio_bloques: [], cotizacion_excepciones_margen: [], cotizacion_ranuras: [],
    profiles: [{ id: 'p-asesora', workspace_id: WS, role: 'operator', full_name: 'Asesora de prueba', platform_admin: false }],
    staff: [{ id: 's-asesora', full_name: 'Asesora de prueba', position: 'Asesora' }],
    workspaces: [{ id: WS, name: 'Trappvel', logo_url: null, color_primario: null, cotizacion_template_slug: 'trappvel', config_extra: {} }],
    empresas: [],
    fiscal_profiles: [{
      workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true,
      is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true,
      nit: '900000000', razon_social: 'AGENCIA DE PRUEBA S.A.S',
    }],
  }
}

type ResultadoPDF = { success: boolean; pdf: string; error?: string; borrador?: boolean }

const cot = () => base.tablas.cotizaciones[0] as Fila
const item = (id: string) => base.tablas.items.find(i => i.id === id) as Fila
const cifra = (n: number) => n.toLocaleString('es-CO').replace(/,/g, '.')

async function pdf(): Promise<string> {
  const r = await generateCotizacionPDF(COT) as ResultadoPDF
  if (!r.success) throw new Error(r.error)
  return textoDelPDF(Buffer.from(r.pdf, 'base64'))
}

/** La tabla «Vuelos» del documento: del título hasta «Inversión». */
function tablaDeVuelos(t: string): string {
  const desde = t.indexOf('AEROLÍNEA RUTA')
  expect(desde, 'el documento no trae la tabla de vuelos').toBeGreaterThan(-1)
  const hasta = t.indexOf('Inversión', desde)
  return t.slice(desde, hasta === -1 ? undefined : hasta)
}

/** La fila de un número de vuelo: el texto desde el número anterior hasta él. */
function filaDe(tabla: string, numero: string): string {
  const fin = tabla.indexOf(numero)
  expect(fin, `falta el vuelo ${numero} en la tabla`).toBeGreaterThan(-1)
  const anteriores = ['9782', '9779', '8814', '8833', 'LA4100', 'LA4101'].map(n => tabla.lastIndexOf(n, fin - 1)).filter(i => i > -1)
  const ini = anteriores.length > 0 ? Math.max(...anteriores) + 4 : 0
  return tabla.slice(ini, fin + numero.length)
}

const TRAMOS = [
  { numero: '9782', fecha: '23  nov 2026', salida: '06:50', llegada: '09:00' },
  { numero: '9779', fecha: '28  nov 2026', salida: '18:45', llegada: '20:55' },
  { numero: '8814', fecha: '23  nov 2026', salida: '11:40', llegada: '12:17' },
  { numero: '8833', fecha: '25  nov 2026', salida: '10:30', llegada: '11:06' },
]

beforeEach(() => sembrar())

// ── 1 · Los cuatro tramos salen ──────────────────────────────────────────────

describe('COT-2026-0025 (anonimizada): los cuatro tramos salen en el PDF', () => {
  it('la tabla «Vuelos» trae los 4 tramos, cada uno con su fecha, sus horas y las dos tarifas', async () => {
    await recalcularTotales(COT)
    const tabla = tablaDeVuelos(await pdf())
    for (const t of TRAMOS) {
      const fila = filaDe(tabla, t.numero)
      expect(fila).toContain(t.fecha.replace('  ', ' ').split(' ')[0])
      expect(fila).toContain(t.salida)
      expect(fila).toContain(t.llegada)
      // Los vuelos son fijos: van en las dos tarifas de la propuesta, aunque ninguna sea principal.
      expect(fila).toContain('RECOMENDADA')
      expect(fila).toContain('PREMIUM')
    }
    expect(tabla).toContain('Avianca')
    expect(tabla).toContain('SATENA')
    expect((tabla.match(/Vuelo directo/g) ?? []).length).toBe(4)
    // La Económica no va en la propuesta: no aparece en ninguna fila.
    expect(tabla).not.toContain('ECONÓMICA')
  })

  it('«Inversión» cobra los dos vuelos en cada tarifa y el TOTAL es el de la Recomendada', async () => {
    await recalcularTotales(COT)
    expect(cot().valor_total).toBe(RECOMENDADA)
    const t = await pdf()
    const inversion = t.slice(t.indexOf('Inversión'))
    expect(inversion.split(cifra(PRECIO.avianca)).length - 1).toBe(2)
    expect(inversion.split(cifra(PRECIO.satena)).length - 1).toBe(2)
    expect(inversion).toContain(cifra(RECOMENDADA))
    expect(inversion).toContain(cifra(PREMIUM))
  })

  it('«Así lo ve el cliente» de cada vuelo trae sus dos tramos (la misma función que el PDF)', () => {
    for (const [id, numeros] of [['v-avianca', ['9782', '9779']], ['v-satena', ['8814', '8833']]] as const) {
      const html = pintarTarjeta(id, null)
      expect(html).toContain('data-hoja-cliente')
      const hoja = html.slice(html.indexOf('data-vuelo-cliente'))
      for (const n of numeros) expect(hoja).toContain(n)
    }
  })
})

// ── 2 · Quitar y poner un vuelo ──────────────────────────────────────────────

describe('el check «Va en la cotización» de un vuelo', () => {
  it('quitado: no suma, no sale en la tabla, ni en «Inversión», ni en «Opcionales»; la otra aerolínea sigue', async () => {
    await recalcularTotales(COT)
    const r = await marcarActividadEnCotizacion('v-satena', { va: false })
    expect(r).toEqual({ success: true, estado: 'no_va' })
    expect(item('v-satena').entra_al_precio).toBe(false)
    expect(item('v-satena').mostrar_en_sugeridos).toBe(false)
    expect(cot().valor_total).toBe(RECOMENDADA - PRECIO.satena)

    const t = await pdf()
    const tabla = tablaDeVuelos(t)
    for (const n of ['8814', '8833']) expect(t).not.toContain(n)
    expect(t).not.toContain('SATENA')
    expect(t).not.toContain(cifra(PRECIO.satena))
    expect(t).not.toContain('Opcionales')
    for (const n of ['9782', '9779']) expect(tabla).toContain(n)
    expect(t).toContain(cifra(RECOMENDADA - PRECIO.satena))
    expect(t).toContain(cifra(PREMIUM - PRECIO.satena))
  })

  it('quitado: la tarjeta lo dice y «Así lo ve el cliente» no lo muestra', async () => {
    await marcarActividadEnCotizacion('v-satena', { va: false })
    const html = pintarTarjeta('v-satena', 'no_va')
    expect(html).toContain('data-vuelo-no-va')
    expect(html).not.toContain('data-hoja-cliente')
    expect(html).toContain('aria-label="Va en la cotización"')
    // Puesto, la hoja vuelve.
    expect(pintarTarjeta('v-avianca', 'incluida')).toContain('data-hoja-cliente')
  })

  it('puesto otra vez: el PDF y el total vuelven idénticos', async () => {
    await recalcularTotales(COT)
    const antes = await pdf()
    await marcarActividadEnCotizacion('v-satena', { va: false })
    const r = await marcarActividadEnCotizacion('v-satena', { va: true })
    expect(r).toEqual({ success: true, estado: 'incluida' })
    expect(item('v-satena').entra_al_precio).toBe(true)
    expect(item('v-satena').mostrar_en_sugeridos).toBe(true)
    expect(leerTarifaPax(item('v-satena').tarifa_pax).noVa).toBeUndefined()
    expect(cot().valor_total).toBe(RECOMENDADA)
    expect(await pdf()).toBe(antes)
  })

  it('las dos aerolíneas fuera: no queda tabla de vuelos y el total es solo tierra', async () => {
    await marcarActividadEnCotizacion('v-satena', { va: false })
    await marcarActividadEnCotizacion('v-avianca', { va: false })
    expect(cot().valor_total).toBe(PRECIO.posada + PRECIO.verdeMar + PRECIO.traslado)
    const t = await pdf()
    expect(t).not.toContain('AEROLÍNEA RUTA')
    expect(t).not.toContain('Avianca')
  })

  it('un vuelo no es «Opcional», y el interruptor genérico no lo saca del precio', async () => {
    const opcional = await marcarActividadEnCotizacion('v-satena', { modo: 'opcional' })
    expect(opcional.success).toBe(false)
    expect(opcional.error).toContain('no puede ser opcional')
    const generico = await actualizarDiaDeItem('v-satena', { entra_al_precio: false })
    expect(generico.success).toBe(false)
    expect(item('v-satena').entra_al_precio).toBe(true)
  })

  it('un hotel sigue sin poder quitarse por aquí', async () => {
    const r = await marcarActividadEnCotizacion('h-posada', { va: false })
    expect(r.success).toBe(false)
    expect(item('h-posada').entra_al_precio).toBe(true)
  })
})

// ── 3 · Un vuelo que solo aplica a una tarifa ────────────────────────────────

describe('un vuelo que solo va en una tarifa (alternativa en la ranura)', () => {
  beforeEach(() => {
    base.tablas.items.push(linea('v-latam', 6_900_000, 8_100_000, {
      nombre: 'LATAM BOGOTÁ–SAN ANDRÉS ISLA', grupo: 'vuelo: Vuelo Bogotá–San Andrés Isla', opcion_de: 'v-avianca', orden: 8,
      tarifa_pax: casilla('LATAM Bogotá–San Andrés Isla', 6_900_000, { Aerolínea: 'LATAM', Origen: 'Bogotá', Destino: 'San Andrés Isla', Escalas: '0' }),
      tramos: [
        tramo('ida', 'Bogotá', 'San Andrés Isla', '2026-11-23', '08:10', '10:20', 'LA4100', true),
        tramo('regreso', 'San Andrés Isla', 'Bogotá', '2026-11-28', '15:00', '17:10', 'LA4101', true),
      ],
    }))
    base.tablas.itinerario_opciones.push(
      { itinerario_id: 't-eco', item_id: 'v-avianca' },
      { itinerario_id: 't-rec', item_id: 'v-avianca' },
      { itinerario_id: 't-pre', item_id: 'v-latam' },
    )
  })

  it('cada aerolínea sale con SU tarifa, y la Premium cobra LATAM', async () => {
    await recalcularTotales(COT)
    const t = await pdf()
    const tabla = tablaDeVuelos(t)
    const avianca = filaDe(tabla, '9782')
    expect(avianca).toContain('RECOMENDADA')
    expect(avianca).not.toContain('PREMIUM')
    const latam = filaDe(tabla, 'LA4100')
    expect(latam).toContain('PREMIUM')
    expect(latam).not.toContain('RECOMENDADA')
    expect(t).toContain(cifra(PREMIUM - PRECIO.avianca + 8_100_000))
  })

  it('quitar LATAM devuelve Avianca a las dos tarifas; ponerla otra vez, a como estaba', async () => {
    await recalcularTotales(COT)
    const antes = await pdf()
    await marcarActividadEnCotizacion('v-latam', { va: false })
    const sin = await pdf()
    expect(sin).not.toContain('LA4100')
    const avianca = filaDe(tablaDeVuelos(sin), '9782')
    expect(avianca).toContain('RECOMENDADA')
    expect(avianca).toContain('PREMIUM')
    expect(sin).toContain(cifra(PREMIUM))
    await marcarActividadEnCotizacion('v-latam', { va: true })
    expect(await pdf()).toBe(antes)
  })
})

// ── 4 · Formas difíciles: escala y regreso en ítem aparte ────────────────────

describe('escala en la ida y el regreso cargado como otro vuelo', () => {
  it('cada uno sale en su fila, la escala con su ciudad', () => {
    const vuelos = vuelosDeItems([
      {
        nombre: 'COPA BOGOTÁ–CANCÚN', grupo: 'vuelo',
        tarifa_pax: casilla('Copa', 0, { Aerolínea: 'Copa', Origen: 'Bogotá', Destino: 'Cancún', Escalas: '1' }),
        tramos: [tramo('ida', 'Bogotá', 'Cancún', '2026-11-12', '13:10', '17:00', 'CM101 · CM202', false, 'Panamá')],
      },
      {
        nombre: 'AVIANCA CANCÚN–BOGOTÁ', grupo: 'vuelo 2',
        tarifa_pax: casilla('Avianca', 0, { Aerolínea: 'Avianca', Origen: 'Cancún', Destino: 'Bogotá', Escalas: '0' }),
        tramos: [tramo('ida', 'Cancún', 'Bogotá', '2026-11-19', '18:00', '22:30', 'AV255', false)],
      },
    ])
    expect(vuelos).toHaveLength(2)
    expect(vuelos[0]).toMatchObject({ origen: 'Bogotá', destino: 'Cancún', escalaIda: 'Panamá', fechaRegreso: null })
    expect(vuelos[1]).toMatchObject({ origen: 'Cancún', destino: 'Bogotá', fechaRegreso: null })
  })
})

// ── Arnés de la tarjeta ──────────────────────────────────────────────────────

function pintarTarjeta(id: string, estado: 'incluida' | 'no_va' | null) {
  const fila = item(id)
  const tarifa = leerTarifaPax(fila.tarifa_pax)
  return renderToStaticMarkup(React.createElement(TarjetaOpcion, {
    itemId: id,
    numero: 1,
    item: { nombre: fila.nombre as string, grupo: fila.grupo as string, tarifa_pax: fila.tarifa_pax, tramos: fila.tramos, descripcion: null },
    tarifa,
    composicionViaje: { adultos: 6, ninos: 1, infantes: 1 },
    editable: true,
    abierta: true,
    onAlternar: () => {},
    precioOpcion: Number(fila.precio_venta),
    precioLinea: Number(fila.precio_venta),
    costoLinea: Number(fila.subtotal),
    confirmada: null,
    margenAplicado: 15,
    convencion: 'sobre_venta',
    administrativosPct: 0,
    pisoPct: 5,
    adicionales: [],
    adicionalesDisponible: true,
    margenCotizacion: { margenPct: 15, convencion: 'sobre_venta' },
    pendiente: null,
    onIrABandeja: () => {},
    onEliminar: () => {},
    onMover: () => {},
    mover: null,
    respaldo: null,
    nota: null,
    bloqueTitulo: 'Vuelo',
    onGuardarNota: () => {},
    onCambio: () => {},
    actividad: estado ? { estado, dia: null, precioPorPersona: null, era: 'incluida', soloVa: true } : null,
  }))
}
