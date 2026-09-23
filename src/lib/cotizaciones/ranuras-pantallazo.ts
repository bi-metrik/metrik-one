/**
 * Las RANURAS del pantallazo: qué se le pide a cada captura y qué se espera leer.
 *
 * Paso 3 del motor de cotización de Trappvel
 * (`proyectos/trappvel/clarity/docs/diseno/motor-cotizacion.md`, §3).
 *
 * ## El principio duro del diseño
 *
 * *«No existe un campo abierto de pegar imagen.»* Cada captura entra por una ranura
 * TIPADA, elegida ANTES de pegar, con un contrato cerrado de qué se espera y qué se
 * rechaza. Sin ranura no hay contrato contra el cual leer la imagen, y sin contrato
 * el modelo devuelve lo que le parezca.
 *
 * ## La ranura se DERIVA del `grupo`, no se elige aparte
 *
 * `items.grupo` ya es la ranura de la tabla de combinaciones (§2.2): la columna
 * «vuelo» compara vuelos. La misma palabra decide qué contrato aplica al pantallazo.
 * Un segundo desplegable para «tipo de captura» sería una segunda fuente para la
 * misma pregunta, y el día que se separen el pantallazo de un hotel se leería con el
 * contrato de un vuelo sin que nada falle.
 *
 * Consecuencia directa: **un ítem sin grupo no ofrece cargue de pantallazo.** No es
 * una limitación, es el contrato.
 *
 * ## VARIAS ranuras del mismo tipo, y el grupo sigue siendo la única fuente
 *
 * Caso real (Mauricio, 2026-09-21): un viaje a Providencia lleva **dos vuelos** —
 * Bogotá–San Andrés y San Andrés–Providencia— y los dos van en lo que recibe el
 * cliente. **Suman**, no compiten. Dentro de cada uno, las aerolíneas y los horarios sí
 * compiten.
 *
 * Como el modelo ya hace que dos grupos DISTINTOS sumen y dos líneas del MISMO grupo
 * compitan, lo único que faltaba era poder escribir dos grupos distintos que el registro
 * reconociera los dos como vuelo. Se hace con una **convención declarada de etiqueta**
 * dentro del mismo campo, no con una columna nueva:
 *
 * ```
 *   vuelo                          → ranura de vuelo, sin etiqueta
 *   vuelo 2                        → ranura de vuelo, etiqueta «2»
 *   vuelo: Bogotá a San Andrés     → ranura de vuelo, etiqueta «Bogotá a San Andrés»
 * ```
 *
 * ⚠️ La etiqueta separada por ESPACIO tiene que ser un número, y no es un detalle: sin
 * esa restricción «Hotel Occidental» pasaría a resolver como hotel, y el propio registro
 * declara desde el primer día que **no** debe hacerlo — es el nombre de un proveedor, no
 * una ranura. Con dos puntos la etiqueta es libre porque el separador ya es la
 * declaración explícita de que lo de la izquierda es el tipo.
 *
 * ⚠️ Dos grupos del mismo tipo con etiquetas distintas son **dos ranuras**, y por eso
 * suman. Renombrar la etiqueta de UNA línea de una ranura con varias variantes la parte
 * en dos ranuras de una variante cada una, y el total **se duplica en silencio**: por eso
 * el renombre es una operación sobre la ranura entera (`renombrarRanura`) y no la edición
 * del grupo de una línea suelta.
 *
 * ## Por qué este registro vive en CÓDIGO y no en una tabla (R-P3)
 *
 * Misma regla que `src/lib/pdf/plantillas-cotizacion.ts`. Lo que le decimos al modelo
 * que busque decide qué número acaba dentro de un costo: si se edita desde la UI, un
 * cambio de una palabra mueve el margen de todas las cotizaciones siguientes sin
 * pasar por revisión, sin rastro y sin poder volver atrás. En código pasa por un PR.
 *
 * ## Lo que este archivo NO hace
 *
 * No llama al modelo (eso es `src/lib/ai/extraer-ranura.ts`) y no decide si una
 * lectura se acepta (eso es `lectura-pantallazo.ts`). Aquí solo está el contrato.
 */

/** El tipo de dato que se espera en un campo de la ranura. */
export type TipoCampoRanura = 'texto' | 'numero' | 'fecha' | 'boolean' | 'currency' | 'enum'

export interface CampoRanura {
  slug: string
  label: string
  tipo: TipoCampoRanura
  /**
   * Mínimo obligatorio. Si falta uno, **no se crea nada** y se pide captura nueva
   * (RX2). No es "conviene tenerlo": es la diferencia entre un costo y un número
   * suelto.
   */
  min: boolean
  /** Qué buscar, en las palabras que el modelo lee. */
  descripcion_ai: string
  /**
   * Marca el campo para que una persona lo confirme antes de confiar en él. Los tres
   * que siempre la llevan (`moneda`, `base_precio`, `impuestos_incluidos`) son los
   * que convierten un precio correcto en un margen falso (R-P6).
   */
  alerta_revision?: boolean
  /** Valores admitidos cuando `tipo === 'enum'`. */
  opciones?: string[]
  /**
   * El campo NO se le pide a la lectura: lo llena otro paso (`detectarEstrellas`, en
   * `src/lib/ai/extraer-ranura.ts`). Sigue siendo un campo de la ranura —se muestra, se edita
   * y se guarda como los demás—, pero el prompt y el esquema de la lectura no lo nombran.
   */
  aparte?: boolean
}

export interface DefinicionRanura {
  /** Identificador de la ranura. Es el que viaja en la respuesta del modelo. */
  slug: string
  /** Cómo se llama de cara a quien cotiza. */
  label: string
  /**
   * Valores de `items.grupo` que resuelven a esta ranura. El PRIMERO es el canónico:
   * es el que ofrece el selector y el que se guarda.
   *
   * ⚠️ Los sinónimos son una lista CERRADA y declarada, no una adivinanza del modelo.
   * «hotel» y «hoteles» tienen que caer en el mismo contrato; «Hotel Occidental» no
   * cae en ninguno, y eso es correcto: es el nombre de un proveedor, no una ranura.
   */
  grupos: string[]
  /** Qué imagen se pide, dicho al usuario ANTES de pegar. */
  queSePide: string
  /** Qué NO sirve. Es la mitad del contrato que evita la captura equivocada. */
  queNoSirve: string
  /** Unidad de venta por defecto de la línea (se escribe en `items.unidad`). */
  unidadPorDefecto: string
  campos: CampoRanura[]
}

// ── Campos compartidos ───────────────────────────────────────────────────────

