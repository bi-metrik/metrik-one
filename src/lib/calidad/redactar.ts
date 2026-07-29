/**
 * Redaccion de datos sensibles en una transcripcion de llamada.
 *
 * POR QUE ESTA EN CODIGO Y NO EN EL PROMPT
 *
 * En la demo se suben llamadas REALES con clientes reales: numero de tarjeta,
 * codigo de seguridad, seguro social. Un paso critico que depende del prompt
 * regresiona en silencio la proxima vez que alguien afine otra cosa del prompt,
 * y aqui una regresion significa persistir el numero de tarjeta de una persona.
 * Determinista o no sirve.
 *
 * QUE SE CONSERVA Y QUE SE BORRA
 *
 * Se conserva la PETICION del agente y se borra el DATO DICTADO. No es un
 * matiz: la peticion ES la evidencia de las banderas C1 y C6 ("en 24:57 se
 * solicita el codigo de seguridad"). Si se borrara la frase entera, la
 * auditoria perderia justo el hallazgo que la justifica. Es el mismo criterio
 * que se aplico a mano sobre la llamada del 21 de mayo, y es el de Emilio:
 * "que el modulo redacte automaticamente, no dependa del criterio del operador".
 *
 * COMO DISTINGUE UNO DEL OTRO
 *
 * Un dato dictado es una RACHA de digitos, y las rachas no aparecen en el habla
 * normal. La peticion del agente dice "los dieciseis digitos" o "de cuatro en
 * cuatro": numeros sueltos, nunca cuatro seguidos. Por eso el criterio es la
 * racha y no la presencia de un numero.
 */

/** Numeros hablados, tal como los dicta alguien deletreando una tarjeta. */
const PALABRA_DIGITO = [
  'cero', 'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'dieciséis',
  'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'treinta', 'cuarenta', 'cincuenta',
  'sesenta', 'setenta', 'ochenta', 'noventa', 'cien', 'ciento',
  // Ingles: las llamadas son a EE.UU. y Puerto Rico, el dictado mezcla idiomas.
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty',
]
const SET_DIGITO = new Set(PALABRA_DIGITO)

/**
 * Minimo de numeros seguidos para considerarlo un dictado y no habla normal.
 *
 * Cuatro por defecto: en el habla corriente no se encadenan cuatro numeros.
 * Pero un codigo de seguridad son TRES digitos, asi que cuando el contexto lo
 * anuncia ("el CCV", "el codigo de seguridad") el umbral baja a tres. Bajarlo
 * siempre a tres empezaria a comerse frases normales; bajarlo solo ahi no,
 * porque la ventana es la linea siguiente a que el agente lo pida.
 */
const RACHA_POR_DEFECTO = 4
const RACHA_CODIGO = 3

export type Marca =
  | 'tarjeta'
  | 'codigo de seguridad'
  | 'vencimiento'
  | 'seguro social'
  | 'dato numerico dictado'

const ETIQUETA: Record<Marca, string> = {
  tarjeta: '[REDACTADO — número de tarjeta]',
  'codigo de seguridad': '[REDACTADO — código de seguridad]',
  vencimiento: '[REDACTADO — fecha de vencimiento]',
  'seguro social': '[REDACTADO — número de seguro social]',
  'dato numerico dictado': '[REDACTADO — dato numérico dictado]',
}

export interface Redaccion {
  /** Texto listo para persistir. */
  texto: string
  /** Cuantas veces se redacto, por tipo. Sirve para reportar sin exponer nada. */
  conteo: Record<string, number>
  /** Total de redacciones aplicadas. */
  total: number
}

/**
 * Que clase de dato es, segun lo que se dijo ANTES en la misma linea o en la
 * linea anterior. El contexto es lo unico que distingue un CCV de un ZIP.
 */
function clasificar(contexto: string): Marca {
  const c = contexto.toLowerCase()
  if (/\b(ccv|cvv|c[oó]digo de seguridad|security code|tres d[ií]gitos del respaldo)\b/.test(c)) {
    return 'codigo de seguridad'
  }
  if (/\b(vencimiento|expiraci[oó]n|expira|expiration|mes y a[nñ]o)\b/.test(c)) return 'vencimiento'
  if (/\b(social|ssn|seguro social)\b/.test(c)) return 'seguro social'
  if (/\b(tarjeta|card|d[ií]gitos|debit|cr[eé]dito|pl[aá]stico)\b/.test(c)) return 'tarjeta'
  return 'dato numerico dictado'
}

/** Quita acentos para comparar contra el vocabulario de numeros. */
const limpio = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Redacta una transcripcion linea a linea.
 *
 * Cada linea trae la forma `[HH:MM:SS] HABLANTE: texto`. Se redacta SOLO el
 * texto; la marca de tiempo y el hablante se conservan porque la auditoria los
 * necesita para citar el momento.
 */
export function redactarTranscripcion(entrada: string): Redaccion {
  const conteo: Record<string, number> = {}
  let total = 0

  const marcar = (m: Marca) => {
    conteo[m] = (conteo[m] ?? 0) + 1
    total += 1
    return ETIQUETA[m]
  }

  const lineas = entrada.split('\n')
  let contextoPrevio = ''

  const salida = lineas.map((linea) => {
    const m = linea.match(/^(\s*\[[0-9:.]+\]\s*[^:]*:\s*)([\s\S]*)$/)
    const prefijo = m ? m[1] : ''
    let texto = m ? m[2] : linea

    const contexto = `${contextoPrevio} ${texto}`
    const clase = clasificar(contexto)
    const minimo = clase === 'codigo de seguridad' ? RACHA_CODIGO : RACHA_POR_DEFECTO

    // 1. Rachas de digitos escritos con cifras, con o sin separadores. Cubre
    //    "4532 1234 5678 9010" y "123-45-6789".
    const reDigitos = new RegExp(`\\b(?:\\d[\\s.\\-–]?){${minimo - 1},}\\d\\b`, 'g')
    texto = texto.replace(reDigitos, () => marcar(clase))

    // 2. Rachas de numeros hablados. Es el caso real: la persona los dicta.
    const tokens = texto.split(/(\s+)/)
    const esNum = tokens.map((t) => SET_DIGITO.has(limpio(t).replace(/[.,;:!?¿¡]/g, '')))
    let i = 0
    const recompuesto: string[] = []
    while (i < tokens.length) {
      if (!esNum[i]) {
        recompuesto.push(tokens[i])
        i += 1
        continue
      }
      // Cuenta la racha, permitiendo los espacios intercalados.
      let j = i
      let cuantos = 0
      while (j < tokens.length && (esNum[j] || /^\s+$/.test(tokens[j]))) {
        if (esNum[j]) cuantos += 1
        j += 1
      }
      if (cuantos >= minimo) {
        recompuesto.push(marcar(clase))
      } else {
        recompuesto.push(...tokens.slice(i, j))
      }
      i = j
    }
    texto = recompuesto.join('')

    contextoPrevio = m ? m[2] : linea
    return prefijo + texto
  })

  return { texto: salida.join('\n'), conteo, total }
}
