/**
 * La entrada del módulo Valida API: UNA pantalla y UNA aprobación antes de todo lo demás.
 *
 * Pedido de Mauricio (2026-09-16), textual: «debe ser ahí mismo debajo y que sea una sola
 * aprobación de todo. Sobre todo los términos no pueden vivir en un documento. Deben estar vivos,
 * así como cuando uno acepta los términos que tiene que haber leído hasta el final para poder
 * aprobar. Sin eso no debería poderse hacer nada.»
 *
 * Hasta ese día la entrada tenía dos pasos (la Política con un enlace a otra pestaña, y los
 * términos solo para el dueño y solo si faltaba la constancia del contrato). Como 4D SOFT ya los
 * había aceptado por WhatsApp, ningún usuario suyo veía jamás los términos al entrar.
 *
 * ## Qué es «aprobada», y por qué son TRES cosas
 *
 *   1. El usuario aceptó la versión vigente de la Política de Datos.
 *   2. El usuario tiene constancia propia de CADA documento de términos vigente (leído hasta el
 *      final y aceptado), atada a la huella del PDF: una fila con el mismo slug y versión pero otra
 *      huella es otro documento, no este.
 *   3. El contrato del espacio tiene la aceptación contractual de cada documento vigente (la del
 *      dueño, por WhatsApp o en este módulo).
 *
 * La tercera no la puede dar cualquiera: la da el dueño real del espacio, nunca el soporte de
 * MeTRIK. Por eso un usuario puede tener hechas la 1 y la 2 y seguir sin entrar.
 *
 * ## Valida de los CDA (2026-09-23): solo la tercera
 *
 * En el producto `valida_cda` (ver `producto.ts`) lo que abre el módulo es la aceptación del
 * contrato, que firma la persona designada por la empresa. Esa persona hace también su 1 y su 2 en
 * el mismo clic, pero a los operadores no se les pide nada propio: esperan a que ella acepte.
 *
 * ## Fail-closed
 *
 * No poder leer algo NO es haberlo aceptado. Un fallo de lectura devuelve `no_disponible` y un
 * espacio sin documentos vigentes devuelve `sin_documentos`: en los dos el módulo no se abre.
 *
 * Puro y sin `node:crypto`: lo usan el servidor (que decide y registra) y la pantalla (que arma la
 * casilla), y los dos tienen que construir EL MISMO texto.
 */

import { POLITICA_DATOS_VALIDA, requiereAceptacion } from './politica'
import { PRODUCTOS_ENTRADA, type ProductoEntrada } from './producto'
import type { DocumentoContractual } from './resultados'
import { estadoTerminos, puedeAceptarTerminos, vigentesConAceptacion, type RazonNoAcepta } from './terminos'

/** Una fila de `documentos_aceptaciones_usuario` del usuario, tal como la lee el servidor. */
export interface AceptacionUsuarioRegistrada {
  documento_slug: string
  documento_version: string
  documento_sha256: string | null
  aceptada_at: string
}

export interface DocumentoEnEntrada {
  doc: DocumentoContractual
  /** El contrato del espacio tiene constancia de esta versión. */
  contratoAceptado: boolean
  /** El usuario tiene su constancia de haberla leído y aceptado. */
  leidoPorUsuario: boolean
}

export type EstadoEntrada =
  | { estado: 'no_disponible' }
  | { estado: 'sin_documentos' }
  | { estado: 'aprobada' }
  | {
      estado: 'pendiente'
      documentos: DocumentoEnEntrada[]
      politicaAceptada: boolean
      /** Documentos cuyo contrato no tiene aceptación. Vacío = el contrato está aceptado. */
      contratoPendiente: DocumentoContractual[]
      /** Solo cuando el contrato está pendiente: si la persona de la sesión real puede firmarlo. */
      aceptante: { puede: true } | { puede: false; razon: RazonNoAcepta } | null
      /** Nombre de la persona designada por el contrato, para decirle al resto a quién esperan. */
      designadoNombre: string | null
      /**
       * Documentos vigentes para los que el usuario YA tiene una fila con el mismo slug y versión
       * pero OTRA huella. El UNIQUE (usuario, slug, versión) de la tabla impide registrar la nueva,
       * así que la aprobación no se puede completar desde aquí.
       */
      conflictos: DocumentoContractual[]
    }