/**
 * La moneda NUNCA se asume (R-P5). *«Un número sin moneda en un viaje internacional
 * es el error más caro que este motor puede cometer.»* Trappvel cotiza Punta Cana y
 * Madrid: el pantallazo en USD y EUR es el caso normal, no el raro.
 */
const MONEDA: CampoRanura = {
  slug: 'moneda',
  label: 'Moneda',
  tipo: 'texto',
  min: true,
  alerta_revision: true,
  descripcion_ai:
    'Código ISO 4217 de la moneda del precio que aparece en la captura: COP, USD, EUR, MXN... ' +
    'Si la pantalla muestra solo el símbolo $ y NO dice el código ni el país, devuelve null: ' +
    '$ es ambiguo entre pesos y dólares. NO lo deduzcas del destino del viaje.',
}

const PRECIO_TOTAL: CampoRanura = {
  slug: 'precio_total',
  label: 'Precio',
  tipo: 'currency',
  min: true,
  descripcion_ai:
    'El precio que la pantalla muestra como valor a pagar, tal como está escrito. ' +
    'Si hay varios (por persona y total), devuelve el que la pantalla destaca como principal ' +
    'y declara en base_precio cuál de los dos es.',
}

/**
 * La ocupación que muestra la captura, por tipo de pasajero (TP3).
 *
 * ⚠️ Son CONTEOS leídos, no una composición deducida: con «3 huéspedes» la pantalla no
 * dice cuántos son adultos, y adivinarlo es inventar el dato contra el que se valida la
 * captura. Por eso va aparte `ocupacion_total`.
 */
/**
 * Lo que NO es ocupación y el modelo tomó por ella, medido contra el banco real del 2026-09-16:
 * «1 x Standard Room» (habitaciones) leído como 1 adulto, y «Standard Room W... AD» (régimen
 * alojamiento y desayuno) devuelto como «1 Adulto». Va en cada campo de conteo porque el
 * modelo los llena por separado.
 */
const NO_ES_OCUPACION =
  'El número de habitaciones («1 x Standard Room», «1 Habitación») NO es la ocupación, y el código de régimen ' +
  'que sigue al nombre de la habitación (SA, AD, MP, PC, TI) tampoco: «Standard Room AD» es alojamiento y ' +
  'desayuno, no un adulto. No los uses como número de personas.'

const OCUPACION: CampoRanura[] = [
  {
    slug: 'ocupacion_adultos',
    label: 'Adultos en la captura',
    tipo: 'numero',
    min: false,
    descripcion_ai:
      'Cuántos ADULTOS muestra la pantalla para esta búsqueda o reserva (buscador, resumen de la reserva, ' +
      'o la fila ADT de una tabla por tipo de pasajero). null si la pantalla no separa adultos de menores o no se ve. ' +
      NO_ES_OCUPACION,
  },
  {
    slug: 'ocupacion_ninos',
    label: 'Niños en la captura',
    tipo: 'numero',
    min: false,
    descripcion_ai:
      'Cuántos NIÑOS muestra la pantalla (niño, child, CHD). 0 si la pantalla muestra la ocupación y no hay niños. ' +
      'null si no se ve la ocupación. ' + NO_ES_OCUPACION,
  },
  {
    slug: 'ocupacion_infantes',
    label: 'Infantes en la captura',
    tipo: 'numero',
    min: false,
    descripcion_ai:
      'Cuántos INFANTES muestra la pantalla (infante, bebé, INF). 0 si la pantalla muestra la ocupación y no hay ' +
      'infantes. null si no se ve la ocupación. ' + NO_ES_OCUPACION,
  },
  {
    slug: 'ocupacion_total',
    label: 'Personas en la captura',
    tipo: 'numero',
    min: false,
    descripcion_ai:
      'Total de personas cuando la pantalla solo da el total sin separar adultos y menores (ej. «3 huéspedes»). ' +
      'null si no se ve. ' + NO_ES_OCUPACION,
  },
]

/**
 * Lo que paga la agencia cuando la pantalla lo muestra aparte del valor al pasajero.
 *
 * Hallazgo 7.1 del diseño: en la liquidación de Decameron la resta de comisión y
 * prestación NO da el «total a pagar agencia» (faltan 7.287 sin concepto). El costo es el
 * número leído, nunca uno recalculado.
 *
 * ⚠️ La etiqueta NO es la de Decameron. Medido contra el banco real el 2026-09-16, la
 * captura de Altos Ushuaia (`4.03.08_PM`) dice exactamente lo mismo con otras palabras
 * —«Precio neto» en un globo, sobre el precio grande— y este campo volvía vacío en las
 * 4 corridas: la pantalla traía un margen servido que nadie tomaba. Por eso la
 * descripción enumera las formas de decirlo y no una sola.
 *
 * ⚠️ El otro efecto de nombrarlo es que le da DÓNDE CAER a ese número: en 1 de 6 corridas
 * el modelo había leído el neto de Ushuaia como si fuera el precio al pasajero. Con dos
 * casillas descritas cada cifra tiene su sitio, y por eso las dos descripciones se
 * apuntan mutuamente.
 */
const A_PAGAR_AGENCIA: CampoRanura = {
  slug: 'total_a_pagar_agencia',
  label: 'Precio neto (lo que paga la agencia)',
  tipo: 'currency',
  min: false,
  alerta_revision: true,
  descripcion_ai:
    'El valor NETO que paga la AGENCIA, cuando la pantalla lo muestra aparte del valor al pasajero. ' +
    'Da igual cómo lo llame: «TOTAL A PAGAR AGENCIA», «Precio neto», «Neto», «Tarifa neta», «Net rate», ' +
    '«Precio agencia», «Valor agencia», «Costo agencia». Suele ser MENOR que el precio destacado y aparecer ' +
    'en un globo, un recuadro o una fila aparte. Cópialo tal cual: NO lo calcules restando comisiones. ' +
    'null si la pantalla no lo muestra. NUNCA pongas aquí el precio que paga el pasajero: ese va en precio_total.',
}

/**
 * La comisión de la agencia, para DERIVAR el neto cuando la pantalla no lo escribe.
 *
 * Solo rellena el hueco: si el neto viene escrito, manda el neto (`costo-agencia.ts`).
 * Son dos campos porque la misma comisión suele venir escrita dos veces —Ushuaia dice
 * «Descuento (14%) 111.862,29»— y tenerlas separadas es lo que permite cruzarlas: si el
 * porcentaje aplicado al precio no da la plata, la captura se contradice y no se fija
 * ningún margen.
 *
 * ⚠️ La descripción distingue a propósito la comisión de la agencia de un descuento
 * PROMOCIONAL al cliente. Los dos se dibujan igual (un porcentaje al lado de un valor) y
 * confundirlos convertiría una oferta de temporada en margen inventado.
 */
