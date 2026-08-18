// ============================================================
// Parser de transcripciones de Google Meet
//
// Formato real (verificado sobre la carpeta de transcripciones):
//
//   ## **{Titulo del evento}**
//
//   # **Asistentes**
//
//   Nombre Uno, Nombre Dos
//
//   # **Transcripcion**
//
//   ### 00:05:00
//
//   Nombre Uno: texto...
//
//   ### La reunion finalizo despues de 00:18:23
//
// Notas:
//  - Los asistentes vienen como NOMBRES, no correos. Resolver a correo es
//    responsabilidad de otra capa.
//  - El nombre del archivo en Drive trae el cliente cuando la reunion nacio de
//    un evento de Calendar con titulo ("Tema - Cliente x MeTRIK - fecha -
//    Transcript"). Las reuniones ad-hoc traen el codigo de Meet ("abc-defg-hij
//    (fecha) - Transcript").
//  - Google genera dos documentos por reunion: "- Transcript" y, a veces,
//    "- Notes by Gemini". Solo el primero es fuente de acta.
// ============================================================

export interface TranscripcionParseada {
  titulo: string | null
  asistentes: string[]
  duracionSegundos: number | null
  cuerpo: string
  /** true si el doc no tiene transcripcion util (reunion sin habla). */
  vacia: boolean
}

const RE_TITULO = /^##\s*\*\*(.+?)\*\*\s*$/m
const RE_ASISTENTES = /#\s*\*\*Asistentes\*\*\s*\n+([\s\S]*?)(?=\n#\s|\n###\s|$)/
const RE_FIN = /La reuni[oó]n finaliz[oó] despu[eé]s de\s+(\d{1,2}):(\d{2}):(\d{2})/
const RE_CUERPO = /#\s*\*\*Transcripci[oó]n\*\*\s*\n([\s\S]*)$/

/** Ultimo marcador `### HH:MM:SS` del cuerpo, como respaldo de duracion. */
const RE_MARCA_TIEMPO = /^###\s+(\d{1,2}):(\d{2}):(\d{2})\s*$/gm

function aSegundos(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

export function parseTranscripcion(texto: string): TranscripcionParseada {
  const titulo = texto.match(RE_TITULO)?.[1]?.trim() ?? null

  const bloqueAsistentes = texto.match(RE_ASISTENTES)?.[1] ?? ''
  const asistentes = bloqueAsistentes
    .split(/[,\n]/)
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && !n.startsWith('#') && !n.startsWith('*'))

  let duracionSegundos: number | null = null
  const fin = texto.match(RE_FIN)
  if (fin) {
    duracionSegundos = aSegundos(fin[1], fin[2], fin[3])
  } else {
    // Sin marcador de cierre: usar la ultima marca de tiempo del cuerpo.
    let ultima: RegExpExecArray | null = null
    let m: RegExpExecArray | null
    RE_MARCA_TIEMPO.lastIndex = 0
    while ((m = RE_MARCA_TIEMPO.exec(texto)) !== null) ultima = m
    if (ultima) duracionSegundos = aSegundos(ultima[1], ultima[2], ultima[3])
  }

  const cuerpo = (texto.match(RE_CUERPO)?.[1] ?? '').trim()

  // Un doc de transcripcion sin intervenciones trae encabezados y nada mas.
  const intervenciones = (cuerpo.match(/^[^\n#*][^\n]*?:\s/gm) ?? []).length

  return {
    titulo,
    asistentes,
    duracionSegundos,
    cuerpo,
    vacia: intervenciones < 3,
  }
}

// ── Metadatos derivados del nombre del archivo en Drive ──────────────────────

export interface MetaNombreArchivo {
  /** Titulo del evento de Calendar, o null si fue reunion ad-hoc. */
  tituloEvento: string | null
  /** Codigo de Meet (`abc-defg-hij`) cuando la reunion fue ad-hoc. */
  codigoMeet: string | null
  /** Contraparte inferida del patron "X x MeTRIK". Pista, no veredicto. */
  contraparte: string | null
  esTranscript: boolean
  esNotasGemini: boolean
}

const RE_CODIGO_MEET = /^([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})\s*\(/
const RE_CONTRAPARTE = /([^-–—]+?)\s+x\s+M[ée]TRIK/i

export function parseNombreArchivo(nombre: string): MetaNombreArchivo {
  const esNotasGemini = /-\s*Notes by Gemini\s*$/i.test(nombre)
  const esTranscript = /-\s*Transcript\s*$/i.test(nombre)

  const codigo = nombre.match(RE_CODIGO_MEET)?.[1] ?? null

  let tituloEvento: string | null = null
  if (!codigo) {
    // "Titulo - Cliente x MeTRIK - 2026/08/18 11:55 GMT-05:00 - Transcript"
    // Se recorta el sufijo de fecha y el tipo de documento.
    tituloEvento =
      nombre
        .replace(/\s*-\s*(Transcript|Notes by Gemini)\s*$/i, '')
        .replace(/\s*-\s*\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d{2}:?\d{2}\s*$/i, '')
        .trim() || null
  }

  const contraparte = (tituloEvento ?? nombre).match(RE_CONTRAPARTE)?.[1]?.trim() ?? null

  return { tituloEvento, codigoMeet: codigo, contraparte, esTranscript, esNotasGemini }
}
