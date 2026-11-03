/**
 * Brief del 2026-10-29 (COT-2026-0008, Trappvel), punto 1 · las fechas del documento salen de los
 * servicios, no del rango de la solicitud.
 *
 * La forma del caso (datos inventados): la solicitud dice 21 jun – 4 jul 2027; el vuelo va el 26 y
 * vuelve el 30; el hotel no trae fechas en su captura (la lectura le puso las de la solicitud,
 * «(del viaje)»). El PDF decía «14 días · 13 noches», la ficha del hotel lo mismo y el día a día
 * abría el 21 con el vuelo en el día 6.
 */
import { PDFDocument } from 'pdf-lib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'
import { modeloDePropuesta, type EntradaModeloPropuesta } from '@/lib/cotizaciones/propuesta/modelo-documento'
import { htmlDePropuesta } from '@/lib/pdf/html/trappvel/plantilla'

const motor = vi.hoisted(() => ({ llamadas: [] as unknown[], falla: false }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
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
      composicion: { adultos: 2, ninos: 0, infantes: 0 },
      // La solicitud: el rango amplio que dio la cliente.
      fechas: { inicio: '2027-06-21', fin: '2027-07-04' },
      destino: 'Curazao',
      presentacion: null,
      nivelDetalle: 'normal',
    },
    error: null,
  }),
}))
vi.mock('@/lib/pdf/html/propuesta-html', () => ({
  pdfDePropuestaHtml: async (entrada: unknown) => {
    motor.llamadas.push(entrada)
    if (motor.falla) throw new Error('Chromium no arrancó')
    const doc = await PDFDocument.create()
    doc.addPage()
    return { pdf: Buffer.from(await doc.save()), modelo: null, html: '', medidas: { totalMs: 1, pdfBytes: 1, peticionesBloqueadas: [] } }
  },
}))

const WS = 'ws-trappvel'
const COT = 'cot-cur'
const NEG = 'neg-cur'

import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { recalcularTotales } from './cotizacion-actions'

function linea(id: string, precio: number, extra: Fila): Fila {
  return {
    id, cotizacion_id: COT, descripcion: null, opcion_de: null, es_ajuste: false, cantidad: 1,
    subtotal: Math.round(precio * 0.85), descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: precio, precio_manual: true,
    unidad: null, tramos: null, tarifa_pax: null, dia_relativo: null, entra_al_precio: true, mostrar_en_sugeridos: true,
    base_iva: null, cargo_destino_valor: null, cargo_destino_moneda: null,
    ...extra,
  }
}


const campo = (label: string, valor: string) => ({ label, valor })

const lecturaVuelo = {
  leidaEn: 'L-vuelo', moneda: 'COP', total: 3_000_000, nombre: 'Aerolínea Ficticia BOG–CUR',
  campos: [
    campo('Aerolínea', 'Aerolínea Ficticia'), campo('Origen', 'Bogotá BOG'), campo('Destino', 'Willemstad CUR'),
    campo('Salida', '2027-06-26'), campo('Regreso', '2027-06-30'),
    campo('Hora de salida (ida)', '07:25'), campo('Hora de llegada (ida)', '10:20'),
    campo('Hora de salida (regreso)', '18:15'), campo('Hora de llegada (regreso)', '19:10'),
    campo('Escalas', '0'),
  ],
}

const lecturaHotel = (hotel: string, checkIn = '2027-06-21 (del viaje)', checkOut = '2027-07-04 (del viaje)') => ({
  leidaEn: `L-${hotel}`, moneda: 'COP', total: 5_000_000, nombre: hotel,
  campos: [
    campo('Hotel', hotel), campo('Ciudad', 'Willemstad / Curazao'), campo('Habitación', 'Doble'),
    campo('Régimen', 'Todo incluido'), campo('Check-in', checkIn), campo('Check-out', checkOut), campo('Ocupación', '2 adultos'),
  ],
})

