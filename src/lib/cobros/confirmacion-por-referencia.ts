/**
 * ¿Una REFERENCIA de pago sigue esperando el visto bueno del área financiera?
 *
 * La pregunta parece la misma que "¿este negocio está conciliado?" y no lo es. El check
 * de la financiera confirma **una referencia concreta**; el flag de `negocio_conciliacion`
 * describe **un negocio**. Mientras la pantalla usó lo segundo para decidir lo primero,
 * una referencia repartida entre varios negocios desaparecía entera de la bandeja "Por
 * confirmar" en cuanto UNO de ellos quedaba conciliado — por cualquier motivo, incluso
 * ajeno a esa referencia. La porción del otro negocio se quedaba sin ningún lugar desde
 * donde aceptarse: plata registrada, sin confirmar y sin salida por la aplicación.
 *
 * Pasó en SOENA con la referencia 385563083 (V0497 / V0498, 15-sep-2026) y hubo que
 * restituir el check por SQL a mano.
 *
 * Este módulo es la fuente ÚNICA de esa decisión, y lo consumen los DOS lados:
 * `getConciliacionV2` para contar, y el panel para filtrar la bandeja. Escrito dos veces,
 * el servidor y la pantalla se desincronizan y el síntoma vuelve a ser el mismo: una
 * referencia accionable que nadie ve.
 *
 * Puro: no toca DB ni red.
 */

import { esPorcionPendienteDeConfirmar, type CobroParaRecaudo } from '@/lib/negocios/recaudo-confirmado'

/** Una porción de la referencia, con el estado del negocio donde cayó. */
export interface PorcionDeReferencia {
  cobro: CobroParaRecaudo
  /** `negocio_conciliacion.conciliado` del negocio de esta porción. */
  negocioConciliado: boolean
  /** Una porción anulada no espera nada: su plata ya no existe. */
  anulada?: boolean
}

/**
 * Cuántas porciones de la referencia siguen esperando confirmación.
 *
 * Se cuenta POR PORCIÓN y no por negocio: dos porciones de la misma referencia pueden
 * estar en estados distintos, y ese es justo el caso que hay que poder atender.
 */
export function porcionesPorConfirmar(porciones: PorcionDeReferencia[] | null | undefined): number {
  return (porciones ?? []).reduce((n, p) => {
    if (!p || p.anulada) return n
    return esPorcionPendienteDeConfirmar(p.cobro, p.negocioConciliado) ? n + 1 : n
  }, 0)
}

/**
 * ¿La referencia tiene que seguir apareciendo en "Por confirmar"?
 *
 * ⚠️ Es una sola condición y por eso vive con nombre propio: es el punto exacto donde el
 * criterio por negocio le escondía trabajo a la financiera.
 */
export function referenciaEsperaConfirmacion(ref: { porciones_por_confirmar: number }): boolean {
  return (ref?.porciones_por_confirmar ?? 0) > 0
}
