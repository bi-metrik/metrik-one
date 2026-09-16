/**
 * Términos del contrato en el módulo Valida API: cuándo se exigen, quién los acepta y qué texto
 * firma. Puro y sin `node:crypto`: lo usan el servidor (que decide y registra) y la pantalla (que
 * muestra la declaración mientras se llena), y los dos tienen que armar EL MISMO texto, o la
 * constancia no probaría lo que la persona leyó.
 *
 * ## Dónde se exigen
 *
 * La cláusula 3.1 de los términos de Valida dice que las credenciales se entregan únicamente
 * después de la aceptación. Desde el 2026-09-16 (tarde) la exigencia no es de la pestaña Llaves
 * sino de TODO el módulo: la entrada única de `entrada.ts` pide, por usuario, leer los términos
 * vigentes hasta el final y aceptar la Política, y además que el contrato del espacio tenga su
 * aceptación contractual. Sin las tres cosas no hay pestañas ni acciones del servidor.
 *
 * Sin documentos vigentes registrados el módulo no se abre: «no hay nada que aceptar» no es lo
 * mismo que «ya se aceptó», y la cláusula habla de lo segundo.
 *
 * ## Quién acepta
 *
 * El dueño del espacio (owner), que es quien puede obligar a la empresa, y nunca el soporte de
 * MeTRIK (platform_admin), ni visitando el espacio. La base lo vuelve a exigir en
 * `aceptaciones_terminos_modulo()` (migración 20260917014500).
 */

import type { DocumentoContractual } from './resultados'

export const CALIDADES_ACEPTANTE = {
  representante_legal: 'Representante legal',
  apoderado: 'Apoderado',
} as const

export type CalidadAceptante = keyof typeof CALIDADES_ACEPTANTE

/** Etiqueta legible de una calidad guardada, también las del canal WhatsApp. */
export function etiquetaCalidad(calidad: string | null | undefined): string | null {
  if (!calidad) return null
  const conocidas: Record<string, string> = {
    ...CALIDADES_ACEPTANTE,
    persona_natural: 'Persona natural',
    autorizado: 'Autorizado',
  }
  return (conocidas[calidad] ?? calidad).toLowerCase()
}

/** Tope de `aceptaciones_terminos.texto_aceptacion` (CHECK de la tabla). */
export const LARGO_MAXIMO_DECLARACION = 1024

export type EstadoTerminos =
  | { estado: 'aceptados' }
  | { estado: 'pendientes'; pendientes: DocumentoContractual[] }
  | { estado: 'sin_documentos' }

/** ¿La versión rige hoy? Las fechas vienen como 'YYYY-MM-DD' y `hoy` es el día en Bogotá. */
export function documentoVigente(
  doc: Pick<DocumentoContractual, 'vigenteDesde' | 'vigenteHasta'>,
  hoy: string,
): boolean {
  if (!doc.vigenteDesde || doc.vigenteDesde.slice(0, 10) > hoy) return false
  return !doc.vigenteHasta || doc.vigenteHasta.slice(0, 10) >= hoy
}

/**
 * Las versiones que rigen hoy, una por documento, con si tienen constancia contractual.
 * `mis_documentos_de_servicio()` devuelve una fila por documento Y por constancia, así que un
 * documento cuenta como aceptado si CUALQUIERA de sus filas trae fecha de aceptación. Ordenadas
 * por slug y fecha de vigencia: la pantalla las muestra en ese orden y el servidor arma el texto
 * de la casilla en el mismo.
 */
export function vigentesConAceptacion(
  documentos: readonly DocumentoContractual[],
  hoy: string,
): { doc: DocumentoContractual; aceptado: boolean }[] {
  const vigentes = new Map<string, { doc: DocumentoContractual; aceptado: boolean }>()
  for (const d of documentos) {
    if (!documentoVigente(d, hoy)) continue
    const previo = vigentes.get(d.documentoId)
    vigentes.set(d.documentoId, {
      doc: previo?.doc ?? d,
      aceptado: (previo?.aceptado ?? false) || d.aceptadoAt !== null,
    })
  }
  return [...vigentes.values()].sort(
    (a, b) => a.doc.slug.localeCompare(b.doc.slug) || a.doc.vigenteDesde.localeCompare(b.doc.vigenteDesde),
  )
}

