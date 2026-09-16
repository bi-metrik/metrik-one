// ============================================================
// Acceso a un archivo guardado por referencia. UNA puerta para los dos esquemas
// (`sbext://` del proyecto del cliente, `one://` de los buckets de ONE) y para los dos
// consumidores:
//   · `GET /api/archivos/abrir?ref=...` (`resolverApertura`)
//   · la vista del repositorio `/negocios/<id>/archivos` (`resolverAccesoNegocio`)
// Si cada uno validara por su cuenta, el día que uno cambie la vista listaría lo que
// el endpoint no deja abrir, o al revés.
//
// El criterio vive aquí para poder probarlo sin Next ni base (un `route.ts` no puede
// exportar helpers: el build lo rechaza).
//
// Orden de las puertas, y por qué:
//   1. la referencia tiene forma válida y se le puede atribuir dueño → 400  (solo abrir)
//   2. hay sesión con workspace                                      → 401
//   3. si la RUTA declara workspace (`one://`), es el de la sesión    → 404
//      (404 y no 403: a quien no es del workspace no se le confirma que existe)
//   4. si el archivo cuelga de un negocio: el negocio es del workspace → 404
//      y el usuario puede ver ESE negocio (`operator`: solo el suyo)  → 403
//   5. el workspace puede firmar ese archivo                          → 404
//   6. firmar y redirigir; config incompleta                          → 503
//
// Las puertas 3 y 4 son independientes y se acumulan: un documento de negocio en un
// bucket de ONE pasa por las dos. La 4 se salta SOLO cuando el archivo no cuelga de
// ningún negocio (el comprobante de un gasto, el soporte de un pago). No es un permiso
// más laxo elegido aquí: es el mismo alcance que ya tienen las pantallas que pintan
// esos enlaces, que filtran por workspace y por rol. El razonamiento completo está en
// `duenoDeReferencia`.
// ============================================================

import { ErrorAlmacenamiento } from './config'
import { duenoDeReferencia, type DuenoArchivo } from './referencia'

export type ResultadoApertura =
  | { tipo: 'redirigir'; url: string }
  | { tipo: 'error'; status: 400 | 401 | 403 | 404 | 503; mensaje: string }

export type ResultadoAcceso =
  | { tipo: 'ok'; workspaceId: string }
  | { tipo: 'error'; status: 401 | 403 | 404; mensaje: string }

export interface DependenciasAcceso {
  /** Workspace efectivo de la sesión (respeta "Ver como"), o null sin sesión. */
  workspaceDeSesion(): Promise<string | null>
  negocioEsDelWorkspace(negocioId: string, workspaceId: string): Promise<boolean>
  puedeVerNegocio(negocioId: string): Promise<boolean>
}

export interface DependenciasApertura extends DependenciasAcceso {
  /** URL firmada, o null si el workspace NO usa almacenamiento externo. */
  firmar(workspaceId: string, referencia: string, opciones: { descargar: boolean }): Promise<string | null>
}

const NO_ENCONTRADO = { tipo: 'error', status: 404, mensaje: 'Archivo no encontrado' } as const

/**
 * Puertas 2 a 4 sobre el DUEÑO del archivo. Es la única función del producto que decide
 * si un archivo se abre, y sus dos patas son independientes y acumulativas:
 *
 *   · el workspace de la RUTA, cuando la referencia lo trae.
 *   · el negocio dueño, cuando lo hay: pertenencia y permiso. Un documento de negocio se
 *     valida igual esté en Drive, en el proyecto del cliente o en `ve-documentos`.
 */
export async function resolverAcceso(
  dueno: DuenoArchivo,
  deps: DependenciasAcceso,
): Promise<ResultadoAcceso> {
  const workspaceId = await deps.workspaceDeSesion()
  if (!workspaceId) return { tipo: 'error', status: 401, mensaje: 'Inicia sesión para ver estos archivos' }

  // Pata 1 — el workspace que declara la RUTA. Solo la traen las referencias `one://`;
  // es el mismo prefijo que exigen las policies de Storage, y compararlo no cuesta un
  // viaje a la base.
  if (dueno.workspaceId !== null && dueno.workspaceId.toLowerCase() !== workspaceId.toLowerCase()) {
    return { tipo: 'error', status: 404, mensaje: 'Negocio no encontrado' }
  }

  // Pata 2 — el negocio. Corre ENTERA (pertenencia + permiso) siempre que haya negocio,
  // aunque la ruta ya haya declarado el workspace.
  //
  // ⚠️ Las dos mitades hacen falta, y saltarse la primera fue un defecto real que atrapó
  // la prueba «un negocio que no es del workspace de la ruta tampoco pasa»:
  // `puedeVerNegocio` (`guardVerNegocio`) mira responsables y rol, NO el workspace, así
  // que para un owner devuelve `true` sobre un negocio ajeno. La pertenencia la comprueba
  // esta línea y nadie más.
  if (dueno.negocioId) {
    if (!(await deps.negocioEsDelWorkspace(dueno.negocioId, workspaceId))) {
      return { tipo: 'error', status: 404, mensaje: 'Negocio no encontrado' }
    }
    if (!(await deps.puedeVerNegocio(dueno.negocioId))) {
      return { tipo: 'error', status: 403, mensaje: 'Sin acceso a este negocio' }
    }
  } else if (dueno.workspaceId === null) {
    // Ni workspace en la ruta ni negocio: el archivo no se le puede atribuir a nadie.
    // `duenoDeReferencia` ya no devuelve esta forma; queda como fondo del saco para que
    // un dueño nuevo no entre sin puerta por olvido.
    return { tipo: 'error', status: 404, mensaje: 'Negocio no encontrado' }
  }

  return { tipo: 'ok', workspaceId }
}

/**
 * La misma puerta para la vista del repositorio, que parte de un negocio y no de una
 * referencia. Delega para que no existan dos criterios.
 */
export async function resolverAccesoNegocio(
  negocioId: string,
  deps: DependenciasAcceso,
): Promise<ResultadoAcceso> {
  return resolverAcceso({ workspaceId: null, negocioId }, deps)
}

export async function resolverApertura(
  ref: string | null,
  descargar: boolean,
  deps: DependenciasApertura,
): Promise<ResultadoApertura> {
  const dueno = duenoDeReferencia(ref)
  if (!dueno) return { tipo: 'error', status: 400, mensaje: 'Referencia de archivo inválida' }

  const acceso = await resolverAcceso(dueno, deps)
  if (acceso.tipo === 'error') {
    if (acceso.status === 404) return NO_ENCONTRADO
    if (acceso.status === 401) return { tipo: 'error', status: 401, mensaje: 'Inicia sesión para abrir este archivo' }
    return acceso
  }

  try {
    const url = await deps.firmar(acceso.workspaceId, ref as string, { descargar })
    if (!url) return NO_ENCONTRADO
    return { tipo: 'redirigir', url }
  } catch (e) {
    if (e instanceof ErrorAlmacenamiento) {
      return { tipo: 'error', status: 503, mensaje: e.message }
    }
    return NO_ENCONTRADO
  }
}
