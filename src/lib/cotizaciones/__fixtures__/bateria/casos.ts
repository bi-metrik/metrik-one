/**
 * BATERÍA DE REGRESIÓN DE COTIZACIONES (decisión D1 de Mauricio, 2026-10-29: «que ninguna cotización
 * ya armada se dañe»).
 *
 * Cinco cotizaciones SINTÉTICAS, escritas a mano, con la FORMA de las que arma Trappvel: hoteles,
 * empresas, personas, NIT y cifras son inventados. No es un volcado de producción ni se leyó la base
 * para armarlas.
 *
 *  (a) Bloqueo San Andrés: tres paquetes del operador, uno Pública sin comisión y dos Netas, sin
 *      vuelo, régimen «(FULL) Desayuno, Almuer.», todas las casillas de «incluye» marcadas menos el
 *      tiquete, y la cotización con `margen_porcentaje = 0` y `margen_default_pct = 15` (la forma de
 *      la COT-2026-0009). Se arma con las ACCIONES reales del paquete (`crear`/`guardar`), no
 *      sembrando filas: así cualquier arreglo en esas acciones lo ve la batería.
 *  (b) Cancún: vuelo internacional con colchón, tres hoteles Pública (uno por tarifa) y dos traslados
 *      Neta al 5 % propio.
 *  (c) Santa Marta: vuelo, hotel y traslado con costo por tipo de pasajero (adulto, niño, infante),
 *      sin reglas de margen (la cascada de siempre).
 *  (d) Cartagena y Barú: mezcla de Neta y Pública con comisión, con descuento sobre el total.
 *  (e) Medellín: la cotización simple y sana, sin reglas, que hoy sale bien.
 *
 * Cada caso trae lo que DEBE dar según las decisiones D2–D6, calculado a mano con la regla del
 * negocio y no con las funciones del motor (ver `oraculo.ts`): el precio de cada línea según su tipo,
 * qué va al cliente y qué dice el documento.
 *
 * Vive en `__fixtures__` (no es una suite): lo corre `bateria-cotizaciones-e2e.test.ts`.
 */

import { POLITICA_REGLAS_POR_DEFECTO, reglasAJsonb, type DescuentoSobreTotal } from '../../reglas-margen'

export type Fila = Record<string, unknown>

export type ClaveCaso = 'a-bloqueo-san-andres' | 'b-cancun-publicas' | 'c-santa-marta-por-pasajero' | 'd-cartagena-mezcla' | 'e-medellin-sana'

export type TipoLinea = 'vuelo' | 'hotel' | 'paquete' | 'traslado' | 'actividad'

/** Una línea y lo que el negocio dice que debe valer (decisiones D2–D4). */
export interface LineaEsperada {
  /** Cómo se reconoce en la cotización y en el documento (sin mayúsculas ni tildes al comparar). */
  nombre: string
  tipo: TipoLinea
  tarifa: 'neta' | 'publica'
  /** Lo que cobra el proveedor por toda la línea (Neta) o el precio público (Pública). */
  costo: number
  /** Lo que paga el cliente por la línea, ANTES de los descuentos sobre el total. */
  precio: number
  /** Pública: la comisión de la agencia en pesos. `null` = nadie la escribió (D3: no puede salir). */
  comision?: number | null
  /** Tolerancia del precio en pesos: el cuadre por pasajero redondea cada pasajero al peso. */
  tolerancia?: number
}

/** Lo que ve el cliente: una tarifa (o la cotización entera sin tarifas) y sus líneas. */
export interface SujetoEsperado {
  /** Nombre de la tarifa, o `null` = la cotización sin tarifas. */
  tarifa: string | null
  lineas: string[]
}

export interface ViajeDelCaso {
  composicion: { adultos: number; ninos: number; infantes: number }
  fechas: { inicio: string; fin: string }
  destino: string
  edadesMenores: string | null
}

/** Un paquete de bloqueo para la acción real «Guardar paquete». */
export interface PaqueteDelCaso {
  paquete: Fila
  comision: 'incluida' | 'por_incluir'
}

