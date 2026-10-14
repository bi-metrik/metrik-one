/**
 * COT-2026-0026 de muestra: el viaje del prototipo aprobado de la propuesta (v5,
 * `proyectos/trappvel/clarity/qa/2026-10-13_prueba-europa/ideal/`), armado como lo arma la
 * acción del PDF (`CotizacionPDFProps` + servicios) para el motor `html`.
 *
 * Cliente ficticio y precios inventados, como el prototipo. Los datos de la agencia (pie,
 * firma, términos, teléfono) son de EJEMPLO: un fixture del repo no lleva datos de un cliente.
 * Las fotos de hotel son las del ensayo del PR 0 (Wikimedia Commons, ya reducidas).
 *
 * El hotel trae su cancelación a propósito: la propuesta NO la imprime (decisión del
 * 2026-10-14), y las pruebas lo vigilan con el dato presente.
 */
import path from 'node:path'
import type { CotizacionPDFProps, ViajePDF } from '@/lib/pdf/cotizacion-props'
import type { HotelPDF, VueloPDF } from '@/lib/cotizaciones/detalle-viaje'
import type { EntradaModeloPropuesta, ServicioDelDocumento } from '@/lib/cotizaciones/propuesta/modelo-documento'
import { REGLA_POR_DEFECTO } from '@/lib/viaje/plan-pagos'

const FOTOS = path.join(process.cwd(), 'src/lib/pdf/chromium/ensayo/fotos')
const foto = (archivo: string) => ({ url: path.join(FOTOS, archivo), proporcion: 1.5 })

// Índices de `itinerarios`: 0 Recomendada (principal), 1 Económica, 2 Premium (se dice «Superior»).
export const R = 0
export const E = 1
export const P = 2

