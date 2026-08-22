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

// El export de Drive a text/plain NO trae markdown. Verificado contra la
// transcripcion real de "Daniela Gomez - Trappvel x MeTRIK" (2026-08-20):
//
//   \ufeffDaniela Gomez - Trappvel x MeTRIK
//   Asistentes
//   Comercial Trappvel, Mauricio Moreno
//   Transcripcion
//   Comercial Trappvel: Alo.
//   ...
//   00:05:00
//   ...
//   La reunion finalizo despues de 01:35:56
//
// Los encabezados son lineas sueltas y las marcas de tiempo son `HH:MM:SS`
// solas, sin `###`. Se toleran igual las variantes con markdown (`## **X**`)
// porque el mismo Doc exportado por otra via si las trae: la decoracion se
// quita antes de comparar, en vez de mantener dos juegos de expresiones.

const RE_FIN = /La reuni[oó]n finaliz[oó] despu[eé]s de\s+(\d{1,2}):(\d{2}):(\d{2})/
const RE_MARCA_TIEMPO = /^(\d{1,2}):(\d{2}):(\d{2})$/
const RE_INTERVENCION = /^[^:\n]{2,60}:\s+\S/

const ENCABEZADO_ASISTENTES = /^asistentes$/i
const ENCABEZADO_CUERPO = /^transcripci[oó]n$/i
const PIE = /^esta transcripci[oó]n editable/i

function aSegundos(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

/** Quita BOM, vinetas y decoracion markdown para poder comparar la linea. */
function limpiar(linea: string): string {
  return linea
    .replace(/^\ufeff/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .trim()
}

export function parseTranscripcion(texto: string): TranscripcionParseada {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n').map(limpiar)

  let titulo: string | null = null
  const asistentes: string[] = []
  const cuerpoLineas: string[] = []

  // 'cabecera' hasta el encabezado de asistentes, luego 'asistentes', luego
  // 'cuerpo'. Un doc sin encabezados deja todo en cabecera y sale vacio, que es
  // la respuesta correcta: no se inventa una transcripcion que no esta.
  let zona: 'cabecera' | 'asistentes' | 'cuerpo' = 'cabecera'
  let ultimaMarca: string | null = null

  for (const linea of lineas) {
    if (!linea) continue

    if (ENCABEZADO_ASISTENTES.test(linea)) {
      zona = 'asistentes'
      continue
    }
    if (ENCABEZADO_CUERPO.test(linea)) {
      zona = 'cuerpo'
      continue
    }

    if (zona === 'cabecera') {
      if (titulo === null) titulo = linea
      continue
    }

    if (zona === 'asistentes') {
      asistentes.push(...linea.split(',').map((n) => n.trim()).filter(Boolean))
      continue
    }

    if (PIE.test(linea)) continue
    if (RE_FIN.test(linea)) continue
    if (RE_MARCA_TIEMPO.test(linea)) {
      ultimaMarca = linea
      continue
    }
    cuerpoLineas.push(linea)
  }

  let duracionSegundos: number | null = null
  const fin = texto.match(RE_FIN)
  if (fin) {
    duracionSegundos = aSegundos(fin[1], fin[2], fin[3])
  } else if (ultimaMarca) {
    // Sin marcador de cierre: la ultima marca de tiempo es el piso conocido.
    const [h, m, sg] = ultimaMarca.split(':')
    duracionSegundos = aSegundos(h, m, sg)
  }

  const intervenciones = cuerpoLineas.filter((l) => RE_INTERVENCION.test(l)).length

  return {
    titulo,
    asistentes,
    duracionSegundos,
    cuerpo: cuerpoLineas.join('\n').trim(),
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
