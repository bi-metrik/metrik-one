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
import { precioCuadradoPorPasajero, type FilaDePasajeros } from './cuadre-pasajero'
import { esTarifaPublica } from './tarifa-publica'
import {
  colchonDeLinea,
  comisionDePublica,
  comisionEnPesos,
  descuentoDeLinea,
  descuentosDeTarifa,
  tipoParaMargen,
  type ColchonDeLinea,
  type ReglasDeCotizacion,
  type TipoParaMargen,
} from './reglas-margen'

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
  /**
   * Los pasajeros entre los que se reparte el precio de la línea (`cuadre-pasajero.ts`, brief
   * del 2026-10-05, punto 11). Con ellos, el precio de la línea es la suma de los precios por
   * pasajero ya redondeados. Ausente o `null` en toda línea que no se vende por pasajero, que es
   * todo lo que no es Trappvel: la cascada da exactamente lo de antes.
   */
  pasajeros?: readonly FilaDePasajeros[] | null
  /**
   * La lectura de la línea (`items.tarifa_pax`). Aquí solo se mira si la línea es de tarifa
   * PÚBLICA (`tarifa-publica.ts`): el precio no cambia, pero la línea sale de la medida del
   * margen mínimo. Ausente = Neta, que es todo lo anterior al 2026-10-22.
   */
  tarifa_pax?: unknown
  /**
   * La ranura y el nombre de la línea. Solo los miran las reglas de margen (`reglas-margen.ts`):
   * vuelo, hotel o lo demás, y de dónde a dónde va un vuelo. Sin reglas no cambian nada.
   */
  grupo?: string | null
  nombre?: string | null
}

export interface ParametrosCascada {
  /** Administración e imprevistos, en % sobre el costo directo. */
  administrativosPct?: number | null
  /** Margen de la cotización, el que aplica a toda línea que no traiga el suyo. */
  margenPct?: number | null
  /** Descuento comercial final, en % sobre la venta bruta. */
  descuentoComercialPct?: number | null
  convencionMargen?: ConvencionMargen | null
  /**
   * Las reglas de margen de la cotización (`reglas-margen.ts`, brief del 2026-10-27). Ausentes o
   * `null` —toda cotización anterior y toda línea que no las declara—, la cascada es exactamente
   * la de siempre.
   */
  reglas?: ReglasDeCotizacion | null
  /**
   * De qué tarifa es esta cascada (el id del itinerario), para los descuentos sobre el total que
   * son de UNA tarifa (`reglas-margen.ts › descuentoAplicaA`, 2026-10-29). Ausente = la cascada no
   * es de ninguna tarifa: solo entran los descuentos de «todas», como hasta hoy.
   */
  tarifaId?: string | null
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
  /** La línea es de tarifa pública (`tarifa-publica.ts`). */
  publica: boolean
  /**
   * Una Pública: la comisión de la agencia en pesos (D3, 2026-10-29), sobre el precio público de la
   * línea. `null` = nadie la escribió, o la línea es Neta.
   */
  comisionPesos: number | null
  /**
   * Lo que agregan las reglas de margen. Ausente sin reglas: la línea de siempre.
   *
   * ⚠️ `puntos` SÍ está en `precioConAdicionales` (es lo que el cliente paga por la línea en ESTA
   * tarifa) y NO en `precioLinea`: el reparto depende de qué líneas lleva cada tarifa, y
   * `recalcularTotales` escribe `items.precio_venta` desde `precioLinea`.
   */
  reglas?: ReglasDeLinea
}

