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
 */
const A_PAGAR_AGENCIA: CampoRanura = {
  slug: 'total_a_pagar_agencia',
  label: 'Total a pagar agencia',
  tipo: 'currency',
  min: false,
  alerta_revision: true,
  descripcion_ai:
    'El valor NETO que paga la agencia cuando la pantalla lo muestra aparte del valor al pasajero ' +
    '(ej. «TOTAL A PAGAR AGENCIA» en una liquidación con comisión). Cópialo tal cual: NO lo calcules ' +
    'restando comisiones. null si la pantalla no lo muestra.',
}

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
 * ⚠️ Esta descripción NO es lo único que decide: lo que el modelo responda aquí se CRUZA
 * contra los iconos que dice ver (`iconos_equipaje`), y lo que no coincide se descarta
 * (`derivarEquipajeDeLosIconos`, `src/lib/ai/extraer-ranura.ts`). Con la descripción sola,
 * la misma imagen daba respuestas distintas entre corridas.
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
    A_PAGAR_AGENCIA,
    { slug: 'precio_por_pax', label: 'Precio por pax', tipo: 'currency', min: false, descripcion_ai: 'Precio unitario por pasajero, solo si la pantalla lo muestra aparte del total.' },
    basePrecio(['total', 'por_pax'], 'total = es el precio de toda la reserva; por_pax = es el precio de un solo pasajero.'),
  ],
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
    A_PAGAR_AGENCIA,
    basePrecio(['total', 'por_noche'], 'total = es el precio de toda la estadía; por_noche = es el precio de una sola noche.'),
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
    A_PAGAR_AGENCIA,
    basePrecio(['total', 'por_pax'], 'total = es el precio de todas las personas; por_pax = es el precio de una sola.'),
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
    A_PAGAR_AGENCIA,
    basePrecio(['total', 'por_pax'], 'total = es el precio del trayecto completo; por_pax = es el precio por persona.'),
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

/**
 * La ranura que le corresponde a un `items.grupo`, o `null` si ese grupo no es una.
 *
 * `null` es una respuesta legítima y frecuente: los grupos del método día a día
 * (`dia-1`, `dia-2`, §2.5) y los componentes propios («seguro», «propina») no tienen
 * contrato de captura. Esos ítems se costean a mano, como hoy.
 */
export function ranuraDeGrupo(grupo: string | null | undefined): DefinicionRanura | null {
  if (!grupo) return null
  return POR_GRUPO.get(clave(grupo)) ?? null
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
