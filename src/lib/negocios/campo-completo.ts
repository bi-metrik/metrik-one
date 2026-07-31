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

/**
 * ¿El valor satisface el campo? Solo se llama con campos `required` y visibles.
 *
 * @param tipo  `fields[i].tipo` de la config del bloque.
 * @param valor valor persistido en `negocio_bloques.data[slug]`.
 */
export function campoRequeridoCumplido(tipo: CampoTipo, valor: unknown): boolean {
  if (TIPOS_SIN_CAPTURA.has(tipo)) return true

  // La confirmación se acepta como booleano o como la cadena 'true': los bloques
  // configurados con `select` de opciones true/false guardan el string.
  if (TIPOS_CONFIRMACION.has(tipo)) return valor === true || valor === 'true'

  return valor !== '' && valor !== null && valor !== undefined
}