/** Qué falta aceptar del contrato. */
export function estadoTerminos(documentos: readonly DocumentoContractual[], hoy: string): EstadoTerminos {
  const vigentes = vigentesConAceptacion(documentos, hoy)
  if (vigentes.length === 0) return { estado: 'sin_documentos' }
  const pendientes = vigentes.filter((v) => !v.aceptado).map((v) => v.doc)
  return pendientes.length === 0 ? { estado: 'aceptados' } : { estado: 'pendientes', pendientes }
}

export type RazonNoAcepta = 'no_owner' | 'soporte' | 'otro_espacio'

/**
 * ¿La persona de la sesión REAL puede aceptar? Se decide con su perfil, no con el rol de
 * getWorkspace (que puede venir de «Ver como»).
 */
export function puedeAceptarTerminos(
  perfil: { role: string | null; workspaceId: string | null; platformAdmin: boolean },
  workspaceId: string,
): { puede: true } | { puede: false; razon: RazonNoAcepta } {
  if (perfil.platformAdmin) return { puede: false, razon: 'soporte' }
  if (perfil.workspaceId !== workspaceId) return { puede: false, razon: 'otro_espacio' }
  if (perfil.role !== 'owner') return { puede: false, razon: 'no_owner' }
  return { puede: true }
}

export interface DatosAceptante {
  nombre: string
  cedula: string
  calidad: CalidadAceptante
}

/** Nombre sin espacios sobrantes. */
export function normalizarNombre(nombre: unknown): string {
  return typeof nombre === 'string' ? nombre.normalize('NFC').replace(/\s+/g, ' ').trim() : ''
}

/** Cédula solo con dígitos: se aceptan puntos y espacios al escribirla. */
export function normalizarCedula(cedula: unknown): string {
  return typeof cedula === 'string' ? cedula.replace(/[\s.]/g, '') : ''
}

