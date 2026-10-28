/**
 * Lo que se le pide al modelo de los DOS pantallazos de un paquete de bloqueo, y cómo se sanea lo que
 * devuelve (brief del 2026-10-27, puntos 3 y 4). Puro: la llamada vive en `bloqueo-leer.ts`.
 *
 * ## Por qué no depende de la maqueta de Aliados
 *
 * El formato de Tu Reserva todavía no se ha visto. El prompt describe QUÉ datos buscar (hotel, tabla de
 * precios por persona, niño, íconos de lo que incluye; tramos del vuelo), no DÓNDE están en la página de
 * Aliados. Los íconos cambian de un operador a otro (Mauricio, 2026-10-27): no hay leyenda fija ni
 * comparación contra una plantilla; el modelo interpreta cada ícono y lo lleva a una de las cinco
 * categorías. Lo que no encaja con certeza queda como «ícono sin identificar» y lo clasifica la asesora;
 * NUNCA se marca como incluido por defecto. Sin íconos en la pantalla, todas las casillas quedan vacías.
 */

import {
  ACOMODACIONES,
  CATEGORIAS_INCLUYE,
  casillasVacias,
  esAcomodacion,
  esCategoriaIncluye,
  fechaIso,
  horaHHMM,
  montoPositivo,
  textoCorto,
  type CategoriaIncluye,
  type HotelBloqueo,
  type IncluyeBloqueo,
  type PrecioAcomodacion,
  type TramoBloqueo,
  type VueloBloqueo,
} from './bloqueo-paquete'

// ── Hotel ─────────────────────────────────────────────────────────────────────

export const PROMPT_HOTEL_BLOQUEO = [
  'Eres el lector de pantallazos de una agencia de viajes colombiana. La imagen es la oferta de un HOTEL dentro de un',
  'paquete de BLOQUEO de un operador mayorista (cupo fijo de vuelo + hotel para fechas cerradas). El precio es POR',
  'PERSONA y ya incluye lo que muestren los íconos. Lee SOLO lo que se ve; lo que no se vea va en null. No inventes.',
  '',
  'Devuelve:',
  '- es_oferta_de_hotel: false si la imagen no es la oferta de un hotel (por ejemplo, es un vuelo).',
  '- hotel, zona (el barrio o zona que muestre, sin la palabra «Zona»), noches (número), habitacion (la habitación',
  '  elegida, tal cual), plan_alimentacion (el plan elegido, tal cual; si está cortado, lo que se lea).',
  '- temporada: tal cual (ej. «Baja | Regular»). tarifa_promo: true si la pantalla marca la tarifa como promoción.',
  '- compra_antes_de: si dice «Compra antes del <fecha>», esa fecha en AAAA-MM-DD; si no, null.',
  '- moneda: código ISO (COP si muestra pesos con $ sin otra marca).',
  '- precios_por_persona: UNA entrada por cada acomodación que aparezca con su precio (sencilla, doble, triple,',
  '  cuadruple). Solo las que aparezcan: si no hay cuádruple, no la pongas. precio = el número sin puntos ni símbolo.',
  '  No confundas los botones de «+ N PAX» con precios.',
  '- nino: el precio por niño (CHD, menor) y su rango de edad en años (ej. «CHD 02-11» → edad_min 2, edad_max 11). null si',
  '  no aparece.',
  '- iconos: CADA ícono de la fila de servicios incluidos (pequeños dibujos junto al hotel), en orden. Para cada uno:',
  '  descripcion (qué dibujo es, en pocas palabras) y categoria, una de: tiquete_aereo (avión, tiquete, pasabordo),',
  '  alimentacion (cubiertos, plato, copa), planes_tours (lancha, barco, cámara, tour, mapa, actividad), traslados',
  '  (bus, van, carro, transfer), seguro_medico (maletín o cruz médica, escudo de salud). Si un ícono no encaja con',
  '  certeza en una de las cinco, categoria = sin_identificar. Los íconos cambian de un operador a otro: interpreta el',
  '  dibujo, no supongas una leyenda. seguro = true solo si estás seguro de la categoría.',
  '  NO cuentes como íconos de servicios las estrellas, el logo del operador, ni los íconos de ubicación.',
  '  Si no hay ninguna fila de íconos, iconos = [].',
  '- texto_incluye: el texto de la pantalla que diga qué incluye (ej. «Receptivos… traslados in y out»), tal cual;',
  '  null si no hay.',
  '- incluye_por_texto: las categorías (de las cinco) que ese texto dice EXPLÍCITAMENTE que incluye. [] si ninguna.',
].join('\n')

const NULO = { nullable: true }

