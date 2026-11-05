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

// Un documento "- Transcript" cierra con "La reunion finalizo..."; uno de
// Notas de Gemini (que trae la transcripcion embebida, ver calendario.ts)
// cierra con "La transcripcion finalizo...". Medido sobre el export real de
// "Alejandra Lancheros - Trappvel x MeTRIK" (2026-08-19): "La transcripción
// finalizó después de 01:29:41".
const RE_FIN = /La (?:reuni[oó]n|transcripci[oó]n) finaliz[oó] despu[eé]s de\s+(\d{1,2}):(\d{2}):(\d{2})/
const RE_MARCA_TIEMPO = /^(\d{1,2}):(\d{2}):(\d{2})$/
const RE_INTERVENCION = /^[^:\n]{2,60}:\s+\S/

// Los encabezados se comparan sobre la linea en `llano` (minusculas, sin
// tildes), asi que "Transcripción", "TRANSCRIPCION" y "transcripcion" son lo
// mismo.
const ENCABEZADO_ASISTENTES = /^asistentes$/
// Formato del documento "- Transcript" y de las Notas de Gemini hasta
// septiembre de 2026: la palabra sola.
const ENCABEZADO_CUERPO = /^transcripcion$/
// Formato de las Notas de Gemini que exporta Drive hoy (medido el 2026-11-05
// sobre las Notas del 4 y 5 de septiembre, sin cambios desde que se crearon):
// la linea suelta "Transcripcion" desaparecio y el corte quedo en
// "<titulo> - Transcripcion", justo antes de la primera marca de tiempo. El
// titulo puede traer guiones propios ("Tema - Cliente x MeTRIK"): el que
// cuenta es el ultimo. El guion corto exige espacio antes (sin espacio es una
// palabra compuesta, "pre-transcripcion"); la raya larga no.
const SEPARADOR_TITULO = String.raw`(?:\s+[-–—]|\s*[–—])\s*`
const ENCABEZADO_CUERPO_CON_TITULO = new RegExp(String.raw`^(.*\S)${SEPARADOR_TITULO}transcripcion$`)
const COLA_TRANSCRIPCION = new RegExp(String.raw`${SEPARADOR_TITULO}\S+$`)
// Ojo: arriba del resumen, las Notas traen la fila de pestanas del documento
// ("Registros de la reunion Transcripcion"). NO es el corte (debajo viene el
// resumen, que no es habla) y ninguna de las dos expresiones la toma: no es la
// palabra sola ni lleva guion.
const PIE = /^esta transcripcion editable/

/** Minusculas y sin tildes, solo para comparar contra los encabezados. */
function llano(linea: string): string {
  return linea.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

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
  // Los encabezados solo cuentan ANTES de la primera intervencion. Despues,
  // una linea que diga "Transcripcion" (o "Asistentes", o termine en
  // "- transcripcion") es habla o ruido del cuerpo, no un corte: tomarla como
  // encabezado partiria la reunion o mandaria el resto a la lista de
  // asistentes.
  let hayIntervencion = false

  for (const linea of lineas) {
    if (!linea) continue

    if (!hayIntervencion) {
      const l = llano(linea)
      if (zona !== 'cuerpo' && ENCABEZADO_ASISTENTES.test(l)) {
        zona = 'asistentes'
        continue
      }
      // Una vineta del resumen nunca es el corte. Y ya dentro del cuerpo (Notas
      // viejas: "Transcripcion" suelta y luego "<titulo> - Transcripcion"), una
      // linea con forma de intervencion es habla aunque termine en
      // "- transcripcion".
      const conTitulo =
        /^[*•-]\s/.test(linea) || (zona === 'cuerpo' && RE_INTERVENCION.test(linea))
          ? null
          : l.match(ENCABEZADO_CUERPO_CON_TITULO)
      if (ENCABEZADO_CUERPO.test(l) || conTitulo) {
        // Lo que se junto entre un encabezado y otro (en las Notas viejas, la
        // fecha entre "Transcripcion" y "<titulo> - Transcripcion") no es habla.
        cuerpoLineas.length = 0
        if (conTitulo) {
          // El titulo del encabezado es el del evento; el de la primera linea,
          // en las Notas, es la fecha. Se recorta del original para no perder
          // mayusculas ni tildes.
          titulo = linea.replace(COLA_TRANSCRIPCION, '').trim()
        }
        zona = 'cuerpo'
        continue
      }
    }

    if (zona === 'cabecera') {
      if (titulo === null) titulo = linea
      continue
    }

    if (zona === 'asistentes') {
      asistentes.push(...linea.split(',').map((n) => n.trim()).filter(Boolean))
      continue
    }

    if (PIE.test(llano(linea))) continue
    if (RE_FIN.test(linea)) continue
    if (RE_MARCA_TIEMPO.test(linea)) {
      ultimaMarca = linea
      continue
    }
    if (RE_INTERVENCION.test(linea)) hayIntervencion = true
    cuerpoLineas.push(linea)
  }

  // Las Notas de Gemini no traen bloque "Asistentes" (solo una linea
  // "Invitado ..." sin separadores). Sin el, los nombres salen de quien habla.
  if (asistentes.length === 0) {
    for (const l of cuerpoLineas) {
      if (!RE_INTERVENCION.test(l)) continue
      const nombre = l.slice(0, l.indexOf(':')).trim()
      if (!asistentes.includes(nombre)) asistentes.push(nombre)
    }
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

/**
 * Extrae la contraparte del patron "... - Cliente x MeTRIK", que Mauricio usa
 * al titular los eventos. Sirve igual sobre el nombre del archivo en Drive y
 * sobre el titulo del evento de Calendar: es el mismo texto.
 */
export function contraparteEn(texto: string): string | null {
  return texto.match(RE_CONTRAPARTE)?.[1]?.trim() || null
}

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

  const contraparte = contraparteEn(tituloEvento ?? nombre)

  return { tituloEvento, codigoMeet: codigo, contraparte, esTranscript, esNotasGemini }
}
