// ============================================================
// Actas — que reunion del dia merece acta, y por que las demas no
//
// Esta capa es el filtro, no el generador. Decide sobre datos ya medidos y
// devuelve SIEMPRE el motivo del descarte: un cron que solo dice "0 actas" es
// indistinguible de un cron roto.
//
// Dos reglas de negocio viven aqui:
//
//  1. Duracion. Solo reuniones de mas de una hora (decision de Mauricio). Se
//     mide contra la duracion REAL de la transcripcion, no contra la agendada:
//     "Temas Marketing + Ventas" del 2026-08-18 estaba agendada a 60 minutos y
//     duro 18:23. Agendar no es reunirse.
//
//  2. Interna vs externa. Si algun participante tiene correo fuera del dominio
//     de MeTRIK, la reunion es externa y el acta va al cliente. Si todos son de
//     casa, son notas internas. La clasificacion sale del CORREO, no del
//     nombre, que es justamente por lo que el cron se maneja desde Calendar.
//
// La resolucion "este dominio es de tal cliente" NO vive aqui: entra inyectada
// para que el filtro se pueda probar sin base de datos.
// ============================================================

import { exportGoogleDocAsText } from '@/lib/google-drive'
import {
  listarReunionesDelDia,
  type MotivoSinTranscripcion,
  type ReunionCalendario,
} from './calendario'
import { parseTranscripcion, type TranscripcionParseada } from './transcripcion'

/** Decision de Mauricio: el acta formaliza reuniones de trabajo, no llamadas cortas. */
export const DURACION_MINIMA_SEGUNDOS = 3600

export const DOMINIO_METRIK = 'metrik.com.co'

export type MotivoDescarte =
  | MotivoSinTranscripcion
  /** El doc existe pero no tiene intervenciones utiles. */
  | 'transcripcion_vacia'
  /** No se pudo leer cuanto duro: sin marcador de cierre y sin marcas de tiempo. */
  | 'duracion_indeterminada'
  /** Duro menos del minimo. */
  | 'duracion_insuficiente'
  /** El evento no tiene a quien enviarle nada. */
  | 'sin_participantes'

export type TipoReunion = 'externa' | 'interna'

export interface CandidataActa {
  reunion: ReunionCalendario
  transcripcion: TranscripcionParseada
  duracionRealSegundos: number
  tipo: TipoReunion
  /** Dominios de correo ajenos a MeTRIK presentes en el evento. */
  dominiosExternos: string[]
}

export interface ReunionDescartada {
  eventId: string
  titulo: string | null
  motivo: MotivoDescarte
  /** Dato que sustenta el descarte, para el log del cron. */
  detalle?: string
}

export type Evaluacion =
  | { ok: true; candidata: CandidataActa }
  | { ok: false; descarte: ReunionDescartada }

function dominio(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase()
}

function descartar(
  reunion: ReunionCalendario,
  motivo: MotivoDescarte,
  detalle?: string,
): Evaluacion {
  return {
    ok: false,
    descarte: { eventId: reunion.eventId, titulo: reunion.titulo, motivo, detalle },
  }
}

/**
 * Decide sobre UNA reunion cuyo texto de transcripcion ya se descargo.
 * Pura: sin red, sin base de datos. `texto` es null cuando no habia que bajar
 * nada (el evento ya venia sin transcripcion utilizable).
 */
export function evaluarReunion(
  reunion: ReunionCalendario,
  texto: string | null,
  opts: { dominioPropio?: string; duracionMinimaSegundos?: number } = {},
): Evaluacion {
  const propio = (opts.dominioPropio ?? DOMINIO_METRIK).toLowerCase()
  const minimo = opts.duracionMinimaSegundos ?? DURACION_MINIMA_SEGUNDOS

  if (!reunion.transcriptFileId || texto === null) {
    return descartar(reunion, reunion.motivoSinTranscripcion ?? 'sin_adjuntos')
  }

  if (reunion.participantes.length === 0) {
    return descartar(reunion, 'sin_participantes')
  }

  const transcripcion = parseTranscripcion(texto)
  if (transcripcion.vacia) {
    return descartar(reunion, 'transcripcion_vacia')
  }

  const duracionRealSegundos = transcripcion.duracionSegundos
  if (duracionRealSegundos === null) {
    return descartar(reunion, 'duracion_indeterminada')
  }
  if (duracionRealSegundos < minimo) {
    return descartar(
      reunion,
      'duracion_insuficiente',
      `${Math.round(duracionRealSegundos / 60)} min de ${Math.round(minimo / 60)} requeridos`,
    )
  }

  const dominiosExternos = [
    ...new Set(
      reunion.participantes.map((p) => dominio(p.email)).filter((d) => d && d !== propio),
    ),
  ]

  return {
    ok: true,
    candidata: {
      reunion,
      transcripcion,
      duracionRealSegundos,
      tipo: dominiosExternos.length > 0 ? 'externa' : 'interna',
      dominiosExternos,
    },
  }
}

export interface SeleccionDelDia {
  candidatas: CandidataActa[]
  descartadas: ReunionDescartada[]
  /** Cuantos eventos miro el cron, para distinguir "nada aplicaba" de "no corrio". */
  revisadas: number
}

/**
 * Trae las reuniones del dia y decide sobre cada una. Solo baja el texto de las
 * que traen transcripcion: exportar un Doc cuesta una llamada por reunion.
 */
export async function seleccionarDelDia(
  fecha: Date,
  opts: {
    calendarId?: string
    workspaceId?: string
    offsetHoras?: number
    dominioPropio?: string
    duracionMinimaSegundos?: number
  } = {},
): Promise<SeleccionDelDia> {
  const reuniones = await listarReunionesDelDia(fecha, opts)
  const candidatas: CandidataActa[] = []
  const descartadas: ReunionDescartada[] = []

  for (const reunion of reuniones) {
    let texto: string | null = null
    if (reunion.transcriptFileId) {
      try {
        texto = await exportGoogleDocAsText(reunion.transcriptFileId, opts.workspaceId)
      } catch (e) {
        // Un Doc que no se deja exportar no puede tumbar el resto del dia.
        descartadas.push({
          eventId: reunion.eventId,
          titulo: reunion.titulo,
          motivo: 'adjunto_ilegible',
          detalle: e instanceof Error ? e.message : String(e),
        })
        continue
      }
    }

    const r = evaluarReunion(reunion, texto, opts)
    if (r.ok) candidatas.push(r.candidata)
    else descartadas.push(r.descarte)
  }

  return { candidatas, descartadas, revisadas: reuniones.length }
}
