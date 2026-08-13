/**
 * ¿Un campo obligatorio de un bloque `datos` está satisfecho?
 *
 * FUENTE ÚNICA de la regla de completitud por campo. La usa `BloqueDatos` para decidir
 * si el bloque queda `completo`, que es lo que a su vez determina si un bloque `es_gate`
 * deja avanzar de etapa.
 *
 * ⚠️ POR QUÉ EXISTE ESTE ARCHIVO
 *
 * La versión anterior daba por cumplido CUALQUIER `toggle` o `checkbox`, aunque estuviera
 * marcado `required` y aunque su bloque fuera gate:
 *
 *     if (f.tipo === 'toggle') return true
 *     if (f.tipo === 'checkbox') return true
 *
 * Es decir: todo bloque de confirmación humana ("Confirmo la tarifa UPME", "Certificado
 * entregado al cliente", "Enviado a la DIAN") nacía completo y no retenía nada. El gate
 * existía en la configuración y era decorativo en la práctica.
 *
 * Medido en SOENA el 2026-07-31: SIETE bloques marcados `es_gate` colgaban de un campo
 * así, y ninguno bloqueaba. El caso que lo destapó: V0129 pasó a operaciones con
 * `tarifa_confirmada = false` y $701.812 de tarifa UPME sin recaudar, porque el modelo de
 * dinero exige esa confirmación para incluir la tarifa en el umbral de recaudo.
 *
 * Una confirmación es justamente lo contrario de "se da por hecha": si el campo se declara
 * obligatorio, alguien tiene que marcarlo.
 *
 * Los tipos que NO capturan valor (`plantilla` es texto renderizado, `documentos_preview`
 * lista archivos, `doc_link` apunta a otro bloque) siguen dándose por cumplidos: ahí no hay
 * nada que responder y exigirlos dejaría el bloque bloqueado para siempre.
 */

export type CampoTipo =
  | 'texto'
  | 'numero'
  | 'fecha'
  | 'toggle'
  | 'checkbox'
  | 'select'
  | 'radio'
  | 'imagen_clipboard'
  | 'documentos_preview'
  | 'doc_link'
  | 'plantilla'
  | (string & {})

/** Tipos que no capturan respuesta del usuario: son presentación o referencia. */
const TIPOS_SIN_CAPTURA = new Set(['documentos_preview', 'doc_link', 'plantilla'])

/** Tipos de confirmación: `required` significa "tiene que quedar en verdadero". */
const TIPOS_CONFIRMACION = new Set(['toggle', 'checkbox'])

/** Forma mínima de un `config_extra.fields[i]` para evaluar completitud. */
export interface CampoConfig {
  slug: string
  tipo: CampoTipo
  required?: boolean
  label?: string
  showIf?: { field: string; equals: unknown }
  /**
   * `no_cero` (opt-in, solo tipo `numero`): el cero NO satisface el campo.
   *
   * ⚠️ POR QUÉ HIZO FALTA
   *
   * `required` da por cumplido cualquier valor presente, y el cero está presente.
   * En un campo de PLATA eso no es un dato faltante: es un dato borrado, y se ve
   * igual que una respuesta deliberada.
   *
   * Medido en SOENA el 2026-08-13: SEIS casos con la tarifa UPME confirmada en
   * cero, los seis con el toggle de confirmación marcado. El sistema ya había
   * calculado la referencia correcta en todos ($701.812, y $1.997.484 en V0294)
   * y alguien la sobrescribió con cero. Cuatro de esos casos ya llegaron a Cita
   * recaudando exactamente el honorario, sin un peso de la tarifa que se le gira
   * a la UPME.
   *
   * Como el bloque que lo captura ya es `es_gate`, marcar el campo alcanza para
   * que el avance se frene solo: no hace falta un gate nuevo. Sin la marca, el
   * comportamiento es idéntico al anterior para todos los demás campos.
   */
  no_cero?: boolean
}

/**
 * ¿El valor satisface el campo? Solo se llama con campos `required` y visibles.
 *
 * Recibe el CAMPO, no solo su tipo, porque la regla vive en su configuración.
 * Pasar solo el tipo dejaría a los consumidores que no la conocen evaluando con
 * un criterio distinto, que es la forma en que este repo ya se ha desincronizado
 * antes (dos caminos de escritura, uno validado y otro no).
 *
 * @param campo `fields[i]` de la config del bloque (basta `tipo` + `no_cero`).
 * @param valor valor persistido en `negocio_bloques.data[slug]`.
 */
export function campoRequeridoCumplido(
  campo: Pick<CampoConfig, 'tipo'> & Partial<Pick<CampoConfig, 'no_cero'>>,
  valor: unknown,
): boolean {
  const { tipo } = campo
  if (TIPOS_SIN_CAPTURA.has(tipo)) return true

  // La confirmación se acepta como booleano o como la cadena 'true': los bloques
  // configurados con `select` de opciones true/false guardan el string.
  if (TIPOS_CONFIRMACION.has(tipo)) return valor === true || valor === 'true'

  if (valor === '' || valor === null || valor === undefined) return false

  // El cero solo descalifica donde se declaró que descalifica. Se compara sobre
  // el número, no sobre el texto: el input guarda '0', '0.00' y '$ 0' según por
  // dónde entre, y las tres son el mismo cero.
  if (campo.no_cero) {
    if (typeof valor === 'number') {
      if (valor === 0) return false
    } else {
      const limpio = String(valor).replace(/[^\d.-]/g, '')
      // Sin un solo dígito no hay número que juzgar. Sin este corte, `Number('')`
      // devuelve 0 y un texto como 'pendiente' se frenaría como si fuera un cero,
      // con un mensaje que no explica nada. Un valor con basura es un problema de
      // formato, no de este control.
      if (/\d/.test(limpio) && Number(limpio) === 0) return false
    }
  }

  return true
}

/**
 * ¿El campo aplica a este caso? Un campo con `showIf` que no se cumple está oculto
 * en pantalla, así que exigirlo dejaría el bloque bloqueado para siempre.
 */
export function campoVisible(f: CampoConfig, valores: Record<string, unknown>): boolean {
  if (!f.showIf) return true
  return valores[f.showIf.field] === f.showIf.equals
}

/**
 * ¿El bloque `datos` está completo? Misma regla que usa `BloqueDatos.isComplete`,
 * extraída acá para que el SERVIDOR pueda aplicarla también.
 *
 * ⚠️ POR QUÉ EN EL SERVIDOR
 *
 * `marcarBloqueCompleto` validaba permisos (`guardEditarBloque`) pero NO completitud:
 * escribía `estado='completo'` con lo que el cliente le mandara. La única barrera vivía
 * en un componente, así que todo llamador que no fuera el camino feliz de `persist()`
 * podía marcar completo un bloque incompleto. `handleConfirm` (bloques `require_confirm`)
 * es uno de esos llamadores: llama directo, sin evaluar `isComplete`.
 *
 * Es el mismo criterio que el código ya declara para permisos ("la UI es solo UX; esta es
 * la barrera real") y que no se estaba cumpliendo para completitud.
 *
 * Devuelve los campos que faltan (vacío = completo) para poder decir CUÁL falta, en vez
 * de un "no se pudo" sin explicación.
 */
export function camposRequeridosFaltantes(
  fields: CampoConfig[],
  valores: Record<string, unknown>,
): CampoConfig[] {
  return fields
    .filter((f) => f.required && campoVisible(f, valores))
    .filter((f) => !campoRequeridoCumplido(f, valores[f.slug]))
}
