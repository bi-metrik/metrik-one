// ============================================================
// Acceso a los archivos de un negocio en almacenamiento externo.
//
// Dos consumidores, UNA validación:
//   · `GET /api/archivos/abrir?ref=...` (`resolverApertura`)
//   · la vista del repositorio `/negocios/<id>/archivos` (`resolverAccesoNegocio`)
// Si cada uno validara por su cuenta, el día que uno cambie la vista listaría lo que
// el endpoint no deja abrir, o al revés.
//
// El criterio vive aquí para poder probarlo sin Next ni base (un `route.ts` no puede
// exportar helpers: el build lo rechaza).
//
// Orden de las puertas, y por qué:
//   1. la referencia tiene forma válida y es del bucket de ONE     → 400   (solo abrir)
//   2. hay sesión con workspace                                    → 401
//   3. el negocio es del workspace de la sesión                    → 404
//      (404 y no 403: a quien no es del workspace no se le confirma que existe)
//   4. el usuario puede ver ESE negocio (operator: solo si es responsable) → 403
//   5. el workspace de la sesión usa almacenamiento externo         → 404
//   6. firmar por 5 minutos y redirigir; config incompleta         → 503
// ============================================================

import { ErrorAlmacenamiento } from './config'
import { BUCKET_ARCHIVOS, negocioDeRuta, parsearReferencia } from './referencia'

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

/** Puertas 2 a 4: sesión, negocio del workspace, permiso sobre el negocio. */
export async function resolverAccesoNegocio(
  negocioId: string,
  deps: DependenciasAcceso,
): Promise<ResultadoAcceso> {
  const workspaceId = await deps.workspaceDeSesion()
  if (!workspaceId) return { tipo: 'error', status: 401, mensaje: 'Inicia sesión para ver estos archivos' }

  if (!(await deps.negocioEsDelWorkspace(negocioId, workspaceId))) {
    return { tipo: 'error', status: 404, mensaje: 'Negocio no encontrado' }
  }
  if (!(await deps.puedeVerNegocio(negocioId))) {
    return { tipo: 'error', status: 403, mensaje: 'Sin acceso a este negocio' }
  }
  return { tipo: 'ok', workspaceId }
}

export async function resolverApertura(
  ref: string | null,
  descargar: boolean,
  deps: DependenciasApertura,
): Promise<ResultadoApertura> {
  const partes = parsearReferencia(ref)
  if (!partes || partes.bucket !== BUCKET_ARCHIVOS) {
    return { tipo: 'error', status: 400, mensaje: 'Referencia de archivo inválida' }
  }
  const negocioId = negocioDeRuta(partes.path)
  if (!negocioId) return { tipo: 'error', status: 400, mensaje: 'Referencia de archivo inválida' }

  const acceso = await resolverAccesoNegocio(negocioId, deps)
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