export interface ReglasDeLinea {
  tipo: TipoParaMargen
  /** Solo en un vuelo que hereda el margen: el colchón que lo decide. */
  colchon: ColchonDeLinea | null
  /** El descuento que ve el cliente en esta opción, ya en pesos (`precioLinea` ya lo descontó). */
  descuento: {
    motivo: string
    valor: number
    precioSinDescuento: number
    /**
     * El margen ANTES del descuento: el que se guarda en `margen_porcentaje` y el que se edita en
     * «Ajustar» (Vera, 2026-10-29). `margenAplicado` ya es el de después.
     */
    margenAntes: number
  } | null
  /** Los pesos que le tocan de los puntos extra en ESTA cascada. */
  puntos: number
  /** La comisión de una línea Pública, si alguien la escribió. */
  comisionPct: number | null
  /**
   * ¿Esta línea toma el margen de la cotización (la casilla «Margen de hoteles»)? Solo un hotel Neta
   * sin margen propio y con precio que sale del costo. «Ver el cálculo» lo usa para no mostrar como
   * aplicado un margen que no toma ninguna línea (brief del 2026-10-29, falla 2).
   */
  tomaElGeneral: boolean
}

/** Lo que las reglas de margen dejan en la cascada. Ausente sin reglas. */
export interface ResultadoReglas {
  /**
   * El margen global: `(venta − costo) / venta` después de márgenes, colchones, puntos y
   * descuentos. Las Públicas con comisión entran con su comisión; las que no la tienen, no entran.
   * `null` = no se puede medir (sin venta o sin costo en la base).
   */
  margenGlobalPct: number | null
  /** El mismo margen ANTES de los puntos extra y de los descuentos. */
  margenAntesPct: number | null
  /** Los puntos que se pidieron y los pesos que de verdad se repartieron. */
  puntosPct: number
  puntosPesos: number
  /** Cada descuento sobre el total, en pesos, en el orden en que se escribió. */
  descuentos: { id: string; descripcion: string; pct: number; valor: number }[]
  /** La suma de las líneas que ve el cliente, antes de los descuentos sobre el total. */
  subtotal: number
  /** Los hoteles cuyo margen (ya con su descuento) quedó bajo el piso de hotel. */
  hotelesBajoPiso: { id: string | undefined; margenPct: number }[]
  pisoHotelPct: number
  /** Las Públicas sin comisión: con alguna, el margen global no se puede medir (D2/D3). */
  publicasSinComision: number
}

/**
 * Lo que pesan las líneas de tarifa PÚBLICA dentro de la cascada (`tarifa-publica.ts`). Con
 * `lineas: 0` la cascada es exactamente la de siempre.
 *
 * Decisión D2 de Mauricio (2026-10-29): ya no hay exención. El margen general es el de TODAS las
 * líneas, y lo que la agencia paga por una Pública es su precio público menos su comisión. Una
 * Pública sin comisión no deja medir el margen (`sinComision`), y la cotización no sale (D3).
 */