export const ESQUEMA_HOTEL_BLOQUEO = {
  type: 'object',
  properties: {
    es_oferta_de_hotel: { type: 'boolean' },
    hotel: { type: 'string', ...NULO },
    zona: { type: 'string', ...NULO },
    noches: { type: 'integer', ...NULO },
    habitacion: { type: 'string', ...NULO },
    plan_alimentacion: { type: 'string', ...NULO },
    temporada: { type: 'string', ...NULO },
    tarifa_promo: { type: 'boolean', ...NULO },
    compra_antes_de: { type: 'string', ...NULO },
    moneda: { type: 'string', ...NULO },
    precios_por_persona: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          acomodacion: { type: 'string', enum: [...ACOMODACIONES] },
          precio: { type: 'number', ...NULO },
        },
        required: ['acomodacion', 'precio'],
      },
    },
    nino: {
      type: 'object',
      ...NULO,
      properties: {
        precio: { type: 'number', ...NULO },
        edad_min: { type: 'integer', ...NULO },
        edad_max: { type: 'integer', ...NULO },
      },
    },
    iconos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          descripcion: { type: 'string' },
          categoria: { type: 'string', enum: [...CATEGORIAS_INCLUYE, 'sin_identificar'] },
          seguro: { type: 'boolean' },
        },
        required: ['descripcion', 'categoria', 'seguro'],
      },
    },
    texto_incluye: { type: 'string', ...NULO },
    incluye_por_texto: { type: 'array', items: { type: 'string', enum: [...CATEGORIAS_INCLUYE] } },
  },
  required: ['es_oferta_de_hotel', 'precios_por_persona', 'iconos', 'incluye_por_texto'],
} as const

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

function entero(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return null
  const e = Math.round(n)
  return e >= min && e <= max ? e : null
}

/** «Cuádruple», «quadruple», «Triple» → la acomodación canónica. */
function acomodacionDe(v: unknown): PrecioAcomodacion['acomodacion'] | null {
  if (esAcomodacion(v)) return v
  if (typeof v !== 'string') return null
  const t = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  if (/^(sencill|single|sgl)/.test(t)) return 'sencilla'
  if (/^(dobl|double|dbl)/.test(t)) return 'doble'
  if (/^(tripl|tpl)/.test(t)) return 'triple'
  if (/^(cuadrup|quadrup|cpl|qua)/.test(t)) return 'cuadruple'
  return null
}

/**
 * Qué incluye, de los íconos y del texto que los acompaña.
 *
 *  · Sin íconos y sin texto: las cinco casillas vacías (`null`). No se adivina.
 *  · Con íconos: lo que no tiene ícono es NO incluido (`false`); cada ícono seguro de su categoría la marca.
 *    El que no encaja con certeza va a `sinIdentificar` y NO marca nada.
 *  · El texto que dice explícitamente que incluye algo («traslados in y out») marca esa categoría.
 */
export function incluyeDesdeLectura(raw: unknown): IncluyeBloqueo {
  const r = esObj(raw) ? raw : {}
  const iconos = (Array.isArray(r.iconos) ? r.iconos : []).filter(esObj).slice(0, 12)
  const porTexto = (Array.isArray(r.incluye_por_texto) ? r.incluye_por_texto : []).filter(esCategoriaIncluye) as CategoriaIncluye[]
  const casillas = casillasVacias()
  const sinIdentificar: IncluyeBloqueo['sinIdentificar'] = []
  if (iconos.length > 0) {
    for (const c of CATEGORIAS_INCLUYE) casillas[c] = false
    for (const i of iconos) {
      if (esCategoriaIncluye(i.categoria) && i.seguro === true) casillas[i.categoria] = true
      else sinIdentificar.push({ descripcion: textoCorto(i.descripcion, 120) ?? 'Ícono', categoria: null })
    }
  }
  for (const c of porTexto) casillas[c] = true
  return { casillas, sinIdentificar, texto: textoCorto(r.texto_incluye, 400) }
}

export type LecturaHotelBloqueo =
  | { ok: true; hotel: HotelBloqueo; incluye: IncluyeBloqueo }
  | { ok: false; motivo: string }

/** Lo que devolvió el modelo para el pantallazo del hotel, saneado. */
export function hotelDesdeLectura(raw: unknown): LecturaHotelBloqueo {
  if (!esObj(raw)) return { ok: false, motivo: 'La lectura no trajo nada legible. Vuelve a intentarlo.' }
  if (raw.es_oferta_de_hotel === false) {
    return { ok: false, motivo: 'Ese pantallazo no parece la oferta de un hotel. Pégalo en la casilla del vuelo, o pega el del hotel.' }
  }
  const vistas = new Set<string>()
  const precios: PrecioAcomodacion[] = []
  for (const p of Array.isArray(raw.precios_por_persona) ? raw.precios_por_persona : []) {
    if (!esObj(p)) continue
    const a = acomodacionDe(p.acomodacion)
    if (!a || vistas.has(a)) continue
    vistas.add(a)
    precios.push({ acomodacion: a, precioPorPersona: montoPositivo(p.precio) })
  }
  const n = esObj(raw.nino) ? raw.nino : null
  const nino = n ? { precio: montoPositivo(n.precio), edadMin: entero(n.edad_min, 0, 17), edadMax: entero(n.edad_max, 0, 17) } : null
  const hotel: HotelBloqueo = {
    hotel: textoCorto(raw.hotel),
    zona: textoCorto(typeof raw.zona === 'string' ? raw.zona.replace(/^\s*zona\s+/i, '') : raw.zona),
    noches: entero(raw.noches, 1, 60),
    habitacion: textoCorto(raw.habitacion),
    planAlimentacion: textoCorto(raw.plan_alimentacion, 200),
    temporada: textoCorto(raw.temporada, 60),
    tarifaPromo: raw.tarifa_promo === true,
    compraAntesDe: fechaIso(raw.compra_antes_de),
    moneda: (textoCorto(raw.moneda, 3) ?? 'COP').toUpperCase(),
    precios,
    nino: nino && (nino.precio !== null || nino.edadMin !== null || nino.edadMax !== null) ? nino : null,
  }
  return { ok: true, hotel, incluye: incluyeDesdeLectura(raw) }
}

