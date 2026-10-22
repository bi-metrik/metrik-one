/**
 * El estado (Completo / Pendiente) de los bloques cuyo trabajo NO se guarda en el bloque.
 *
 * La cabecera de todo bloque lee `negocio_bloques.estado`. Tres tipos nunca lo escribían, porque
 * su dato vive en otro sitio:
 *   · «Autorización de datos» (`contacto`, variante `autorizacion`): la firma el titular en su link
 *     y queda en `autorizacion_datos_enlaces` / `contactos`. El caso de Mauricio (2026-10-22): con
 *     la autorización aprobada, el bloque seguía en «Pendiente».
 *   · «Ficha del cliente» (`contacto`, variante `campos`): escribe en `contactos`.
 *   · «Servicios del viaje» (`servicios`): escribe en `negocio_servicios` y `gastos`.
 *
 * Aquí vive UNA regla por tipo, y es la misma del gate que frena el avance:
 *   · autorización → `faltaParaAvanzar` sobre la RPC `autorizacion_datos_estado` (el gate
 *     `autorizacion_datos`, `gate-servidor.ts`). Revocada o con versión mayor por aceptar, vuelve
 *     a pendiente;
 *   · servicios → `serviciosListos` (el gate `servicios_listos`);
 *   · ficha → los campos `required` de la config del bloque, llenos en el contacto.
 *
 * Puro: no toca DB ni red.
 */

import { faltaParaAvanzar, type EstadoAutorizacion } from '@/lib/autorizacion-datos/estado'
import { leerCampo, type CampoContacto, type ValoresContacto } from '@/lib/contactos/campos-contacto'
import { serviciosListos } from '@/lib/viaje/gate-servicios'
import type { ServicioDelNegocio } from '@/lib/viaje/servicios-viaje-datos'

export type EstadoBloque = 'completo' | 'pendiente'

export type TipoDerivado = 'autorizacion' | 'ficha' | 'servicios'

/** ¿Este bloque tiene estado derivado? Por el tipo de su definición y la variante de su config. */
export function tipoDerivado(defTipo: string | null | undefined, configExtra: Record<string, unknown> | null | undefined): TipoDerivado | null {
  if (defTipo === 'servicios') return 'servicios'
  if (defTipo !== 'contacto') return null
  return configExtra?.variante === 'autorizacion' ? 'autorizacion' : 'ficha'
}

export function estadoAutorizacion(estado: EstadoAutorizacion | null, menores: boolean): EstadoBloque {
  return faltaParaAvanzar(estado, { menores }) === null ? 'completo' : 'pendiente'
}

function lleno(campo: CampoContacto, v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (campo.tipo === 'toggle') return v === true
  if (typeof v === 'string') return v.trim() !== ''
  return true
}

/** La ficha: completa cuando todos los campos obligatorios están llenos. Sin contacto, pendiente. */
export function estadoFicha(campos: readonly CampoContacto[], valores: ValoresContacto | null): EstadoBloque {
  if (!valores) return 'pendiente'
  return campos.filter(c => c.required).every(c => lleno(c, leerCampo(valores, c.slug))) ? 'completo' : 'pendiente'
}

export function estadoServicios(filas: readonly ServicioDelNegocio[], exigeConfirmacion: boolean): EstadoBloque {
  return serviciosListos(filas, exigeConfirmacion) ? 'completo' : 'pendiente'
}

/**
 * Lo que hay que escribir: los que cambian entre `pendiente` y `completo`. `derivado` en `null` = no
 * se pudo saber, y entonces no se toca nada (ni en pantalla ni en la base).
 */
export function cambiosDeEstado(
  bloques: ReadonlyArray<{ instanciaId: string; actual: string; derivado: EstadoBloque | null }>,
): { completar: string[]; reabrir: string[] } {
  const completar: string[] = []
  const reabrir: string[] = []
  for (const b of bloques) {
    if (!b.derivado || b.derivado === b.actual) continue
    // Otro estado (`rechazado`…) lo puso alguien a propósito: no se pisa.
    if (b.actual !== 'pendiente' && b.actual !== 'completo') continue
    if (b.derivado === 'completo') completar.push(b.instanciaId)
    else reabrir.push(b.instanciaId)
  }
  return { completar, reabrir }
}
