// ============================================================
// Terminos y condiciones de la propuesta economica
// ============================================================
// SOENA edita sus propios terminos desde /mi-negocio y el PDF los recibe ya
// armados en `terminos_html`. El servicio de render hace reemplazo LITERAL de
// cadenas (`{{clave}}` -> valor): no tiene como defenderse de marcado roto o
// malicioso, asi que **el escape es responsabilidad de ONE**. Por eso el armado
// vive aqui, en funciones puras que se prueban sin base de datos.
//
// Lo que se escribe en la pantalla es TEXTO PLANO con una sola marca:
// `**negrita**`. No es capricho. Las 18 clausulas vigentes resaltan en negrita
// justo las exclusiones de responsabilidad ("SOENA no garantiza una fecha
// determinada..."), y un editor de texto pelado las habria perdido en la
// primera edicion. La marca se aplica DESPUES de escapar, asi que no reabre la
// puerta a HTML.
//
// La numeracion NO se guarda: sale del orden del arreglo. Insertar una clausula
// en la mitad renumera sola, incluidas las sub-clausulas `N.M`.

export interface ParrafoTerminos {
  /** Si viene, el parrafo es una sub-clausula: se numera `N.M.` y se resalta. */
  subtitulo?: string
  texto: string
}

export interface ClausulaTerminos {
  titulo: string
  parrafos: ParrafoTerminos[]
}

export interface PropuestaTerminos {
  clausulas: ClausulaTerminos[]
  /** Parrafo de aceptacion al pie de las firmas. */
  cierre: string
  /** Sube 1 en cada guardado. El PDF deja constancia de con cual se genero. */
  version: number
  updated_at: string | null
  updated_by: string | null
}

// ── Escape ────────────────────────────────────────────────────────────────

// Solo los tres caracteres que pueden abrir una etiqueta o una entidad. Las
// comillas se dejan intactas a proposito: el texto del usuario nunca aterriza
// dentro de un atributo, y escaparlas ensuciaria la tipografia del documento.
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>]/g, (c) => ESCAPES[c])
}

/** Escapa y reactiva la unica marca permitida: `**negrita**`. */
export function textoAHtml(texto: string): string {
  return escaparHtml(texto).replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
}

// ── Render ────────────────────────────────────────────────────────────────

/** Los titulos se guardan sin punto final; el documento siempre lo lleva. */
function conPuntoFinal(titulo: string): string {
  const limpio = titulo.trim().replace(/[.\s]+$/, '')
  return limpio ? `${limpio}.` : ''
}

function clausulaAHtml(clausula: ClausulaTerminos, numero: number): string {
  const partes: string[] = []
  let sub = 0
  clausula.parrafos.forEach((parrafo, i) => {
    const texto = textoAHtml(parrafo.texto.trim())
    if (parrafo.subtitulo?.trim()) {
      sub += 1
      const subtitulo = textoAHtml(conPuntoFinal(parrafo.subtitulo))
      partes.push(`<p class="tsub"><b>${numero}.${sub}. ${subtitulo}</b> ${texto}</p>`)
    } else if (i === 0) {
      // El primer parrafo va pegado al titulo, en la misma linea.
      partes.push(` ${texto}`)
    } else {
      partes.push(`<p>${texto}</p>`)
    }
  })
  const titulo = textoAHtml(conPuntoFinal(clausula.titulo))
  return `<li><span class="tn">${numero}.</span><b>${titulo}</b>${partes.join('')}</li>`
}

/** Arma el `terminos_html` que espera la plantilla: un `<li>` por clausula. */
export function clausulasAHtml(clausulas: ClausulaTerminos[]): string {
  return clausulas
    .filter((c) => c.titulo.trim() || c.parrafos.some((p) => p.texto.trim()))
    .map((c, i) => clausulaAHtml(c, i + 1))
    .join('\n')
}

// ── Lectura defensiva ─────────────────────────────────────────────────────

function comoTexto(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * Lee `lineas_negocio.config_extra.propuesta` sin confiar en su forma. Devuelve
 * `null` cuando no hay nada configurado, que es la senal para que el PDF caiga
 * a los terminos por defecto del servicio de render en vez de salir sin ellos.
 */
export function normalizarTerminos(raw: unknown): PropuestaTerminos | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const crudas = Array.isArray(obj.clausulas) ? obj.clausulas : []
  const clausulas: ClausulaTerminos[] = crudas.map((c) => {
    const cl = (c ?? {}) as Record<string, unknown>
    const parrafosCrudos = Array.isArray(cl.parrafos) ? cl.parrafos : []
    return {
      titulo: comoTexto(cl.titulo),
      parrafos: parrafosCrudos.map((p) => {
        const pa = (p ?? {}) as Record<string, unknown>
        const subtitulo = comoTexto(pa.subtitulo).trim()
        return subtitulo
          ? { subtitulo, texto: comoTexto(pa.texto) }
          : { texto: comoTexto(pa.texto) }
      }),
    }
  })
  const cierre = comoTexto(obj.cierre).trim()
  if (clausulas.length === 0 && !cierre) return null
  return {
    clausulas,
    cierre,
    version: Number(obj.version) || 1,
    updated_at: comoTexto(obj.updated_at) || null,
    updated_by: comoTexto(obj.updated_by) || null,
  }
}