// ── Vuelo ─────────────────────────────────────────────────────────────────────

export const PROMPT_VUELO_BLOQUEO = [
  'Eres el lector de pantallazos de una agencia de viajes colombiana. La imagen muestra los VUELOS de un paquete de',
  'bloqueo (ida y regreso, a veces más tramos). Los vuelos ya están dentro del precio del paquete: NO busques precios.',
  'Lee SOLO lo que se ve; lo que no se vea va en null. No inventes.',
  '',
  'Devuelve:',
  '- es_vuelo: false si la imagen no muestra vuelos (por ejemplo, es la oferta de un hotel).',
  '- tramos: UNO por cada vuelo, en el orden en que aparecen. Para cada uno:',
  '  aerolinea (nombre o código que se lea en el logo o el texto; null si no se lee), numero_vuelo (solo el número o',
  '  código, sin la palabra «vuelo»), origen y destino (el código de 3 letras o la ciudad, tal cual), fecha (la de',
  '  salida, AAAA-MM-DD; si no muestra el año, null), hora_salida y hora_llegada (HH:MM, 24 horas),',
  '  fecha_llegada (AAAA-MM-DD), directo (true si dice directo o sin escalas; false si dice escalas),',
  '  escalas (número de escalas; 0 si es directo; null si no se ve).',
].join('\n')

export const ESQUEMA_VUELO_BLOQUEO = {
  type: 'object',
  properties: {
    es_vuelo: { type: 'boolean' },
    tramos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          aerolinea: { type: 'string', ...NULO },
          numero_vuelo: { type: 'string', ...NULO },
          origen: { type: 'string', ...NULO },
          destino: { type: 'string', ...NULO },
          fecha: { type: 'string', ...NULO },
          hora_salida: { type: 'string', ...NULO },
          hora_llegada: { type: 'string', ...NULO },
          fecha_llegada: { type: 'string', ...NULO },
          directo: { type: 'boolean', ...NULO },
          escalas: { type: 'integer', ...NULO },
        },
      },
    },
  },
  required: ['es_vuelo', 'tramos'],
} as const

export type LecturaVueloBloqueo =
  | { ok: true; vuelo: VueloBloqueo }
  | { ok: false; motivo: string }

/** Lo que devolvió el modelo para el pantallazo del vuelo, saneado. */
export function vueloDesdeLectura(raw: unknown): LecturaVueloBloqueo {
  if (!esObj(raw)) return { ok: false, motivo: 'La lectura no trajo nada legible. Vuelve a intentarlo.' }
  if (raw.es_vuelo === false) {
    return { ok: false, motivo: 'Ese pantallazo no parece de vuelos. Pégalo en la casilla del hotel, o pega el del vuelo.' }
  }
  const tramos: TramoBloqueo[] = []
  for (const t of Array.isArray(raw.tramos) ? raw.tramos : []) {
    if (!esObj(t)) continue
    const numero = textoCorto(typeof t.numero_vuelo === 'string' ? t.numero_vuelo.replace(/^\s*vuelo\s*/i, '') : t.numero_vuelo, 20)
    const escalas = t.directo === true ? 0 : entero(t.escalas, 0, 5)
    const tramo: TramoBloqueo = {
      aerolinea: textoCorto(t.aerolinea, 60),
      numeroVuelo: numero,
      origen: textoCorto(t.origen, 60),
      destino: textoCorto(t.destino, 60),
      fecha: fechaIso(t.fecha),
      horaSalida: horaHHMM(t.hora_salida),
      horaLlegada: horaHHMM(t.hora_llegada),
      fechaLlegada: fechaIso(t.fecha_llegada),
      escalas,
    }
    if (Object.values(tramo).some(x => x !== null)) tramos.push(tramo)
  }
  if (tramos.length === 0) return { ok: false, motivo: 'No se leyó ningún vuelo en ese pantallazo. Escríbelos a mano o pega otro.' }
  return { ok: true, vuelo: { tramos: tramos.slice(0, 8) } }
}