export interface CasoBateria {
  clave: ClaveCaso
  titulo: string
  cotizacionId: string
  negocioId: string
  viaje: ViajeDelCaso
  /** Las tablas para el doble de Supabase. */
  tablas: () => Record<string, Fila[]>
  /** Solo (a): los paquetes que se crean y guardan con las acciones reales, en orden. */
  paquetes?: PaqueteDelCaso[]
  /** (a): después de armar, la cotización queda con este margen (la forma de la COT-2026-0009). */
  margenDeLaCotizacionAlFinal?: number
  lineas: LineaEsperada[]
  sujetos: SujetoEsperado[]
  /** Descuentos sobre el total, en %, que el cliente ve (se aplican a cada sujeto). */
  descuentoTotalPct: number
  pisoPct: number
  /** Los regímenes de alimentación de los hoteles del documento. */
  regimenes: string[]
  /** (a): las categorías de «incluye» marcadas en el paquete (las etiquetas que ve el cliente). */
  incluyeCasillas?: { marcadas: string[]; noMarcadas: string[] }
  /** Días del viaje, contando el de salida y el de regreso. */
  diasDelViaje: number
}

// ── Piezas comunes ───────────────────────────────────────────────────────────

const WS = 'ws-bateria'
export const WORKSPACE_BATERIA = WS
const LINEA = 'linea-viaje-bateria'
const LEIDA_EN = '2026-10-29T13:00:00.000Z'

const campos = (pares: Record<string, string>) => Object.entries(pares).map(([label, valor]) => ({ label, valor }))
const casilla = (nombre: string, total: number, pares: Record<string, string>) =>
  ({ grupo_completo: { nombre, total, moneda: 'COP', leidaEn: LEIDA_EN, campos: campos(pares) } })

type TipoPax = 'adulto' | 'nino' | 'infante'
/** La tarifa por pasajero confirmada, como la deja «Aceptar»: costo por tipo en COP. */
function confirmada(costos: [TipoPax, number, number][], composicion: ViajeDelCaso['composicion']) {
  const filas = costos.map(([tipo, cantidad, unitario]) => ({ tipo, cantidad, unitarioCOP: unitario, totalCOP: cantidad * unitario }))
  return { composicion, costos: filas, costoTotalCOP: filas.reduce((a, f) => a + f.totalCOP, 0), moneda: 'COP', tasa: null, confirmadaEn: LEIDA_EN }
}

const equipaje = { personal: true, mano: true, bodega: true, piezas: { personal: { cantidad: 1, pesoKg: null }, mano: { cantidad: 1, pesoKg: 10 }, bodega: { cantidad: 1, pesoKg: 23 } } }
const tramo = (sentido: 'ida' | 'regreso', origen: string, destino: string, fecha: string, salida: string, llegada: string, numero: string) =>
  ({ sentido, origen, destino, fecha, salida, llegada, numero, escala: null, directo: true, equipaje })

function linea(cot: string, id: string, orden: number, grupo: string, nombre: string, costo: number, extra: Fila = {}): Fila {
  return {
    id, cotizacion_id: cot, nombre, descripcion: null, grupo, opcion_de: null, orden, es_ajuste: false, cantidad: 1,
    subtotal: costo, descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: 0, precio_manual: false, unidad: null,
    tramos: null, tarifa_pax: null, dia_relativo: null, entra_al_precio: true, mostrar_en_sugeridos: true, base_iva: null,
    cargo_destino_valor: null, cargo_destino_moneda: null,
    ...extra,
  }
}

const hotelLeido = (nombre: string, ciudad: string, entrada: string, salida: string, noches: number, regimen: string, total: number) =>
  casilla(nombre, total, { Hotel: nombre, Ciudad: ciudad, 'Check-in': entrada, 'Check-out': salida, Noches: String(noches), Habitación: 'Habitación doble estándar', Régimen: regimen })

const vueloLeido = (nombre: string, aerolinea: string, origen: string, destino: string, total: number) =>
  casilla(nombre, total, { Aerolínea: aerolinea, Origen: origen, Destino: destino, Escalas: '0', Tarifa: 'Classic' })

const publica = (comisionPct?: number) => ({ tipo: 'publica', origen: 'persona', por: 'Asesora de prueba', en: LEIDA_EN, ...(comisionPct !== undefined ? { comisionPct } : {}) })

/** Margen sobre la venta: el precio que deja `m` % del precio (la convención de Trappvel). */
export const conMargen = (costo: number, m: number) => Math.round(costo / (1 - m / 100))