const COMO_SE_RECONOCE_LA_COMISION =
  'Es lo que la AGENCIA gana: la diferencia entre lo que paga el pasajero y lo que paga la agencia. ' +
  'Cuenta cuando la pantalla la llama «comisión», «comisión agencia», «commission», o cuando es el ' +
  'descuento que aplicado al precio da un «precio neto» que también se ve. ' +
  'NO cuentan las rebajas promocionales al cliente (precio tachado, «-20% oferta», «ahorra X»): esas no ' +
  'las gana la agencia. Si no puedes distinguirlo, devuelve null.'

const COMISION_VALOR: CampoRanura = {
  slug: 'comision_agencia_valor',
  label: 'Comisión de la agencia',
  tipo: 'currency',
  min: false,
  alerta_revision: true,
  descripcion_ai:
    `La comisión de la agencia EN PLATA, en la misma moneda del precio. ${COMO_SE_RECONOCE_LA_COMISION}`,
}

const COMISION_PCT: CampoRanura = {
  slug: 'comision_agencia_pct',
  label: 'Comisión de la agencia (%)',
  tipo: 'numero',
  min: false,
  descripcion_ai:
    'La misma comisión escrita como PORCENTAJE, solo el número (14 para «(14%)»). ' +
    `${COMO_SE_RECONOCE_LA_COMISION} null si la pantalla solo la muestra en plata.`,
}

/** Lo que paga la agencia, dicho de las tres formas en que las pantallas lo dicen. */
const COSTO_AGENCIA: CampoRanura[] = [A_PAGAR_AGENCIA, COMISION_VALOR, COMISION_PCT]

// ── Escala: DÓNDE, no solo cuántas ───────────────────────────────────────────

/**
 * Qué es una escala cuando la pantalla muestra el itinerario por tramos.
 *
 * Pedido de Alejandra el 2026-09-16: *«el cliente quiere saber si hace escala en Bogotá
 * o en Panamá»*. Hasta hoy la ranura solo leía CUÁNTAS (`escalas`), que es el dato que
 * menos le sirve a quien viaja.
 *
 * ⚠️ La escala casi nunca está escrita como tal: en el banco real (Amadeus, 2026-09-16)
 * la ida son dos filas —`Cúcuta CUC → Bogotá BOG` y `Bogotá BOG → Armenia AXM`— y la
 * palabra «escala» no aparece en ninguna parte. Por eso la instrucción describe el
 * PATRÓN (la ciudad donde termina un tramo y empieza el siguiente) y no una etiqueta.
 */
const COMO_SE_LEE_LA_ESCALA =
  'La escala es la ciudad INTERMEDIA del recorrido: cuando el itinerario se muestra en varios tramos, ' +
  'es la ciudad donde termina un tramo y empieza el siguiente (Cúcuta→Bogotá y Bogotá→Armenia hacen escala ' +
  'en Bogotá). Devuelve el NOMBRE de la ciudad como aparece, y el país si la pantalla lo muestra; si solo ' +
  'se ve el código de aeropuerto, devuélvelo tal cual. Con varias escalas, sepáralas con « · ». ' +
  'Si ese trayecto es de un solo tramo (directo), devuelve null: el campo escalas ya dice 0. ' +
  'Si la pantalla no muestra el recorrido, null. NUNCA la deduzcas de la aerolínea ni del destino.'

const ESCALA_IDA: CampoRanura = {
  slug: 'escala_ida',
  label: 'Escala (ida)',
  tipo: 'texto',
  min: false,
  descripcion_ai: `Ciudad o ciudades donde hace escala la IDA (los tramos que van del origen al destino). ${COMO_SE_LEE_LA_ESCALA}`,
}

const ESCALA_REGRESO: CampoRanura = {
  slug: 'escala_regreso',
  label: 'Escala (regreso)',
  tipo: 'texto',
  min: false,
  descripcion_ai:
    'Ciudad o ciudades donde hace escala el REGRESO (los tramos que vuelven del destino al origen). ' +
    `${COMO_SE_LEE_LA_ESCALA} Si el viaje es solo ida, null.`,
}

// ── Horas de vuelo: se LEEN, nunca se calculan ───────────────────────────────

/**
 * La hora de salida y la de llegada de cada trayecto.
 *
 * Los itinerarios que Trappvel manda hoy a sus clientes traen una tabla de vuelos con
 * columnas SALIDA y LLEGADA —leídas del PDF de referencia el 2026-09-22, donde salen como
 * `07:45 am` y `11:35 am`—. Sin estos campos esas dos columnas no se pueden llenar: el dato
 * **no existía** en ninguna ranura, así que no era un problema de impresión.
 *
 * ⚠️ En un itinerario con escala la pantalla muestra una fila POR TRAMO. Lo que el cliente
 * necesita es cuándo sale de su casa y cuándo llega a su destino, o sea la salida del
 * PRIMER tramo y la llegada del ÚLTIMO. Tomar la hora de una fila cualquiera daría una
 * hora real de un tramo que al viajero no le dice nada.
 */
const COMO_SE_LEE_LA_HORA =
  'Formato de 24 horas HH:MM, tal como se ve (05:50, 18:45). Si la pantalla usa AM/PM, conviértelo a 24 horas. ' +
  'Si la pantalla no muestra horas, devuelve null: NUNCA la deduzcas de la duración, de la fecha ni del destino.'

const HORA_SALIDA: CampoRanura = {
  slug: 'hora_salida',
  label: 'Hora de salida (ida)',
  tipo: 'texto',
  min: false,
  descripcion_ai:
    'Hora a la que SALE la ida. Si la ida se muestra en varios tramos, es la hora de salida del PRIMER ' +
    `tramo (el que sale del origen del viaje). ${COMO_SE_LEE_LA_HORA}`,
}

const HORA_LLEGADA: CampoRanura = {
  slug: 'hora_llegada',
  label: 'Hora de llegada (ida)',
  tipo: 'texto',
  min: false,
  descripcion_ai:
    'Hora a la que LLEGA la ida a su destino final. Si la ida se muestra en varios tramos, es la hora de ' +
    `llegada del ÚLTIMO tramo, no la del primero. ${COMO_SE_LEE_LA_HORA}`,
}

const HORA_SALIDA_REGRESO: CampoRanura = {
  slug: 'hora_salida_regreso',
  label: 'Hora de salida (regreso)',
  tipo: 'texto',
  min: false,
  descripcion_ai:
    'Hora a la que SALE el regreso (el primer tramo que vuelve del destino hacia el origen). ' +
    `${COMO_SE_LEE_LA_HORA} Si el viaje es solo ida, null.`,
}