function sembrar(opts: { hotel?: ReturnType<typeof lecturaHotel>; sinVuelo?: boolean; planPagos?: boolean } = {}) {
  base.secuencia = 0
  motor.llamadas = []
  base.tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null,
      codigo: 'COT-2026-0097', consecutivo: 'COT-2026-0097', modo: 'detallada',
      descripcion: 'Curazao', estado: 'borrador', valor_total: 0, costo_total: 0,
      margen_porcentaje: null, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null,
      piso_margen_pct: null, aviso_margen_pct: null, fecha_envio: null, fecha_validez: null,
      condiciones_pago: null, notas: null, lugar_entrega: null, terminos_condiciones: null,
      tarifa_aceptada_id: null, documento_cliente: null,
    }],
    items: [
      ...(opts.sinVuelo ? [] : [linea('v-vuelo', 3_500_000, { nombre: 'AEROLÍNEA FICTICIA BOG–CUR', grupo: 'vuelo: Vuelo Bogotá–Willemstad', orden: 1, tarifa_pax: { casillas: { grupo_completo: lecturaVuelo } } })]),
      linea('h-hotel', 5_800_000, { nombre: 'HOTEL FICTICIO PLAYA · WILLEMSTAD', grupo: 'hotel: Hotel en Willemstad', orden: 2, tarifa_pax: { casillas: { grupo_completo: opts.hotel ?? lecturaHotel('Hotel Ficticio Playa') } } }),
    ],
    cotizacion_itinerarios: [],
    itinerario_opciones: [],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: 'linea-viaje', nombre: 'P9 27 1', carpeta_url: null, empresa_id: null, precio_aprobado: null, etapa_actual_id: 'e1' }],
    lineas_negocio: [{ id: 'linea-viaje', config_extra: opts.planPagos ? { plan_pagos: { activo: true } } : {} }],
    etapas_negocio: [{ id: 'e1', linea_id: 'linea-viaje', orden: 1, config_extra: {} }],
    bloque_configs: [], rubros: [], item_adicionales: [], activity_log: [], decisiones_combinacion: [],
    negocio_bloques: [], cotizacion_excepciones_margen: [], cotizacion_ranuras: [], cobros: [],
    profiles: [{ id: 'p-asesora', workspace_id: WS, role: 'operator', full_name: 'Asesora de prueba', platform_admin: false }],
    staff: [{ id: 's-asesora', full_name: 'Asesora de prueba', position: 'Asesora', phone_whatsapp: '300 000 0000' }],
    workspaces: [{
      id: WS, name: 'Agencia de prueba', logo_url: null, color_primario: null, cotizacion_template_slug: 'trappvel',
      config_extra: { documento_viaje: { motor: 'html' } },
    }],
    empresas: [],
    fiscal_profiles: [{
      workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true,
      is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true,
      nit: '900000000', razon_social: 'AGENCIA DE PRUEBA S.A.S',
    }],
  }
}

async function documento() {
  await recalcularTotales(COT)
  const r = (await generateCotizacionPDF(COT)) as { success: boolean; error?: string }
  if (!r.success) throw new Error(r.error)
  const entrada = motor.llamadas[0] as EntradaModeloPropuesta
  const m = modeloDePropuesta(entrada)
  const html = htmlDePropuesta(m, { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'Agencia de prueba' })
  const texto = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  return { entrada, m, texto }
}

beforeEach(() => sembrar())

