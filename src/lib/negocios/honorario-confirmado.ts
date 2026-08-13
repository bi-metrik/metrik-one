/**
 * Honorario confirmado: la condicion para dejar registrar un cobro.
 *
 * Decision de Mauricio (2026-08-12): "Ningun caso debe avanzar sin tener un plan
 * escogido que confirme el valor del honorario."
 *
 * ESTE MODULO ES EL ESPEJO EN TS DE `negocio_exige_honorario_confirmado` (SQL).
 * El guard que de verdad frena vive en el trigger de `cobros`, porque hay once
 * sitios distintos que insertan ahi y un criterio replicado en cada uno es un
 * inventario que nadie puede cerrar. Esta copia existe para que la PANTALLA
 * pueda avisar antes de que alguien llene un formulario que va a ser rechazado,
 * y para poder probar el criterio sin base de datos.
 *
 * Si uno de los dos cambia sin el otro, lo delata `honorario-confirmado.test.ts`
 * contra los casos reales medidos en produccion.
 */

/** Config de `cobro` en `lineas_negocio` / `workspaces` (`config_extra`). */
export interface ConfigCobro {
  exige_honorario_confirmado?: boolean | null
}

export interface EstadoHonorario {
  /** `negocios.precio_aprobado`. Es el honorario CON IVA (ver `v_negocio_valor`). */
  precioAprobado: number | null | undefined
  /** `negocios.estado`. Un caso cerrado ya no se retiene. */
  estado: string | null | undefined
  /** `config_extra.cobro` de la LINEA. Gana sobre el del workspace. */
  configLinea?: ConfigCobro | null
  /** `config_extra.cobro` del WORKSPACE. Respaldo. */
  configWorkspace?: ConfigCobro | null
}

/**
 * ¿La linea (o el workspace) exige honorario confirmado para cobrar?
 *
 * La linea gana sobre el workspace: la primera que lo declare, manda. Sin
 * declaracion, `false` — quien no configura nada recibe el comportamiento que ya
 * tenia, no una regla nueva. Es la misma disciplina de `recaudo.topar_por_valor`
 * y de `honorario.iva_pct`, y la razon es la misma: un criterio de UN cliente
 * aplicado a todos les cambia los datos en silencio.
 */
export function lineaExigeHonorarioConfirmado(e: EstadoHonorario): boolean {
  const linea = e.configLinea?.exige_honorario_confirmado
  if (typeof linea === 'boolean') return linea
  const ws = e.configWorkspace?.exige_honorario_confirmado
  if (typeof ws === 'boolean') return ws
  return false
}

/**
 * ¿Al negocio le FALTA el honorario confirmado, y por eso no puede recibir cobros?
 *
 * "Confirmado" es `precio_aprobado > 0`, no la marca de aprobacion del bloque.
 * Medido en produccion (SOENA, 2026-08-12) sobre los 192 negocios con precio:
 * los 70 nacidos en ONE y de Meta lo tienen por propuesta aprobada con plan
 * escogido; los 122 del cargue historico NO tienen esa marca y sin embargo su
 * valor esta confirmado por la via del cargue, con 111 abiertos y 8 que ya
 * cobraron. Exigir la marca habria frenado esos 122 sin que les falte nada.
 *
 * Lo que la regla protege es que exista un valor contra el cual medir lo que
 * entra. El plan es la via normal de confirmarlo, no el fin en si mismo — por
 * eso un plan escogido con honorario en cero (caso V0066) tampoco cumple.
 */
export function faltaHonorarioConfirmado(e: EstadoHonorario): boolean {
  if (!lineaExigeHonorarioConfirmado(e)) return false
  if (e.estado !== 'abierto') return false
  return (e.precioAprobado ?? 0) <= 0
}

/** Motivo legible para la pantalla. `null` si el negocio SI puede recibir cobros. */
export function motivoNoPuedeCobrar(e: EstadoHonorario): string | null {
  return faltaHonorarioConfirmado(e)
    ? 'Este caso no tiene el honorario confirmado. Aprueba la propuesta economica (elige el plan) antes de registrar el cobro.'
    : null
}
