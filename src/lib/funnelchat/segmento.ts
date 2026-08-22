import { STATUS_CONTACTO } from '@/lib/catalogos/constants'

/**
 * Etiqueta de FunnelChat -> segmento del contacto en ONE.
 *
 * La decision de negocio (2026-08-22, Mauricio): **FunnelChat es la fuente de
 * verdad del segmento**. El comercial etiqueta en el chat, que es donde de verdad
 * trabaja, y ONE refleja. Antes de esto el campo existia y nadie lo movia: los 62
 * contactos etiquetados en FunnelChat estaban los 62 en `sin_contactar`.
 */

/**
 * ⚠️ Solo valores VIVOS del catalogo. `contactado`, `convertido` e `inactivo`
 * siguen pasando el CHECK de la tabla pero ONE los esta retirando —
 * `resolverStatusContacto` ya los pinta en gris como desconocidos. Mapear una
 * etiqueta a uno de esos tres dejaria el chip apagado en pantalla sin que nada
 * fallara: el sincronizador diria que funciono y el usuario veria un valor muerto.
 * El test amarra esta lista contra STATUS_CONTACTO para que no se separen.
 */
const SEGMENTO_POR_ETIQUETA: Record<string, string> = {
  // Terminal negativo: el vehiculo no aplica (MHEV, usado, fuera de fecha...).
  'no calificado': 'descartado',
  // En espera por causa externa: aplica pero no esta en BIZAGI.
  'pendiente bizagi': 'standby',
  // Conversacion viva y avanzada. `Cerrado` (el cliente pago) tambien cae aqui:
  // el pago es un negocio, no un estado de contacto, y el catalogo de segmentos
  // no tiene —ni deberia tener— un valor de venta.
  cerrado: 'conectado',
  propuesta: 'conectado',
  calificado: 'conectado',
  conectado: 'conectado',
  // "Ya se realizo el primer contacto", literal de la descripcion del tag.
  seguimiento: 'primer_contacto',
  'no contesta': 'no_contesto',
  // Lleno formulario y todavia nadie lo toco.
  lead: 'sin_contactar',
}

/**
 * Orden de avance. Se usa para DOS cosas que son la misma:
 *
 * 1. Un contacto puede llevar varias etiquetas a la vez (hoy 4 las llevan, uno
 *    tres). FunnelChat no quita la vieja al poner la nueva, asi que no existe "la
 *    etiqueta actual": gana la mas avanzada.
 * 2. Los eventos llegan de a una etiqueta y **sin orden garantizado**. Sin esta
 *    comparacion, un `No contesta` que llega tarde tumbaria un `descartado` ya
 *    escrito. La sincronizacion solo avanza, nunca retrocede.
 *
 * El precio de (2) esta declarado y es real: quitar una etiqueta en FunnelChat no
 * dispara nada —su webhook solo avisa de lo que se AGREGA—, asi que una etiqueta
 * puesta por error solo se deshace a mano en ONE. Se prefiere eso a que el orden
 * de llegada decida el segmento.
 */
const RANGO: Record<string, number> = {
  sin_contactar: 0,
  no_contesto: 1,
  primer_contacto: 2,
  segundo_contacto: 3,
  tercer_contacto: 4,
  standby: 5,
  conectado: 6,
  descartado: 7,
}

/** Campos que se aceptan como portadores de la etiqueta, misma razon que CLAVES_TELEFONO. */
export const CLAVES_ETIQUETA = ['etiqueta', 'tag', 'label', 'etiquetas', 'tags'] as const

/**
 * Normaliza el texto del tag: minusculas, sin tildes, espacios colapsados. Lo
 * escribe quien administra FunnelChat, no nosotros, y "Pendiente BIZAGI" tiene
 * que enganchar igual que "pendiente bizagi".
 */
export function normalizarEtiqueta(crudo: string): string {
  return crudo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function extraerEtiqueta(payload: Record<string, unknown>): string | null {
  for (const clave of CLAVES_ETIQUETA) {
    const v = payload[clave]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

export type DecisionSegmento =
  | { estado: 'sin_etiqueta' }
  | { estado: 'etiqueta_desconocida'; etiqueta: string }
  | { estado: 'aplica'; etiqueta: string; anterior: string | null; nuevo: string }
  | { estado: 'no_retrocede'; etiqueta: string; anterior: string; nuevo: string }
  | { estado: 'sin_cambio'; etiqueta: string; segmento: string }

/**
 * Que hacer con el segmento de un contacto ante una etiqueta.
 *
 * Devuelve un veredicto para CADA caso, incluidos los que no escriben. Un
 * `etiqueta_desconocida` que se tratara como "no hacer nada" seria indistinguible
 * de un exito: alguien crearia un tag nuevo en FunnelChat, la sincronizacion lo
 * ignoraria en silencio y los dos sistemas se separarian sin que nadie lo note.
 */
export function decidirSegmento(
  etiquetaCruda: string | null,
  segmentoActual: string | null,
): DecisionSegmento {
  if (!etiquetaCruda) return { estado: 'sin_etiqueta' }

  const etiqueta = normalizarEtiqueta(etiquetaCruda)
  const nuevo = SEGMENTO_POR_ETIQUETA[etiqueta]
  if (!nuevo) return { estado: 'etiqueta_desconocida', etiqueta: etiquetaCruda }

  if (segmentoActual === nuevo) {
    return { estado: 'sin_cambio', etiqueta: etiquetaCruda, segmento: nuevo }
  }

  // Un segmento que no esta en RANGO (los legacy, o uno que se agregue despues
  // sin tocar este archivo) se trata como el principio de la escala: es preferible
  // que la sincronizacion lo mueva a que se quede clavado en un valor muerto.
  const rangoActual = segmentoActual ? (RANGO[segmentoActual] ?? -1) : -1
  if (RANGO[nuevo] <= rangoActual) {
    return { estado: 'no_retrocede', etiqueta: etiquetaCruda, anterior: segmentoActual!, nuevo }
  }

  return { estado: 'aplica', etiqueta: etiquetaCruda, anterior: segmentoActual, nuevo }
}

/** Los valores a los que esta pieza puede llevar un contacto. Para el test. */
export const SEGMENTOS_DESTINO = [...new Set(Object.values(SEGMENTO_POR_ETIQUETA))]
export const SEGMENTOS_VIVOS = STATUS_CONTACTO.map(s => s.value) as readonly string[]
export const ETIQUETAS_CONOCIDAS = Object.keys(SEGMENTO_POR_ETIQUETA)
