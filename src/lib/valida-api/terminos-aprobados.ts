/**
 * Los términos que el usuario aprobó en la entrada, para releerlos en la pestaña Términos.
 *
 * Pedido de Mauricio (2026-09-16): «deja un espacio donde se puedan volver a leer los términos y
 * condiciones, pero el mismo texto que se aprobó y que diga aprobado».
 *
 * ## Cómo se sabe qué texto se aprobó
 *
 * La constancia del usuario (`documentos_aceptaciones_usuario`) guarda slug, versión y la huella del
 * PDF de la versión que aceptó. Con esa terna se localiza la versión entre los documentos del
 * espacio (`mis_documentos_de_servicio`), y su texto se muestra solo si pasa dos comprobaciones
 * contra la fila registrada de la versión (`documentos_contractuales_versiones`, inmutable):
 *
 *   1. la huella del PDF registrada es la de la constancia, y
 *   2. sha256 del texto que se va a pintar es el `texto_sha256` registrado.
 *
 * Si una falla, no hay texto: un aviso de error, nunca otra versión. Medido el 2026-09-16 sobre la
 * única versión real (4D SOFT v1.0): `texto_sha256` es el sha256 del `texto_md` tal cual, sin
 * recortes ni saltos de línea añadidos.
 *
 * ## Qué versión, si hay varias
 *
 * Por documento (slug), la constancia más reciente de las que corresponden a un documento del
 * espacio. Una constancia de otro espacio con el mismo slug y otra versión no se toma: el soporte de
 * MeTRIK entra a varios espacios y su última aprobación de un slug puede ser de otro cliente.
 *
 * Puro: la huella entra por parámetro (`node:crypto` no llega a la pantalla).
 */

import type { AceptacionUsuarioRegistrada } from './entrada'
import { POLITICA_DATOS_VALIDA } from './politica'
import type { DocumentoContractual, TerminoAprobado } from './resultados'

/** Lo registrado de una versión: las dos huellas de `documentos_contractuales_versiones`. */
export interface HuellasVersion {
  textoSha256: string
  pdfSha256: string
}

export function terminosAprobados(p: {
  /** Las constancias del usuario REAL de la sesión. */
  aceptaciones: readonly AceptacionUsuarioRegistrada[]
  /** Lo que devuelve `mis_documentos_de_servicio()` para el espacio. */
  documentos: readonly DocumentoContractual[]
  /** Por `documentoId`, las huellas registradas de la versión. */
  huellas: ReadonlyMap<string, HuellasVersion>
  huella: (texto: string) => string
}): TerminoAprobado[] {
  const slugsDelEspacio = new Set(p.documentos.map((d) => d.slug))
  const constancias = p.aceptaciones.filter(
    (a) => a.documento_slug !== POLITICA_DATOS_VALIDA.slug && a.documento_sha256 !== null && slugsDelEspacio.has(a.documento_slug),
  )

  const docsDe = (a: AceptacionUsuarioRegistrada) =>
    p.documentos.filter(
      (d) => d.slug === a.documento_slug && d.version === a.documento_version && d.pdfSha256 === a.documento_sha256,
    )
  const masReciente = (xs: AceptacionUsuarioRegistrada[]) =>
    xs.reduce((a, b) => (Date.parse(b.aceptada_at) > Date.parse(a.aceptada_at) ? b : a))

  const resultado: TerminoAprobado[] = []
  // En el orden en que el espacio lista sus documentos.
  for (const slug of slugsDelEspacio) {
    const delSlug = constancias.filter((a) => a.documento_slug === slug)
    if (delSlug.length === 0) continue

    const conDocumento = delSlug.filter((a) => docsDe(a).length > 0)
    if (conDocumento.length === 0) {
      const a = masReciente(delSlug)
      resultado.push({
        estado: 'no_verificado',
        titulo: null,
        version: a.documento_version,
        aprobadoAt: a.aceptada_at,
        motivo: 'version_no_encontrada',
      })
      continue
    }

    const aceptacion = masReciente(conDocumento)
    // La RPC puede repetir una versión (una fila por constancia contractual): mismo PDF, mismo texto.
    const filas = docsDe(aceptacion)
    const doc = filas[0]
    const registrada = p.huellas.get(doc.documentoId)
    const textoIntegro =
      registrada !== undefined &&
      registrada.pdfSha256 === aceptacion.documento_sha256 &&
      filas.every((f) => p.huella(f.textoMd) === registrada.textoSha256)

    if (!textoIntegro) {
      resultado.push({
        estado: 'no_verificado',
        titulo: doc.titulo,
        version: doc.version,
        aprobadoAt: aceptacion.aceptada_at,
        motivo: 'huella_distinta',
      })
      continue
    }

    const conContrato = filas
      .filter((f): f is DocumentoContractual & { aceptadoAt: string } => f.aceptadoAt !== null)
      .sort((a, b) => Date.parse(a.aceptadoAt) - Date.parse(b.aceptadoAt))[0]

    resultado.push({
      estado: 'verificado',
      documentoId: doc.documentoId,
      titulo: doc.titulo,
      version: doc.version,
      textoMd: doc.textoMd,
      aprobadoAt: aceptacion.aceptada_at,
      contrato: conContrato
        ? {
            aceptadoAt: conContrato.aceptadoAt,
            aceptadoPor: conContrato.aceptadoPor,
            canal: conContrato.aceptadoCanal === 'whatsapp' ? 'whatsapp' : 'modulo',
          }
        : null,
    })
  }
  return resultado
}
