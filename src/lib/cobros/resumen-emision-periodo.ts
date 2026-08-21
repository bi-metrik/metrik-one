/**
 * Emitir un periodo son DOS caminos, y quien los invoca tiene que sumarlos igual.
 *
 *   - uniformes  (`generarCuentasCobroPeriodo`): una cuenta por empresa, vencimiento dia 15
 *   - explicitas (`emitirCuentasExplicitasPeriodo`): una cuenta por cuota de `plan_cobro_cuotas`
 *
 * Los invocan el cron, el script de rescate y el boton de `/cobros-recurrentes`.
 * Las dos reglas que siguen (el offset del correlativo en dry-run y la suma de
 * conteos) estaban escritas dentro del script; al agregar el segundo camino al
 * boton habrian quedado copiadas. La formula de saldo de este repo ya enseño que
 * una regla copiada se desincroniza y que el conteo heredado nunca es un
 * inventario cerrado, asi que vive en UN solo sitio y con pruebas.
 *
 * Modulo puro a proposito: sin Supabase, sin red. Se prueba sin mocks. Los dos
 * `import type` de abajo se borran al compilar (`isolatedModules`), asi que este
 * modulo lo puede importar tambien un componente de cliente sin arrastrar Drive
 * ni el render de PDF al bundle.
 */

import type { GenerarCuentasResult } from './generar-cuentas-cobro'
import type { EmitirExplicitasResult } from './emitir-cuota-explicita'

/** Lo minimo que el resumen necesita de un detalle uniforme. */
export type DetalleUniformeMin = { estado: 'creada' | 'omitida' | 'error' }

/** Lo minimo que el resumen necesita de cada camino. */
export type ConteosUniformes = {
  cuentasCreadas: number
  cuentasOmitidas: number
  errores: { empresa_id: string; error: string }[]
}

export type ConteosExplicitas = {
  cuentasCreadas: number
  cuentasOmitidas: number
  errores: { plan_cuota_id: string; error: string }[]
}

export type ErrorEmision = {
  origen: 'uniforme' | 'explicita'
  /** empresa_id o plan_cuota_id, segun el origen. Sirve para ubicar el fallo. */
  ref: string
  error: string
}

export type ResumenEmisionPeriodo = {
  cuentasCreadas: number
  cuentasOmitidas: number
  errores: ErrorEmision[]
}

/**
 * Lo que devuelve la emision de un periodo: el resumen sumado MAS el detalle de
 * cada camino sin aplanar.
 *
 * No se aplanan porque las dos listas no son la misma cosa: una fila uniforme es
 * una empresa con N cobros agrupados y una explicita es UNA cuota con su
 * vencimiento propio. Aplanarlas obligaria a inventar un detalle comun que
 * mentiria en los dos lados; la pantalla las pinta en secciones distintas.
 */
export type EmitirPeriodoResult = ResumenEmisionPeriodo & {
  uniformes: GenerarCuentasResult
  explicitas: EmitirExplicitasResult
}

/**
 * Cuantas posiciones hay que desplazar el correlativo de las cuentas explicitas.
 *
 * Solo aplica en dry-run: como el preview no inserta nada, el `MAX(consecutivo)+1`
 * de la base no se mueve entre un camino y el otro, y las dos listas imprimirian
 * el MISMO numero. En emision real siempre es 0 — cada insert corre el max de verdad.
 *
 * Se cuentan solo los detalles que crearian cuenta: los `omitida` reusan el numero
 * que ya tienen y los `error` no llegan a pedir uno.
 */
export function offsetCorrelativoExplicitas(
  detallesUniformes: DetalleUniformeMin[],
  dryRun: boolean,
): number {
  if (!dryRun) return 0
  return detallesUniformes.filter((d) => d.estado === 'creada').length
}

/**
 * Suma los dos caminos en el conteo unico que lee la pantalla (y el toast).
 *
 * Los errores conservan de que camino vienen: "empresa X" y "cuota Y" no se
 * diagnostican en el mismo sitio, y un listado que los mezcle sin decirlo manda
 * a buscar al lugar equivocado.
 */
export function resumirEmisionPeriodo(
  uniformes: ConteosUniformes,
  explicitas: ConteosExplicitas,
): ResumenEmisionPeriodo {
  return {
    cuentasCreadas: uniformes.cuentasCreadas + explicitas.cuentasCreadas,
    cuentasOmitidas: uniformes.cuentasOmitidas + explicitas.cuentasOmitidas,
    errores: [
      ...uniformes.errores.map((e): ErrorEmision => ({
        origen: 'uniforme',
        ref: e.empresa_id,
        error: e.error,
      })),
      ...explicitas.errores.map((e): ErrorEmision => ({
        origen: 'explicita',
        ref: e.plan_cuota_id,
        error: e.error,
      })),
    ],
  }
}