const vuelo = (over: Partial<VueloPDF>): VueloPDF => ({
  linea: 'VUELO',
  aerolinea: null,
  origen: 'Bogotá BOG',
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

const regreso = (over: Partial<VueloPDF>) => vuelo({ origen: 'Ámsterdam AMS', destino: 'Bogotá BOG', fechaSalida: '23 dic 2026', ...over })

export const VUELOS_EUROPA: VueloPDF[] = [
  vuelo({ linea: 'AVIANCA', aerolinea: 'Avianca', numeroVuelo: 'AV26', horaSalida: '19:20', horaLlegada: '11:15', tarifa: 'Classic', equipaje: 'Maleta de 23 kg incluida', tarifas: [E] }),
  vuelo({ linea: 'AIR FRANCE', aerolinea: 'Air France', numeroVuelo: 'AF423', escalaIda: 'París CDG', escalas: 1, horaSalida: '18:45', horaLlegada: '16:10', tarifa: 'Economy Standard', equipaje: 'Maleta de 23 kg incluida', tarifas: [R] }),
  vuelo({ linea: 'IBERIA', aerolinea: 'Iberia', numeroVuelo: 'IB6584', horaSalida: '16:55', horaLlegada: '08:45', tarifa: 'Basic', adicionales: ['3 maletas de 23 kg agregadas'], tarifas: [P] }),
  regreso({ linea: 'IBERIA REGRESO', aerolinea: 'Iberia', numeroVuelo: 'IB3251', escalaIda: 'Madrid MAD', escalas: 1, horaSalida: '06:25', horaLlegada: '15:45', tarifa: 'Standard', equipaje: 'Maleta de 23 kg incluida', tarifas: [E] }),
  regreso({ linea: 'LUFTHANSA', aerolinea: 'Lufthansa', numeroVuelo: 'LH993', escalaIda: 'Frankfurt FRA', escalas: 1, horaSalida: '07:10', horaLlegada: '15:05', tarifa: 'Light', adicionales: ['3 maletas de 23 kg agregadas'], tarifas: [R] }),
  regreso({ linea: 'KLM', aerolinea: 'KLM', numeroVuelo: 'KL743', horaSalida: '10:05', horaLlegada: '15:20', tarifa: 'Economy Standard', equipaje: 'Maleta de 23 kg incluida', tarifas: [P] }),
]

const hotel = (over: Partial<HotelPDF>): HotelPDF => ({
  linea: 'HOTEL',
  hotel: null,
  ciudad: null,
  habitacion: 'Habitación familiar',
  regimen: 'Desayuno incluido',
  checkIn: null,
  checkOut: null,
  noches: null,
  ocupacion: null,
  cancelacion: 'Cancelación gratis hasta el 1 dic',
  estrellas: null,
  localizador: null,
  adicionales: [],
  ...over,
})

const MAD = { ciudad: 'Madrid', checkIn: '11 dic 2026', checkOut: '14 dic 2026', noches: 3 }
const BCN = { ciudad: 'Barcelona', checkIn: '14 dic 2026', checkOut: '17 dic 2026', noches: 3 }
const PAR = { ciudad: 'París', checkIn: '17 dic 2026', checkOut: '21 dic 2026', noches: 4 }
const AMS = { ciudad: 'Ámsterdam', checkIn: '21 dic 2026', checkOut: '23 dic 2026', noches: 2 }

export const HOTELES_EUROPA: HotelPDF[] = [
  hotel({ ...MAD, hotel: 'Ibis Styles Madrid Prado', estrellas: 3, foto: foto('ibis_mad.jpg'), tarifas: [E] }),
  hotel({ ...MAD, hotel: 'Catalonia Puerta del Sol', estrellas: 4, habitacion: 'Habitación familiar (2 + 2)', foto: foto('catalonia.jpg'), tarifas: [R] }),
  hotel({ ...MAD, hotel: 'Gran Hotel Inglés', estrellas: 5, habitacion: 'Junior suite familiar', cancelacion: 'No reembolsable', foto: foto('ingles.jpg'), tarifas: [P] }),
  hotel({ ...BCN, hotel: 'Ibis Barcelona Centro (Sagrada Familia)', estrellas: 3, habitacion: 'Habitación triple', foto: foto('ibis_bcn.jpg'), tarifas: [E] }),
  hotel({ ...BCN, hotel: 'H10 Metropolitan', estrellas: 4, foto: foto('h10.jpg'), tarifas: [R] }),
  hotel({ ...BCN, hotel: 'Hotel Majestic', estrellas: 5, habitacion: 'Suite familiar', foto: foto('majestic.jpg'), tarifas: [P] }),
  hotel({ ...PAR, hotel: 'Ibis Paris Tour Eiffel Cambronne', estrellas: 3, foto: foto('ibis_par.jpg'), tarifas: [E] }),
  hotel({ ...PAR, hotel: 'Pullman Paris Tour Eiffel', estrellas: 4, habitacion: 'Habitación familiar deluxe', foto: foto('pullman.jpg'), tarifas: [R] }),
  hotel({ ...PAR, hotel: 'Le Meurice', estrellas: 5, habitacion: 'Suite familiar', cancelacion: 'No reembolsable', foto: foto('meurice.jpg'), tarifas: [P] }),
  hotel({ ...AMS, hotel: 'Ibis Amsterdam Centre', estrellas: 3, foto: foto('ibis_ams.jpg'), tarifas: [E] }),
  hotel({ ...AMS, hotel: 'Park Plaza Victoria', estrellas: 4, habitacion: 'Habitación familiar superior', foto: foto('parkplaza.jpg'), tarifas: [R] }),
  hotel({ ...AMS, hotel: 'Waldorf Astoria Amsterdam', estrellas: 5, habitacion: 'Deluxe familiar vista al canal', cancelacion: 'No reembolsable', foto: foto('waldorf.jpg'), tarifas: [P] }),
]

const linea = (nombre: string, precio: number) => ({ nombre, descripcion: null, precio_venta: precio, descuento_porcentaje: 0, cantidad: 1, unidad: null })

const COMUNES = [
  linea('Trenes AVE, TGV y Eurostar', 3_412_000),
  linea('Traslados entre aeropuertos, estaciones y hoteles', 2_890_500),
  linea('Museo del Prado, Sagrada Familia, Torre Eiffel y canales', 2_869_050),
  linea('Asistencia médica Europa (Schengen)', 611_250),
]
const RECOMENDADA = [linea('Vuelos Air France y Lufthansa', 14_326_000), linea('Hoteles 4 estrellas', 30_105_247), ...COMUNES]
const ECONOMICA = [linea('Vuelos Avianca e Iberia', 11_240_000), linea('Hoteles 3 estrellas', 23_846_324), ...COMUNES]
const PREMIUM = [linea('Vuelos Iberia y KLM', 16_980_000), linea('Hoteles 5 estrellas', 67_672_084), ...COMUNES]
const suma = (l: typeof RECOMENDADA) => l.reduce((a, i) => a + i.precio_venta, 0)
export const PRECIO_R = suma(RECOMENDADA) // 54.214.047
export const PRECIO_E = suma(ECONOMICA) // 44.869.124
export const PRECIO_P = suma(PREMIUM) // 94.434.884

export const VIAJE_EUROPA: ViajePDF = {
  titular: 'Europa en familia: Madrid, Barcelona, París y Ámsterdam',
  intro:
    'Entre ciudades van en tren, como lo pidieron: de centro a centro, sin aeropuertos de por medio. Los hoteles tienen habitación familiar para los cuatro y cuna para la bebé, y los días libres quedan abiertos para que ustedes decidan.',
  incluye: [
    'Tiquetes aéreos de ida y regreso para los cuatro, con impuestos',
    '12 noches de hotel con desayuno en habitación familiar, con cuna',
    'Tres trenes: AVE, TGV y Eurostar',
    'Traslados entre aeropuertos, estaciones y hoteles',
    'Museo del Prado, Sagrada Familia, cumbre de la Torre Eiffel y canales de Ámsterdam',
    'Asistencia médica Europa (Schengen) para los cuatro',
  ],
  antesDeViajar: [
    'Pasaportes vigentes de los cuatro. Colombianos no necesitan visa para el espacio Schengen por menos de 90 días.',
    'Diciembre es frío: entre 0 y 10 °C en París y Ámsterdam. Ropa abrigada.',
    'Lleguen a El Dorado tres horas antes del vuelo internacional.',
  ],
  viajeros: '2 adultos, 1 niño y 1 infante',
  destino: 'Madrid, Barcelona, París, Ámsterdam',
  fechas: '10 – 23 de diciembre de 2026',
  duracion: '14 días · 12 noches',
  presentacion: null,
  foto: null,
  fotosCiudades: [],
  fechaInicio: '2026-12-10',
  vuelos: VUELOS_EUROPA,
  hoteles: HOTELES_EUROPA,
  cargosEnDestino: [
    { ciudad: 'Barcelona', hotel: 'H10 Metropolitan', concepto: 'Tasa turística', monto: '41,28 EUR', observacion: 'Se paga en el hotel.', tarifas: [R] },
    { ciudad: 'París', hotel: 'Ibis Paris Tour Eiffel Cambronne', concepto: 'Tasa de estancia', monto: '18,50 EUR', observacion: 'Se paga en el hotel.', tarifas: [E] },
    { ciudad: 'París', hotel: 'Pullman Paris Tour Eiffel', concepto: 'Tasa de estancia', monto: '46 EUR', observacion: 'Se paga en el hotel.', tarifas: [R] },
  ],
  nivelDetalle: 'normal',
  pie: 'www.agencia.example · contacto@agencia.example · (601) 000 0000 · Bogotá - Colombia',
  firma: { nombre: 'Asesora de Ejemplo', cargo: 'Directora comercial', contacto: 'contacto@agencia.example' },
}

export const TERMINOS_EJEMPLO = [
  'Al realizar el pago, el pasajero declara que conoce y acepta las condiciones de la reserva.',
  'Las tarifas están sujetas a cambios y a disponibilidad al momento de reservar.',
  'Los servicios que no se tomen no son reembolsables.',
  'Medios de pago: transferencia a la cuenta de la agencia, PSE o tarjeta de crédito.',
].join('\n')

export const PROPS_EUROPA: CotizacionPDFProps = {
  cotizacion: {
    consecutivo: 'COT-2026-0026',
    descripcion: 'Europa en familia',
    valor_total: PRECIO_R,
    modo: 'detallada',
    fecha_envio: null,
    fecha_validez: null,
    condiciones_pago: null,
    notas: null,
    descuento_porcentaje: 0,
    descuento_valor: 0,
    terminos_condiciones: TERMINOS_EJEMPLO,
  },
  empresa: { nombre: 'Laura Ocampo', nit: null, contacto_nombre: 'Laura Ocampo', contacto_email: null, telefono: null, direccion: null, ciudad: null },
  vendedor: { nombre: 'Agencia de ejemplo', razon_social: null, nit: null, logo_url: null, color_primario: '#e63380', telefono: null, email: null, direccion: null, ciudad: null },
  items: RECOMENDADA,
  itinerarios: [
    { nombre: 'Recomendada', esPrincipal: true, precio: PRECIO_R, items: RECOMENDADA },
    { nombre: 'Económica', esPrincipal: false, precio: PRECIO_E, items: ECONOMICA },
    { nombre: 'Premium', esPrincipal: false, precio: PRECIO_P, items: PREMIUM },
  ],
  dias: null,
  itemsSinDia: null,
  sugeridos: [
    { nombre: 'Palacio Real de Madrid', descripcion: 'Visita guiada en español por los salones y la Armería real.', precio_venta: 520_000, cantidad: 1, unidad: null },
    { nombre: 'Tour del Bernabéu', descripcion: 'Vestuarios, túnel, museo y trofeos del Real Madrid. Cancelación: gratuita hasta 01/12/2026', precio_venta: 780_000, cantidad: 1, unidad: null },
    { nombre: 'Park Güell con guía', descripcion: 'El dragón de Gaudí, la plaza y las casitas de cuento.', precio_venta: 610_000, cantidad: 1, unidad: null },
    { nombre: 'Aquàrium de Barcelona', descripcion: 'El túnel de tiburones bajo el mar del Port Vell.', precio_venta: 420_000, cantidad: 1, unidad: null },
    { nombre: 'Disneyland Paris', descripcion: 'Un día completo en los dos parques.', precio_venta: 2_031_294, cantidad: 1, unidad: null },
    { nombre: 'El Louvre en familia', descripcion: 'Recorrido corto para niños: la Gioconda, Egipto y las momias.', precio_venta: 890_000, cantidad: 1, unidad: null },
    { nombre: 'Crucero con cena por el Sena', descripcion: 'París iluminada desde el agua, con menú infantil.', precio_venta: 1_150_000, cantidad: 1, unidad: null },
    { nombre: 'Molinos de Zaanse Schans', descripcion: 'Molinos, zuecos y queso a 20 minutos de Ámsterdam.', precio_venta: 690_000, cantidad: 1, unidad: null },
  ],
  preciosPorPasajero: null,
  fiscal: { subtotal: PRECIO_R, iva: 0, reteFuente: 0, reteICA: 0, reteIVA: 0, totalBruto: PRECIO_R, totalRetenciones: 0, teQueda: PRECIO_R },
  negocio: { nombre: 'Europa en familia' },
  emisor: null,
  viaje: VIAJE_EUROPA,
  asiPuedesPagar: { fechaSalida: '2026-12-10', hoy: '2026-10-14', regla: REGLA_POR_DEFECTO },
}

const t = (descripcion: string, fecha: string): ServicioDelDocumento => ({ tipo: 'traslado', descripcion, fecha, hora: null })
const a = (descripcion: string, fecha: string): ServicioDelDocumento => ({ tipo: 'actividad', descripcion, fecha, hora: null })

export const SERVICIOS_EUROPA: ServicioDelDocumento[] = [
  t('Aeropuerto Barajas T4 - hotel · Privado, van con silla de bebé', '11 dic 2026'),
  a('Museo del Prado con guía en español · 2 h · Madrid', '12 dic 2026'),
  t('Hotel - estación Puerta de Atocha · Privado', '14 dic 2026'),
  t('Madrid Atocha - Barcelona Sants · AVE 03071 Renfe, Estándar', '14 dic 2026'),
  t('Barcelona Sants - hotel · Compartido', '14 dic 2026'),
  a('Sagrada Familia con subida a las torres · 1 h 30 · Barcelona', '15 dic 2026'),
  t('Hotel - Barcelona Sants · Compartido', '17 dic 2026'),
  t('Barcelona Sants - Paris Gare de Lyon · TGV INOUI 9714, segunda clase', '17 dic 2026'),
  t('Gare de Lyon - hotel · Privado, con silla de bebé', '17 dic 2026'),
  a('Cumbre de la Torre Eiffel con guía · 2 h · París', '18 dic 2026'),
  t('Hotel - Paris Gare du Nord · Privado', '21 dic 2026'),
  t('Paris Nord - Amsterdam Centraal · Eurostar 9325, Standard', '21 dic 2026'),
  t('Amsterdam Centraal - hotel · Privado, con silla de bebé', '21 dic 2026'),
  a('Paseo en barco por los canales · 1 h 15 · Ámsterdam', '22 dic 2026'),
  t('Hotel - aeropuerto Schiphol · Privado', '23 dic 2026'),
]

/** La entrada completa del modelo, con el anticipo asignado y el WhatsApp de la asesora. */
export const ENTRADA_EUROPA: EntradaModeloPropuesta = {
  props: PROPS_EUROPA,
  servicios: SERVICIOS_EUROPA,
  anticipo: { monto: 5_421_000, texto: 'Con esto les bloqueamos los hoteles y les guardamos esta propuesta por 5 días hábiles.' },
  asesora: { nombre: 'Asesora de Ejemplo', whatsapp: '573000000000' },
}
