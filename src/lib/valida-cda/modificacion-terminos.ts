/**
 * Los textos del aviso de una modificación de los Términos por la cláusula 13.1 (la v1.4 de los
 * Términos VALIDA · Plan CDA: restricción de las consultas nuevas a los 5 días de mora).
 *
 * Decisión de Mauricio (2026-10-07) y dictamen de Emilio: el aviso va POR LA PLATAFORMA, lo ven todos
 * los usuarios del CDA desde la publicación, dice en simple qué cambia, desde cuándo rige, dónde está el
 * documento completo y el PDF, y el derecho de la 13.1 (terminar sin penalidad antes de la vigencia, con
 * reembolso a prorrata). La persona designada puede aceptarla con el mismo mecanismo de la entrada;
 * aceptarla no es condición de nada, porque la modificación rige igual.
 *
 * Todas las fechas salen del dato registrado (`vigente_desde` y `publicada_at` de la versión), nunca de
 * una constante: si el aviso se hubiera publicado otro día, los textos dirían ese día.
 *
 * Puro: lo usan la pantalla y las pruebas.
 */

import { todayBogotaISO } from '@/lib/dates/bogota'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'
import { SLUG_TERMINOS_CDA } from './plazos'

/** A quién se le escribe para terminar sin penalidad (cláusula 15.1: el correo registrado de METRIK). */
export const CORREO_TERMINACION = 'mauricio.moreno@metrik.com.co'

const MESES_LARGOS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

/** '2026-11-06' → '6 de noviembre de 2026'. Lo que no es una fecha sale tal cual. */
export function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  const mes = m ? MESES_LARGOS[Number(m[2]) - 1] : undefined
  return m && mes ? `${Number(m[3])} de ${mes} de ${m[1]}` : iso
}

/** 'v1.4' → 'versión 1.4'. */
export function nombreVersion(version: string): string {
  return `versión ${version.replace(/^v/, '')}`
}

/** El día (Bogotá) en que se publicó el aviso, o `null` si la versión no lo trae. */
export function diaDePublicacion(doc: Pick<DocumentoContractual, 'publicadaAt'>): string | null {
  if (!doc.publicadaAt) return null
  const t = Date.parse(doc.publicadaAt)
  return Number.isNaN(t) ? null : todayBogotaISO(new Date(t))
}

export interface TextosAvisoModificacion {
  titulo: string
  /** Qué cambia, en simple. */
  queCambia: string
  /** Desde cuándo rige y por qué rige aunque no se acepte. */
  vigencia: string
  /** El derecho de la cláusula 13.1. `null` desde la vigencia: ya no se puede ejercer. */
  derecho: string | null
  /** Cuándo se publicó el aviso. */
  publicado: string | null
}

/** Qué cambia, por serie y versión. Una versión sin resumen propio remite al documento. */
function queCambia(doc: Pick<DocumentoContractual, 'slug' | 'version' | 'titulo' | 'vigenteDesde'>): string {
  const desde = fechaLarga(doc.vigenteDesde)
  if (doc.slug === SLUG_TERMINOS_CDA && doc.version === 'v1.4') {
    return (
      `Cambian las cláusulas 2.5 y 11. Desde el ${desde}, si una cuota de la suscripción no se paga dentro de los ` +
      `cinco (5) días calendario siguientes a su vencimiento, se restringen las consultas nuevas en Valida ` +
      `(individuales y masivas) hasta que se registre el pago. El historial sigue abierto: los reportes ya ` +
      `generados se pueden ver y descargar, y los usuarios siguen activos. Si el pago se hace por el enlace de ` +
      `pago, las consultas se habilitan de nuevo apenas se aprueba. La suspensión por mora de más de treinta (30) ` +
      `días sigue igual, y para una empresa al día nada cambia. Precio, alcance, usuarios y plazo no cambian.`
    )
  }
  return `METRIK modifica los ${doc.titulo}. Lee el documento completo para ver qué cambia.`
}

export function textosAvisoModificacion(
  doc: Pick<DocumentoContractual, 'slug' | 'version' | 'titulo' | 'vigenteDesde' | 'publicadaAt'>,
  hoy: string,
): TextosAvisoModificacion {
  const desde = fechaLarga(doc.vigenteDesde)
  const antes = hoy < doc.vigenteDesde.slice(0, 10)
  const publicadoEl = diaDePublicacion(doc)
  return {
    titulo: `Cambian los Términos de tu suscripción a Valida (${nombreVersion(doc.version)})`,
    queCambia: queCambia(doc),
    vigencia: antes
      ? `El cambio rige desde el ${desde} por la cláusula 13.1 de los Términos (aviso con treinta días de ` +
        `anticipación), lo acepte o no tu empresa. Hasta esa fecha siguen rigiendo los Términos que ya aceptaron.`
      : `El cambio rige desde el ${desde} (cláusula 13.1 de los Términos).`,
    derecho: antes
      ? `Si tu empresa no está de acuerdo, puede terminar la suscripción sin penalidad antes del ${desde}, con ` +
        `reembolso a prorrata de los días no prestados (cláusula 13.1), escribiendo a ${CORREO_TERMINACION}.`
      : null,
    publicado: publicadoEl ? `Aviso publicado en la plataforma el ${fechaLarga(publicadoEl)}.` : null,
  }
}

/**
 * A quién le toca aceptar, para quien no puede hacerlo. Aceptar es voluntario, y se dice SIN dejar leer
 * que sin aceptación el cambio no aplica (gate de Vera, 2026-10-07): rige desde su vigencia en todo caso.
 */
export function textoQuienAceptaModificacion(
  designadoNombre: string | null,
  doc: Pick<DocumentoContractual, 'vigenteDesde'>,
): string {
  const desde = fechaLarga(doc.vigenteDesde)
  const quien = designadoNombre ? `La persona designada por tu empresa, ${designadoNombre},` : 'La persona designada por tu empresa'
  return (
    `${quien} puede aceptar esta versión desde Valida. Aceptarla no es obligatorio para seguir usando Valida, ` +
    `pero el cambio rige desde el ${desde} en todo caso.`
  )
}

/** La ruta del PDF de una versión (la descarga firmada de `/api/valida/archivo`). */
export function rutaPdfTerminos(documentoId: string): string {
  return `/api/valida/archivo/terminos/${documentoId}`
}
