/**
 * El tipo de documento de una fila de la carga masiva, tal como lo escribe la persona en el XLSX,
 * llevado al código que acepta Valida.
 *
 * Hasta el 2026-10-23 el lote solo pasaba el valor a mayúsculas y lo mandaba tal cual. El esquema de
 * `POST /api/v1/validate` acepta un enum cerrado, así que «CEDULA», «PP», «PA» o «TI» volvían 400
 * `validation_error` (no se cobraban) y la fila quedaba en «Error» sin decir por qué. Solo en un
 * espacio fueron cientos de filas. La consulta puntual no lo sufre: elige el tipo de una lista.
 *
 * Sin imports de servidor: lo usan la vista previa del lote, el trabajador y el script de reproceso.
 */

import type { TipoDocumento, TipoPersona } from '@/lib/actions/valida-consultas'
import { CODIGO_TIPO_DOCUMENTO_NO_ACEPTADO, MENSAJES_ERROR_VALIDA } from './mensajes-error'

/**
 * Lo que Valida acepta en `documento.tipo`. TI, PPT y RC entraron con metrik-valida#70 (2026-10-23);
 * hasta entonces ONE los reconocía pero no los mandaba.
 */
export const TIPOS_DOCUMENTO_VALIDA: readonly TipoDocumento[] = ['CC', 'CE', 'NIT', 'PAS', 'TI', 'PPT', 'RC']

/**
 * Formas en que llega cada tipo, ya compactadas (sin tildes, puntos, espacios, guiones ni guiones
 * bajos, en mayúsculas). «C.C.», «c c», «Cédula de ciudadanía» y «CEDULA» dan lo mismo.
 */
const ALIAS: Readonly<Record<string, TipoDocumento>> = {
  CC: 'CC',
  CEDULA: 'CC',
  CEDULADECIUDADANIA: 'CC',
  CEDULACIUDADANIA: 'CC',
  CE: 'CE',
  CEDULADEEXTRANJERIA: 'CE',
  CEDULAEXTRANJERIA: 'CE',
  NIT: 'NIT',
  PAS: 'PAS',
  PA: 'PAS',
  PP: 'PAS',
  PASAPORTE: 'PAS',
  PASSPORT: 'PAS',
  TI: 'TI',
  TARJETADEIDENTIDAD: 'TI',
  TARJETAIDENTIDAD: 'TI',
  PPT: 'PPT',
  PERMISOPORPROTECCIONTEMPORAL: 'PPT',
  PERMISODEPROTECCIONTEMPORAL: 'PPT',
  RC: 'RC',
  REGISTROCIVIL: 'RC',
  REGISTROCIVILDENACIMIENTO: 'RC',
}

export type TipoDocumentoLeido =
  /** Un tipo que Valida acepta. `inferido`: la celda venía vacía y se dedujo del tipo de persona. */
  | { estado: 'aceptado'; tipo: TipoDocumento; inferido: boolean }
  /** Nada que se pueda leer como tipo («X», un número puesto en la columna, «PEP»…). */
  | { estado: 'no_reconocido'; valor: string }
  /** Sin tipo y sin número: la fila consulta solo por nombre, como siempre. */
  | { estado: 'sin_documento' }

/** «C.C.», «Cédula de Ciudadanía» → «CEDULADECIUDADANIA». */
export function compactarTipo(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[.\s\-_]/g, '')
}

/** ¿Es un tipo que Valida acepta? Lo usa el trabajador para no mandar lo que volvería 400. */
export function tipoAceptadoPorValida(tipo: string | null | undefined): tipo is TipoDocumento {
  return (TIPOS_DOCUMENTO_VALIDA as readonly string[]).includes(tipo ?? '')
}

/**
 * Lee el tipo de documento de una fila.
 *
 * Celda vacía con número: persona jurídica → NIT; persona natural → CC, o PAS si el número trae
 * letras (un pasaporte; ni CC, ni CE, ni NIT llevan letras). El motor de Valida busca por dígitos y el
 * tipo solo cambia algo para el NIT (le quita el dígito de verificación), así que deducirlo no cambia
 * a quién se busca. Antes, esa fila perdía el número y consultaba solo por nombre.
 */
export function leerTipoDocumento(
  valor: string | null | undefined,
  numero: string | null | undefined,
  tipoPersona: TipoPersona,
): TipoDocumentoLeido {
  const crudo = String(valor ?? '').trim()
  const num = String(numero ?? '').trim()

  if (!crudo) {
    if (!num) return { estado: 'sin_documento' }
    if (tipoPersona === 'juridica') return { estado: 'aceptado', tipo: 'NIT', inferido: true }
    return { estado: 'aceptado', tipo: /[a-z]/i.test(num) ? 'PAS' : 'CC', inferido: true }
  }

  const tipo = ALIAS[compactarTipo(crudo)]
  if (!tipo) return { estado: 'no_reconocido', valor: crudo }
  return { estado: 'aceptado', tipo, inferido: false }
}

/** Lo que la fila dice cuando el tipo no se reconoce. */
export const MENSAJE_TIPO_NO_RECONOCIDO: string = MENSAJES_ERROR_VALIDA[CODIGO_TIPO_DOCUMENTO_NO_ACEPTADO]

/** El mensaje de la fila, o null si el tipo se puede consultar. */
export function mensajeTipoDocumento(leido: TipoDocumentoLeido): string | null {
  if (leido.estado === 'no_reconocido') return MENSAJE_TIPO_NO_RECONOCIDO
  return null
}
