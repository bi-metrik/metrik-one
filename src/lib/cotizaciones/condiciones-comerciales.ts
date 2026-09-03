/**
 * Condiciones comerciales de una cotización: del texto libre a párrafos con rótulo.
 *
 * `cotizaciones.terminos_condiciones` es un textarea. El formato que el equipo escribe
 * de verdad (levantado del PDF real de Termotech) es una lista de párrafos donde cada
 * uno empieza por un rótulo corto y dos puntos:
 *
 *     Forma de Pago: 50% de anticipo contra orden de compra y 50% contra entrega.
 *     Exclusiones: no incluye obra civil ni acometidas eléctricas.
 *
 * El render los pinta con el rótulo en negrita y el resto como texto corrido. Esta
 * función es la que decide dónde termina un rótulo — y por eso está aparte y probada:
 * es fácil confundir el primer `:` de una frase ("de 8:00 a 17:00") con un rótulo, y
 * el resultado sería media frase en negrita en un documento que se le manda al cliente.
 *
 * Un texto sin rótulos NO se rompe: sale como un único párrafo sin negrita.
 */

export interface CondicionComercial {
  /** Texto en negrita antes de los dos puntos. `null` si el párrafo no tiene rótulo. */
  rotulo: string | null
  /** Resto del párrafo. Puede quedar vacío si el rótulo venía solo en su línea. */
  texto: string
}

/** Viñetas que la gente pega al principio de una línea y que no aportan al texto. */
const VINETAS = /^[\s·•‣◦⁃*+\-–—]+/

/**
 * Un rótulo es corto, no arranca con dígito y no termina en dígito.
 *
 * El corte por dígito final es el que salva el caso "de 8:00 a 17:00": el prefijo
 * hasta el primer `:` sería "El personal trabaja de 8", que termina en dígito y por
 * eso NO se acepta como rótulo. Sin esa regla, media frase saldría en negrita.
 */
const MAX_CARACTERES_ROTULO = 40
const MAX_PALABRAS_ROTULO = 6

function rotuloValido(candidato: string): boolean {
  const r = candidato.trim()
  if (r.length < 2 || r.length > MAX_CARACTERES_ROTULO) return false
  if (/\d$/.test(r)) return false
  if (/^\d/.test(r)) return false
  if (r.split(/\s+/).length > MAX_PALABRAS_ROTULO) return false
  // Un rótulo es una etiqueta, no una oración: sin puntos ni comas internos.
  if (/[.,;]/.test(r)) return false
  return true
}

export function parsearCondicionesComerciales(
  texto: string | null | undefined,
): CondicionComercial[] {
  if (!texto || !texto.trim()) return []

  const parrafos: CondicionComercial[] = []

  for (const linea of texto.split(/\r?\n/)) {
    const limpia = linea.replace(VINETAS, '').trim()

    // Línea en blanco: cierra el párrafo abierto, no crea uno nuevo.
    if (!limpia) {
      if (parrafos.length > 0) parrafos.push({ rotulo: null, texto: '' })
      continue
    }

    const corte = limpia.indexOf(':')
    if (corte > 0 && rotuloValido(limpia.slice(0, corte))) {
      parrafos.push({
        rotulo: limpia.slice(0, corte).trim(),
        texto: limpia.slice(corte + 1).trim(),
      })
      continue
    }

    // Sin rótulo: continúa el párrafo abierto, o abre uno nuevo si no hay.
    const abierto = parrafos[parrafos.length - 1]
    if (abierto && (abierto.rotulo !== null || abierto.texto !== '')) {
      abierto.texto = abierto.texto ? `${abierto.texto} ${limpia}` : limpia
    } else if (abierto) {
      abierto.texto = limpia
    } else {
      parrafos.push({ rotulo: null, texto: limpia })
    }
  }

  return parrafos.filter((p) => p.rotulo !== null || p.texto !== '')
}

/**
 * Vigencia de la cotización EN DÍAS.
 *
 * El formato de Termotech no imprime la fecha de vencimiento sino cuántos días vale
 * la oferta. El dato no existe como campo: se deriva de `fecha_validez` − `fecha_envio`.
 *
 * Devuelve `null` cuando falta cualquiera de las dos fechas — es la misma condición
 * que ya aplicaba el payload de WeasyPrint, que sobre ese `null` pone su default de 30.
 * Aquí no se inventa un default: quien llama decide si muestra la línea o la omite.
 */
export function vigenciaEnDias(
  fechaEnvio: string | null | undefined,
  fechaValidez: string | null | undefined,
): number | null {
  if (!fechaEnvio || !fechaValidez) return null
  const envio = new Date(fechaEnvio).getTime()
  const validez = new Date(fechaValidez).getTime()
  if (Number.isNaN(envio) || Number.isNaN(validez)) return null
  return Math.max(1, Math.round((validez - envio) / 86_400_000))
}

/**
 * Máximo de caracteres de un trozo de palabra en la columna de descripción del PDF.
 *
 * Medido sobre la plantilla: la columna es 43% de 536 pt útiles ≈ 222 pt, y a 8 pt en
 * negrita mayúscula un carácter ocupa ~5,8 pt. 28 caracteres son ~162 pt: entran con
 * holgura. Ninguna palabra del español llega ahí (la más larga de uso corriente,
 * «electroencefalografista», tiene 23).
 */
export const MAX_CARACTERES_PALABRA = 28

/**
 * Cómo partir una palabra al final del renglón en el PDF.
 *
 * react-pdf trae separación silábica con patrones de INGLÉS y la aplica al español:
 * partía «URGENCIAS» en «URGEN-CIAS» y «ADMINISTRACIÓN» en «ADMINIS-TRACIÓN». Apagarla
 * del todo tampoco sirve — probado: un código de producto de 49 caracteres se DESBORDA
 * sobre la columna de al lado, y eso rompe la tabla en un documento que va al cliente.
 *
 * Regla: la palabra se devuelve entera salvo que no quepa; solo entonces se corta en
 * trozos que sí caben. El guion de corte aparece únicamente donde es inevitable.
 */
export function partirPalabraLarga(palabra: string): string[] {
  if (palabra.length <= MAX_CARACTERES_PALABRA) return [palabra]
  const trozos: string[] = []
  for (let i = 0; i < palabra.length; i += MAX_CARACTERES_PALABRA) {
    trozos.push(palabra.slice(i, i + MAX_CARACTERES_PALABRA))
  }
  return trozos
}
