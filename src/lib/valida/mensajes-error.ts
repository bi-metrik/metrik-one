/**
 * Lo que lee la persona cuando una consulta de Valida no sale. Nunca el código crudo: el motor
 * responde `{ error: 'busqueda_incompleta' }` y hasta el 2026-10-21 la pantalla pintaba esa palabra
 * tal cual en el recuadro rojo.
 *
 * `mensajeErrorValida` acepta tanto códigos (del motor o de ONE) como frases ya escritas para la
 * persona (la puerta de los CDA devuelve oraciones: términos pendientes, mora). Una frase pasa tal
 * cual; un código conocido se traduce; cualquier otra cosa (código nuevo, `HTTP 500`, el mensaje de
 * Postgres o de la red) cae al mensaje genérico, con el código aparte como detalle técnico.
 *
 * Sin imports de servidor: lo usan la pantalla, las acciones y el trabajador del cargue masivo.
 */

/** La búsqueda en alguna lista no se completó: Valida no registró ni cobró (metrik-valida#66). */
export const CODIGO_BUSQUEDA_INCOMPLETA = 'busqueda_incompleta'

export const MENSAJE_GENERICO =
  'No pudimos completar la consulta. Intenta de nuevo; si sigue pasando, escríbenos.'

export const MENSAJES_ERROR_VALIDA: Readonly<Record<string, string>> = {
  [CODIGO_BUSQUEDA_INCOMPLETA]:
    'No pudimos revisar todas las listas en este momento. La consulta no se registró ni se cobró; intenta de nuevo.',
  valida_tiempo_agotado: 'Valida no respondió a tiempo. Intenta de nuevo en un momento.',
  db_error: 'Valida tuvo un problema interno. Intenta de nuevo; si sigue pasando, escríbenos.',
  persistencia_error: 'La consulta no se pudo guardar y no se cobró. Intenta de nuevo.',
  validation_error: 'Revisa los datos: el nombre o el documento no tienen un formato válido.',
  invalid_json: 'Revisa los datos: el nombre o el documento no tienen un formato válido.',
  invalid_api_key: 'La conexión de tu espacio con Valida no está activa. Escríbenos para revisarla.',
  valida_api_key_no_configurada: 'Tu espacio todavía no tiene Valida listo para consultar. Escríbenos para activarlo.',
  sin_plan_asignado: 'Tu espacio no tiene un paquete de consultas asignado. Escríbenos para activarlo.',
  paquete_vencido_sin_pago:
    'El pago del paquete de consultas está pendiente. Cuando se registre podrás consultar de nuevo; no pierdes consultas.',
  bolsa_agotada: 'Se acabaron las consultas de tu plan. Esta consulta no se registró ni se cobró.',
  bolsa_vencida: 'Tu plan de consultas venció. Esta consulta no se registró ni se cobró.',
  saldo_insuficiente: 'No te alcanzan las consultas del plan para todo el archivo.',
  negocio_no_encontrado: 'El negocio seleccionado no existe en tu espacio.',
  workspace_no_encontrado: 'No pudimos verificar tu sesión. Vuelve a iniciar sesión.',
  archivo_no_provisto: 'Selecciona un archivo XLSX.',
  archivo_no_legible: 'No pudimos leer el archivo. Revisa que sea un XLSX de la plantilla.',
  archivo_sin_hojas: 'El archivo no tiene hojas. Usa la plantilla de Valida.',
  archivo_vacio: 'El archivo no tiene filas para consultar.',
  lote_no_encontrado: 'No encontramos ese cargue. Recarga la página.',
  lote_sin_consultas_validas: 'Este cargue no tiene consultas con reporte para descargar.',
}

export type MensajeError = {
  mensaje: string
  /** El código original, para mostrarlo pequeño como detalle técnico. `null` si ya era una frase. */
  codigo: string | null
}

/** ¿Es una frase escrita para la persona? Empieza en mayúscula (o ¿/¡) y tiene más de una palabra. */
function esFrase(texto: string): boolean {
  return /^[¿¡]?[A-ZÁÉÍÓÚÑ]/.test(texto) && /\s/.test(texto) && !/^HTTP \d{3}$/.test(texto)
}

export function mensajeErrorValida(error: string | null | undefined): MensajeError {
  const texto = (error ?? '').trim()
  if (!texto) return { mensaje: MENSAJE_GENERICO, codigo: null }
  const conocido = MENSAJES_ERROR_VALIDA[texto]
  if (conocido) return { mensaje: conocido, codigo: texto }
  if (esFrase(texto)) return { mensaje: texto, codigo: null }
  return { mensaje: MENSAJE_GENERICO, codigo: texto.slice(0, 120) }
}

/** El rótulo de una fila del cargue que falló sin resultado porque la búsqueda no se completó. */
export const ROTULO_NO_COMPLETADA = 'No completada, reintenta'