const HORA_LLEGADA_REGRESO: CampoRanura = {
  slug: 'hora_llegada_regreso',
  label: 'Hora de llegada (regreso)',
  tipo: 'texto',
  min: false,
  descripcion_ai:
    'Hora a la que el regreso LLEGA de vuelta al origen (el último tramo del regreso). ' +
    `${COMO_SE_LEE_LA_HORA} Si el viaje es solo ida, null.`,
}

/**
 * ⚠️⚠️ La DURACIÓN del vuelo ya NO se lee, y no porque no se pudiera.
 *
 * Se leía bien —18 de 18 en el banco real (#812)— pero **el itinerario de referencia no la
 * trae**: su tabla de vuelos tiene cinco columnas (AEROLÍNEA, RUTA, FECHA, SALIDA, LLEGADA).
 * Leído el 2026-09-22 del PDF que Trappvel manda hoy. La §2 de `propuesta-visual.md` decía
 * que sí y estaba escrita de memoria.
 *
 * Nada más la consumía: `resumenDeLinea` nunca la mostró en la plataforma y el documento
 * era su único destino. Un campo que el modelo llena en cada lectura y que no se ve en
 * ninguna pantalla es trabajo que se paga y no se usa.
 *
 * Queda escrito lo que costó medirlo, porque la conclusión vale para cualquier dato
 * horario de un viaje internacional: **restar llegada menos salida miente en 2 de 3
 * capturas reales**, y en las dos por una hora exacta —lo bastante plausible como para que
 * nadie lo revise— porque el vuelo cruza un huso. Tampoco se pueden SUMAR los tramos: la
 * suma omite la conexión (2h 25m de tramos sobre un recorrido de 4h 25m). Si algún día
 * vuelve a hacer falta, se LEE de la pantalla o se deja vacía; nunca se calcula.
 */

// ── Equipaje: cuenta el icono RESALTADO, no que el icono exista ──────────────

/**
 * Los tres iconos de maleta salen SIEMPRE; el que cuenta es el resaltado.
 *
 * Defecto reportado por Alejandra el 2026-09-16: *«el lector marcó equipaje de bodega en
 * una tarifa Basic que solo lleva mochila»*. Medido sobre el banco real contando píxeles
 * (`3.57.39_PM-3`, tarifa BASIC): los tres iconos están dibujados y **solo el primero es
 * azul**; los otros dos son gris (RGB sin componente azul dominante). En la tarifa LIGHT
 * (`4.00.50_PM`) son azules el primero y el segundo, y gris el tercero. O sea que la
 * PRESENCIA del icono no dice nada y el color lo dice todo.
 *
 * Por eso cada campo describe **su** icono y el estado que lo hace verdadero, en vez de
 * preguntar «¿incluye equipaje de bodega?», que es la pregunta que el modelo respondía
 * mirando si el dibujo estaba.
 *
 * ⚠️ Desde el 2026-09-18 esta descripción **solo manda cuando la pantalla NO muestra
 * iconos** (una tarifa que dice por escrito «incluye 1 maleta de 23 kg»). Con fila de
 * iconos visible decide el ESTADO de cada icono (`iconos_equipaje` →
 * `derivarEquipajeDeLosIconos`, `src/lib/ai/extraer-ranura.ts`), y si esa fila no se lee
 * limpia los tres campos quedan vacíos. Motivo medido: con la descripción sola, la misma
 * imagen daba `true` en una corrida y `false` en la siguiente, las dos con confianza 0,9.
 */
const COMO_SE_LEE_EL_EQUIPAJE =
  'En las pantallas de aerolínea el equipaje se muestra como una fila de iconos y SIEMPRE aparecen todos, ' +
  'incluidos los que la tarifa NO incluye: los incluidos van RESALTADOS (a color, normalmente azul) y los ' +
  'excluidos van en GRIS, apagados o tachados. De izquierda a derecha son: (1) el más pequeño, un bolso, ' +
  'morral o mochila, es el ARTÍCULO PERSONAL; (2) una maleta de cabina con ruedas y manija, es el EQUIPAJE ' +
  'DE MANO; (3) la maleta más grande, es el EQUIPAJE DE BODEGA. Que el icono esté dibujado NO quiere decir ' +
  'que la tarifa lo incluya. PROCEDIMIENTO: cuenta de izquierda a derecha cuántos de los tres iconos están ' +
  'A COLOR. Si solo el primero está a color, la tarifa incluye ÚNICAMENTE el artículo personal y los otros ' +
  'dos son false. Si están a color los dos primeros, incluye artículo personal y equipaje de mano, y bodega ' +
  'es false. Si están los tres, los tres son true. NO decidas por el nombre de la tarifa (BASIC, LIGHT, ' +
  'STANDARD, FLEX) ni por lo que suelas saber de esa aerolínea: la misma familia tarifaria lleva cosas ' +
  'distintas según la ruta, y lo que vale es lo que la imagen muestra.'

function equipaje(slug: string, label: string, cual: string): CampoRanura {
  return {
    slug,
    label,
    tipo: 'boolean',
    min: false,
    alerta_revision: true,
    descripcion_ai:
      `true SOLO si ${cual} está RESALTADO a color (o la pantalla lo dice con texto); ` +
      `false si está en gris, apagado o tachado (o la pantalla dice que no va incluido); ` +
      `null si la pantalla no muestra nada sobre equipaje. ${COMO_SE_LEE_EL_EQUIPAJE}`,
  }
}

const EQUIPAJE: CampoRanura[] = [
  equipaje('equipaje_personal', 'Artículo personal', 'el icono del artículo personal (el bolso o mochila, el primero)'),
  equipaje('equipaje_mano', 'Equipaje de mano', 'el icono de la maleta de cabina (el segundo)'),
  equipaje('equipaje_bodega', 'Equipaje de bodega', 'el icono de la maleta grande de bodega (el tercero)'),
]

/** El enum que decide si el número leído se multiplica o no (R-P6). */
function basePrecio(opciones: string[], nota: string): CampoRanura {
  return {
    slug: 'base_precio',
    label: 'El precio mostrado es',
    tipo: 'enum',
    min: true,
    alerta_revision: true,
    opciones,
    descripcion_ai:
      `Qué representa el número de precio_total. ${nota} ` +
      `Responde exactamente uno de: ${opciones.join(', ')}. ` +
      'Si la pantalla no lo dice con claridad, devuelve null en vez de suponer.',
  }
}

// ── El registro ──────────────────────────────────────────────────────────────