const REGLAS = (descuentos: DescuentoSobreTotal[] = []) => reglasAJsonb({ politica: POLITICA_REGLAS_POR_DEFECTO, puntosExtra: 0, descuentos })

/** Las tablas comunes: la cotización, el negocio de una línea de viaje con el piso en la salida. */
function tablasBase(c: { cot: string; neg: string; consecutivo: string; destino: string; margen: number | null; reglas: Fila | null; items: Fila[]; tarifas?: { id: string; nombre: string; orden: number; va: boolean; seleccion: string[] }[] }): Record<string, Fila[]> {
  const tarifas = c.tarifas ?? []
  return {
    cotizaciones: [{
      id: c.cot, workspace_id: WS, negocio_id: c.neg, oportunidad_id: null, codigo: c.consecutivo, consecutivo: c.consecutivo, modo: 'detallada',
      descripcion: c.destino, estado: 'borrador', valor_total: 0, costo_total: 0, margen_porcentaje: c.margen, margen_default_pct: 15,
      convencion_margen: 'sobre_venta', descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: null, aiu_imprevistos_pct: null,
      piso_margen_pct: 12, aviso_margen_pct: 12, fecha_envio: null, fecha_validez: null, condiciones_pago: null, notas: null,
      lugar_entrega: null, terminos_condiciones: null, tarifa_aceptada_id: null,
      // C6: el texto del cliente revisado (solo el titular) y la marca de «Incluye» armado por ONE con
      // lo que se cobra, como la cotización por pasos.
      documento_cliente: {
        titular: `Su viaje a ${c.destino}`, intro: null, incluye: [], antes_de_viajar: [], origen: 'persona',
        revisado_por: 'p-asesora', revisado_por_nombre: 'Asesora de prueba', revisado_en: LEIDA_EN, incluye_origen: 'one',
      },
      ...(c.reglas ? { reglas_margen: c.reglas } : {}),
    }],
    items: c.items,
    cotizacion_itinerarios: tarifas.map(t => ({ id: t.id, workspace_id: WS, cotizacion_id: c.cot, nombre: t.nombre, orden: t.orden, va_en_propuesta: t.va, es_principal: false, motivo_codigo: null, motivo_texto: null })),
    itinerario_opciones: tarifas.flatMap(t => t.seleccion.map(item_id => ({ itinerario_id: t.id, item_id }))),
    negocios: [{ id: c.neg, workspace_id: WS, linea_id: LINEA, nombre: `PRUEBA ${c.destino.toUpperCase()}`, codigo: 'P 26 1', carpeta_url: null, empresa_id: null, contacto_id: null, precio_aprobado: null, etapa_actual_id: 'e-cotizacion' }],
    lineas_negocio: [{ id: LINEA, config_extra: { margen: { convencion: 'sobre_venta', default_pct: 15, piso_pct: 12, aviso_pct: 12 } } }],
    // El piso se exige en la SALIDA (gate `margen_sobre_piso`), como en Trappvel.
    etapas_negocio: [{ id: 'e-cotizacion', linea_id: LINEA, orden: 2, config_extra: { gates: ['margen_sobre_piso'] } }],
    // Una tarifa por pasajero confirmada deja su costo en un rubro confirmado, como «Aceptar».
    rubros: c.items
      .filter(i => (i.tarifa_pax as { confirmada?: unknown } | null)?.confirmada)
      .map(i => ({ id: `r-${i.id}`, item_id: i.id, tipo: 'servicios_prof', descripcion: i.nombre, cantidad: 1, unidad: 'servicio', valor_unitario: i.subtotal, valor_total: i.subtotal, sugerido: false })),
    negocio_bloques: [], bloque_configs: [], item_adicionales: [], activity_log: [], decisiones_combinacion: [],
    cotizacion_excepciones_margen: [], cotizacion_ranuras: [], cobros: [],
    profiles: [{ id: 'p-asesora', workspace_id: WS, role: 'operator', full_name: 'Asesora de prueba', platform_admin: false }],
    staff: [{ id: 's-asesora', full_name: 'Asesora de prueba', position: 'Asesora', phone_whatsapp: '300 000 0000' }],
    workspaces: [{ id: WS, name: 'Agencia de prueba', logo_url: null, color_primario: null, cotizacion_template_slug: 'trappvel', config_extra: { documento_viaje: { motor: 'html' } } }],
    empresas: [], contactos: [],
    fiscal_profiles: [{ workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: false, is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true, nit: '900000000', razon_social: 'AGENCIA DE PRUEBA S.A.S' }],
    fotos_perfiles: [], fotos_perfiles_alias: [], fotos_catalogo: [],
  }
}

