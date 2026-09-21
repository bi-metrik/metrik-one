/**
 * La cascada de una cotización: de lo que cuesta a lo que se cobra.
 *
 * Una cotización se arma en un solo sentido y cada escalón tiene un dueño distinto:
 *
 *   costo directo        Σ (costo unitario × cantidad − descuento de compra)
 * + administrativos      lo que cuesta operar el contrato (AIU), un % sobre el costo
 * = costo de venta       la plata que hay que poner para entregar el trabajo
 * + margen               la utilidad, global o propia de una línea
 * − descuento comercial  lo que se cede para cerrar
 * = precio de venta      lo que paga el cliente
 *
 * Dos cosas que parecen detalle y no lo son:
 *
 *  · El descuento del ítem es de COMPRA: baja el costo, no el precio. El que baja el
 *    precio es el comercial y vive al final. Aplicar el mismo número en los dos sitios
 *    lo cobra dos veces y deja la cotización por debajo del piso sin que se note.
 *  · Los administrativos se reparten proporcionalmente al costo de cada línea, así que
 *    aplicarlos línea por línea da el mismo total que aplicarlos al gran total. Eso es
 *    lo que permite que una línea pueda marginar distinto sin romper la suma.
 *
 * ## Los ADICIONALES entran como un sumando, no como un escalón
 *
 * Una variante puede llevar adicionales (`adicionales.ts`): la maleta extra, la silla, el
 * seguro. Cada uno trae **su costo y su precio ya tomados**, así que no pasa por el margen
 * de la línea ni por el de la cotización y no lleva administrativos: se suma al costo
 * directo y a la venta bruta, y punto.
 *
 * ⚠️ La línea conserva sus dos cifras BASE (`costoDeVentaLinea`, `precioLinea`) y expone
 * las del adicional aparte. No es prolijidad: `recalcularTotales` escribe
 * `items.precio_venta` a partir de `precioLinea`, y una maleta metida ahí se volvería
 * precio base de la línea y se cobraría otra vez en el recálculo siguiente.
 *
 * LEGADO: una línea sin costo (las cotizaciones anteriores a esto guardaban solo el
 * precio) conserva su `precio_venta` como precio de línea. Sin eso, recalcular una
 * cotización ya enviada la dejaría en cero.
 */

import {
  CONVENCION_MARGEN_POR_DEFECTO,
  costoUnitarioDelItem,
  precioConMargen,
  type ConvencionMargen,
} from './precio-item'
import { totalesDeAdicionales, type AdicionalParaSuma } from './adicionales'

export interface ItemParaCascada {
  id?: string
  /** Ítem de cuadre de cotizaciones viejas: no tiene costo, su precio pasa derecho. */
  es_ajuste?: boolean | null
  cantidad?: number | null
  /** Costo unitario escrito a mano. */
  subtotal?: number | null
  numeroDeRubros: number
  /** Suma de `rubros.valor_total` cuando la línea se desglosa. */
  costoDeRubros?: number | null
  /** Descuento de COMPRA sobre el costo de la línea. */
  descuento_porcentaje?: number | null
  /** Margen propio de la línea. `null` usa el margen de la cotización. */
  margen_porcentaje?: number | null
  /** Precio guardado. Solo manda si la línea no tiene costo o se fijó a mano. */
  precio_venta?: number | null
  precio_manual?: boolean | null
  /**
   * Los adicionales DE ESTA VARIANTE: la maleta extra, la silla, el seguro.
   *
   * Ausente o vacío vale cero por todos lados y la cascada da exactamente lo que daba
   * antes de que este campo existiera — que es R6 sostenido desde el dato y no desde un
   * `if`. Ver `adicionales.ts`: cuelgan del ítem, nunca de la ranura.
   */
  adicionales?: readonly AdicionalParaSuma[] | null
}

export interface ParametrosCascada {
  /** Administración e imprevistos, en % sobre el costo directo. */
  administrativosPct?: number | null
  /** Margen de la cotización, el que aplica a toda línea que no traiga el suyo. */
  margenPct?: number | null
  /** Descuento comercial final, en % sobre la venta bruta. */
  descuentoComercialPct?: number | null
  convencionMargen?: ConvencionMargen | null
}

