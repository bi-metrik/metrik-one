/**
 * El modelo del documento nuevo dice las MISMAS cifras que el PDF de hoy.
 *
 * La paridad se afirma contra el binario: se imprime el PDF de @react-pdf de Trappvel con las
 * mismas props y se busca cada cifra del modelo en su texto (`textoDelPDF`), como el resto de
 * pruebas de la plantilla. Datos inventados: un viaje de cuatro ciudades con tres tarifas.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import CotizacionTrappvelPDF from '@/lib/pdf/cotizacion-trappvel-pdf'
import { textoDelPDF } from '@/lib/pdf/texto-del-pdf'
import type { CotizacionPDFProps, ViajePDF } from '@/lib/pdf/cotizacion-props'
import type { HotelPDF, VueloPDF } from '@/lib/cotizaciones/detalle-viaje'
import { asiPuedesPagar } from '@/lib/viaje/asi-puedes-pagar'
import { REGLA_POR_DEFECTO } from '@/lib/viaje/plan-pagos'
import {
  esTren,
  modeloDePropuesta,
  nombreDeTarifaParaCliente,
  type ServicioDelDocumento,
} from './modelo-documento'

// ── Datos inventados ─────────────────────────────────────────────────────────

const vuelo = (over: Partial<VueloPDF>): VueloPDF => ({
  linea: 'VUELO',
  aerolinea: null,
  origen: 'Bogota BOG',
  destino: 'Madrid MAD',
  fechaSalida: '10 dic 2026',
  fechaRegreso: null,
  horaSalida: null,
  horaLlegada: null,
  horaSalidaRegreso: null,
  horaLlegadaRegreso: null,
  escalaIda: null,
  escalaRegreso: null,
  escalas: 0,
  tarifa: null,
  equipaje: null,
  adicionales: [],
  ...over,
})

const hotel = (over: Partial<HotelPDF>): HotelPDF => ({
  linea: 'HOTEL',
  hotel: null,
  ciudad: null,
  habitacion: 'Habitación familiar',
  regimen: 'Desayuno',
  checkIn: null,
  checkOut: null,
  noches: null,
  ocupacion: null,
  cancelacion: null,
  estrellas: null,
  localizador: null,
  adicionales: [],
  ...over,
})

// Índices de `itinerarios`: 0 Recomendada (principal), 1 Económica, 2 Premium.
const R = 0
const E = 1
const P = 2

const VUELOS: VueloPDF[] = [
  vuelo({ linea: 'AIR FRANCE', aerolinea: 'Air France', numeroVuelo: 'AF423', escalaIda: 'Paris CDG', escalas: 1, horaSalida: '18:45', horaLlegada: '16:10', tarifas: [R] }),
  vuelo({ linea: 'AVIANCA', aerolinea: 'Avianca', numeroVuelo: 'AV26', horaSalida: '19:20', horaLlegada: '11:15', tarifas: [E] }),
  vuelo({ linea: 'IBERIA', aerolinea: 'Iberia', numeroVuelo: 'IB6584', horaSalida: '16:55', horaLlegada: '08:45', adicionales: ['Equipaje de bodega adicional ×3'], tarifas: [P] }),
  vuelo({ linea: 'KLM REGRESO', aerolinea: 'KLM', origen: 'Amsterdam AMS', destino: 'Bogota BOG', fechaSalida: '23 dic 2026', horaSalida: '10:05', horaLlegada: '15:20', tarifas: [R, E, P] }),
]

const HOTELES: HotelPDF[] = [
  hotel({ hotel: 'Hotel Sol Cuatro', ciudad: 'Madrid', checkIn: '11 dic 2026', checkOut: '14 dic 2026', noches: 3, estrellas: 4, cancelacion: 'Gratis hasta el 1 dic', tarifas: [R] }),
  hotel({ hotel: 'Hostal Prado Tres', ciudad: 'Madrid', checkIn: '11 dic 2026', checkOut: '14 dic 2026', noches: 3, estrellas: 3, tarifas: [E] }),
  hotel({ hotel: 'Gran Hotel Cinco', ciudad: 'Madrid', checkIn: '11 dic 2026', checkOut: '14 dic 2026', noches: 3, estrellas: 5, tarifas: [P] }),
  hotel({ hotel: 'Hotel Rambla Cuatro', ciudad: 'Barcelona', checkIn: '14 dic 2026', checkOut: '17 dic 2026', noches: 3, estrellas: 4, tarifas: [R] }),
  hotel({ hotel: 'Hotel Centro Tres', ciudad: 'Barcelona', checkIn: '14 dic 2026', checkOut: '17 dic 2026', noches: 3, estrellas: 3, tarifas: [E] }),
  hotel({ hotel: 'Hotel Paseo Cinco', ciudad: 'Barcelona', checkIn: '14 dic 2026', checkOut: '17 dic 2026', noches: 3, estrellas: 5, tarifas: [P] }),
  hotel({ hotel: 'Hotel Torre Cuatro', ciudad: 'Paris', checkIn: '17 dic 2026', checkOut: '21 dic 2026', noches: 4, estrellas: 4, tarifas: [R, E] }),
  hotel({ hotel: 'Palacio Cinco', ciudad: 'Paris', checkIn: '17 dic 2026', checkOut: '21 dic 2026', noches: 4, estrellas: 5, tarifas: [P] }),
  hotel({ hotel: 'Hotel Canal Cuatro', ciudad: 'Amsterdam', checkIn: '21 dic 2026', checkOut: '23 dic 2026', noches: 2, estrellas: 4, tarifas: [R, E, P] }),
]

const linea = (nombre: string, precio: number, extra: Partial<{ cantidad: number; valorAdicionales: number; adicionales: string[] }> = {}) => ({
  nombre,
  descripcion: null,
  precio_venta: precio,
  descuento_porcentaje: 0,
  cantidad: extra.cantidad ?? 1,
  unidad: null,
  ...(extra.adicionales ? { adicionales: extra.adicionales } : {}),
  ...(extra.valorAdicionales !== undefined ? { valorAdicionales: extra.valorAdicionales } : {}),
})

const COMUNES = [linea('Trenes AVE, TGV y Eurostar', 3_412_000), linea('Traslados privados', 2_890_500), linea('Asistencia médica', 611_250)]
const RECOMENDADA = [linea('Vuelos Air France y KLM', 9_458_300), linea('Hoteles 4 estrellas', 31_207_997), ...COMUNES]
const ECONOMICA = [linea('Vuelos Avianca y KLM', 8_120_400), linea('Hoteles 3 y 4 estrellas', 22_500_111), ...COMUNES]
const PREMIUM = [linea('Vuelos Iberia y KLM', 3_350_000, { cantidad: 3, valorAdicionales: 1_200_000, adicionales: ['Equipaje de bodega adicional ×3'] }), linea('Hoteles 5 estrellas', 70_410_333), ...COMUNES]

const suma = (l: typeof RECOMENDADA) =>
  l.reduce((a, i) => a + Math.round(i.precio_venta * i.cantidad) + ((i as { valorAdicionales?: number }).valorAdicionales ?? 0), 0)
const PRECIO_R = suma(RECOMENDADA)

const VIAJE: ViajePDF = {
  viajeros: '2 adultos, 1 niño y 1 infante',
  destino: 'Europa',
  fechas: '10 dic 2026 – 23 dic 2026',
  duracion: '14 días / 13 noches',
  presentacion: null,
  foto: null,
  fechaInicio: '2026-12-10',
  vuelos: VUELOS,
  hoteles: HOTELES,
  cargosEnDestino: [{ ciudad: 'Barcelona', hotel: 'Hotel Rambla Cuatro', concepto: 'Tasa turística', monto: '41,28 EUR', observacion: 'Se paga en el hotel.', tarifas: [R] }],
  nivelDetalle: 'normal',
  pie: 'Agencia de ejemplo · contacto@agencia.example',
  firma: { nombre: 'Asesora de Ejemplo', cargo: 'Asesora', contacto: null },
}

const ENTRADA_PLAN = { fechaSalida: '2026-12-10', hoy: '2026-10-14', regla: REGLA_POR_DEFECTO }

const props = (over: Partial<CotizacionPDFProps> = {}): CotizacionPDFProps => ({
  cotizacion: {
    consecutivo: 'COT-2026-9001',
    descripcion: null,
    valor_total: PRECIO_R,
    modo: 'detallada',
    fecha_envio: null,
    fecha_validez: null,
    condiciones_pago: null,
    notas: null,
    descuento_porcentaje: 0,
    descuento_valor: 0,
  },
  empresa: { nombre: 'Familia Ejemplo', nit: null, contacto_nombre: 'Familia Ejemplo', contacto_email: null, telefono: null, direccion: null, ciudad: null },
  vendedor: { nombre: 'Agencia de ejemplo', razon_social: null, nit: null, logo_url: null, color_primario: '#e63380', telefono: null, email: null, direccion: null, ciudad: null },
  items: RECOMENDADA,
  itinerarios: [
    { nombre: 'Recomendada', esPrincipal: true, precio: PRECIO_R, items: RECOMENDADA },
    { nombre: 'Económica', esPrincipal: false, precio: suma(ECONOMICA), items: ECONOMICA },
    { nombre: 'Premium', esPrincipal: false, precio: suma(PREMIUM), items: PREMIUM },
  ],
  dias: null,
  itemsSinDia: null,
  sugeridos: [{ nombre: 'Tour del estadio', descripcion: 'Vestuarios y museo · Cancelación: gratuita hasta 01/12/2026', precio_venta: 195_000, cantidad: 4, unidad: null }],
  preciosPorPasajero: null,
  fiscal: { subtotal: PRECIO_R, iva: 0, reteFuente: 0, reteICA: 0, reteIVA: 0, totalBruto: PRECIO_R, totalRetenciones: 0, teQueda: PRECIO_R },
  negocio: { nombre: 'Europa en familia' },
  emisor: null,
  viaje: VIAJE,
  asiPuedesPagar: ENTRADA_PLAN,
  ...over,
})

const SERVICIOS: ServicioDelDocumento[] = [
  { tipo: 'traslado', descripcion: 'Aeropuerto Barajas T4 - hotel · Privado', fecha: '11 dic 2026', hora: null },
  { tipo: 'traslado', descripcion: 'Madrid Atocha - Barcelona Sants · AVE 03071', fecha: '14 dic 2026', hora: '09:30' },
  { tipo: 'traslado', descripcion: 'Barcelona Sants - Paris Gare de Lyon · TGV INOUI 9714', fecha: '17 dic 2026', hora: '09:25' },
  { tipo: 'traslado', descripcion: 'Paris Nord - Amsterdam Centraal · Eurostar 9325', fecha: '21 dic 2026', hora: '10:25' },
  { tipo: 'actividad', descripcion: 'Museo del Prado · 2 h · Madrid', fecha: '12 dic 2026', hora: '10:00' },
]

// ── Paridad con el PDF de hoy ────────────────────────────────────────────────

const pesos = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)
const plano = (t: string) => t.replace(/\s+/g, ' ')

async function textoDelPdfDeHoy(p: CotizacionPDFProps): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return plano(textoDelPDF(Buffer.from(await renderToBuffer(createElement(CotizacionTrappvelPDF, p) as any))))
}

describe('las cifras del modelo son las del PDF de hoy', () => {
  it('con tres tarifas: el precio de cada una, el TOTAL y el plan de pagos', { timeout: 30_000 }, async () => {
    const p = props()
    const m = modeloDePropuesta({ props: p, servicios: SERVICIOS })
    const t = await textoDelPdfDeHoy(p)

    // Cada tarifa: su precio y el de cada una de sus líneas están impresos en el PDF de hoy.
    expect(m.tarifas.map((x) => x.indice)).toEqual([E, R, P])
    for (const tarifa of m.tarifas) {
      expect(tarifa.precio).toBe(p.itinerarios![tarifa.indice].precio)
      expect(t).toContain(plano(pesos(tarifa.precio)))
      for (const l of tarifa.lineas) expect(t).toContain(plano(pesos(l.total)))
      // Las líneas del modelo suman el precio de la tarifa, igual que «Inversión».
      expect(tarifa.lineas.reduce((a, l) => a + l.total, 0)).toBe(tarifa.precio)
    }

    // El TOTAL.
    expect(m.precio.total).toBe(PRECIO_R)
    expect(t).toContain(plano(pesos(m.precio.total)))
    expect(m.precio.totalEsDeLaRecomendada).toBe(true)
    expect(t).toContain('El total de abajo corresponde a la opción recomendada')

    // El plan de la Recomendada es EXACTAMENTE el que imprime el PDF de hoy (sobre su TOTAL).
    const planHoy = asiPuedesPagar(PRECIO_R, ENTRADA_PLAN)
    const planR = m.precio.planes.find((x) => x.tarifa === R)!
    expect(planR.plan).toEqual(planHoy)
    expect(planR.plan.filas!.length).toBeGreaterThan(1)
    for (const f of planR.plan.filas!) {
      expect(t).toContain(plano(pesos(f.monto)))
      expect(t).toContain(f.cuando)
    }

    // Las otras dos tarifas: el mismo plan sobre su precio, y cada una suma su precio exacto.
    expect(m.precio.planes.map((x) => x.tarifa)).toEqual([E, R, P])
    for (const pl of m.precio.planes) {
      const precio = m.tarifas.find((x) => x.indice === pl.tarifa)!.precio
      expect(pl.plan.suma).toBe(precio)
      expect(pl.plan.filas!.reduce((a, f) => a + f.monto, 0)).toBe(precio)
    }
    expect(m.avisos).toEqual([])
  })

  it('con el IVA dentro de los precios: la misma nota de IVA por tarifa que hoy', { timeout: 30_000 }, async () => {
    const p = props({ ivaEnPrecios: { iva: 1_234_567, nota: true, porBloque: [1_234_567, 987_654, 2_345_678] } })
    const m = modeloDePropuesta({ props: p })
    const t = await textoDelPdfDeHoy(p)
    for (const tarifa of m.tarifas) {
      expect(tarifa.notaIva).not.toBeNull()
      expect(t).toContain(plano(tarifa.notaIva!))
    }
    // Cada tarifa con SU IVA (el de su posición en `itinerarios`), no el de otra.
    expect(m.tarifas.map((x) => x.notaIva)).toEqual([
      `Incluye IVA de ${pesos(987_654)}`,
      `Incluye IVA de ${pesos(1_234_567)}`,
      `Incluye IVA de ${pesos(2_345_678)}`,
    ])
    expect(m.precio.notaIva).not.toBeNull()
    expect(t).toContain(plano(pesos(1_234_567)))
  })

  it('sin tarifas: el TOTAL, las líneas y el plan del total, como hoy', { timeout: 30_000 }, async () => {
    const p = props({ itinerarios: null, viaje: { ...VIAJE, vuelos: [VUELOS[0], VUELOS[3]], hoteles: HOTELES.filter((h) => h.tarifas!.includes(R)).map((h) => ({ ...h, tarifas: undefined })) } })
    const m = modeloDePropuesta({ props: p })
    const t = await textoDelPdfDeHoy(p)
    expect(m.tarifas).toEqual([])
    expect(m.precio.total).toBe(PRECIO_R)
    expect(t).toContain(plano(pesos(PRECIO_R)))
    for (const l of m.precio.lineas) expect(t).toContain(plano(pesos(l.total)))
    expect(m.precio.planes).toHaveLength(1)
    expect(m.precio.planes[0].plan).toEqual(asiPuedesPagar(PRECIO_R, ENTRADA_PLAN))
    for (const f of m.precio.planes[0].plan.filas!) expect(t).toContain(plano(pesos(f.monto)))
  })

  it('sin plan en la línea no hay plan, igual que hoy', () => {
    expect(modeloDePropuesta({ props: props({ asiPuedesPagar: null }) }).precio.planes).toEqual([])
  })

  it('avisa si el precio de la Recomendada no es el TOTAL (el síntoma de H27)', () => {
    const p = props()
    const m = modeloDePropuesta({ props: { ...p, fiscal: { ...p.fiscal!, totalBruto: PRECIO_R - 1_000 } } })
    expect(m.avisos).toHaveLength(1)
    expect(m.avisos[0]).toContain('Recomendada')
  })

  it('el opcional vale lo que imprime su tarjeta hoy, sin la cancelación del proveedor', { timeout: 30_000 }, async () => {
    const p = props()
    const m = modeloDePropuesta({ props: p })
    expect(m.opcionales).toEqual([{ nombre: 'Tour del estadio', descripcion: 'Vestuarios y museo', valor: 780_000, unidad: null, ciudad: null, fecha: null }])
    expect(await textoDelPdfDeHoy(p)).toContain(plano(pesos(780_000)))
  })
})

// ── Léxico y secciones ───────────────────────────────────────────────────────

describe('léxico: «Premium» se le dice «Superior» al cliente', () => {
  it('el nombre visible cambia; el guardado no', () => {
    expect(nombreDeTarifaParaCliente('Premium', false, 3)).toBe('Superior')
    expect(nombreDeTarifaParaCliente('PREMIUM', false, 3)).toBe('SUPERIOR')
    expect(nombreDeTarifaParaCliente('Económica', false, 1)).toBe('Económica')
    expect(nombreDeTarifaParaCliente('Recomendada', true, 1)).toBe('Recomendada')
    expect(nombreDeTarifaParaCliente(null, true, 2)).toBe('Opción 2 · recomendada')
    const m = modeloDePropuesta({ props: props() })
    expect(m.tarifas.map((t) => t.nombre)).toEqual(['Económica', 'Recomendada', 'Superior'])
    expect(m.tarifas.map((t) => t.clave)).toEqual(['economica', 'recomendada', 'superior'])
    expect(JSON.stringify(m)).not.toMatch(/premium/i)
  })
})

describe('la Intermedia (segunda vuelta de la COT-2026-0008): el orden del documento sigue al precio', () => {
  it('Económica, Intermedia, Recomendada, de izquierda a derecha', () => {
    const m = modeloDePropuesta({
      props: props({
        itinerarios: [
          { nombre: 'Recomendada', esPrincipal: true, precio: PRECIO_R, items: RECOMENDADA },
          { nombre: 'Económica', esPrincipal: false, precio: suma(ECONOMICA), items: ECONOMICA },
          { nombre: 'Intermedia', esPrincipal: false, precio: suma(PREMIUM), items: PREMIUM },
        ],
      }),
    })
    expect(m.tarifas.map((t) => t.nombre)).toEqual(['Económica', 'Intermedia', 'Recomendada'])
    expect(m.tarifas.map((t) => t.clave)).toEqual(['economica', 'intermedia', 'recomendada'])
  })
})

describe('las secciones del prototipo', () => {
  const m = modeloDePropuesta({ props: props(), servicios: SERVICIOS })

  it('la ruta: de Bogota por cuatro ciudades, con el tren entre ellas', () => {
    expect(m.ruta.origen).toBe('Bogota (BOG)')
    expect(m.ruta.paradas.map((x) => [x.ciudad, x.noches])).toEqual([
      ['Madrid', 3],
      ['Barcelona', 3],
      ['Paris', 4],
      ['Amsterdam', 2],
    ])
    expect(m.ruta.paradas[0].siguiente).toContain('AVE')
    expect(m.ruta.paradas[1].siguiente).toContain('TGV')
    expect(m.ruta.paradas[2].siguiente).toContain('Eurostar')
    expect(m.ruta.paradas[3].siguiente).toBeNull()
  })

  it('hoteles por ciudad, una opción por tarifa en el orden del cliente', () => {
    expect(m.hoteles.map((c) => c.ciudad)).toEqual(['Madrid', 'Barcelona', 'Paris', 'Amsterdam'])
    const madrid = m.hoteles[0]
    expect(madrid.desde).toBe('2026-12-11')
    expect(madrid.hasta).toBe('2026-12-14')
    expect(madrid.opciones.map((o) => o.hotel)).toEqual(['Hostal Prado Tres', 'Hotel Sol Cuatro', 'Gran Hotel Cinco'])
    const barcelonaR = m.hoteles[1].opciones.find((o) => o.tarifas.includes(R))!
    expect(barcelonaR.cargoEnDestino).toBe('Tasa turística: 41,28 EUR')
    // Un hotel compartido por varias tarifas va una sola vez.
    expect(m.hoteles[3].opciones).toHaveLength(1)
    expect(m.hoteles[3].opciones[0].tarifas).toEqual([R, E, P])
  })

  it('vuelos de ida y regreso marcados con su tarifa', () => {
    const ida = m.vuelos.filter((f) => f.sentido === 'ida' && f.fecha === '2026-12-10')
    expect(ida.map((f) => f.aerolinea)).toEqual(['Air France', 'Avianca', 'Iberia'])
    expect(ida[0].escala).toContain('Escala en')
    expect(ida[1].escala).toBe('Vuelo directo')
    expect(ida[2].adicionales).toEqual(['Equipaje de bodega adicional ×3'])
  })

  it('trenes y traslados aparte de los vuelos', () => {
    expect(m.trayectos.filas.map((x) => x.tipo)).toEqual(['traslado', 'tren', 'tren', 'tren'])
    expect(m.trayectos.igualEnTodas).toBe(true)
    expect(esTren('Hotel → aeropuerto Schiphol · Privado')).toBe(false)
    expect(esTren('Roma Termini - Firenze SMN · Frecciarossa')).toBe(true)
  })

  it('el día a día también con tarifas: solo el vuelo va por tarifa', () => {
    expect(m.dias).toHaveLength(14)
    expect(m.dias[0].fecha).toBe('2026-12-10')
    const salida = m.dias[0].eventos.find((e) => e.tipo === 'vuelo')!
    expect(salida.texto).toBe('Bogota (BOG) → Madrid (MAD)')
    expect(salida.momento).toBe('salida')
    expect(salida.porTarifa.map((x) => x.tarifas)).toEqual([[R], [E], [P]])
    // Como el prototipo v4: aerolínea, hora, directo o vía. Con cajas, la hora va en cada una.
    expect(salida.porTarifa.map((x) => x.texto)).toEqual(['Air France 18:45, vía Paris', 'Avianca 19:20, directo', 'Iberia 16:55, directo'])
    // Cada caja lleva la sigla de su aerolínea, para la pastilla (brief del 2026-10-08).
    expect(salida.porTarifa.map((x) => x.siglas)).toEqual([['AF'], ['AV'], ['IB']])
    expect(salida.hora).toBeNull()
    // Llega al día siguiente: ese día dice a qué hora llega cada versión.
    const llega = m.dias[1].eventos[0]
    expect(llega).toMatchObject({ tipo: 'vuelo', momento: 'llegada', hora: null, texto: 'Llegada a Madrid (MAD)' })
    expect(llega.porTarifa.map((x) => x.texto)).toEqual(['llega 16:10', 'llega 11:15', 'llega 08:45'])
    // El hotel de cada versión ya está en «Dónde duermen»: el día a día no lo repite.
    const llegadaMadrid = m.dias[1].eventos.find((e) => e.tipo === 'hotel')!
    expect(llegadaMadrid.texto).toBe('Llegada al hotel en Madrid')
    expect(llegadaMadrid.porTarifa).toEqual([])
    expect(m.dias.flatMap((d) => d.eventos).filter((e) => e.tipo !== 'vuelo' && e.porTarifa.length > 0)).toEqual([])
    expect(m.dias[2].eventos.map((e) => e.texto)).toEqual(['Museo del Prado · 2 h · Madrid'])
    expect(m.dias[2].ciudad).toBe('Madrid')
    // Un día sin nada programado se marca libre.
    expect(m.dias[3].libre).toBe(true)
    const regreso = m.dias[13].eventos.find((e) => e.tipo === 'vuelo')!
    expect(regreso.porTarifa).toEqual([])
  })

  it('«Elige tu versión»: hoteles, estrellas y vuelos de cada tarifa, y lo que es igual en las tres', () => {
    const [eco, rec, sup] = m.tarifas
    expect(rec.estrellas).toBe(4)
    // Solo cuando TODOS sus hoteles tienen la misma categoría: la Superior duerme en un 4★ en
    // Ámsterdam y la Económica mezcla 3★ y 4★, así que ninguna de las dos se resume.
    expect(sup.estrellas).toBeNull()
    expect(eco.estrellas).toBeNull()
    expect(sup.hoteles.map((h) => h.nombre)).toEqual(['Gran Hotel Cinco', 'Hotel Paseo Cinco', 'Palacio Cinco', 'Hotel Canal Cuatro'])
    expect(rec.vuelos.map((f) => f.aerolinea)).toEqual(['Air France', 'KLM'])
    expect(m.igualEnTodas).toEqual(['Trenes AVE, TGV y Eurostar', 'Traslados privados', 'Asistencia médica'])
  })

  it('lo que no incluye y lo formal salen como en el documento de hoy', () => {
    expect(m.precio.noIncluye).toEqual([
      // V7-2 (QA del 2026-10-29): dice en qué versión se paga.
      'Tasa turística en Barcelona: se paga en el hotel, solo en la versión Recomendada',
      'Las actividades opcionales listadas al final de este documento',
    ])
    expect(m.formal.pie).toBe('Agencia de ejemplo · contacto@agencia.example')
    expect(m.formal.firma?.nombre).toBe('Asesora de Ejemplo')
    expect(m.portada.titulo).toBe('Europa en familia')
  })
})

describe('los planes opcionales en los días libres', () => {
  const sugeridos = [
    { nombre: 'Palacio Real de Madrid', descripcion: null, precio_venta: 520_000, cantidad: 1, unidad: null },
    { nombre: 'Tour del Bernabéu', descripcion: 'Museo del Real Madrid', precio_venta: 780_000, cantidad: 1, unidad: null },
    { nombre: 'Disneyland', descripcion: 'Dos parques', precio_venta: 2_000_000, cantidad: 1, unidad: null },
    { nombre: 'El Louvre en familia', descripcion: null, precio_venta: 890_000, cantidad: 1, unidad: null },
    { nombre: 'Crucero por el Sena', descripcion: null, precio_venta: 1_150_000, cantidad: 1, unidad: null },
    { nombre: 'Molinos', descripcion: 'A 20 minutos de Amsterdam', precio_venta: 690_000, cantidad: 1, unidad: null },
    { nombre: 'Cena de gala', descripcion: null, precio_venta: 500_000, cantidad: 1, unidad: null },
  ]
  const lugares = [
    null, // Madrid: lo dice el nombre
    { ciudad: 'MADRID', fecha: null }, // leída, con otra grafía: se ajusta a la parada
    { ciudad: 'París', fecha: null }, // «Paris» en la parada, con tilde en la lectura
    { ciudad: 'Paris', fecha: null },
    { ciudad: 'Paris', fecha: null },
    null, // Ámsterdam: lo dice la descripción, y la ciudad no tiene días libres
    null, // sin ciudad: se queda en la sección del final
  ]
  const servicios: ServicioDelDocumento[] = [
    ...SERVICIOS,
    { tipo: 'actividad', descripcion: 'Torre Eiffel · 2 h · Paris', fecha: '18 dic 2026', hora: null },
    { tipo: 'actividad', descripcion: 'Canales · 1 h · Amsterdam', fecha: '22 dic 2026', hora: null },
    { tipo: 'traslado', descripcion: 'Hotel - aeropuerto Schiphol · Privado', fecha: '23 dic 2026', hora: null },
  ]
  const m = modeloDePropuesta({ props: props({ sugeridos }), servicios, lugaresDeOpcionales: lugares })
  const dia = (iso: string) => m.dias.find((d) => d.fecha === iso)!

  it('cada plan sabe su ciudad: la leída, o la que nombra', () => {
    expect(m.opcionales.map((o) => o.ciudad)).toEqual(['Madrid', 'Madrid', 'Paris', 'Paris', 'Paris', 'Amsterdam', null])
  })

  it('van a los días libres de su ciudad, repartidos en orden', () => {
    expect(dia('2026-12-13').libre).toBe(true)
    expect(dia('2026-12-13').opcionales).toEqual(['Palacio Real de Madrid', 'Tour del Bernabéu'])
    // París tiene dos días libres (19 y 20) y tres planes: dos y uno.
    expect(dia('2026-12-19').opcionales).toEqual(['Disneyland', 'El Louvre en familia'])
    expect(dia('2026-12-20').opcionales).toEqual(['Crucero por el Sena'])
    // Ámsterdam no tiene días libres: el plan va al día de solo visitas.
    expect(dia('2026-12-22').libre).toBe(false)
    expect(dia('2026-12-22').opcionales).toEqual(['Molinos'])
    // El que no tiene ciudad no aparece en ningún día.
    expect(m.dias.flatMap((d) => d.opcionales)).not.toContain('Cena de gala')
  })

  it('un plan con día va a ese día, aunque no sea libre', () => {
    const conDia = modeloDePropuesta({
      props: props({ sugeridos: sugeridos.slice(0, 1) }),
      servicios,
      lugaresDeOpcionales: [{ ciudad: 'Madrid', fecha: '12 dic' }],
    })
    expect(conDia.dias.find((d) => d.fecha === '2026-12-12')!.opcionales).toEqual(['Palacio Real de Madrid'])
    expect(conDia.dias.find((d) => d.fecha === '2026-12-13')!.opcionales).toEqual([])
  })

  it('el traslado al aeropuerto va antes que el vuelo de ese día', () => {
    expect(dia('2026-12-23').eventos.map((e) => e.tipo)).toEqual(['traslado', 'vuelo'])
  })

  it('los ganchos del texto generado nacen vacíos', () => {
    expect(m.dias.every((d) => d.titulo === null && d.sugerencia === null)).toBe(true)
  })
})
