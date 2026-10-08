/**
 * El estado de la autorización de un contacto, tal como lo devuelve la RPC
 * `autorizacion_datos_estado` (la regla de vigencia vive allá, una sola vez, para la app y el
 * bot), y el gate de avance que lo lee. Puro.
 */

import type { CasillasMarcadas, ClaveCasilla, Medio } from './texto'

export interface EstadoAutorizacion {
  existe: boolean
  contacto: { nombre: string; email: string | null } | null
  texto: { id: string; version: string; mayor: number; menor: number } | null
  aceptacion: {
    enlace_id: string
    aceptado_at: string
    version: string
    mayor: number
    menor: number
    medio: Medio
    casillas: CasillasMarcadas
    revocadas: Record<string, unknown>
  } | null
  vigente: Record<ClaveCasilla, boolean>
  requiere_reaceptar: boolean
  pendiente: {
    enlace_id: string
    token: string
    expira_at: string
    correo_enviado_at: string | null
    rechazado_at: string | null
  } | null
  manual_sin_evidencia: { fecha: string | null } | null
}

const NADA: Record<ClaveCasilla, boolean> = { generales: false, sensibles: false, menores: false, ofertas: false }

/** De lo que devuelve la RPC al tipo. Lo que no tenga forma se lee como «no autorizado». */
export function leerEstado(raw: unknown): EstadoAutorizacion {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const vig = (r.vigente && typeof r.vigente === 'object' ? r.vigente : {}) as Record<string, unknown>
  return {
    existe: r.existe === true,
    contacto: (r.contacto as EstadoAutorizacion['contacto']) ?? null,
    texto: (r.texto as EstadoAutorizacion['texto']) ?? null,
    aceptacion: (r.aceptacion as EstadoAutorizacion['aceptacion']) ?? null,
    vigente: {
      generales: vig.generales === true,
      sensibles: vig.sensibles === true,
      menores: vig.menores === true,
      ofertas: vig.ofertas === true,
    },
    requiere_reaceptar: r.requiere_reaceptar === true,
    pendiente: (r.pendiente as EstadoAutorizacion['pendiente']) ?? null,
    manual_sin_evidencia: (r.manual_sin_evidencia as EstadoAutorizacion['manual_sin_evidencia']) ?? null,
  }
}

export const ESTADO_VACIO: EstadoAutorizacion = leerEstado({ existe: false, vigente: NADA })

// ─── Menores del viaje ──────────────────────────────────────────────────────

/**
 * ¿El viaje lleva menores? Niños o infantes mayores de 0 en cualquier bloque del negocio
 * (`condiciones_del_viaje` en Trappvel). Se busca por SLUG DE CAMPO, como la composición de la
 * cotización (`lib/cotizaciones/viaje-negocio.ts`): no depende de cómo se llame el bloque.
 *
 * Vacío o ilegible NO cuenta como menores: si el dato falta, el mínimo de la solicitud ya lo
 * pide; este gate exige la casilla de menores cuando el viaje DICE que hay.
 */
export function hayMenores(filas: ReadonlyArray<Record<string, unknown> | null | undefined>): boolean {
  for (const f of filas) {
    if (!f) continue
    for (const slug of ['ninos', 'infantes']) {
      const n = Number(typeof f[slug] === 'string' ? (f[slug] as string).trim() : f[slug])
      if (Number.isFinite(n) && n > 0) return true
    }
  }
  return false
}

// ─── El gate de avance ──────────────────────────────────────────────────────

export const GATE_AUTORIZACION = 'autorizacion_datos'

export type FaltaGate = 'sin_contacto' | 'generales' | 'menores'

export const MENSAJE_GATE: Record<FaltaGate, string> = {
  sin_contacto: 'El negocio no tiene contacto: asígnale el cliente para pedirle la autorización de datos.',
  generales: 'Falta que el cliente autorice el tratamiento de datos. Envíale el link:',
  menores: 'El viaje lleva menores y el cliente no autorizó el uso de sus datos. Envíale el link:',
}

/**
 * Qué frena el avance. Un cliente recurrente que ya autorizó (en cualquier viaje: vive en el
 * contacto) pasa sin volver a firmar, salvo que se haya publicado una versión MAYOR posterior.
 * La marca manual vieja (`manual_sin_evidencia`) no cuenta: la RPC no la suma a `vigente`.
 */
export function faltaParaAvanzar(
  estado: EstadoAutorizacion | null,
  opts: { menores: boolean },
): FaltaGate | null {
  if (!estado || !estado.existe) return 'sin_contacto'
  if (!estado.vigente.generales) return 'generales'
  if (opts.menores && !estado.vigente.menores) return 'menores'
  return null
}

/** El estado en una línea, para el bloque y el bot. */
export type FaseAutorizacion = 'aprobada' | 'reaceptar' | 'rechazada' | 'enviada' | 'pendiente'

export function faseDe(estado: EstadoAutorizacion): FaseAutorizacion {
  if (estado.vigente.generales) return 'aprobada'
  if (estado.requiere_reaceptar) return 'reaceptar'
  if (estado.pendiente?.rechazado_at) return 'rechazada'
  if (estado.pendiente?.correo_enviado_at) return 'enviada'
  return 'pendiente'
}