describe('punto 1 · las fechas del documento salen del vuelo, no de la solicitud', () => {
  it('portada: del 26 al 30 de junio, 5 días y 4 noches', async () => {
    const { m, texto } = await documento()
    expect(m.portada.fechas).toBe('26 jun 2027 – 30 jun 2027')
    expect(m.portada.duracion).toBe('5 días · 4 noches')
    expect(texto).not.toContain('13 noches')
    expect(texto).not.toContain('21 jun')
  })

  it('la ficha del hotel: entra el 26, sale el 30, 4 noches (el costo no cambia)', async () => {
    const { entrada, m } = await documento()
    expect(m.hoteles).toHaveLength(1)
    expect(m.hoteles[0]).toMatchObject({ desde: '2027-06-26', hasta: '2027-06-30', noches: 4 })
    expect(entrada.props.items.find(i => i.nombre.startsWith('HOTEL'))?.precio_venta).toBe(5_800_000)
  })

  it('el día a día abre el 26 con el vuelo y termina el 30 con el regreso', async () => {
    const { m } = await documento()
    expect(m.dias.map(d => d.fecha)).toEqual(['2027-06-26', '2027-06-27', '2027-06-28', '2027-06-29', '2027-06-30'])
    expect(m.dias[0].eventos.map(e => e.tipo)).toContain('vuelo')
    expect(m.dias[4].eventos.map(e => e.tipo)).toContain('vuelo')
  })

  it('un hotel con fechas LEÍDAS en su captura las conserva', async () => {
    sembrar({ hotel: lecturaHotel('Hotel Ficticio Playa', '2027-06-27', '2027-06-30') })
    const { m } = await documento()
    expect(m.hoteles[0]).toMatchObject({ desde: '2027-06-27', hasta: '2027-06-30', noches: 3 })
    expect(m.portada.fechas).toBe('26 jun 2027 – 30 jun 2027')
  })

  it('un hotel cuya entrada corrigió una persona conserva lo corregido', async () => {
    const h = base.tablas.items[1] as Fila
    h.tarifa_pax = { ...(h.tarifa_pax as object), correcciones: { check_in: { valor: '2027-06-28', por: 'Asesora de prueba', en: '2027-01-01' } } }
    const { m } = await documento()
    expect(m.hoteles[0].desde).toBe('2027-06-28')
  })

  it('un traslado con día asignado conserva la fecha que vio la asesora (día 6 de la solicitud = 26 jun)', async () => {
    ;(base.tablas.items as Fila[]).push(
      linea('t-llegada', 180_000, { nombre: 'AEROPUERTO - HOTEL', grupo: 'traslado: Traslado en Willemstad', orden: 3, dia_relativo: 6 }),
    )
    const { m } = await documento()
    expect(m.dias[0].eventos.map(e => e.tipo)).toEqual(expect.arrayContaining(['vuelo', 'traslado']))
  })

  it('sin ningún servicio con fecha, el documento usa el rango de la solicitud como siempre', async () => {
    sembrar({ sinVuelo: true })
    const { m } = await documento()
    expect(m.portada.fechas).toBe('21 jun 2027 – 4 jul 2027')
    expect(m.hoteles[0]).toMatchObject({ desde: '2027-06-21', hasta: '2027-07-04', noches: 13 })
  })
})

/**
 * Segunda vuelta (brief del 2026-10-29, punto 2) · el plan de pagos cuenta desde el día del viaje
 * COTIZADO. Con #1330 el documento decía 26–30 jun, pero «Así puedes pagar» seguía diciendo «hasta
 * el 21 de junio, día del viaje» (el inicio de la solicitud) y el 80 % vencía el 6 de junio.
 */
describe('punto 2 · el plan de pagos usa la fecha del viaje cotizado', () => {
  it('el saldo vence el 25 de junio, un día antes del viaje (26), y el 80 % quince días antes (11 de junio)', async () => {
    sembrar({ planPagos: true })
    const { entrada, m, texto } = await documento()
    expect(entrada.props.asiPuedesPagar?.fechaSalida).toBe('2027-06-26')
    const filas = m.precio.planes[0]?.plan.filas ?? []
    expect(filas.map(f => f.cuando)).toEqual([
      'al confirmar (anticipo)',
      'hasta el 11 de junio',
      'hasta el 25 de junio, un día antes del viaje',
    ])
    expect(texto).toContain('25 de junio, un día antes del viaje')
    expect(texto).not.toContain('21 de junio')
  })

  it('sin ningún servicio con fecha, el plan cuenta desde el inicio de la solicitud como siempre', async () => {
    sembrar({ planPagos: true, sinVuelo: true })
    const { entrada } = await documento()
    expect(entrada.props.asiPuedesPagar?.fechaSalida).toBe('2027-06-21')
  })
})
