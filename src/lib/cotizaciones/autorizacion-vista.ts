/**
 * La autorización del dueño bajo el mínimo, como la pinta el paso de Tarifas de la forma por pasos
 * (P6 de Vera; H6 de la verificación D, 2026-10-14).
 *
 * ⚠️ El defecto que corrige: «Retirar la autorización» exigía `puedeAutorizar`, y
 * `puedeAutorizar` exige que la salida BLOQUEE, cosa que deja de ser cierta justo al autorizar.
 * Con la excepción vigente el dueño nunca veía el botón. Ahora: con la excepción vigente, el
 * dueño (lo dice el servidor, `SalidaVista.esDueno`) la puede retirar; sin ella, autoriza quien
 * puede autorizar, como siempre.
 *
 * Puro: lo usan la vista y su prueba.
 */

export interface SalidaParaAutorizacion {
  aplica: boolean
  bloquea: boolean
  dueno: string | null
  puedeAutorizar: boolean
  /** ¿Quien mira es el dueño del workspace? Ausente en las vistas de antes de H6. */
  esDueno?: boolean
  excepcion: { autorizadaPor: string; motivo: string } | null
  perdida: unknown | null
  excepcionesDisponibles: boolean
}

export interface AutorizacionDeLaVista {
  bloquea: boolean
  dueno: string | null
  /** Ve «Autorizar» (sin excepción) o «Retirar la autorización» (con ella). */
  esDueno: boolean
  vigente: { por: string; motivo: string } | null
  perdida: boolean
  pedido: { por: string | null } | null
  disponible: boolean
}

export function autorizacionDeLaSalida(
  salida: SalidaParaAutorizacion | null,
  pedido: { por: string | null } | null,
): AutorizacionDeLaVista | null {
  if (!salida?.aplica) return null
  const vigente = salida.excepcion ? { por: salida.excepcion.autorizadaPor, motivo: salida.excepcion.motivo } : null
  return {
    bloquea: salida.bloquea,
    dueno: salida.dueno,
    esDueno: vigente ? salida.esDueno === true || salida.puedeAutorizar : salida.puedeAutorizar,
    vigente,
    perdida: !!salida.perdida,
    pedido,
    disponible: salida.excepcionesDisponibles,
  }
}