const LETRAS = /^[\p{L}][\p{L}'’\- ]*$/u

export function validarDatosAceptante(input: {
  nombre?: unknown
  cedula?: unknown
  calidad?: unknown
  declaraFacultades?: unknown
}): { ok: true; datos: DatosAceptante } | { ok: false; error: string } {
  const nombre = normalizarNombre(input.nombre)
  if (nombre.length < 5 || nombre.length > 120 || nombre.split(' ').length < 2 || !LETRAS.test(nombre)) {
    return { ok: false, error: 'Escribe tu nombre completo, con nombres y apellidos.' }
  }
  const cedula = normalizarCedula(input.cedula)
  if (!/^[0-9]{5,12}$/.test(cedula)) {
    return { ok: false, error: 'La cédula debe tener entre 5 y 12 dígitos, sin letras.' }
  }
  if (typeof input.calidad !== 'string' || !(input.calidad in CALIDADES_ACEPTANTE)) {
    return { ok: false, error: 'Indica si aceptas como representante legal o como apoderado.' }
  }
  if (input.declaraFacultades !== true) {
    return { ok: false, error: 'Para aceptar tienes que declarar que tienes facultades para obligar a la empresa.' }
  }
  return { ok: true, datos: { nombre, cedula, calidad: input.calidad as CalidadAceptante } }
}

/** Una versión del contrato por firmar, con la empresa que la firma. El texto se lee aparte. */
export interface DocumentoPorAceptar {
  documentoId: string
  titulo: string
  version: string
  pdfSha256: string
  empresaNombre: string
  empresaNit: string
}

/**
 * El texto EXACTO que se firma. Sigue la declaración de la cláusula 16.2 de los términos v1.0
 * (la del WhatsApp), con dos datos que por WhatsApp constaban en el registro y aquí van en el
 * texto: la cédula de quien acepta y la huella del PDF leído.
 */
export function textoDeclaracionTerminos(
  doc: Pick<DocumentoPorAceptar, 'titulo' | 'version' | 'pdfSha256' | 'empresaNombre' | 'empresaNit'>,
  datos: DatosAceptante,
): string {
  const calidad = CALIDADES_ACEPTANTE[datos.calidad].toUpperCase()
  return (
    `Yo, ${datos.nombre}, identificado(a) con cédula ${datos.cedula}, actúo como ${calidad} de ` +
    `${doc.empresaNombre} (NIT ${doc.empresaNit}). Declaro bajo la gravedad de juramento que tengo ` +
    `facultades para obligarla y, en su nombre, ACEPTO los ${doc.titulo} ${doc.version} que leí en el ` +
    `módulo Valida API de MeTRIK ONE (huella SHA-256 del PDF: ${doc.pdfSha256}). ${doc.empresaNombre} ` +
    `conoce y ratifica esta actuación. Si no tuviera esas facultades, respondo personalmente. Esta ` +
    `aceptación vale como firma (Ley 527 de 1999).`
  )
}

/**
 * Una versión con el contrato que la respalda, tal como la lee el servidor con el cliente de
 * servicio. Es la fuente de las huellas y de los datos de la empresa: nada de eso llega del
 * navegador.
 */
export interface VersionContratada {
  documentoId: string
  workspaceCobradorId: string
  titulo: string
  version: string
  textoSha256: string
  pdfSha256: string
  empresaNombre: string
  empresaNit: string
  negocioId: string
}

/** Fila de `aceptaciones_terminos` del canal módulo. `respondido_at` y la huella los pone la base. */
export interface FilaAceptacionModulo {
  workspace_id: string
  negocio_id: string
  canal: 'modulo'
  estado: 'aceptado'
  nombre_aceptante: string
  cedula_aceptante: string
  calidad: CalidadAceptante
  empresa_nombre: string
  empresa_nit: string
  usuario_id: string
  workspace_cliente_id: string
  documento_version_id: string
  documento_titulo: string
  documento_version: string
  documento_sha256: string
  texto_documento_sha256: string
  texto_aceptacion: string
  ip: string | null
  user_agent: string | null
}

export type PreparacionAceptacion =
  | { tipo: 'ya_aceptado' }
  | { tipo: 'error'; error: string }
  | { tipo: 'fila'; fila: FilaAceptacionModulo }

/**
 * Todo lo que se decide antes de escribir la constancia, sin tocar la base. El servidor junta los
 * datos (documentos visibles para la sesión, la versión con su contrato, el perfil real) y esta
 * función dice si se puede y con qué fila.
 *
 * `declaracionMostrada` es el texto que la pantalla tenía a la vista cuando la persona marcó la
 * casilla. Si no es idéntico al que arma el servidor con los datos de la base, no se registra:
 * la constancia tiene que ser de lo que se leyó, no de lo que el servidor cree que se leyó.
 */
export function prepararAceptacion(p: {
  documentos: readonly DocumentoContractual[]
  hoy: string
  documentoId: string
  version: VersionContratada | null
  input: { nombre?: unknown; cedula?: unknown; calidad?: unknown; declaraFacultades?: unknown }
  declaracionMostrada: unknown
  usuarioId: string
  workspaceClienteId: string
  ip: string | null
  userAgent: string | null
}): PreparacionAceptacion {
  const filas = p.documentos.filter((d) => d.documentoId === p.documentoId)
  if (filas.length === 0) {
    return { tipo: 'error', error: 'Ese documento no está entre los términos de tu contrato.' }
  }
  if (filas.some((d) => d.aceptadoAt !== null)) return { tipo: 'ya_aceptado' }
  if (!documentoVigente(filas[0], p.hoy)) {
    return { tipo: 'error', error: 'Esa versión de los términos no está vigente hoy.' }
  }
  if (!p.version || p.version.documentoId !== p.documentoId || p.version.pdfSha256 !== filas[0].pdfSha256) {
    return { tipo: 'error', error: 'No se pudo leer el contrato de ese documento. Intenta de nuevo en un momento.' }
  }

  const validos = validarDatosAceptante(p.input)
  if (!validos.ok) return { tipo: 'error', error: validos.error }

  const texto = textoDeclaracionTerminos(p.version, validos.datos)
  if (texto.length > LARGO_MAXIMO_DECLARACION) {
    return { tipo: 'error', error: 'La declaración supera el largo permitido. Escríbenos para registrarla.' }
  }
  if (p.declaracionMostrada !== texto) {
    return {
      tipo: 'error',
      error: 'El texto de la declaración cambió mientras la revisabas. Recarga la página y vuelve a leerlo.',
    }
  }

  const v = p.version
  return {
    tipo: 'fila',
    fila: {
      workspace_id: v.workspaceCobradorId,
      negocio_id: v.negocioId,
      canal: 'modulo',
      estado: 'aceptado',
      nombre_aceptante: validos.datos.nombre,
      cedula_aceptante: validos.datos.cedula,
      calidad: validos.datos.calidad,
      empresa_nombre: v.empresaNombre,
      empresa_nit: v.empresaNit,
      usuario_id: p.usuarioId,
      workspace_cliente_id: p.workspaceClienteId,
      documento_version_id: v.documentoId,
      documento_titulo: v.titulo,
      documento_version: v.version,
      documento_sha256: v.pdfSha256,
      texto_documento_sha256: v.textoSha256,
      texto_aceptacion: texto,
      ip: p.ip,
      user_agent: p.userAgent,
    },
  }
}