export function usuarioLeyoDocumento(
  doc: Pick<DocumentoContractual, 'slug' | 'version' | 'pdfSha256'>,
  filas: readonly AceptacionUsuarioRegistrada[],
): boolean {
  return filas.some(
    (f) => f.documento_slug === doc.slug && f.documento_version === doc.version && f.documento_sha256 === doc.pdfSha256,
  )
}

function enConflicto(
  doc: Pick<DocumentoContractual, 'slug' | 'version' | 'pdfSha256'>,
  filas: readonly AceptacionUsuarioRegistrada[],
): boolean {
  return filas.some(
    (f) => f.documento_slug === doc.slug && f.documento_version === doc.version && f.documento_sha256 !== doc.pdfSha256,
  )
}

export function evaluarEntrada(p: {
  /** Lo que devuelve `mis_documentos_de_servicio()`; `null` si la lectura falló. */
  documentos: readonly DocumentoContractual[] | null
  hoy: string
  /** Las filas del usuario en `documentos_aceptaciones_usuario`; `null` si la lectura falló. */
  aceptacionesUsuario: readonly AceptacionUsuarioRegistrada[] | null
  /** El perfil REAL de la sesión (no el de «Ver como»); `null` si la lectura falló. */
  perfil: { role: string | null; workspaceId: string | null; platformAdmin: boolean } | null
  workspaceId: string
  /** Qué producto: decide si cada usuario aprueba y si hace falta designado. Por defecto, Valida API. */
  producto?: ProductoEntrada
  /** La persona REAL de la sesión, para compararla con la designada. */
  usuarioId?: string | null
  /**
   * Quién firma según el contrato. `undefined` = no se leyó: el servidor la lee solo si el contrato
   * está pendiente, que es el único caso en que decide algo.
   */
  designacion?: { designadoId: string | null; designadoNombre: string | null } | null
}): EstadoEntrada {
  if (p.documentos === null || p.aceptacionesUsuario === null) return { estado: 'no_disponible' }
  const producto = PRODUCTOS_ENTRADA[p.producto ?? 'valida_api']

  const contrato = estadoTerminos(p.documentos, p.hoy)
  if (contrato.estado === 'sin_documentos') return { estado: 'sin_documentos' }

  const filas = p.aceptacionesUsuario
  const politicaAceptada = !requiereAceptacion(filas.filter((f) => f.documento_slug === POLITICA_DATOS_VALIDA.slug))
  const documentos = vigentesConAceptacion(p.documentos, p.hoy).map(({ doc, aceptado }) => ({
    doc,
    contratoAceptado: aceptado,
    leidoPorUsuario: usuarioLeyoDocumento(doc, filas),
  }))
  const contratoPendiente = contrato.estado === 'pendientes' ? contrato.pendientes : []

  const usuarioAlDia = politicaAceptada && documentos.every((d) => d.leidoPorUsuario)
  if (contratoPendiente.length === 0 && (usuarioAlDia || !producto.exigeAprobacionPorUsuario)) {
    return { estado: 'aprobada' }
  }

  let aceptante: { puede: true } | { puede: false; razon: RazonNoAcepta } | null = null
  if (contratoPendiente.length > 0) {
    // Sin el perfil real no se puede decidir quién firma: no se adivina.
    if (!p.perfil) return { estado: 'no_disponible' }
    aceptante = puedeAceptarTerminos(p.perfil, p.workspaceId, {
      designadoId: p.designacion?.designadoId ?? null,
      exigida: producto.exigeDesignado,
      usuarioId: p.usuarioId ?? null,
    })
  }

  return {
    estado: 'pendiente',
    documentos,
    politicaAceptada,
    contratoPendiente,
    aceptante,
    designadoNombre: p.designacion?.designadoNombre ?? null,
    // Un conflicto solo impide completar la aprobación PROPIA del usuario. Donde esa aprobación no
    // se exige (los CDA), no puede frenar la firma del contrato: el upsert la omite sin error.
    conflictos: producto.exigeAprobacionPorUsuario
      ? documentos.filter((d) => !d.leidoPorUsuario && enConflicto(d.doc, filas)).map((d) => d.doc)
      : [],
  }
}