// ── (a) Bloqueo San Andrés ───────────────────────────────────────────────────

const REGIMEN_FULL = '(FULL) Desayuno, Almuer.'

function paqueteSanAndres(hotel: string, precioPorPersonaDoble: number): Fila {
  return {
    version: 1,
    operador: 'Operador Ficticio',
    hotel: {
      hotel, zona: 'San Andrés', noches: 5, habitacion: 'Estándar', planAlimentacion: REGIMEN_FULL, temporada: null,
      tarifaPromo: false, compraAntesDe: null, moneda: 'COP', precios: [{ acomodacion: 'doble', precioPorPersona: precioPorPersonaDoble }], nino: null, infante: null,
    },
    vuelo: null,
    salidaManual: null,
    incluye: { casillas: { tiquete_aereo: false, alimentacion: true, planes_tours: true, traslados: true, seguro_medico: true }, sinIdentificar: [], texto: null },
    distribucion: { habitaciones: { doble: 2 }, ninos: 0, infantes: 0, edadesNinos: [] },
    imagenes: { hotel: null, vuelo: null },
  }
}

const A_COT = 'cot-bateria-a'
const CASO_A: CasoBateria = {
  clave: 'a-bloqueo-san-andres',
  titulo: '(a) bloqueo San Andrés: 3 paquetes, uno Pública sin comisión, margen de la cotización en 0',
  cotizacionId: A_COT,
  negocioId: 'neg-bateria-a',
  viaje: { composicion: { adultos: 4, ninos: 0, infantes: 0 }, fechas: { inicio: '2026-12-10', fin: '2026-12-15' }, destino: 'San Andrés', edadesMenores: null },
  tablas: () => tablasBase({ cot: A_COT, neg: 'neg-bateria-a', consecutivo: 'COT-2026-9101', destino: 'San Andrés', margen: null, reglas: REGLAS(), items: [] }),
  paquetes: [
    { paquete: paqueteSanAndres('Hotel Arena Ficticio', 1_500_000), comision: 'incluida' },
    { paquete: paqueteSanAndres('Hotel Coral Ficticio', 1_800_000), comision: 'por_incluir' },
    { paquete: paqueteSanAndres('Hotel Palma Ficticio', 2_100_000), comision: 'por_incluir' },
  ],
  margenDeLaCotizacionAlFinal: 0,
  lineas: [
    // Pública: el cliente paga el precio público; la comisión nadie la escribió (D3).
    { nombre: 'Hotel Arena Ficticio', tipo: 'paquete', tarifa: 'publica', costo: 6_000_000, precio: 6_000_000, comision: null },
    // Netas: el 0 de la cotización no lo escribió nadie a propósito: manda el 15 de la línea (D4).
    { nombre: 'Hotel Coral Ficticio', tipo: 'paquete', tarifa: 'neta', costo: 7_200_000, precio: conMargen(7_200_000, 15) },
    { nombre: 'Hotel Palma Ficticio', tipo: 'paquete', tarifa: 'neta', costo: 8_400_000, precio: conMargen(8_400_000, 15) },
  ],
  // D5: cada paquete que la asesora incluye sale al cliente como su propia opción.
  sujetos: [
    { tarifa: null, lineas: ['Hotel Arena Ficticio'] },
    { tarifa: null, lineas: ['Hotel Coral Ficticio'] },
    { tarifa: null, lineas: ['Hotel Palma Ficticio'] },
  ],
  descuentoTotalPct: 0,
  pisoPct: 12,
  regimenes: [REGIMEN_FULL, REGIMEN_FULL, REGIMEN_FULL],
  incluyeCasillas: { marcadas: ['Alimentación', 'Planes / tours', 'Traslados', 'Seguro médico'], noMarcadas: ['Tiquete aéreo'] },
  diasDelViaje: 6,
}

// ── (b) Cancún: vuelo internacional, hoteles Pública, traslados Neta al 5 % ─