export interface PesoDeLasPublicas {
  lineas: number
  /** Su costo de venta (con su parte de administrativos y sus adicionales): el precio público. */
  costoDeVenta: number
  /** Lo que suman a la venta bruta, adicionales incluidos. */
  ventaBruta: number
  /** La suma de sus comisiones en pesos (solo las que la tienen). */
  comision: number
  /** Cuántas no tienen comisión escrita. */
  sinComision: number
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
  /** Ver `PesoDeLasPublicas`. */
  publicas: PesoDeLasPublicas
  /** Ver `ResultadoReglas`. Ausente sin reglas de margen. */
  reglas?: ResultadoReglas
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

/**
 * El precio de una línea, cuadrado al peso como lo imprime el documento: por pasajero si la línea
 * se vende por pasajero (punto 11 del brief del 2026-10-05), si no por unidad («VLR. UNIT.»).
 */
/** El margen que da un precio sobre un costo, en la convención de la cotización. */
function margenDePrecio(costo: number, precio: number, convencion: ConvencionMargen): number {
  if (convencion === 'sobre_venta') return precio > 0 ? ((precio - costo) / precio) * 100 : 0
  return costo > 0 ? ((precio - costo) / costo) * 100 : 0
}

function cuadrarAlPeso(precio: number, cantidad: number, pasajeros: ItemParaCascada['pasajeros'] | false): number {
  return pasajeros
    ? precioCuadradoPorPasajero(precio / cantidad, pasajeros) * cantidad
    : Math.round(precio / cantidad) * cantidad
}

/** Lo que hace falta para repartir los puntos extra: la línea, su cantidad y cómo se cuadra. */
interface ParaPuntos {
  linea: LineaCalculada
  cantidad: number
  pasajeros: ItemParaCascada['pasajeros'] | false
}

/** Toda la cascada, de las líneas al precio final. */
export function calcularCascada(items: ItemParaCascada[], params: ParametrosCascada): Cascada {
  const adminPct = Math.max(0, Number(params.administrativosPct) || 0)
  const margenCotizacion = Number(params.margenPct) || 0
  const descComercial = Math.min(100, Math.max(0, Number(params.descuentoComercialPct) || 0))
  const convencion = params.convencionMargen ?? CONVENCION_MARGEN_POR_DEFECTO
  // Las reglas de margen (brief del 2026-10-27). Sin ellas, todo lo de abajo es lo de siempre.
  const reglas = params.reglas ?? null

  const lineas: LineaCalculada[] = []
  const paraPuntos: ParaPuntos[] = []
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
  // Tarifa pública (2026-10-22): lo que pesa, y su comisión (D2/D3, 2026-10-29).
  let publicasLineas = 0
  let publicasCosto = 0
  let publicasVenta = 0
  let publicasComision = 0
  let publicasSinComision = 0

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

    const publica = item.es_ajuste !== true && esTarifaPublica(item.tarifa_pax)
    const margenPropio = item.margen_porcentaje !== null && item.margen_porcentaje !== undefined
    const tipo = reglas ? tipoParaMargen(item.grupo) : null
    // La parte de los administrativos que le toca a esta línea. Proporcional al
    // costo, que es la propiedad que permite que una línea margine distinto sin
    // romper la suma (ver el encabezado del archivo).
    const costoDeVentaLinea = costoLinea * (1 + adminPct / 100)
    const cantidadLinea = Number(item.cantidad) || 1
    const derivaDelCosto = costoLinea > 0 && item.precio_manual !== true && item.es_ajuste !== true

    // El margen con que nace la línea cuando nadie le escribió uno. Sin reglas, el de la
    // cotización (lo de siempre). Con reglas: el hotel, el de la cotización; el vuelo, su
    // colchón; una Pública y todo lo demás, 0.
    let colchon: ColchonDeLinea | null = null
    let margenAplicado: number
    if (margenPropio) margenAplicado = Number(item.margen_porcentaje) || 0
    else if (!reglas) margenAplicado = margenCotizacion
    else if (publica) margenAplicado = 0
    else if (tipo === 'hotel') margenAplicado = margenCotizacion
    else if (tipo === 'vuelo' && derivaDelCosto) {
      colchon = colchonDeLinea(item, costoLinea, cantidadLinea, reglas.politica)
      const conColchon = costoDeVentaLinea + colchon.colchon
      margenAplicado = convencion === 'sobre_venta'
        ? (conColchon > 0 ? (colchon.colchon / conColchon) * 100 : 0)
        : (costoDeVentaLinea > 0 ? (colchon.colchon / costoDeVentaLinea) * 100 : 0)
    } else margenAplicado = 0

    let precioLinea: number
    if (costoLinea <= 0 || item.precio_manual === true || item.es_ajuste === true) {
      // Línea sin costo o con precio fijado a mano: manda lo guardado.
      const descuento = Math.min(100, Math.max(0, Number(item.descuento_porcentaje) || 0))
      const bruto = (Number(item.precio_venta) || 0) * cantidadLinea
      precioLinea = item.precio_manual === true || item.es_ajuste === true
        ? bruto
        : bruto * (1 - descuento / 100)
    } else if (colchon) {
      // El colchón se suma en pesos: el margen de arriba es solo cómo se dice.
      precioLinea = costoDeVentaLinea + colchon.colchon
    } else {
      precioLinea = precioConMargen(costoDeVentaLinea, margenAplicado, convencion)
    }

    // El descuento que el cliente ve en esta opción (el del hotel). Solo con reglas, y solo
    // sobre un precio que sale del costo: un precio escrito a mano ya dice lo que se cobra.
    const descuentoCliente = reglas && derivaDelCosto ? descuentoDeLinea(item.tarifa_pax) : null
    const precioSinDescuento = precioLinea
    const margenAntesDelDescuento = margenAplicado
    if (descuentoCliente) {
      precioLinea = descuentoCliente.tipo === 'pct'
        // Puntos de margen que se ceden: 15 % con 3 de descuento queda en 12 %.
        ? precioConMargen(costoDeVentaLinea, margenAplicado - descuentoCliente.valor, convencion)
        : precioLinea - descuentoCliente.valor
      precioLinea = Math.max(0, precioLinea)
      // El margen que se le APLICÓ es el que queda después del descuento (QA del bloqueo,
      // 2026-10-29): un paquete Neto al 15 % con 6 de descuento se vende al 9 %, y la tarjeta, el
      // «Ajustar» y el precio por fila tienen que decir 9, no 15.
      margenAplicado = descuentoCliente.tipo === 'pct'
        ? margenAplicado - descuentoCliente.valor
        : margenDePrecio(costoDeVentaLinea, precioLinea, convencion)
    }

    // El precio de la línea se cuadra al peso POR UNIDAD, que es la cifra que se
    // imprime en la cotización del cliente ("VLR. UNIT."). Sin esto, el total salía
    // de redondear la suma exacta y la columna del PDF sumaba unos pesos distintos:
    // un documento que no cuadra consigo mismo, y el cliente sí suma la columna.
    // Una línea que se vende por pasajero cuadra con lo que paga cada uno (punto 11 del brief
    // del 2026-10-05). Solo la que sale del margen: un precio escrito a mano manda tal cual.
    const porPasajero = derivaDelCosto && item.pasajeros ? item.pasajeros : false
    precioLinea = cuadrarAlPeso(precioLinea, cantidadLinea, porPasajero)

    // El adicional se suma DESPUÉS del cuadre por unidad, no antes: su cantidad es la
    // suya (seis maletas para seis adultos) y no tiene por qué ser múltiplo de la del
    // ítem. Sumarlo antes dejaría el precio unitario de la línea contaminado con una
    // fracción de maleta, que es justo el número que la columna del PDF imprime.
    const precioConAdicionales = precioLinea + adic.precio
    ventaBruta += precioConAdicionales

    // La comisión de una Pública, en pesos, sobre su precio público (su costo de venta).
    const comisionPesos = publica ? comisionEnPesos(item.tarifa_pax, costoDeVentaLinea) : null
    if (publica) {
      publicasLineas++
      publicasCosto += costoDeVentaLinea + adic.costo
      publicasVenta += precioConAdicionales
      if (comisionPesos === null) publicasSinComision++
      else publicasComision += comisionPesos
    }

    const linea: LineaCalculada = {
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
      publica,
      comisionPesos: comisionPesos === null ? null : Math.round(comisionPesos),
    }
    if (reglas && tipo) {
      const sinDescuento = descuentoCliente ? Math.round(cuadrarAlPeso(precioSinDescuento, cantidadLinea, porPasajero)) : 0
      linea.reglas = {
        tipo,
        colchon,
        descuento: descuentoCliente
          ? { motivo: descuentoCliente.motivo, valor: Math.max(0, sinDescuento - linea.precioLinea), precioSinDescuento: sinDescuento, margenAntes: margenAntesDelDescuento }
          : null,
        puntos: 0,
        comisionPct: publica ? comisionDePublica(item.tarifa_pax) : null,
        tomaElGeneral: tipo === 'hotel' && !publica && !margenPropio && derivaDelCosto,
      }
      // Reciben puntos extra el hotel y lo demás, nunca el vuelo (el cliente compara el tiquete en
      // internet), ni una Pública (su precio es el público), ni un precio escrito a mano.
      if (tipo !== 'vuelo' && !publica && derivaDelCosto && linea.precioLinea > 0) {
        paraPuntos.push({ linea, cantidad: cantidadLinea, pasajeros: porPasajero })
      }
    }
    lineas.push(linea)
  }