const VUELO: DefinicionRanura = {
  slug: 'vuelo_detalle',
  label: 'Vuelo',
  grupos: ['vuelo', 'vuelos', 'aereo', 'aéreo', 'tiquete', 'tiquetes'],
  queSePide: 'La pantalla de DETALLE del itinerario ya seleccionado, con su precio.',
  queNoSirve: 'El listado de resultados o el comparador de aerolíneas: ahí hay varias tarifas y el sistema no elige por ti.',
  unidadPorDefecto: 'pax',
  campos: [
    { slug: 'aerolinea', label: 'Aerolínea', tipo: 'texto', min: true, descripcion_ai: 'Nombre de la aerolínea que opera el itinerario.' },
    { slug: 'origen', label: 'Origen', tipo: 'texto', min: true, descripcion_ai: 'Ciudad o código IATA de salida del primer trayecto.' },
    { slug: 'destino', label: 'Destino', tipo: 'texto', min: true, descripcion_ai: 'Ciudad o código IATA de llegada final de la ida.' },
    { slug: 'fecha_salida', label: 'Salida', tipo: 'fecha', min: true, descripcion_ai: 'Fecha de salida del vuelo de ida, en formato AAAA-MM-DD. Si la pantalla muestra día y mes pero NO el año, devuelve --MM-DD (ej. --10-23): NUNCA inventes el año.' },
    { slug: 'fecha_regreso', label: 'Regreso', tipo: 'fecha', min: false, descripcion_ai: 'Fecha del vuelo de regreso en formato AAAA-MM-DD. null si es solo ida. Si la pantalla muestra día y mes pero NO el año, devuelve --MM-DD (ej. --10-23): NUNCA inventes el año.' },
    HORA_SALIDA,
    HORA_LLEGADA,
    HORA_SALIDA_REGRESO,
    HORA_LLEGADA_REGRESO,
    { slug: 'numero_vuelo', label: 'Nº de vuelo', tipo: 'texto', min: false, descripcion_ai: 'Número o números de vuelo tal como aparecen (ej. AV8520).' },
    { slug: 'escalas', label: 'Escalas', tipo: 'numero', min: false, descripcion_ai: 'Cuántas escalas tiene la IDA. 0 si es directo. null si la pantalla no lo dice.' },
    ESCALA_IDA,
    ESCALA_REGRESO,
    { slug: 'familia_tarifa', label: 'Tarifa', tipo: 'texto', min: false, descripcion_ai: 'Nombre de la familia tarifaria: basic, light, full, flex, economy...' },
    ...EQUIPAJE,
    { slug: 'pax', label: 'Pasajeros', tipo: 'numero', min: true, descripcion_ai: 'Número de pasajeros de la reserva. Si la pantalla no lo dice, devuelve null: no supongas 1.' },
    ...OCUPACION,
    MONEDA,
    PRECIO_TOTAL,
    basePrecio(['total', 'por_pax'], 'total = es el precio de toda la reserva; por_pax = es el precio de un solo pasajero.'),
    ...COSTO_AGENCIA,
    { slug: 'precio_por_pax', label: 'Precio por pax', tipo: 'currency', min: false, descripcion_ai: 'Precio unitario por pasajero, solo si la pantalla lo muestra aparte del total.' },
  ],
}

// ── Estrellas: la CATEGORÍA del hotel, no la opinión de los huéspedes ────────

/**
 * La categoría del hotel, leída SOLO si la captura la muestra.
 *
 * La tarjeta de hotel del documento del cliente imprime las estrellas junto al nombre
 * (`sistema-visual-documento.md` §4.3) y ninguna ranura las leía: el campo existía en
 * `HotelPDF` y llegaba siempre vacío. Es la excepción declarada a «no tocar la ficha»
 * (brief del 2026-09-22).
 *
 * ⚠️ `aparte`: la lectura NO la pide. La detecta `detectarEstrellas`
 * (`src/lib/ai/extraer-ranura.ts`) en paralelo, con otro modelo y otra pregunta, porque
 * contarla dentro de la lectura dio 4 en un hotel de 5 estrellas en cinco de cinco corridas.
 * El porqué, con los números, está en esa función. Aquí sigue siendo un campo de la ranura:
 * se muestra, se edita y se guarda como los demás.
 *
 * ⚠️ La trampa en las tarjetas reales no es solo la estrella vacía: dos líneas más abajo van
 * los círculos verdes de TripAdvisor (4 círculos en un hotel de 3 estrellas). La reseña no es
 * la categoría.
 */
const ESTRELLAS: CampoRanura = {
  slug: 'estrellas',
  label: 'Estrellas',
  tipo: 'numero',
  min: false,
  alerta_revision: true,
  aparte: true,
  descripcion_ai:
    'Categoría del hotel en estrellas, entero de 1 a 5, solo si la captura la muestra junto al nombre. ' +
    'No se le pide a la lectura: la detecta `detectarEstrellas`.',
}