const B_COT = 'cot-bateria-b'
const B_VIAJE: ViajeDelCaso = { composicion: { adultos: 2, ninos: 0, infantes: 0 }, fechas: { inicio: '2026-11-14', fin: '2026-11-21' }, destino: 'Cancún', edadesMenores: null }
const B_ITEMS = (): Fila[] => [
  linea(B_COT, 'b-vuelo', 1, 'vuelo: Vuelo Bogotá ⇄ Cancún', 'AVIONES FICTICIOS BOGOTÁ ⇄ CANCÚN', 4_800_000, {
    tarifa_pax: { casillas: vueloLeido('Aviones Ficticios Bogotá ⇄ Cancún', 'Aviones Ficticios', 'Bogotá BOG', 'Cancún CUN', 4_800_000), confirmada: confirmada([['adulto', 2, 2_400_000]], B_VIAJE.composicion) },
    tramos: [tramo('ida', 'Bogotá BOG', 'Cancún CUN', '2026-11-14', '07:10', '11:05', 'AF 101'), tramo('regreso', 'Cancún CUN', 'Bogotá BOG', '2026-11-21', '12:30', '16:20', 'AF 102')],
  }),
  linea(B_COT, 'b-laguna', 2, 'hotel: Hotel en Cancún', 'HOTEL LAGUNA FICTICIO', 7_000_000, {
    margen_porcentaje: 0,
    tarifa_pax: { casillas: hotelLeido('Hotel Laguna Ficticio', 'Cancún', '2026-11-14', '2026-11-21', 7, 'Todo incluido', 7_000_000), tipoTarifa: publica() },
  }),
  linea(B_COT, 'b-coral-azul', 3, 'hotel: Hotel en Cancún', 'HOTEL CORAL AZUL FICTICIO', 5_600_000, {
    margen_porcentaje: 0,
    tarifa_pax: { casillas: hotelLeido('Hotel Coral Azul Ficticio', 'Cancún', '2026-11-14', '2026-11-21', 7, 'Todo incluido', 5_600_000), tipoTarifa: publica() },
  }),
  linea(B_COT, 'b-gran-palmar', 4, 'hotel: Hotel en Cancún', 'HOTEL GRAN PALMAR FICTICIO', 9_800_000, {
    margen_porcentaje: 0,
    tarifa_pax: { casillas: hotelLeido('Hotel Gran Palmar Ficticio', 'Cancún', '2026-11-14', '2026-11-21', 7, 'Todo incluido', 9_800_000), tipoTarifa: publica() },
  }),
  linea(B_COT, 'b-traslado-llegada', 5, 'traslado: Traslado en Cancún', 'AEROPUERTO CANCÚN - HOTEL', 180_000, { margen_porcentaje: 5 }),
  linea(B_COT, 'b-traslado-salida', 6, 'traslado 2: Traslado en Cancún', 'HOTEL - AEROPUERTO CANCÚN', 180_000, { margen_porcentaje: 5 }),
]
const B_COMUNES = ['Aviones Ficticios Bogotá ⇄ Cancún', 'Aeropuerto Cancún - hotel', 'Hotel - aeropuerto Cancún']
const CASO_B: CasoBateria = {
  clave: 'b-cancun-publicas',
  titulo: '(b) Cancún: vuelo internacional + 3 hoteles Pública sin comisión + 2 traslados Neta al 5 %',
  cotizacionId: B_COT,
  negocioId: 'neg-bateria-b',
  viaje: B_VIAJE,
  tablas: () => tablasBase({
    cot: B_COT, neg: 'neg-bateria-b', consecutivo: 'COT-2026-9102', destino: 'Cancún', margen: 15, reglas: REGLAS(), items: B_ITEMS(),
    tarifas: [
      { id: 'b-economica', nombre: 'Económica', orden: 1, va: true, seleccion: ['b-coral-azul'] },
      { id: 'b-recomendada', nombre: 'Recomendada', orden: 2, va: true, seleccion: ['b-laguna'] },
      { id: 'b-premium', nombre: 'Premium', orden: 3, va: true, seleccion: ['b-gran-palmar'] },
    ],
  }),
  lineas: [
    // Colchón internacional: 5 % de $2.400.000 = $120.000 por tiquete, entre $60.000 y $200.000.
    { nombre: 'Aviones Ficticios Bogotá ⇄ Cancún', tipo: 'vuelo', tarifa: 'neta', costo: 4_800_000, precio: 4_800_000 + 2 * 120_000 },
    { nombre: 'Hotel Laguna Ficticio', tipo: 'hotel', tarifa: 'publica', costo: 7_000_000, precio: 7_000_000, comision: null },
    { nombre: 'Hotel Coral Azul Ficticio', tipo: 'hotel', tarifa: 'publica', costo: 5_600_000, precio: 5_600_000, comision: null },
    { nombre: 'Hotel Gran Palmar Ficticio', tipo: 'hotel', tarifa: 'publica', costo: 9_800_000, precio: 9_800_000, comision: null },
    { nombre: 'Aeropuerto Cancún - hotel', tipo: 'traslado', tarifa: 'neta', costo: 180_000, precio: conMargen(180_000, 5) },
    { nombre: 'Hotel - aeropuerto Cancún', tipo: 'traslado', tarifa: 'neta', costo: 180_000, precio: conMargen(180_000, 5) },
  ],
  sujetos: [
    { tarifa: 'Económica', lineas: [...B_COMUNES, 'Hotel Coral Azul Ficticio'] },
    { tarifa: 'Recomendada', lineas: [...B_COMUNES, 'Hotel Laguna Ficticio'] },
    { tarifa: 'Premium', lineas: [...B_COMUNES, 'Hotel Gran Palmar Ficticio'] },
  ],
  descuentoTotalPct: 0,
  pisoPct: 12,
  regimenes: ['Todo incluido', 'Todo incluido', 'Todo incluido'],
  diasDelViaje: 8,
}