  // El AIU se calcula sobre el costo BASE, no sobre el que ya trae adicionales: ver la
  // nota de `costoDeVentaLinea`. Sin adicionales, `costoBaseDeAdministrativos` es
  // idéntico a `costoDirecto` y esto es exactamente la línea de siempre.
  const administrativos = costoBaseDeAdministrativos * (adminPct / 100)
  const costoDeVenta = costoDirecto + administrativos

  if (reglas) {
    return conReglas({
      reglas,
      tarifaId: params.tarifaId ?? null,
      lineas,
      paraPuntos,
      ventaBruta,
      costoDirecto,
      administrativos,
      costoDeVenta,
      descComercial,
      publicas: { lineas: publicasLineas, costo: publicasCosto, venta: publicasVenta, comision: publicasComision, sinComision: publicasSinComision },
    })
  }

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
    publicas: {
      lineas: publicasLineas,
      costoDeVenta: Math.round(publicasCosto),
      ventaBruta: Math.round(publicasVenta),
      comision: Math.round(publicasComision),
      sinComision: publicasSinComision,
    },
  }
}

/**
 * La base del margen global (D2, 2026-10-29): venta y costo de TODAS las líneas. Lo que la agencia
 * paga por una Pública es su precio público menos su comisión. Una Pública sin comisión no tiene
 * costo de agencia conocido: se cuenta en `sinComision` y el margen global queda sin medir (`null`),
 * que frena la salida (D3). Sigue fuera de la suma para que los puntos extra se repartan igual.
 */