const HOTEL: DefinicionRanura = {
  slug: 'hotel_detalle',
  label: 'Hotel',
  grupos: ['hotel', 'hoteles', 'alojamiento', 'hospedaje'],
  queSePide: 'La pantalla de la habitación y el régimen ya seleccionados, con el precio total de la estadía.',
  queNoSirve: 'El listado de hoteles o la grilla de habitaciones: ahí hay varias tarifas y el sistema no elige por ti.',
  unidadPorDefecto: 'noches',
  campos: [
    { slug: 'hotel', label: 'Hotel', tipo: 'texto', min: true, descripcion_ai: 'Nombre del HOTEL tal como aparece. No el nombre de una promoción, de un plan o de una tarifa: si la pantalla no muestra el nombre del hotel, devuelve null.' },
    ESTRELLAS,
    { slug: 'ciudad', label: 'Ciudad', tipo: 'texto', min: true, descripcion_ai: 'Ciudad o zona del hotel según la pantalla. Si no aparece, devuelve null: NO la deduzcas del destino del viaje.' },
    { slug: 'tipo_habitacion', label: 'Habitación', tipo: 'texto', min: true, descripcion_ai: 'Tipo de habitación seleccionada (doble estándar, suite, vista al mar...).' },
    { slug: 'regimen', label: 'Régimen', tipo: 'texto', min: false, descripcion_ai: 'Régimen de alimentación: solo alojamiento, desayuno, media pensión, todo incluido.' },
    { slug: 'check_in', label: 'Check-in', tipo: 'fecha', min: true, descripcion_ai: 'Fecha de entrada en formato AAAA-MM-DD. Si la pantalla muestra día y mes pero NO el año, devuelve --MM-DD (ej. --10-23): NUNCA inventes el año.' },
    { slug: 'check_out', label: 'Check-out', tipo: 'fecha', min: true, descripcion_ai: 'Fecha de salida en formato AAAA-MM-DD. Si la pantalla muestra día y mes pero NO el año, devuelve --MM-DD (ej. --10-23): NUNCA inventes el año.' },
    { slug: 'noches', label: 'Noches', tipo: 'numero', min: false, descripcion_ai: 'Número de noches si la pantalla lo dice. Si no, devuelve null: se deriva de las fechas.' },
    { slug: 'ocupacion', label: 'Ocupación', tipo: 'texto', min: false, descripcion_ai: 'El texto literal donde la pantalla dice cuántas PERSONAS se alojan (ej. «2 Adultos - 1 Niño», «3 Huéspedes»), copiado tal cual. Si no hay texto de personas, devuelve null. ' + NO_ES_OCUPACION },
    { slug: 'politica_cancelacion', label: 'Cancelación', tipo: 'texto', min: false, alerta_revision: true, descripcion_ai: 'Política de cancelación en una línea: no reembolsable, gratis hasta tal fecha...' },
    {
      // ⚠️ NO es mínimo desde la tarifa por pasajero (2026-09-16). La tarjeta de hotel del
      // listado —la forma real en que Trappvel cotiza— no dice nada de impuestos, y con
      // `min: true` se rechazaba entera. El dato sigue marcado para revisión y, si la
      // captura no lo dice, la lectura lo AVISA en vez de suponer que están incluidos.
      slug: 'impuestos_incluidos',
      label: 'Impuestos incluidos',
      tipo: 'boolean',
      min: false,
      alerta_revision: true,
      descripcion_ai:
        'true si el precio mostrado YA incluye impuestos y tasas; false si la pantalla dice que se pagan aparte ' +
        '(resort fee, city tax, IVA no incluido). Si no lo dice, devuelve null: no supongas que están incluidos.',
    },
    {
      slug: 'impuestos_destino_valor',
      label: 'Impuestos en destino',
      tipo: 'currency',
      min: false,
      alerta_revision: true,
      descripcion_ai:
        'Impuestos o tasas que la pantalla dice que se pagan EN DESTINO, en el hotel, fuera del precio ' +
        '(ej. «Impuestos y tasas a pagar en destino: 329,44 MXN»). Solo el número. null si no aparece.',
    },
    {
      slug: 'impuestos_destino_moneda',
      label: 'Moneda de los impuestos en destino',
      tipo: 'texto',
      min: false,
      descripcion_ai: 'Código ISO 4217 de la moneda de esos impuestos en destino (MXN, USD, EUR...). null si no aparece.',
    },
    ...OCUPACION,
    MONEDA,
    PRECIO_TOTAL,
    basePrecio(['total', 'por_noche'], 'total = es el precio de toda la estadía; por_noche = es el precio de una sola noche.'),
    ...COSTO_AGENCIA,
  ],
}

const ACTIVIDAD: DefinicionRanura = {
  slug: 'actividad_detalle',
  label: 'Actividad',
  grupos: ['actividad', 'actividades', 'tour', 'tours', 'excursion', 'excursión'],
  queSePide: 'La ficha de la actividad con su fecha, número de personas y precio.',
  queNoSirve: 'El buscador con varias actividades: se sube la que ya se eligió.',
  unidadPorDefecto: 'pax',
  campos: [
    { slug: 'proveedor', label: 'Proveedor', tipo: 'texto', min: true, descripcion_ai: 'Quién vende la actividad: Civitatis, GetYourGuide, Viator, o el operador directo.' },
    { slug: 'nombre', label: 'Actividad', tipo: 'texto', min: true, descripcion_ai: 'Nombre de la actividad tal como aparece.' },
    { slug: 'ciudad', label: 'Ciudad', tipo: 'texto', min: true, descripcion_ai: 'Ciudad donde se presta. Si no aparece, null: no la deduzcas del viaje.' },
    { slug: 'fecha', label: 'Fecha', tipo: 'fecha', min: false, descripcion_ai: 'Fecha de la actividad en formato AAAA-MM-DD. Si la pantalla muestra día y mes pero NO el año, devuelve --MM-DD (ej. --10-23): NUNCA inventes el año.' },
    { slug: 'duracion', label: 'Duración', tipo: 'texto', min: false, descripcion_ai: 'Duración tal como aparece (3 horas, día completo...).' },
    { slug: 'idioma', label: 'Idioma', tipo: 'texto', min: false, descripcion_ai: 'Idioma en que se presta el servicio.' },
    { slug: 'pax', label: 'Personas', tipo: 'numero', min: true, descripcion_ai: 'Número de personas de la reserva. Si no se ve, null: no supongas 1.' },
    ...OCUPACION,
    MONEDA,
    PRECIO_TOTAL,
    basePrecio(['total', 'por_pax'], 'total = es el precio de todas las personas; por_pax = es el precio de una sola.'),
    ...COSTO_AGENCIA,
  ],
}

const TRASLADO: DefinicionRanura = {
  slug: 'traslado_detalle',
  label: 'Traslado',
  grupos: ['traslado', 'traslados', 'transfer', 'transfers', 'transporte'],
  queSePide: 'La cotización del trayecto con vehículo, fecha y precio.',
  queNoSirve: 'La lista de opciones de vehículo: se sube la que ya se eligió.',
  unidadPorDefecto: 'trayecto',
  campos: [
    { slug: 'proveedor', label: 'Proveedor', tipo: 'texto', min: true, descripcion_ai: 'Quién presta el traslado.' },
    { slug: 'trayecto', label: 'Trayecto', tipo: 'texto', min: true, descripcion_ai: 'De dónde a dónde (aeropuerto - hotel, ida y vuelta...).' },
    { slug: 'tipo_vehiculo', label: 'Vehículo', tipo: 'texto', min: false, descripcion_ai: 'Tipo de vehículo y si es privado o compartido.' },
    { slug: 'fecha_hora', label: 'Fecha', tipo: 'fecha', min: false, descripcion_ai: 'Fecha del servicio en formato AAAA-MM-DD. Si la pantalla muestra día y mes pero NO el año, devuelve --MM-DD (ej. --10-23): NUNCA inventes el año.' },
    { slug: 'pax', label: 'Personas', tipo: 'numero', min: true, descripcion_ai: 'Número de personas. Si no se ve, null: no supongas 1.' },
    ...OCUPACION,
    MONEDA,
    PRECIO_TOTAL,
    basePrecio(['total', 'por_pax'], 'total = es el precio del trayecto completo; por_pax = es el precio por persona.'),
    ...COSTO_AGENCIA,
  ],
}

const RANURAS: Record<string, DefinicionRanura> = {
  [VUELO.slug]: VUELO,
  [HOTEL.slug]: HOTEL,
  [ACTIVIDAD.slug]: ACTIVIDAD,
  [TRASLADO.slug]: TRASLADO,
}

// ── Qué ranuras entran al producto cartesiano ────────────────────────────────

