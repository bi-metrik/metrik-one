import { ESQUEMA_BORRADOR_JSON, type BorradorCotizacion } from '@/lib/cotizaciones/asistente/borrador'
import type { Viajeros } from '@/lib/cotizaciones/asistente/invariantes'

/**
 * ENTREGA ÚNICA DEL BLOQUEO (Trappvel, decisión de Mauricio del 2026-11-04; brief
 * `proyectos/trappvel/clarity/briefs/2026-11-04_brief-max-entrega-unica-bloqueo.md`).
 *
 * La asesora entrega el pedido por WhatsApp (texto, audio transcrito y pantallazos) y ONE hace UNA
 * llamada al modelo que devuelve, en la misma pasada, los requisitos del viaje y el borrador de la
 * cotización. Prueba del 2026-11-04 (`qa/2026-11-04_entrega-unica-bloqueo/informe.md`): requisitos
 * bien en 9 de 9 y totales al peso con PDF en 7 de 7.
 *
 * Lo que la prueba mostró inestable fue QUÉ pregunta bloquea. Por eso aquí el modelo no la decide:
 * copia literal los datos de los que sale (temporada del pantallazo, operador dicho, tarifa dicha,
 * «Compra antes del», nota de niños gratis) y redacta una pregunta por cada uno. El código
 * (`preguntas.ts`) aplica reglas fijas y elige cuáles van.
 */

export type TipoViaje = 'bloqueo' | 'a_medida' | 'no_se_sabe'
export type ClavePregunta = 'viajeros' | 'tarifa' | 'temporada' | 'compraAntesDe' | 'ninosGratis'

export interface Requisitos {
  tipoViaje: TipoViaje
  evidenciaTipo: string
  cliente: string | null
  viajeros: Viajeros | null
  destino: string | null
  ciudadOrigen: string | null
  fechaIda: string | null
  fechaRegreso: string | null
  noches: number | null
  /** El operador que nombró la asesora o que se lee en el pantallazo, tal cual («Aliados»). */
  operadorDeclarado: string | null
  /** Solo si la asesora lo DIJO: «es pública», «tarifa neta». Si no lo dijo, null. */
  tarifaDicha: 'publica' | 'neta' | null
}

/** Una pregunta redactada por el modelo. El código decide si se manda. */
export interface Redaccion {
  clave: ClavePregunta
  /** El pantallazo del hotel al que se refiere (temporada, compra antes, niños gratis). */
  pantallazo: number | null
  pregunta: string
}

export interface SalidaEntrega {
  requisitos: Requisitos
  redaccion: Redaccion[]
  /** null si faltan los viajeros (E-05) o no es bloqueo (E-04). */
  borrador: BorradorCotizacion | null
}

/** Lo que el modelo devuelve al aplicar la respuesta de la asesora (segunda vuelta). */
export interface SalidaRespuesta extends SalidaEntrega {
  /** Lo que ella contestó a cada pregunta numerada, en sus palabras normalizadas. */
  respuestas: { numero: number; clave: ClavePregunta; pantallazo: number | null; resuelta: boolean; valor: string }[]
  /** Si ella pidió algo que no se puede hacer o no se entendió: se le pregunta de nuevo. */
  noEntendido: string | null
}

const fecha = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const CLAVES: ClavePregunta[] = ['viajeros', 'tarifa', 'temporada', 'compraAntesDe', 'ninosGratis']

export const ESQUEMA_REQUISITOS = {
  type: 'object', additionalProperties: false,
  required: ['tipoViaje', 'evidenciaTipo', 'cliente', 'viajeros', 'destino', 'ciudadOrigen', 'fechaIda', 'fechaRegreso', 'noches', 'operadorDeclarado', 'tarifaDicha'],
  properties: {
    tipoViaje: { type: 'string', enum: ['bloqueo', 'a_medida', 'no_se_sabe'] },
    evidenciaTipo: { type: 'string', description: 'Qué mostró el tipo: lo dijo la asesora, los pantallazos o ambos' },
    cliente: { type: ['string', 'null'] },
    viajeros: {
      type: ['object', 'null'], additionalProperties: false, required: ['adultos', 'ninos'],
      description: 'null si no sabes cuántos adultos van o la edad de un niño. Nunca lo supongas.',
      properties: {
        adultos: { type: 'integer' },
        ninos: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['edad'], properties: { edad: { type: 'integer' } } } },
      },
    },
    destino: { type: ['string', 'null'] },
    ciudadOrigen: { type: ['string', 'null'] },
    fechaIda: fecha,
    fechaRegreso: fecha,
    noches: { type: ['integer', 'null'] },
    operadorDeclarado: { type: ['string', 'null'], description: 'El operador como lo nombró la asesora o como aparece escrito en el pantallazo («Aliados»). null si nadie lo dice.' },
    tarifaDicha: { type: ['string', 'null'], enum: ['publica', 'neta', null], description: 'Solo si la asesora dijo que la tarifa es pública o neta. Si no lo dijo, null.' },
  },
}

export const ESQUEMA_REDACCION = {
  type: 'array',
  description: 'Una pregunta corta (una línea de WhatsApp, dice qué pusiste mientras tanto) por CADA dato de este tipo que exista, aunque no creas que bloquee: viajeros si faltan; tarifa (pública o neta) si la asesora no lo dijo; temporada de cada hotel; «Compra antes del» de cada hotel que lo traiga; niños gratis de cada hotel que lo traiga. El sistema decide cuáles se mandan. La de temporada, si el pantallazo trae un año, pregunta si esa tarifa aplica en las fechas del viaje («La tarifa del Hotel X dice ALTA 2026 y el viaje es en enero de 2027: ¿aplica?»).',
  items: {
    type: 'object', additionalProperties: false, required: ['clave', 'pantallazo', 'pregunta'],
    properties: {
      clave: { type: 'string', enum: CLAVES },
      pantallazo: { type: ['integer', 'null'] },
      pregunta: { type: 'string' },
    },
  },
}

export const ESQUEMA_ENTREGA = {
  type: 'object', additionalProperties: false,
  required: ['requisitos', 'redaccion', 'borrador'],
  properties: {
    requisitos: ESQUEMA_REQUISITOS,
    redaccion: ESQUEMA_REDACCION,
    borrador: { anyOf: [ESQUEMA_BORRADOR_JSON, { type: 'null' }] },
  },
}

export const ESQUEMA_RESPUESTA = {
  type: 'object', additionalProperties: false,
  required: ['respuestas', 'noEntendido', 'requisitos', 'redaccion', 'borrador'],
  properties: {
    respuestas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['numero', 'clave', 'pantallazo', 'resuelta', 'valor'],
        properties: {
          numero: { type: 'integer' },
          clave: { type: 'string', enum: CLAVES },
          pantallazo: { type: ['integer', 'null'] },
          resuelta: { type: 'boolean', description: 'true si la respuesta de la asesora resuelve la pregunta' },
          valor: { type: 'string', description: 'Lo que decidió, corto: «pública», «sí aplica», «2 adultos y un niño de 4»' },
        },
      },
    },
    noEntendido: { type: ['string', 'null'], description: 'Si algo de lo que dijo no se entiende o no se puede aplicar, qué preguntarle. Si no, null.' },
    requisitos: ESQUEMA_REQUISITOS,
    redaccion: ESQUEMA_REDACCION,
    borrador: { anyOf: [ESQUEMA_BORRADOR_JSON, { type: 'null' }] },
  },
}