/** ¿La persona de la sesión puede completar la aprobación desde la pantalla? */
export function puedeAprobarEntrada(estado: EstadoEntrada): boolean {
  if (estado.estado !== 'pendiente') return false
  if (estado.conflictos.length > 0) return false
  return estado.aceptante === null || estado.aceptante.puede
}

/** «el A, el B y el C», para nombrar los documentos en la casilla. */
function enumerar(partes: readonly string[]): string {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/**
 * El texto EXACTO de la única casilla de la entrada. Cubre los términos (leídos hasta el final),
 * la Política y, cuando quien entra es el dueño y el contrato está pendiente, la firma de la
 * declaración de facultades que aparece arriba. Su huella queda en cada constancia del usuario.
 */
export function textoCasillaEntrada(p: {
  documentos: readonly Pick<DocumentoContractual, 'titulo' | 'version'>[]
  /** Nombre(s) de la empresa que se obliga, o `null` si esta aprobación no firma el contrato. */
  firmaPor: readonly string[] | null
  /** En qué módulo se acepta. Por defecto Valida API: su texto ya está firmado y no cambia. */
  producto?: ProductoEntrada
}): string {
  const docs = enumerar(p.documentos.map((d) => `«${d.titulo}» (${d.version})`))
  const base =
    `Leí hasta el final ${docs} y los acepto para mi uso de ${PRODUCTOS_ENTRADA[p.producto ?? 'valida_api'].nombre}. ` +
    `Autorizo a METRIK IA S.A.S. a tratar mis datos conforme a la ` +
    `${POLITICA_DATOS_VALIDA.titulo} v${POLITICA_DATOS_VALIDA.version}.`
  if (!p.firmaPor || p.firmaPor.length === 0) return base
  return (
    `${base} Declaro bajo la gravedad de juramento que tengo facultades para obligar a ` +
    `${enumerar(p.firmaPor)} y firmo en su nombre la declaración de arriba.`
  )
}

/** Fila de `documentos_aceptaciones_usuario` que escribe la aprobación. */
export interface FilaAceptacionUsuario {
  workspace_id: string
  usuario_id: string
  documento_slug: string
  documento_version: string
  documento_sha256: string | null
  documento_url: string | null
  aviso_texto_sha256: string
  ip: string | null
  user_agent: string | null
}

/**
 * Las constancias del usuario que registra un clic en «Acepto»: la de la Política (con la huella
 * de su aviso, como antes) y una por cada documento de términos vigente, atada a la huella de su
 * PDF y a la huella del texto de la casilla. Las huellas las calcula quien llama (`node:crypto`
 * no entra a este archivo).
 */
export function filasAceptacionUsuario(p: {
  documentos: readonly Pick<DocumentoContractual, 'slug' | 'version' | 'pdfSha256'>[]
  workspaceId: string
  usuarioId: string
  huellaAvisoPolitica: string
  huellaCasilla: string
  ip: string | null
  userAgent: string | null
}): FilaAceptacionUsuario[] {
  const comun = { workspace_id: p.workspaceId, usuario_id: p.usuarioId, ip: p.ip, user_agent: p.userAgent }
  return [
    {
      ...comun,
      documento_slug: POLITICA_DATOS_VALIDA.slug,
      documento_version: POLITICA_DATOS_VALIDA.version,
      documento_sha256: null,
      documento_url: POLITICA_DATOS_VALIDA.url,
      aviso_texto_sha256: p.huellaAvisoPolitica,
    },
    ...p.documentos.map((d) => ({
      ...comun,
      documento_slug: d.slug,
      documento_version: d.version,
      documento_sha256: d.pdfSha256,
      documento_url: null,
      aviso_texto_sha256: p.huellaCasilla,
    })),
  ]
}