export interface LineaCalculada {
  id?: string
  /** Costo unitario, venga de rubros o escrito a mano. */
  costoUnitario: number
  /** Costo de la línea ya con cantidad y descuento de compra. */
  costoLinea: number
  /**
   * Costo de la línea CON su parte de los administrativos. **SIN adicionales.**
   *
   * Los administrativos se reparten proporcionalmente al costo, así que la suma de
   * este campo sobre todas las líneas **más** la de `costoAdicionales` es exactamente
   * `costoDeVenta`. Es el costo contra el que hay que medir el margen de la línea:
   * medirlo contra `costoLinea` pelado lo deja por encima del margen real de la
   * cotización, y dos cifras del mismo dinero que no cuadran entre sí es lo que obliga a
   * adivinar cuál manda.
   *
   * ⚠️ El costo del adicional NO entra al reparto de administrativos, y es deliberado: su
   * precio está DADO, no derivado. Meterlo en la base del AIU le movería el margen sin
   * moverle el precio, que son otra vez dos cifras del mismo dinero. Con AIU en 0 —el caso
   * de Trappvel y de casi todos— la diferencia no existe.
   */
  costoDeVentaLinea: number
  /** Margen que se le aplicó, sea el propio o el de la cotización. */
  margenAplicado: number
  /** `true` si la línea trae margen propio distinto al de la cotización. */
  margenPropio: boolean
  /**
   * Precio de la línea, ya con administrativos y margen. **SIN adicionales.**
   *
   * ⚠️ Es a propósito, y es lo que evita un error que se compone solo: `recalcularTotales`
   * escribe `items.precio_venta = precioLinea / cantidad`. Si aquí entrara la maleta, la
   * maleta quedaría metida DENTRO del precio base de la línea, y el siguiente recálculo la
   * sumaría otra vez encima. El precio que incluye adicionales es `precioConAdicionales`,
   * y quien lo necesite lo pide con ese nombre.
   */
  precioLinea: number
  /** Costo de los adicionales de la línea, en pesos. 0 si no tiene. */
  costoAdicionales: number
  /** Precio de los adicionales de la línea, en pesos. 0 si no tiene. */
  precioAdicionales: number
  /**
   * Lo que de verdad paga el cliente por esta línea: base más adicionales.
   *
   * *«El precio de la variante pasa a ser base más adicionales»* (§1.2). Es la cifra que
   * va al documento del cliente, al cuadre del ítem de ajuste y al registro de decisiones
   * —donde lo que se guarda es **el precio que se le mostró al cliente**—, y la que suma
   * `ventaBruta`.
   */
  precioConAdicionales: number
  /**
   * Margen REAL de la línea: lo que queda dentro de su precio después de pagar su
   * costo y su parte de los administrativos.
   *
   * `null` cuando no se puede medir —línea sin precio, o sin costo contra el cual
   * compararlo—. Un 0 ahí se leería como "vendida a costo", que es otra cosa.
   *
   * ⚠️ NO incluye el descuento comercial: ese vive al final de la cascada y no se
   * reparte por línea. Con descuento comercial > 0, la suma ponderada de estos
   * márgenes queda POR ENCIMA del margen real de la cotización. Quien lo muestre
   * tiene que decirlo.
   */
  margenRealPct: number | null
}

export interface Cascada {
  lineas: LineaCalculada[]
  costoDirecto: number
  administrativos: number
  costoDeVenta: number
  ventaBruta: number
  descuentoComercial: number
  precioVenta: number
  /**
   * Margen real de la cotización: lo que queda después de pagar TODO el costo,
   * administrativos incluidos. `null` sin precio, porque un 0 se leería como
   * "vendido a costo" y es otra cosa.
   */
  margenRealPct: number | null
}

/**
 * Margen real de un par (costo de venta, precio), en porcentaje sobre el precio.
 *
 * Es la MISMA aritmética que `margenRealPct` de la cascada, escrita una sola vez:
 * si el total y las líneas la calcularan por separado, el día que una cambie
 * quedarían dos definiciones de "margen" en la misma pantalla.
 *
 * `null` cuando no hay precio o no hay costo: sin uno de los dos no hay margen que
 * reportar, y un 0 se leería como "vendido a costo".
 */
function margenRealDeLinea(costoDeVenta: number, precio: number): number | null {
  if (precio <= 0) return null
  if (costoDeVenta <= 0) return null
  return ((precio - costoDeVenta) / precio) * 100
}

/** Costo de una línea: unitario × cantidad, menos el descuento de compra. */
export function costoDeLinea(item: ItemParaCascada): number {
  if (item.es_ajuste === true) return 0
  const unitario = costoUnitarioDelItem({
    numeroDeRubros: item.numeroDeRubros,
    costoDeRubros: item.costoDeRubros,
    subtotal: item.subtotal,
  })
  const cantidad = Number(item.cantidad) || 1
  const descuento = Math.min(100, Math.max(0, Number(item.descuento_porcentaje) || 0))
  return unitario * cantidad * (1 - descuento / 100)
}

