// ============================================================
// Decisión de `GET /api/archivos/abrir?ref=...`.
//
// La ruta solo cablea dependencias; el criterio vive aquí para poder probarlo sin
// Next ni base (un `route.ts` no puede exportar helpers: el build lo rechaza).
//
// Orden de las puertas, y por qué:
//   1. la referencia tiene forma válida y es del bucket de ONE     → 400
//   2. hay sesión con workspace                                    → 401
//   3. el negocio de la ruta es del workspace de la sesión          → 404
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

export interface DependenciasApertura {
  /** Workspace efectivo de la sesión (respeta "Ver como"), o null sin sesión. */
  workspaceDeSesion(): Promise<string | null>
  negocioEsDelWorkspace(negocioId: string, workspaceId: string): Promise<boolean>
  puedeVerNegocio(negocioId: string): Promise<boolean>
  /** URL firmada, o null si el workspace NO usa almacenamiento externo. */
  firmar(workspaceId: string, referencia: string, opciones: { descargar: boolean }): Promise<string | null>
}

const NO_ENCONTRADO = { tipo: 'error', status: 404, mensaje: 'Archivo no encontrado' } as const

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

  const workspaceId = await deps.workspaceDeSesion()
  if (!workspaceId) return { tipo: 'error', status: 401, mensaje: 'Inicia sesión para abrir este archivo' }

  if (!(await deps.negocioEsDelWorkspace(negocioId, workspaceId))) return NO_ENCONTRADO
  if (!(await deps.puedeVerNegocio(negocioId))) {
    return { tipo: 'error', status: 403, mensaje: 'Sin acceso a este negocio' }
  }

  try {
    const url = await deps.firmar(workspaceId, ref as string, { descargar })
    if (!url) return NO_ENCONTRADO
    return { tipo: 'redirigir', url }
  } catch (e) {
    if (e instanceof ErrorAlmacenamiento) {
      return { tipo: 'error', status: 503, mensaje: e.message }
    }
    return NO_ENCONTRADO
  }
}