function baseDelMargenGlobal(lineas: readonly LineaCalculada[]): { venta: number; costo: number; sinComision: number } {
  let venta = 0
  let costo = 0
  let sinComision = 0
  for (const l of lineas) {
    if (l.reglas === undefined) continue
    if (l.publica) {
      if (l.comisionPesos === null) { sinComision++; continue }
      venta += l.precioConAdicionales
      costo += l.costoDeVentaLinea + l.costoAdicionales - l.comisionPesos
      continue
    }
    venta += l.precioConAdicionales
    costo += l.costoDeVentaLinea + l.costoAdicionales
  }
  return { venta, costo, sinComision }
}

function margenDe(venta: number, costo: number): number | null {
  return venta > 0 && costo > 0 ? ((venta - costo) / venta) * 100 : null
}

/**
 * Los puntos extra: lo que hay que sumarle a la venta para que el margen global suba exactamente
 * esos puntos, repartido entre las líneas que pueden recibirlo en proporción a su precio y
 * cuadrado al peso como el resto del documento. Lo que el redondeo deja suelto va a la línea más
 * grande. Devuelve los pesos que de verdad se repartieron (ya están en cada línea).
 */
function repartirPuntos(paraPuntos: ParaPuntos[], extra: number): number {
  const pesoTotal = paraPuntos.reduce((s, x) => s + x.linea.precioLinea, 0)
  if (!(extra > 0) || !(pesoTotal > 0)) return 0
  let repartido = 0
  for (const x of paraPuntos) {
    const meta = x.linea.precioLinea + (extra * x.linea.precioLinea) / pesoTotal
    const nuevo = Math.round(cuadrarAlPeso(meta, x.cantidad, x.pasajeros))
    x.linea.reglas!.puntos = nuevo - x.linea.precioLinea
    repartido += x.linea.reglas!.puntos
  }
  const resto = extra - repartido
  if (resto !== 0) {
    const mayor = paraPuntos.reduce((m, x) => (x.linea.precioLinea > m.linea.precioLinea ? x : m))
    const actual = mayor.linea.precioLinea + mayor.linea.reglas!.puntos
    const nuevo = Math.round(cuadrarAlPeso(actual + resto, mayor.cantidad, mayor.pasajeros))
    repartido += nuevo - actual
    mayor.linea.reglas!.puntos = nuevo - mayor.linea.precioLinea
  }
  for (const x of paraPuntos) x.linea.precioConAdicionales += x.linea.reglas!.puntos
  return repartido
}

/**
 * El final de la cascada con reglas de margen: los puntos extra, los descuentos sobre el total y
 * el margen global (`reglas-margen.ts`). Vive aparte para que la cascada sin reglas se lea igual
 * que siempre.
 */
