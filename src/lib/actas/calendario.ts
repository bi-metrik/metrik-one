// ============================================================
// Google Calendar — reuniones del dia con transcripcion adjunta
//
// El cron se maneja desde Calendar, no desde Drive. Razon: el evento de
// Calendar es el unico lugar donde estan los CORREOS de los participantes.
// La transcripcion de Meet solo trae NOMBRES, y la tabla de contactos de ONE
// hoy no permite resolver nombre -> correo (se verifico: casi vacia).
//
// El evento tambien trae el adjunto con el fileId exacto de la transcripcion,
// asi que no hay que emparejar nombres de archivo contra reuniones.
//
// Efecto lateral deseado: una reunion ad-hoc sin evento de Calendar no produce
// acta. Sin lista de invitados no hay destinatarios defendibles.
//
// Reutiliza getAccessToken() de google-drive: misma credencial, mismo modo
// (service account / OAuth per-workspace / OAuth global). Requiere que esa
// credencial tenga el scope de Calendar de solo lectura.
//
// Server-only.
// ============================================================

import { getAccessToken } from '@/lib/google-drive'

const RE_ID_DOC = /\/document\/d\/([a-zA-Z0-9_-]+)/

export interface Participante {
  email: string
  organizador: boolean
  esUnoMismo: boolean
}

export interface ReunionCalendario {
  eventId: string
  titulo: string | null
  inicio: string
  fin: string
  /** Duracion agendada. La real sale de la transcripcion, no de aqui. */
  duracionAgendadaSegundos: number
  participantes: Participante[]
  /** fileId del Google Doc de transcripcion adjunto, si Meet ya lo subio. */
  transcriptFileId: string | null
  transcriptNombre: string | null
  /** Por que no hay transcripcion. null cuando si la hay. */
  motivoSinTranscripcion: MotivoSinTranscripcion | null
  meetUrl: string | null
}

interface RawAttendee {
  email?: string
  organizer?: boolean
  self?: boolean
  resource?: boolean
}

interface RawAttachment {
  fileUrl?: string
  title?: string
}

interface RawEvent {
  id: string
  status?: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: RawAttendee[]
  attachments?: RawAttachment[]
  hangoutLink?: string
  conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] }
}

export type MotivoSinTranscripcion =
  /** El evento no trae adjuntos: la reunion no se grabo, o Meet aun no subio nada. */
  | 'sin_adjuntos'
  /** Hay adjuntos pero ninguno es transcripcion (medido: solo "Recording" + "Notas de Gemini"). */
  | 'solo_grabacion'
  /** El adjunto dice ser transcripcion pero su fileUrl no trae fileId de Google Doc. */
  | 'adjunto_ilegible'

const RE_SUFIJO_TRANSCRIPT = /-\s*Transcript\s*$/i

// Meet estampa la hora en el titulo: "... - 2026/08/18 11:55 GMT-05:00 - Transcript"
const RE_SELLO = /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s+GMT([+-]\d{2}):?(\d{2})/

function selloDelTitulo(titulo: string): number | null {
  const m = titulo.match(RE_SELLO)
  if (!m) return null
  const [, anio, mes, dia, hora, min, tzHora, tzMin] = m
  const t = Date.parse(
    `${anio}-${mes}-${dia}T${hora.padStart(2, '0')}:${min}:00${tzHora}:${tzMin}`,
  )
  return Number.isNaN(t) ? null : t
}

export interface SeleccionTranscripcion {
  id: string
  nombre: string
}

/**
 * Un evento puede traer MAS DE UNA transcripcion. Medido sobre el calendario
 * real: "Temas Marketing + Ventas - Soena x MeTRIK" del 2026-08-18 (evento de
 * las 12:00) trae una transcripcion sellada 11:55 y otra sellada 17:55. El
 * orden del arreglo no dice cual corresponde a esta sesion; el sello de tiempo
 * del titulo si. Se elige la mas cercana al inicio del evento.
 *
 * Y puede traer NINGUNA: hay reuniones con "Recording" + "Notas de Gemini" y
 * sin transcripcion. Esas no generan acta, pero el motivo se devuelve para que
 * el cron lo registre en vez de fallar en silencio.
 */
