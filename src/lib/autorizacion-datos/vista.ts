/**
 * Lo que la pantalla muestra de la autorización de un contacto, en el bloque del viaje y en la
 * ficha del directorio. Puro: arma la vista desde el estado de la RPC (`autorizacion_datos_estado`,
 * donde vive la regla de vigencia) y decide quién la ve y quién pide el link.
 *
 * Aquí NO se decide qué cuenta como autorizado: verde es `faseDe(estado) === 'aprobada'`, que es
 * `vigente.generales` de la RPC, lo mismo que mira el gate.
 */

import { faseDe, type EstadoAutorizacion, type FaseAutorizacion } from './estado'
import type { ClaveCasilla } from './texto'

export interface VersionEvidencia {
  id: string
  version: string
  casillas: Array<{ clave: ClaveCasilla; texto: string }>
}

export interface VistaAutorizacionContacto {
  contactoNombre: string
  tieneCorreo: boolean
  fase: FaseAutorizacion
  aceptadoAt: string | null
  version: string | null
  casillas: Partial<Record<ClaveCasilla, boolean | null>> | null
  vigente: Record<ClaveCasilla, boolean>
  correoEnviadoAt: string | null
  rechazadoAt: string | null
  manualSinEvidencia: { fecha: string | null } | null
  textoPublicado: boolean
  versionVigente: string | null
  /** `link` o `evidencia` (registrada por el equipo con el archivo). */
  via: 'link' | 'evidencia' | null
  /** La vía «recibida por otro medio» está encendida en el workspace: sus versiones para elegir. */
  evidencia: { versiones: VersionEvidencia[] } | null
}

export function armarVista(estado: EstadoAutorizacion, evidencia: VersionEvidencia[] | null): VistaAutorizacionContacto {
  return {
    contactoNombre: estado.contacto?.nombre ?? '',
    tieneCorreo: !!estado.contacto?.email,
    fase: faseDe(estado),
    aceptadoAt: estado.aceptacion?.aceptado_at ?? null,
    version: estado.aceptacion?.version ?? null,
    casillas: estado.aceptacion?.casillas ?? null,
    vigente: estado.vigente,
    correoEnviadoAt: estado.pendiente?.correo_enviado_at ?? null,
    rechazadoAt: estado.pendiente?.rechazado_at ?? null,
    manualSinEvidencia: estado.manual_sin_evidencia,
    textoPublicado: !!estado.texto,
    versionVigente: estado.texto?.version ?? null,
    via: estado.aceptacion?.via ?? null,
    evidencia: evidencia ? { versiones: evidencia } : null,
  }
}

/** Verde solo si está aprobada; todo lo demás es rojo (el viaje no pasa a Cotización). */
export function autorizada(vista: Pick<VistaAutorizacionContacto, 'fase'>): boolean {
  return vista.fase === 'aprobada'
}

/** Dónde se muestra: dentro de un viaje o en la ficha del contacto del directorio. */
export type AlcanceVista = 'viaje' | 'contacto'

export const CONSECUENCIA_SIN_AUTORIZACION: Record<AlcanceVista, string> = {
  viaje: 'Sin esta autorización el viaje no pasa a Cotización.',
  contacto: 'Sin esta autorización los viajes de este cliente no pasan a Cotización.',
}

// ─── Permisos por contacto (ficha del directorio) ─────────────────────────────

/**
 * En el viaje, el permiso lo da el bloque (`guardVerNegocio` / `guardEditarBloque`). En el
 * directorio no hay bloque ni etapa: se aplica la misma base de roles.
 *
 * Ver: todos menos `contador` (que tampoco ve negocios, `canViewNegocio`).
 */
export function puedeVerAutorizacion(role: string | null): boolean {
  return !!role && role !== 'contador'
}

/**
 * Pedir el link (copiarlo o mandarlo por correo): owner, admin y supervisor; el `operator` solo
 * si es responsable del contacto o de uno de sus viajes (como en `canViewNegocio`). `read_only` y
 * `contador` nunca (fuera del modelo en `canEditBloque`).
 */
export function puedePedirAutorizacion(role: string | null, esResponsable: boolean): boolean {
  if (role === 'owner' || role === 'admin' || role === 'supervisor') return true
  if (role === 'operator') return esResponsable
  return false
}