/**
 * Las DOS ranuras que la tabla de combinaciones cruza entre sí.
 *
 * Decisión de la reunión del 2026-09-14 con Daniela y Alejandra, y el argumento es
 * suyo: *un traslado al aeropuerto no cambia según la aerolínea que se escoja*.
 * Multiplicar por él no le da al comercial ninguna decisión que tomar; solo infla la
 * tabla. Tres vuelos por tres hoteles son nueve filas revisables; meter dos traslados
 * las vuelve dieciocho, idénticas de a pares.
 *
 * Tours, traslados, planes y cualquier grupo propio (`seguro`, `dia-1`) siguen
 * existiendo y siguen sumando: entran en TODOS los itinerarios, iguales para todos.
 * Lo que dejan de hacer es abrir una columna.
 *
 * ⚠️ Vive AQUÍ, en el catálogo de ranuras, y no como una lista nueva en el motor de
 * itinerarios. El catálogo ya es la única pieza que sabe qué es un vuelo y qué es un
 * hotel —con sus sinónimos declarados, «hoteles» y «alojamiento» incluidos— y una
 * segunda lista para la misma pregunta se desincroniza el día que se agregue un
 * sinónimo: el síntoma sería una columna que desaparece de la tabla sin que nada falle.
 */
export const RANURAS_COMBINABLES: readonly string[] = [VUELO.slug, HOTEL.slug]

/**
 * ¿Un `items.grupo` abre columna en la tabla de combinaciones?
 *
 * Solo si resuelve a una ranura combinable. Un grupo que no resuelve a ninguna ranura
 * (`seguro`, `dia-1`, «propina») devuelve `false`, que es lo correcto: nunca se cruzó
 * con nada y ahora tampoco.
 *
 * ⚠️ Cada INSTANCIA abre su propia columna: «vuelo» y «vuelo 2» son dos columnas, y por
 * eso los dos vuelos de Providencia suman en cada tarifa en vez de competir.
 */
export function grupoCombinable(grupo: string | null | undefined): boolean {
  const ranura = ranuraDeGrupo(grupo)
  return ranura !== null && RANURAS_COMBINABLES.includes(ranura.slug)
}

// ── Resolución ───────────────────────────────────────────────────────────────

/**
 * Normaliza un grupo para compararlo: sin tildes, minúsculas, sin espacios sobrantes.
 *
 * ⚠️ Esto NO es inferir (R-P4). «Hotel» y «hotel» son la misma palabra escrita por dos
 * personas; «Hotel Occidental» es otra cosa y no resuelve a ninguna ranura, que es lo
 * correcto: es el nombre de un proveedor.
 */
