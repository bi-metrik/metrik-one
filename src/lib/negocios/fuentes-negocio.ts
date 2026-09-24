/**
 * Leer un dato del negocio por el SLUG de su bloque, sabiendo si ese bloque le aplica.
 *
 * Lo comparten la tarjeta de datos clave y los cruces de la línea: los dos leen datos
 * que viven en bloques de otras etapas (la titularidad se responde en Propuesta, el
 * certificado llega en Certificación) y los dos tienen que distinguir tres cosas que
 * se ven iguales si solo se mira el valor:
 *
 *   - el dato está,
 *   - el dato falta en un bloque que SÍ le aplica al caso (hay que conseguirlo),
 *   - el dato falta porque el bloque NO le aplica (su `condition` no se cumple).
 *
 * ⚠️ La `condition` no se reevalúa aquí. Entra resuelta por la misma función SQL que
 * usan los gates, el routing y el render (`condicion_cumplida`): si esta capa juzgara
 * por su cuenta, podría decir «no aplica» sobre un bloque que el motor sí está pidiendo.
 * Ver `contextoFuentesDelNegocio` en `fuentes-negocio-servidor.ts`.
 *
 * Los datos llegan APLANADOS (`aplanarDataBloque`): los campos extraídos por IA viven en
 * `data.campos[slug].value` y aquí se leen al mismo nivel que los de un bloque de datos.
 * Se leen por el slug del bloque ORIGEN, nunca por una copia heredada: las copias no
 * tienen slug y su `data` puede ser vieja.
 */

export type EvaluadorCondicion = (condicion: Record<string, unknown>) => Promise<boolean>

export interface ContextoFuentes {
  /** Datos aplanados del bloque origen, por slug. Un slug ausente = el negocio no lo tiene. */
  porSlug: Record<string, Record<string, unknown>>
  /** ¿El bloque le aplica al caso? (`condition` del bloque + `desactivado`). */
  aplica: (slug: string) => Promise<boolean>
  /** Resuelve una condición declarada por la configuración (misma forma que `condition`). */
  evaluar: EvaluadorCondicion
  /** Texto de un valor según las opciones declaradas por el campo en su bloque. */
  etiqueta: (slug: string, field: string, valor: unknown) => string | null
}

/** Un valor cuenta como presente si no es nulo ni texto vacío. `false` y `0` SÍ son valores. */
function tieneValor(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  return true
}

/** El valor de un campo de un bloque, o `undefined` si no está. */
export function valorDe(ctx: Pick<ContextoFuentes, 'porSlug'>, slug: string, field: string): unknown {
  const v = ctx.porSlug[slug]?.[field]
  return tieneValor(v) ? v : undefined
}

/** Minúsculas, sin tildes ni espacios al borde: la misma normalización de `value_in`. */
export function normalizarClave(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * ¿Dos números de documento son la misma persona?
 *
 * Mismo criterio que el cruce `id_prefix` del certificado: se comparan solo los dígitos,
 * y si uno empieza por el otro (con al menos seis dígitos) se acepta. Cubre el NIT con el
 * dígito de verificación pegado y la cédula leída con un dígito de más o de menos al
 * final, que son las dos formas en que el mismo documento llega distinto de dos papeles.
 */
export function mismoDocumento(a: unknown, b: unknown): boolean {
  const x = String(a ?? '').replace(/\D/g, '')
  const y = String(b ?? '').replace(/\D/g, '')
  if (x.length < 6 || y.length < 6) return false
  return x === y || x.startsWith(y) || y.startsWith(x) || conPrefijoDeTipo(x, y) || conPrefijoDeTipo(y, x)
}

/**
 * ¿`largo` es `corto` con el código del tipo de documento pegado delante?
 *
 * En el formulario del RUT de la DIAN la casilla del tipo de documento («13» = cédula de
 * ciudadanía) va junto al número, y la extracción a veces la lee como parte de él: el RUT
 * de V0395 quedó 137556326 y la factura dice 7556326; el de V0177 quedó 132747706 contra
 * 32747706 (ahí solo se coló el «1»).
 *
 * Criterio, estrecho a propósito:
 * - Igualdad EXACTA después de quitar el prefijo: no se combina con la tolerancia del DV
 *   de arriba. Combinarlas abría coincidencias falsas: 1122456789 (una cédula de 10
 *   dígitos) sin su «1» empieza por 12245678, que es otra cédula.
 * - El resto tiene al menos 6 dígitos y NO empieza por 0: las cédulas de 10 dígitos son
 *   10xxxxxxxx, y sin el «1» quedarían empezando por 0, que no es un documento.
 */
function conPrefijoDeTipo(largo: string, corto: string): boolean {
  if (corto.startsWith('0')) return false
  return ['13', '1'].some(p => largo.length === corto.length + p.length && largo === p + corto)
}

/** Recuerda cada respuesta asíncrona por su clave: una condición se resuelve una vez por lectura. */
export function memoizar<T>(fn: (clave: string) => Promise<T>): (clave: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>()
  return clave => {
    const hit = cache.get(clave)
    if (hit) return hit
    const p = fn(clave)
    cache.set(clave, p)
    return p
  }
}
