/**
 * Una propuesta corta de playa con dos versiones, armada como la COT-2026-0004 real (negocio
 * M1 26 1, 2026-10-27): un destino, cinco noches, los mismos vuelos en las dos versiones, dos
 * hoteles (Recomendada y Superior), dos traslados y el plan de pagos de la línea. Sirve para
 * comparar la plantilla con el formato de Edgar del 2026-10-14.
 *
 * Datos ficticios: viajeros, precios, términos, pie y firma son de EJEMPLO (un fixture del repo
 * no lleva datos de un cliente). Las fotos de hotel son las del ensayo del PR 0.
 */
import path from 'node:path'
import type { CotizacionPDFProps, ViajePDF } from '@/lib/pdf/cotizacion-props'
import type { HotelPDF, VueloPDF } from '@/lib/cotizaciones/detalle-viaje'
import type { EntradaModeloPropuesta, ServicioDelDocumento } from '@/lib/cotizaciones/propuesta/modelo-documento'
import { REGLA_POR_DEFECTO } from '@/lib/viaje/plan-pagos'

const FOTOS = path.join(process.cwd(), 'src/lib/pdf/chromium/ensayo/fotos')
const foto = (archivo: string) => ({ url: path.join(FOTOS, archivo), proporcion: 1.5 })

// Índices de `itinerarios`: 0 Recomendada (principal), 1 Premium (se dice «Superior»).
const R = 0
const P = 1

const vuelo = (over: Partial<VueloPDF>): VueloPDF => ({
  linea: 'AVIANCA',
  aerolinea: 'Avianca',
  origen: 'Bogotá BOG',
  destino: 'Curazao CUR',
  fechaSalida: '26 nov 2026',
  fechaRegreso: null,
  horaSalida: null,
  horaLlegada: null,
  horaSalidaRegreso: null,
  horaLlegadaRegreso: null,
  escalaIda: null,
  escalaRegreso: null,
  escalas: 0,
  tarifa: 'Light Standard economy',
  equipaje: 'Artículo personal + equipaje de mano',
  adicionales: [],
  ...over,
})

export const VUELOS_CURAZAO: VueloPDF[] = [
  vuelo({ numeroVuelo: 'AV92', horaSalida: '07:30', horaLlegada: '10:30', tarifas: [R, P] }),
  vuelo({ linea: 'AVIANCA REGRESO', origen: 'Curazao CUR', destino: 'Bogotá BOG', fechaSalida: '1 dic 2026', numeroVuelo: 'AV79', horaSalida: '18:20', horaLlegada: '19:20', tarifas: [R, P] }),
]

const hotel = (over: Partial<HotelPDF>): HotelPDF => ({
  linea: 'HOTEL',
  hotel: null,
  ciudad: 'Willemstad',
  habitacion: null,
  regimen: 'Todo incluido',
  checkIn: '26 nov 2026',
  checkOut: '1 dic 2026',
  noches: 5,
  ocupacion: null,
  cancelacion: 'No reembolsable',
  estrellas: null,
  localizador: null,
  adicionales: [],
  ...over,
})

export const HOTELES_CURAZAO: HotelPDF[] = [
  hotel({ hotel: 'Kunuku Resort All Inclusive Curacao', estrellas: 3, habitacion: 'Doble, una cama doble, no fumadores', foto: foto('parkplaza.jpg'), tarifas: [R] }),
  hotel({ hotel: 'Renaissance Wind Creek Curacao Resort', estrellas: 4, habitacion: 'Doble sin ventana', foto: foto('pullman.jpg'), tarifas: [P] }),
]

const linea = (nombre: string, precio: number) => ({ nombre, descripcion: null, precio_venta: precio, descuento_porcentaje: 0, cantidad: 1, unidad: null })

const COMUNES = [linea('Avianca Bogotá–Curazao', 3_100_000), linea('Traslados aeropuerto – hotel (ida y vuelta)', 380_000)]
const RECOMENDADA = [linea('Kunuku Resort, 5 noches todo incluido', 6_072_219), ...COMUNES]
const PREMIUM = [linea('Renaissance Wind Creek, 5 noches todo incluido', 12_484_024), ...COMUNES]
const suma = (l: typeof RECOMENDADA) => l.reduce((a, i) => a + i.precio_venta, 0)
export const PRECIO_CUR_R = suma(RECOMENDADA) // 9.552.219
export const PRECIO_CUR_P = suma(PREMIUM) // 15.964.024