function clave(grupo: string): string {
  return grupo
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

const POR_GRUPO: Map<string, DefinicionRanura> = new Map(
  Object.values(RANURAS).flatMap(r => r.grupos.map(g => [clave(g), r] as const)),
)

/** El separador explícito del nombre libre. Ver la cabecera. */
const SEPARADOR = ':'

/**
 * Una ranura CONCRETA de una cotización: su tipo y qué la distingue de sus hermanas.
 *
 * La gramática completa del `items.grupo`, y no tiene más casos:
 *
 * ```
 *   grupo  = tipo [ " " numero ] [ ":" nombre ]
 *   tipo   = uno de los sinónimos declarados en `DefinicionRanura.grupos`
 * ```
 *
 * `vuelo` · `vuelo 2` · `vuelo: Bogotá a San Andrés` · `vuelo 2: San Andrés a Providencia`
 */
export interface InstanciaRanura {
  /** El contrato de captura. Lo comparten todas las instancias del mismo tipo. */
  definicion: DefinicionRanura
  /**
   * El ordinal, cuando la instancia lo lleva. `null` = la primera.
   *
   * Lo pone `siguienteGrupoDeTipo` al crear la segunda ranura del tipo, y **sobrevive al
   * renombre**: «vuelo 2» renombrada queda «vuelo 2: San Andrés a Providencia». Perder el
   * número al renombrar haría que la siguiente ranura volviera a llamarse 2.
   */
  numero: number | null
  /** El nombre que le puso una persona. `null` = todavía no tiene. */
  nombre: string | null
}

/**
 * La ranura concreta que le corresponde a un `items.grupo`.
 *
 * `null` es una respuesta legítima y frecuente: los grupos del método día a día
 * (`dia-1`, `dia-2`, §2.5) y los componentes propios («seguro», «propina») no tienen
 * contrato de captura. Esos ítems se costean a mano, como hoy.
 */
export function resolverRanura(grupo: string | null | undefined): InstanciaRanura | null {
  if (!grupo) return null
  const bruto = grupo.trim()
  if (bruto === '') return null

  // El grupo entero como tipo va PRIMERO, sin pasar por la gramática: así ningún grupo
  // que hoy resuelve puede dejar de hacerlo por un separador que aparezca en un
  // sinónimo futuro.
  const directa = POR_GRUPO.get(clave(bruto))
  if (directa) return { definicion: directa, numero: null, nombre: null }

  const corte = bruto.indexOf(SEPARADOR)
  const cabeza = corte >= 0 ? bruto.slice(0, corte).trim() : bruto
  const libre = corte >= 0 ? bruto.slice(corte + 1).trim() : ''
  if (cabeza === '') return null

  // El ordinal va pegado al tipo y SOLO admite dígitos. No es un detalle: con cualquier
  // palabra, «Hotel Occidental» pasaría a ser una ranura de hotel, y el registro declara
  // desde el primer día que no debe — es el nombre de un proveedor.
  const numerada = /^(.+?)\s+(\d+)$/.exec(cabeza)
  const tipo = numerada ? numerada[1] : cabeza
  const numero = numerada ? Number(numerada[2]) : null

  const def = POR_GRUPO.get(clave(tipo))
  if (!def) return null
  return { definicion: def, numero, nombre: libre === '' ? null : libre }
}

/**
 * El TIPO de ranura de un grupo, o `null` si ese grupo no es una.
 *
 * Es lo que consumen el pantallazo, la cobertura y el documento: todos preguntan «¿esto
 * es un vuelo?», no «¿cuál de los vuelos?». Dos instancias del mismo tipo devuelven la
 * misma definición, que es justo lo que hace que «Vuelo 2» tenga caja de pantallazo.
 */
export function ranuraDeGrupo(grupo: string | null | undefined): DefinicionRanura | null {
  return resolverRanura(grupo)?.definicion ?? null
}

/**
 * ¿Estos dos grupos son la MISMA ranura? Compara el texto, no el tipo.
 *
 * ⚠️ `vuelo` y `vuelo 2` son del mismo tipo y **no** son la misma ranura: suman. Quien
 * necesite «del mismo tipo» compara `ranuraDeGrupo(a)?.slug === ranuraDeGrupo(b)?.slug`,
 * y quien necesite «la misma columna» usa esto.
 */
export function mismaRanura(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = (a ?? '').trim()
  const kb = (b ?? '').trim()
  if (ka === '' || kb === '') return false
  return clave(ka) === clave(kb)
}

/**
 * Cómo se llama una ranura de cara a quien cotiza, y en el documento.
 *
 * El tipo SIEMPRE se dice, aunque haya etiqueta: una columna que dijera solo «Bogotá a
 * San Andrés» deja de decir que es un vuelo, y es lo primero que hay que saber para
 * elegir en ella. Un grupo que no es ranura se devuelve tal como se escribió — «dia-1»
 * y «seguro» son su propio nombre.
 */
export function etiquetaDeRanura(grupo: string | null | undefined): string {
  const instancia = resolverRanura(grupo)
  if (instancia === null) return (grupo ?? '').trim()
  const { definicion, numero, nombre } = instancia
  const cabeza = numero === null ? definicion.label : `${definicion.label} ${numero}`
  if (nombre === null) return cabeza
  // Un nombre que YA dice el tipo («Hotel en Cancún», el que pone la ranura al nacer) no se
  // repite detrás de él: «Hotel · Hotel en Cancún» no dice nada más. Solo si también lleva
  // su ordinal («Hotel 2 en Cancún»): sin él, dos ranuras del mismo tipo se leerían iguales.
  if (nombreDiceElTipo(nombre, definicion.label, numero)) return nombre
  return `${cabeza} · ${nombre}`
}

/** ¿El nombre libre empieza por el tipo (y su ordinal, si lo tiene)? */
function nombreDiceElTipo(nombre: string, label: string, numero: number | null): boolean {
  const n = clave(nombre)
  const tipo = clave(label)
  if (numero === null) return n === tipo || n.startsWith(`${tipo} `)
  return n === `${tipo} ${numero}` || n.startsWith(`${tipo} ${numero} `)
}

/**
 * El `items.grupo` que corresponde a una instancia: el canónico, su ordinal y su nombre.
 *
 * Se escribe siempre desde el canónico (`vuelo`), no desde el sinónimo que alguien haya
 * tecleado: así dos ranuras que se llaman igual no quedan escritas distinto («hoteles 2»
 * y «hotel 2») y dejan de ser la misma columna sin que nada falle.
 *
 * ⚠️ El nombre se limpia de dos puntos: uno dentro convertiría «vuelo: 9:15 a. m.» en un
 * grupo cuyo nombre es «9» y cuyo resto se pierde al releerlo. Se reemplaza por un guion
 * en vez de rechazarse, porque el nombre es de la persona y no de la gramática.
 */
export function grupoDeInstancia(
  definicion: DefinicionRanura,
  instancia: { numero?: number | null; nombre?: string | null },
): string {
  const canonico = definicion.grupos[0]
  const n = instancia.numero ?? null
  const cabeza = n === null || !Number.isInteger(n) || n < 2 ? canonico : `${canonico} ${n}`
  const nombre = (instancia.nombre ?? '').trim().replace(/:/g, ' -').trim()
  return nombre === '' ? cabeza : `${cabeza}${SEPARADOR} ${nombre}`
}

/**
 * El grupo de la SIGUIENTE ranura de un tipo, dados los que ya existen.
 *
 * La primera va sin etiqueta (`vuelo`) y las demás numeradas (`vuelo 2`, `vuelo 3`), de
 * modo que una cotización de un solo vuelo se escribe exactamente como hoy (R6) y la
 * segunda no tiene que inventarse un nombre para existir — se le pone después.
 *
 * ⚠️ Basta que exista UNA ranura del tipo, con la etiqueta que sea, para que la siguiente
 * arranque en 2: si alguien renombró la primera a «vuelo: Bogotá a San Andrés», devolver
 * «vuelo» crearía una ranura nueva en vez de continuar la serie, y a simple vista se
 * leerían como dos cosas distintas del mismo viaje.
 */
export function siguienteGrupoDeTipo(
  definicion: DefinicionRanura,
  gruposEnUso: readonly (string | null | undefined)[],
): string {
  const delTipo = gruposEnUso
    .map(resolverRanura)
    .filter(r => r !== null && r.definicion.slug === definicion.slug)
  if (delTipo.length === 0) return definicion.grupos[0]
  // El siguiente ordinal libre. Se mira el NÚMERO de cada instancia, no el texto del
  // grupo: una ranura renombrada («vuelo 2: San Andrés a Providencia») ocupa el 2 aunque
  // su grupo ya no se escriba así, y reutilizarlo fundiría dos ranuras en una.
  const ocupados = new Set(delTipo.map(r => r!.numero ?? 1))
  let n = 2
  while (ocupados.has(n)) n += 1
  return grupoDeInstancia(definicion, { numero: n })
}

/** La ranura por su slug. `null` si el slug no está en el registro. */
export function ranuraPorSlug(slug: string | null | undefined): DefinicionRanura | null {
  if (!slug) return null
  if (!Object.hasOwn(RANURAS, slug)) return null
  return RANURAS[slug]
}

/**
 * Los grupos canónicos que el selector del editor ofrece, en orden de uso.
 *
 * Existe porque la pantalla NO puede tener su propia lista: dos listas para la misma
 * decisión se desincronizan y el síntoma es mudo — el grupo queda escrito, la tabla
 * de combinaciones lo respeta, y el pantallazo no encuentra contrato.
 */
export function gruposCanonicos(): { grupo: string; label: string; ranura: string }[] {
  return Object.values(RANURAS).map(r => ({ grupo: r.grupos[0], label: r.label, ranura: r.slug }))
}

/** Los campos mínimos de una ranura. Lo que, si falta, dispara RX2. */
export function camposMinimos(ranura: DefinicionRanura): CampoRanura[] {
  return ranura.campos.filter(c => c.min)
}

/**
 * Los mínimos que deciden el COSTO: sin ellos el número leído no se puede costear.
 *
 * En el cargue por casillas (tarifa por pasajero) la línea ya existe y la nombró quien
 * cotiza, así que los mínimos DESCRIPTIVOS (hotel, ciudad, habitación, fechas) que la
 * captura no muestre se avisan en vez de rechazar. La liquidación de un proveedor trae el
 * desglose y el total a pagar agencia sin el nombre del hotel: rechazarla por el nombre
 * tiraría el único documento que parte el costo por pasajero.
 */
export const MINIMOS_DE_COSTO: readonly string[] = ['moneda', 'precio_total', 'base_precio']

/** Slugs del registro. Expuesto para pruebas y para el PR. */
export function slugsDeRanura(): string[] {
  return Object.keys(RANURAS)
}
