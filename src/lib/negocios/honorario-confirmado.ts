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
  /**
   * ¿El honorario en cero es una DECISION, no un dato que falta?
   *
   * ⚠️ SIN ESTO EL GUARD FRENA UN CASO SANO Y NADIE PUEDE DESTRABARLO
   *
   * Un honorario en cero tiene dos causas que se ven idénticas desde
   * `precio_aprobado`: nadie cotizó todavía, o alguien aprobó una propuesta
   * regalando el servicio. La segunda es legítima y el producto ya la contempla
   * (`valorARecaudar` cubre el caso "honorario 0 CON tarifa": el cliente igual
   * paga la tarifa de la UPME).
   *
   * Medido en produccion el 2026-08-13: V0066 tiene su propuesta APROBADA, con
   * Plan 1 en $850.000 y Plan 2 con 100% de descuento; se aprobó el Plan 2 y su
   * PDF está en Drive. Con el criterio anterior el guard lo habría frenado por
   * una decisión comercial ya tomada, y el equipo no habría tenido cómo
   * destrabarlo salvo cambiando un precio que alguien decidió.
   *
   * El criterio NO se reimplementa aquí: lo calcula `esCeroDeliberado`
   * (`src/lib/upme/modelo-dinero.ts`), que es donde ya vive, y llega resuelto.
   * Se recibe como dato en vez de importarse para no invertir la dependencia:
   * `lib/negocios` es el motor de avance y `lib/upme` el modelo de dinero de un
   * cliente.
   */
  ceroDeliberado?: boolean
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
  // Un cero DECIDIDO no es un cero que falta. Ver `ceroDeliberado` arriba.
  if (e.ceroDeliberado) return false
  return (e.precioAprobado ?? 0) <= 0
}

/**
 * Texto unico del aviso. Lo consumen el motivo del servidor y el aviso que la
 * pantalla muestra ANTES de que el operador llene el formulario de pago: escrito
 * dos veces, la pantalla y el rechazo del servidor terminarian diciendo cosas
 * distintas sobre el mismo bloqueo.
 */
export const MENSAJE_HONORARIO_PENDIENTE =
  'Este caso no tiene el honorario confirmado. Aprueba la propuesta economica (elige el plan) antes de registrar el cobro.'

/** Motivo legible para la pantalla. `null` si el negocio SI puede recibir cobros. */
export function motivoNoPuedeCobrar(e: EstadoHonorario): string | null {
  return faltaHonorarioConfirmado(e) ? MENSAJE_HONORARIO_PENDIENTE : null
}