// ── (c) Santa Marta: costo por tipo de pasajero, sin reglas ─────────────────

const C_COT = 'cot-bateria-c'
const C_VIAJE: ViajeDelCaso = { composicion: { adultos: 2, ninos: 1, infantes: 1 }, fechas: { inicio: '2026-12-27', fin: '2027-01-02' }, destino: 'Santa Marta', edadesMenores: '7, 1' }
const C_ITEMS = (): Fila[] => [
  linea(C_COT, 'c-vuelo', 1, 'vuelo: Vuelo Bogotá ⇄ Santa Marta', 'AVIONES FICTICIOS BOGOTÁ ⇄ SANTA MARTA', 1_570_000, {
    tarifa_pax: { casillas: vueloLeido('Aviones Ficticios Bogotá ⇄ Santa Marta', 'Aviones Ficticios', 'Bogotá BOG', 'Santa Marta SMR', 1_570_000), confirmada: confirmada([['adulto', 2, 520_000], ['nino', 1, 450_000], ['infante', 1, 80_000]], C_VIAJE.composicion) },
    tramos: [tramo('ida', 'Bogotá BOG', 'Santa Marta SMR', '2026-12-27', '08:00', '09:30', 'AF 301'), tramo('regreso', 'Santa Marta SMR', 'Bogotá BOG', '2027-01-02', '15:00', '16:30', 'AF 302')],
  }),
  linea(C_COT, 'c-sierra', 2, 'hotel: Hotel en Santa Marta', 'HOTEL SIERRA FICTICIO', 3_000_000, {
    tarifa_pax: { casillas: hotelLeido('Hotel Sierra Ficticio', 'Santa Marta', '2026-12-27', '2027-01-02', 6, 'Alojamiento y desayuno', 3_000_000), confirmada: confirmada([['adulto', 2, 1_200_000], ['nino', 1, 600_000], ['infante', 1, 0]], C_VIAJE.composicion) },
  }),
  linea(C_COT, 'c-traslado', 3, 'traslado: Traslado en Santa Marta', 'AEROPUERTO - HOTEL - AEROPUERTO SANTA MARTA', 210_000, {
    tarifa_pax: { confirmada: confirmada([['adulto', 2, 70_000], ['nino', 1, 70_000], ['infante', 1, 0]], C_VIAJE.composicion) },
  }),
]
const CASO_C: CasoBateria = {
  clave: 'c-santa-marta-por-pasajero',
  titulo: '(c) Santa Marta: hotel, vuelo y traslado por tipo de pasajero (adulto/niño/infante), sin reglas',
  cotizacionId: C_COT,
  negocioId: 'neg-bateria-c',
  viaje: C_VIAJE,
  tablas: () => tablasBase({ cot: C_COT, neg: 'neg-bateria-c', consecutivo: 'COT-2026-9103', destino: 'Santa Marta', margen: 15, reglas: null, items: C_ITEMS() }),
  lineas: [
    { nombre: 'Aviones Ficticios Bogotá ⇄ Santa Marta', tipo: 'vuelo', tarifa: 'neta', costo: 1_570_000, precio: conMargen(1_570_000, 15), tolerancia: 10 },
    { nombre: 'Hotel Sierra Ficticio', tipo: 'hotel', tarifa: 'neta', costo: 3_000_000, precio: conMargen(3_000_000, 15), tolerancia: 10 },
    { nombre: 'Aeropuerto - hotel - aeropuerto Santa Marta', tipo: 'traslado', tarifa: 'neta', costo: 210_000, precio: conMargen(210_000, 15), tolerancia: 10 },
  ],
  sujetos: [{ tarifa: null, lineas: ['Aviones Ficticios Bogotá ⇄ Santa Marta', 'Hotel Sierra Ficticio', 'Aeropuerto - hotel - aeropuerto Santa Marta'] }],
  descuentoTotalPct: 0,
  pisoPct: 12,
  regimenes: ['Alojamiento y desayuno'],
  diasDelViaje: 7,
}