function conReglas(a: {
  reglas: ReglasDeCotizacion
  tarifaId: string | null
  lineas: LineaCalculada[]
  paraPuntos: ParaPuntos[]
  ventaBruta: number
  costoDirecto: number
  administrativos: number
  costoDeVenta: number
  descComercial: number
  publicas: { lineas: number; costo: number; venta: number; comision: number; sinComision: number }
}): Cascada {
  const { reglas, lineas } = a
  const politica = reglas.politica

  // ── 4 · Puntos extra: de 0 al tope, sobre el margen global, repartidos por precio ──
  const antes = baseDelMargenGlobal(lineas)
  const margenAntesPct = margenDe(antes.venta, antes.costo)
  const puntosPct = Math.min(politica.puntosExtraMax, Math.max(0, Number(reglas.puntosExtra) || 0))
  let ventaBruta = a.ventaBruta
  let puntosPesos = 0
  if (puntosPct > 0 && margenAntesPct !== null && a.paraPuntos.length > 0) {
    const objetivo = (margenAntesPct + puntosPct) / 100
    const extra = objetivo < 1 ? Math.round(antes.costo / (1 - objetivo) - antes.venta) : 0
    puntosPesos = repartirPuntos(a.paraPuntos, extra)
    ventaBruta += puntosPesos
  }

  // ── 5 · Descuentos sobre el total: después de los puntos, cada uno al peso ──
  // El descuento comercial de siempre (`cotizaciones.descuento_porcentaje`), si alguien lo puso,
  // es uno más: con reglas el cliente ve todo descuento con su nombre.
  // Solo los de esta tarifa: los de «todas» y los que nombran su id (`descuentoAplicaA`).
  const pedidos = [
    ...descuentosDeTarifa(reglas.descuentos, a.tarifaId),
    ...(a.descComercial > 0 ? [{ id: 'comercial', descripcion: 'Descuento comercial', pct: a.descComercial }] : []),
  ]
  const descuentos = pedidos.map(d => ({ ...d, valor: Math.round(ventaBruta * (d.pct / 100)) }))
  const descuentoComercial = descuentos.reduce((s, d) => s + d.valor, 0)
  const precioVenta = ventaBruta - descuentoComercial

  // ── 6 · El margen global, después de todo ──
  const despues = baseDelMargenGlobal(lineas)
  // Los descuentos se reparten en proporción a la venta, igual que `margenMedible` reparte el
  // descuento comercial entre las Netas.
  const factor = ventaBruta > 0 ? precioVenta / ventaBruta : 1
  // D2/D3: con una Pública sin comisión, el margen general no se puede medir.
  const margenGlobalPct = despues.sinComision > 0 ? null : margenDe(despues.venta * factor, despues.costo)

  const pisoHotel = politica.pisoHotelPct
  const hotelesBajoPiso = lineas
    .filter(l => l.reglas?.tipo === 'hotel' && !l.publica && l.margenRealPct !== null && l.margenRealPct < pisoHotel)
    .map(l => ({ id: l.id, margenPct: l.margenRealPct as number }))

  const p = a.publicas
  return {
    lineas,
    costoDirecto: Math.round(a.costoDirecto),
    administrativos: Math.round(a.administrativos),
    costoDeVenta: Math.round(a.costoDeVenta),
    ventaBruta: Math.round(ventaBruta),
    descuentoComercial: Math.round(descuentoComercial),
    precioVenta: Math.round(precioVenta),
    margenRealPct: precioVenta > 0 ? ((precioVenta - a.costoDeVenta) / precioVenta) * 100 : null,
    publicas: {
      lineas: p.lineas,
      costoDeVenta: Math.round(p.costo),
      ventaBruta: Math.round(p.venta),
      comision: Math.round(p.comision),
      sinComision: p.sinComision,
    },
    reglas: {
      margenGlobalPct,
      margenAntesPct,
      puntosPct,
      puntosPesos,
      descuentos,
      subtotal: Math.round(ventaBruta),
      hotelesBajoPiso,
      pisoHotelPct: pisoHotel,
      publicasSinComision: despues.sinComision,
    },
  }
}
