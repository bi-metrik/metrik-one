/**
 * ¿El workspace de la sesión puede usar una ACCIÓN? La contraparte, del lado de las server
 * actions, del gate por ruta de `gate.ts`.
 *
 * El gate por ruta cierra la pantalla, no la acción: un export de un archivo `'use server'` es
 * un endpoint que se alcanza por POST sin pasar por el middleware. Un workspace de un solo
 * módulo (4D SOFT con `valida_api`) podía invocar una acción de Clarity o de Sustenta sobre
 * sí mismo, y las que usan credenciales globales de MeTRIK (Valida, ePayco, Drive, Gemini) lo
 * hacían a cargo de MeTRIK.
 *
 * Mismo criterio que la ruta, para que la pantalla y su acción no puedan decir cosas
 * distintas: un módulo está activo con `moduloActivo` (un workspace sin `modules` es Clarity)
 * y el soporte de MeTRIK (`platformAdmin`, solo en su propio espacio) pasa, como pasa el middleware.
 *
 * Puro y sin imports de servidor: lo prueba `requisito.test.ts` sin dobles.
 */

import { moduloActivo, type ContextoGate } from './gate'
import type { IdModulo } from './catalogo'

export interface RequisitoModulo {
  /** Basta con que UNO esté encendido. Son los módulos de la pantalla a la que sirve la acción. */
  modulos?: readonly IdModulo[]
  /**
   * Llave de función que además tiene que estar en `true` (`fab_pago_epayco`,
   * `compliance_dual_informa`, …). Ausente o `false` = no.
   */
  funcion?: string
}

/** Los requisitos que se repiten, con nombre, para que cada acción no escriba el suyo. */
export const REQUISITO = {
  /** Clarity: negocios, gastos, cobros, horas. */
  clarity: { modulos: ['clarity'] },
  /** `/valida`: consultas SARLAFT con la llave del workspace. */
  validaConsulta: { modulos: ['valida'] },
  /** `/compliance/validacion`: Valida con la llave global de MeTRIK. */
  sustenta: { modulos: ['sustenta'] },
  /** `/compliance/listas`: la consulta dual (alma-afi), con la llave global de MeTRIK. */
  sustentaDual: { modulos: ['sustenta'], funcion: 'compliance_dual_informa' },
  /** `/compliance/vinculacion`. */
  sustentaVinculacion: { modulos: ['sustenta'], funcion: 'compliance_vinculacion' },
  /** La cuenta de ePayco de las variables de entorno (la de SOENA). */
  pagoEpayco: { modulos: ['clarity'], funcion: 'fab_pago_epayco' },
  /** `/calidad`: auditoría de llamadas con la llave de Gemini de MeTRIK. */
  llamadas: { modulos: ['llamadas'] },
  /** Cuentas de cobro recurrentes y su planilla PILA (Drive con las credenciales de MeTRIK). */
  cobrosRecurrentes: { modulos: ['clarity'], funcion: 'cobros_recurrentes' },
} as const satisfies Record<string, RequisitoModulo>

export function cumpleRequisitoModulo(req: RequisitoModulo, ctx: ContextoGate): boolean {
  // Un requisito vacío no autoriza nada: un `exigirModulo({})` escrito por descuido tiene que
  // cerrar, no abrir.
  const conModulos = (req.modulos?.length ?? 0) > 0
  const conFuncion = typeof req.funcion === 'string' && req.funcion.length > 0
  if (!conModulos && !conFuncion) return false

  if (ctx.platformAdmin) return true

  if (conModulos && !req.modulos!.some((id) => moduloActivo(id, ctx.modules))) return false
  if (conFuncion && (ctx.modules ?? {})[req.funcion!] !== true) return false
  return true
}