// ── (d) Cartagena y Barú: Neta + Pública con comisión, descuento sobre el total ─

const D_COT = 'cot-bateria-d'
const D_VIAJE: ViajeDelCaso = { composicion: { adultos: 2, ninos: 0, infantes: 0 }, fechas: { inicio: '2027-02-05', fin: '2027-02-09' }, destino: 'Cartagena', edadesMenores: null }
const D_ITEMS = (): Fila[] => [
  linea(D_COT, 'd-vuelo', 1, 'vuelo: Vuelo Bogotá ⇄ Cartagena', 'AVIONES FICTICIOS BOGOTÁ ⇄ CARTAGENA', 900_000, {
    tarifa_pax: { casillas: vueloLeido('Aviones Ficticios Bogotá ⇄ Cartagena', 'Aviones Ficticios', 'Bogotá BOG', 'Cartagena CTG', 900_000), confirmada: confirmada([['adulto', 2, 450_000]], D_VIAJE.composicion) },
    tramos: [tramo('ida', 'Bogotá BOG', 'Cartagena CTG', '2027-02-05', '06:00', '07:25', 'AF 401'), tramo('regreso', 'Cartagena CTG', 'Bogotá BOG', '2027-02-09', '19:00', '20:25', 'AF 402')],
  }),
  linea(D_COT, 'd-murallas', 2, 'hotel: Hotel en Cartagena', 'HOTEL MURALLAS FICTICIO', 2_400_000, {
    margen_porcentaje: 0,
    tarifa_pax: { casillas: hotelLeido('Hotel Murallas Ficticio', 'Cartagena', '2027-02-05', '2027-02-07', 2, 'Alojamiento y desayuno', 2_400_000), tipoTarifa: publica(20) },
  }),
  linea(D_COT, 'd-baru', 3, 'hotel 2: Hotel en Barú', 'HOTEL BARÚ FICTICIO', 1_700_000, {
    tarifa_pax: { casillas: hotelLeido('Hotel Barú Ficticio', 'Barú', '2027-02-07', '2027-02-09', 2, 'Solo alojamiento', 1_700_000) },
  }),
  linea(D_COT, 'd-rosario', 4, 'actividad: Islas del Rosario', 'TOUR ISLAS DEL ROSARIO', 500_000, { margen_porcentaje: 20, dia_relativo: 3 }),
]
const D_DESCUENTO: DescuentoSobreTotal = { id: 'frecuente', descripcion: 'Cliente frecuente', pct: 5 }
const CASO_D: CasoBateria = {
  clave: 'd-cartagena-mezcla',
  titulo: '(d) Cartagena y Barú: Neta + Pública con comisión 20 %, descuento del 5 % sobre el total',
  cotizacionId: D_COT,
  negocioId: 'neg-bateria-d',
  viaje: D_VIAJE,
  tablas: () => tablasBase({ cot: D_COT, neg: 'neg-bateria-d', consecutivo: 'COT-2026-9104', destino: 'Cartagena', margen: 15, reglas: REGLAS([D_DESCUENTO]), items: D_ITEMS() }),
  lineas: [
    // Colchón nacional: 10 % de $450.000 = $45.000 por tiquete, entre $30.000 y $80.000.
    { nombre: 'Aviones Ficticios Bogotá ⇄ Cartagena', tipo: 'vuelo', tarifa: 'neta', costo: 900_000, precio: 900_000 + 2 * 45_000 },
    // Pública con comisión del 20 %: el cliente paga el precio público, la agencia paga 80 %.
    { nombre: 'Hotel Murallas Ficticio', tipo: 'hotel', tarifa: 'publica', costo: 2_400_000, precio: 2_400_000, comision: 480_000 },
    { nombre: 'Hotel Barú Ficticio', tipo: 'hotel', tarifa: 'neta', costo: 1_700_000, precio: conMargen(1_700_000, 15) },
    { nombre: 'Tour Islas del Rosario', tipo: 'actividad', tarifa: 'neta', costo: 500_000, precio: conMargen(500_000, 20) },
  ],
  sujetos: [{ tarifa: null, lineas: ['Aviones Ficticios Bogotá ⇄ Cartagena', 'Hotel Murallas Ficticio', 'Hotel Barú Ficticio', 'Tour Islas del Rosario'] }],
  descuentoTotalPct: 5,
  pisoPct: 12,
  regimenes: ['Alojamiento y desayuno', 'Solo alojamiento'],
  diasDelViaje: 5,
}

