import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

/**
 * Qué necesita un caso de la cola para poder facturarse HOY.
 *
 * Vive aparte y lo consumen el servidor (que cuenta los totales de la bandeja) y
 * la pantalla (que decide si pinta el botón). Estaba escrito en los dos lados con
 * palabras parecidas, que es exactamente como un criterio se desincroniza sin que
 * nadie lo note: la bandeja diría "3 listos" y la lista mostraría cuatro botones.
 *
 * Puro: no toca DB ni red.
 */
export interface CasoFacturable {
  faltan_factura: string[]
  faltan_cliente: string[]
  /** Lo que falta recaudar del HONORARIO. */
  falta_saldo: number
  /** Honorario aprobado CON IVA. `null` cuando nadie lo ha aprobado todavía. */
  honorario: number | null
  /** El negocio no tiene RUT con identificación utilizable. */
  sin_rut?: boolean
}

/**
 * Cuánto puede faltar del honorario sin que el caso salga de la cola.
 *
 * El honorario recaudado es CONDICIÓN DE ENTRADA a esta bandeja (decisión de
 * Mauricio, 2026-09-08): quien todavía debe plata de verdad no aparece, porque
 * mostrarlo con una etiqueta de "falta recaudo" convertía la lista en un
 * inventario de cosas que nadie puede resolver hoy. Pero un residuo de redondeo
 * tampoco puede esconder un caso, y por eso entre lo cuadrado y lo retenido hay
 * una franja donde decide una persona, por escrito.
 *
 * La franja es `max(TOLERANCIA_SALDO_COP, 1% del honorario)`:
 *
 *   - El piso lo pone `TOLERANCIA_SALDO_COP`, la vara de materialidad de TODO el
 *     producto. **No se toca**: es decisión de CFO, está centralizada a propósito
 *     y de ella cuelgan el motor de avance y los gates de etapa. Subirla para
 *     destrabar un caso de facturación movería todo eso. Esta banda se construye
 *     ENCIMA, es propia de facturación, y nunca la reemplaza.
 *   - El 1% escala con el honorario: en un caso de $637.500 son $6.375 y en uno
 *     de $850.000 son $8.500. Sin eso, un honorario grande tendría una franja
 *     proporcionalmente más estrecha que uno chico, sin ninguna razón.
 *
 * ⚠️ Sin honorario (o en cero) la banda COLAPSA al piso: no hay de qué sacar el
 * 1%, y estirarla sería inventar una franja sobre un número que nadie aprobó.
 * Medido el 2026-09-08 en SOENA: V0429 y V0066 están así, y de todas formas no
 * son facturables porque les falta el honorario aprobado.
 *
 * Puro: no toca DB ni red.
 */
export const PORCENTAJE_BANDA_FACTURACION = 0.01

export function bandaMaterialidadFacturacion(honorario: number | null): number {
  if (honorario == null || !Number.isFinite(honorario) || honorario <= 0) return TOLERANCIA_SALDO_COP
  return Math.max(TOLERANCIA_SALDO_COP, Math.round(honorario * PORCENTAJE_BANDA_FACTURACION))
}

/**
 * En qué lado del recaudo está el caso.
 *
 *   `cubierto`         — el honorario entró. Lista y botón directo.
 *   `descuadre_menor`  — falta un residuo dentro de la banda. Lista, marcado, y
 *                        se emite solo con justificación escrita de la financiera.
 *   `retenido`         — debe plata de verdad. NO se lista: la cola es lo que se
 *                        puede resolver hoy, y cobrar no se resuelve aquí.
 *
 * Medido en producción SOENA el 2026-09-08 sobre los 46 pendientes sin factura:
 * 18 cubiertos, **1 en la banda (V0179: faltan $3.000 sobre $637.500, 0,47%)** y
 * 27 retenidos. El retenido más cercano a la banda debe el **11,8%** de su
 * honorario, así que la vara del 1% no parte ningún grupo por la mitad: entre
 * 0,47% y 11,8% no hay un solo caso.
 */
export type EstadoRecaudo = 'cubierto' | 'descuadre_menor' | 'retenido'

export function estadoDeRecaudo(caso: Pick<CasoFacturable, 'falta_saldo' | 'honorario'>): EstadoRecaudo {
  const falta = Number.isFinite(caso.falta_saldo) ? caso.falta_saldo : 0
  if (falta <= TOLERANCIA_SALDO_COP) return 'cubierto'
  if (falta <= bandaMaterialidadFacturacion(caso.honorario)) return 'descuadre_menor'
  return 'retenido'
}

/**
 * ¿Está TODO cuadrado?
 *
 * ⚠️ Un caso en `descuadre_menor` **no** está listo: es listable con confirmación.
 * Meterlo aquí haría que la bandeja lo cuente entre los que se emiten de un clic
 * y que la pantalla le pinte el botón directo, saltándose la justificación que la
 * financiera tiene que escribir.
 *
 * El recibo del recaudo UPME NO entra en este criterio a propósito: es otro
 * documento y plata de un tercero, así que su falta no puede frenar la factura
 * del honorario. Por eso la cola de facturación ni siquiera calcula lo que le
 * falta al recibo: quien lo vigila es el control de recibos de `/conciliacion`
 * (`getControlRecibos`), que es una superficie aparte.
 */
export function casoListoParaFacturar(caso: CasoFacturable): boolean {
  return (
    caso.faltan_factura.length === 0 &&
    caso.faltan_cliente.length === 0 &&
    estadoDeRecaudo(caso) === 'cubierto'
  )
}

/**
 * Lista de lo que le falta, sin repetir, para pintarla como etiquetas.
 *
 * ⚠️ Sin RUT se nombra el RUT, no sus consecuencias. `faltan_cliente` se arma del
 * documento, así que un negocio sin RUT declaraba a la vez identificación, nombre,
 * dirección y ciudad: cuatro etiquetas que se leen como cuatro datos por teclear,
 * cuando el trabajo real es UNO y no es de digitación, es pedirle el documento al
 * cliente. Los faltantes de la FACTURA sí se conservan, porque no salen del RUT y
 * seguirían faltando el día que llegue.
 *
 * ⚠️ El recaudo ya NO aparece como un faltante más:
 *   - `retenido` no se lista en ninguna parte, así que una etiqueta suya no la
 *     leería nadie;
 *   - `descuadre_menor` nombra el residuo CON el monto, porque el trabajo no es
 *     conseguir esa plata sino decidir por escrito que se factura sin ella.
 */
export function faltantesDelCaso(caso: CasoFacturable): string[] {
  const delCliente = caso.sin_rut ? ['RUT sin cargar'] : caso.faltan_cliente
  const faltas = [...new Set([...delCliente, ...caso.faltan_factura])]
  if (estadoDeRecaudo(caso) === 'descuadre_menor') {
    faltas.push(`descuadre de recaudo: ${fmtCOP(caso.falta_saldo)}`)
  }
  return faltas
}

/** Pesos colombianos sin decimales, para los textos de este módulo. */
function fmtCOP(v: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(v)
}