/** Toda la cascada, de las líneas al precio final. */
export function calcularCascada(items: ItemParaCascada[], params: ParametrosCascada): Cascada {
  const adminPct = Math.max(0, Number(params.administrativosPct) || 0)
  const margenCotizacion = Number(params.margenPct) || 0
  const descComercial = Math.min(100, Math.max(0, Number(params.descuentoComercialPct) || 0))
  const convencion = params.convencionMargen ?? CONVENCION_MARGEN_POR_DEFECTO

  const lineas: LineaCalculada[] = []
  let costoDirecto = 0
  let ventaBruta = 0
  /**
   * La base sobre la que se calculan los administrativos: el costo SIN adicionales.
   *
   * Existe aparte de `costoDirecto` para que la invariante siga cerrando: la suma de
   * `costoDeVentaLinea` más la de `costoAdicionales` tiene que dar `costoDeVenta`
   * exactamente, y el adicional no lleva AIU (ver `costoDeVentaLinea`). Sin adicionales
   * las dos variables valen lo mismo y todo esto es un no-op.
   */
  let costoBaseDeAdministrativos = 0

  for (const item of items) {
    const costoUnitario = item.es_ajuste === true
      ? 0
      : costoUnitarioDelItem({
        numeroDeRubros: item.numeroDeRubros,
        costoDeRubros: item.costoDeRubros,
        subtotal: item.subtotal,
      })
    const costoLinea = costoDeLinea(item)
    // Los adicionales de ESTA variante. Traen su costo y su precio ya tomados, así que
    // no pasan por el margen de la línea ni por el de la cotización: se SUMAN.
    // ⚠️ El ítem de cuadre no admite adicionales — es precio, no un componente del viaje.
    const adic = item.es_ajuste === true
      ? { costo: 0, precio: 0, sinConvertir: [] as string[] }
      : totalesDeAdicionales(item.adicionales)
    costoBaseDeAdministrativos += costoLinea
    costoDirecto += costoLinea + adic.costo

    const margenPropio = item.margen_porcentaje !== null && item.margen_porcentaje !== undefined
    const margenAplicado = margenPropio ? Number(item.margen_porcentaje) || 0 : margenCotizacion

    let precioLinea: number
    if (costoLinea <= 0 || item.precio_manual === true || item.es_ajuste === true) {
      // Línea sin costo o con precio fijado a mano: manda lo guardado.
      const cantidad = Number(item.cantidad) || 1
      const descuento = Math.min(100, Math.max(0, Number(item.descuento_porcentaje) || 0))
      const bruto = (Number(item.precio_venta) || 0) * cantidad
      precioLinea = item.precio_manual === true || item.es_ajuste === true
        ? bruto
        : bruto * (1 - descuento / 100)
    } else {
      precioLinea = precioConMargen(costoLinea * (1 + adminPct / 100), margenAplicado, convencion)
    }

    // El precio de la línea se cuadra al peso POR UNIDAD, que es la cifra que se
    // imprime en la cotización del cliente ("VLR. UNIT."). Sin esto, el total salía
    // de redondear la suma exacta y la columna del PDF sumaba unos pesos distintos:
    // un documento que no cuadra consigo mismo, y el cliente sí suma la columna.
    const cantidadLinea = Number(item.cantidad) || 1
    precioLinea = Math.round(precioLinea / cantidadLinea) * cantidadLinea

    // El adicional se suma DESPUÉS del cuadre por unidad, no antes: su cantidad es la
    // suya (seis maletas para seis adultos) y no tiene por qué ser múltiplo de la del
    // ítem. Sumarlo antes dejaría el precio unitario de la línea contaminado con una
    // fracción de maleta, que es justo el número que la columna del PDF imprime.
    const precioConAdicionales = precioLinea + adic.precio
    ventaBruta += precioConAdicionales

    // La parte de los administrativos que le toca a esta línea. Proporcional al
    // costo, que es la propiedad que permite que una línea margine distinto sin
    // romper la suma (ver el encabezado del archivo).
    const costoDeVentaLinea = costoLinea * (1 + adminPct / 100)

    lineas.push({
      id: item.id,
      costoUnitario,
      costoLinea: Math.round(costoLinea),
      costoDeVentaLinea: Math.round(costoDeVentaLinea),
      margenAplicado,
      margenPropio,
      precioLinea: Math.round(precioLinea),
      costoAdicionales: adic.costo,
      precioAdicionales: adic.precio,
      precioConAdicionales: Math.round(precioConAdicionales),
      // Se mide sobre los valores REDONDEADOS, que son los que la pantalla enseña:
      // calcularlo con los exactos deja un porcentaje que no cuadra con las dos
      // cifras impresas al lado, y el usuario no tiene cómo saber cuál falla.
      margenRealPct: margenRealDeLinea(Math.round(costoDeVentaLinea), Math.round(precioLinea)),
    })
  }

  // El AIU se calcula sobre el costo BASE, no sobre el que ya trae adicionales: ver la
  // nota de `costoDeVentaLinea`. Sin adicionales, `costoBaseDeAdministrativos` es
  // idéntico a `costoDirecto` y esto es exactamente la línea de siempre.
  const administrativos = costoBaseDeAdministrativos * (adminPct / 100)
  const costoDeVenta = costoDirecto + administrativos
  const descuentoComercial = ventaBruta * (descComercial / 100)
  const precioVenta = ventaBruta - descuentoComercial

  return {
    lineas,
    costoDirecto: Math.round(costoDirecto),
    administrativos: Math.round(administrativos),
    costoDeVenta: Math.round(costoDeVenta),
    ventaBruta: Math.round(ventaBruta),
    descuentoComercial: Math.round(descuentoComercial),
    precioVenta: Math.round(precioVenta),
    margenRealPct: precioVenta > 0 ? ((precioVenta - costoDeVenta) / precioVenta) * 100 : null,
  }
}