// ── (e) Medellín: la cotización sana ─────────────────────────────────────────

const E_COT = 'cot-bateria-e'
const E_VIAJE: ViajeDelCaso = { composicion: { adultos: 2, ninos: 0, infantes: 0 }, fechas: { inicio: '2026-11-06', fin: '2026-11-09' }, destino: 'Medellín', edadesMenores: null }
const E_ITEMS = (): Fila[] => [
  linea(E_COT, 'e-vuelo', 1, 'vuelo: Vuelo Bogotá ⇄ Medellín', 'AVIONES FICTICIOS BOGOTÁ ⇄ MEDELLÍN', 700_000, {
    tarifa_pax: { casillas: vueloLeido('Aviones Ficticios Bogotá ⇄ Medellín', 'Aviones Ficticios', 'Bogotá BOG', 'Medellín MDE', 700_000) },
    tramos: [tramo('ida', 'Bogotá BOG', 'Medellín MDE', '2026-11-06', '09:00', '10:00', 'AF 501'), tramo('regreso', 'Medellín MDE', 'Bogotá BOG', '2026-11-09', '18:00', '19:00', 'AF 502')],
  }),
  linea(E_COT, 'e-poblado', 2, 'hotel: Hotel en Medellín', 'HOTEL POBLADO FICTICIO', 1_500_000, {
    tarifa_pax: { casillas: hotelLeido('Hotel Poblado Ficticio', 'Medellín', '2026-11-06', '2026-11-09', 3, 'Alojamiento y desayuno', 1_500_000) },
  }),
]
const CASO_E: CasoBateria = {
  clave: 'e-medellin-sana',
  titulo: '(e) Medellín: vuelo + hotel Neta al 15 %, sin reglas (sana)',
  cotizacionId: E_COT,
  negocioId: 'neg-bateria-e',
  viaje: E_VIAJE,
  tablas: () => tablasBase({ cot: E_COT, neg: 'neg-bateria-e', consecutivo: 'COT-2026-9105', destino: 'Medellín', margen: 15, reglas: null, items: E_ITEMS() }),
  lineas: [
    { nombre: 'Aviones Ficticios Bogotá ⇄ Medellín', tipo: 'vuelo', tarifa: 'neta', costo: 700_000, precio: conMargen(700_000, 15) },
    { nombre: 'Hotel Poblado Ficticio', tipo: 'hotel', tarifa: 'neta', costo: 1_500_000, precio: conMargen(1_500_000, 15) },
  ],
  sujetos: [{ tarifa: null, lineas: ['Aviones Ficticios Bogotá ⇄ Medellín', 'Hotel Poblado Ficticio'] }],
  descuentoTotalPct: 0,
  pisoPct: 12,
  regimenes: ['Alojamiento y desayuno'],
  diasDelViaje: 4,
}

export const CASOS: readonly CasoBateria[] = [CASO_A, CASO_B, CASO_C, CASO_D, CASO_E]