export function elegirTranscripcion(
  attachments: RawAttachment[] | undefined,
  inicioISO: string,
): { elegida: SeleccionTranscripcion | null; motivo: MotivoSinTranscripcion | null } {
  const lista = attachments ?? []
  if (lista.length === 0) return { elegida: null, motivo: 'sin_adjuntos' }

  const candidatos = lista.filter((a) => RE_SUFIJO_TRANSCRIPT.test(a.title ?? ''))
  if (candidatos.length === 0) return { elegida: null, motivo: 'solo_grabacion' }

  const inicio = Date.parse(inicioISO)
  const ordenados = candidatos
    .map((a) => ({ a, sello: selloDelTitulo(a.title ?? '') }))
    .sort((x, y) => {
      // Un titulo sin sello no compite: va al final, pero sigue siendo elegible
      // si es el unico con fileId legible.
      if (x.sello === null) return y.sello === null ? 0 : 1
      if (y.sello === null) return -1
      return Math.abs(x.sello - inicio) - Math.abs(y.sello - inicio)
    })

  for (const { a } of ordenados) {
    const id = a.fileUrl?.match(RE_ID_DOC)?.[1]
    if (id) return { elegida: { id, nombre: a.title ?? '' }, motivo: null }
  }
  return { elegida: null, motivo: 'adjunto_ilegible' }
}

function normalizar(ev: RawEvent): ReunionCalendario | null {
  const inicio = ev.start?.dateTime
  const fin = ev.end?.dateTime
  // Eventos de dia completo (sin dateTime) no son reuniones.
  if (!inicio || !fin) return null

  const { elegida, motivo } = elegirTranscripcion(ev.attachments, inicio)

  const participantes: Participante[] = (ev.attendees ?? [])
    .filter((a) => !!a.email && !a.resource)
    .map((a) => ({
      email: a.email!.toLowerCase(),
      organizador: a.organizer === true,
      esUnoMismo: a.self === true,
    }))

  const meetUrl =
    ev.hangoutLink ??
    ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ??
    null

  return {
    eventId: ev.id,
    titulo: ev.summary?.trim() || null,
    inicio,
    fin,
    duracionAgendadaSegundos: Math.max(
      0,
      Math.round((new Date(fin).getTime() - new Date(inicio).getTime()) / 1000),
    ),
    participantes,
    transcriptFileId: elegida?.id ?? null,
    transcriptNombre: elegida?.nombre ?? null,
    motivoSinTranscripcion: motivo,
    meetUrl,
  }
}

/**
 * Reuniones de un rango en el calendario de un usuario.
 *
 * `calendarId` es el correo del dueño del calendario (o 'primary' cuando la
 * credencial ya impersona a esa cuenta).
 */
export async function listarReuniones(
  desde: Date,
  hasta: Date,
  opts: { calendarId?: string; workspaceId?: string } = {},
): Promise<ReunionCalendario[]> {
  const token = await getAccessToken(opts.workspaceId)
  const calendarId = encodeURIComponent(opts.calendarId ?? 'primary')

  const out: ReunionCalendario[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      timeMin: desde.toISOString(),
      timeMax: hasta.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )

    if (!res.ok) {
      const errBody = await res.text()
      console.error('[actas/calendario] List failed:', res.status, errBody.slice(0, 500))
      if (res.status === 403 && /insufficient|scope/i.test(errBody)) {
        throw new Error(
          'La credencial de Google no tiene scope de Calendar (calendar.readonly). ' +
            'Sin eso no hay correos de participantes.',
        )
      }
      throw new Error(`Error listando eventos de Calendar (${res.status})`)
    }

    const data = await res.json()
    for (const ev of (data.items ?? []) as RawEvent[]) {
      if (ev.status === 'cancelled') continue
      const r = normalizar(ev)
      if (r) out.push(r)
    }
    pageToken = data.nextPageToken as string | undefined
  } while (pageToken)

  return out
}

/** Reuniones del dia calendario en la zona indicada (por defecto Bogota). */
export async function listarReunionesDelDia(
  fecha: Date,
  opts: { calendarId?: string; workspaceId?: string; offsetHoras?: number } = {},
): Promise<ReunionCalendario[]> {
  const offset = opts.offsetHoras ?? -5 // America/Bogota, sin DST
  const y = fecha.getUTCFullYear()
  const m = fecha.getUTCMonth()
  const d = fecha.getUTCDate()
  const desde = new Date(Date.UTC(y, m, d, -offset, 0, 0))
  const hasta = new Date(desde.getTime() + 24 * 3600 * 1000)
  return listarReuniones(desde, hasta, opts)
}