export const VIAJE_CURAZAO: ViajePDF = {
  titular: 'Aruba o Curazao',
  intro: '5 noches en Willemstad con todo incluido. Los días libres quedan abiertos para que ustedes decidan.',
  incluye: [],
  antesDeViajar: [
    'Pasaporte vigente con al menos seis meses de validez.',
    'Certificado de vacuna contra la fiebre amarilla.',
    'Lleguen a El Dorado tres horas antes del vuelo internacional.',
  ],
  viajeros: '2 adultos y 1 niño',
  destino: 'Willemstad',
  fechas: '26 nov 2026 – 1 dic 2026',
  duracion: '6 días · 5 noches',
  presentacion: null,
  foto: null,
  fotosCiudades: [],
  fechaInicio: '2026-11-26',
  vuelos: VUELOS_CURAZAO,
  hoteles: HOTELES_CURAZAO,
  cargosEnDestino: [],
  nivelDetalle: 'normal',
  pie: 'www.agencia.example · contacto@agencia.example · (601) 000 0000 · Bogotá - Colombia',
  firma: { nombre: 'Asesora de Ejemplo', cargo: 'Directora comercial', contacto: 'contacto@agencia.example' },
}

export const TERMINOS_CURAZAO = [
  'Condiciones generales',
  'Al realizar el pago, el pasajero declara que conoce y acepta las condiciones de la reserva.',
  'Las tarifas están sujetas a cambios y a disponibilidad al momento de reservar.',
  'Los servicios que no se tomen no son reembolsables.',
  'Medios de pago',
  'Transferencia a la cuenta de ahorros 000-000000-00 del Banco de Ejemplo.',
  'PSE, tarjeta de crédito o link de pago, con un recargo promedio del 3 %.',
].join('\n')

export const PROPS_CURAZAO: CotizacionPDFProps = {
  cotizacion: {
    consecutivo: 'COT-2026-0004',
    descripcion: 'Aruba o Curazao',
    valor_total: PRECIO_CUR_R,
    modo: 'detallada',
    fecha_envio: null,
    fecha_validez: null,
    condiciones_pago: null,
    notas: null,
    descuento_porcentaje: 0,
    descuento_valor: 0,
    terminos_condiciones: TERMINOS_CURAZAO,
  },
  empresa: { nombre: 'Cliente de Ejemplo', nit: null, contacto_nombre: 'Cliente de Ejemplo', contacto_email: null, telefono: null, direccion: null, ciudad: null },
  vendedor: { nombre: 'Agencia de ejemplo', razon_social: null, nit: null, logo_url: null, color_primario: '#e6197a', telefono: null, email: null, direccion: null, ciudad: null },
  items: RECOMENDADA,
  itinerarios: [
    { nombre: 'Recomendada', esPrincipal: true, precio: PRECIO_CUR_R, items: RECOMENDADA },
    { nombre: 'Premium', esPrincipal: false, precio: PRECIO_CUR_P, items: PREMIUM },
  ],
  dias: null,
  itemsSinDia: null,
  sugeridos: [],
  preciosPorPasajero: null,
  fiscal: { subtotal: PRECIO_CUR_R, iva: 0, reteFuente: 0, reteICA: 0, reteIVA: 0, totalBruto: PRECIO_CUR_R, totalRetenciones: 0, teQueda: PRECIO_CUR_R },
  negocio: { nombre: 'Aruba o Curazao' },
  emisor: null,
  viaje: VIAJE_CURAZAO,
  asiPuedesPagar: { fechaSalida: '2026-11-26', hoy: '2026-10-27', regla: REGLA_POR_DEFECTO },
}

const t = (descripcion: string, fecha: string): ServicioDelDocumento => ({ tipo: 'traslado', descripcion, fecha, hora: null })

export const SERVICIOS_CURAZAO: ServicioDelDocumento[] = [
  t('Aeropuerto Hato - hotel · Compartido, shuttle estándar', '26 nov 2026'),
  t('Hotel - aeropuerto Hato · Compartido, shuttle estándar', '1 dic 2026'),
]

export const ENTRADA_CURAZAO: EntradaModeloPropuesta = {
  props: PROPS_CURAZAO,
  servicios: SERVICIOS_CURAZAO,
  viajeros: [
    { nombre: 'Ana Ejemplo', menor: false },
    { nombre: 'Luis Ejemplo', menor: false },
    { nombre: 'Tomás', menor: true },
  ],
  menoresAutorizados: false,
  anticipo: null,
  asesora: { nombre: 'Asesora de Ejemplo', whatsapp: null },
  // El contacto del negocio, guardado en mayúsculas como el de la COT-2026-0004 real; la empresa
  // es persona natural con el mismo nombre.
  cliente: { contacto: 'ANDRÉS DE LA TORRE', empresa: 'ANDRÉS DE LA TORRE', tipoPersona: 'natural' },
}
