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
    { slug: 'fecha_salida', label: 'Salida', tipo: 'fecha', min: true, descripcion_ai: 'Fecha de salida del vuelo de ida, en formato AAAA-MM-DD.' },
    { slug: 'fecha_regreso', label: 'Regreso', tipo: 'fecha', min: false, descripcion_ai: 'Fecha del vuelo de regreso en formato AAAA-MM-DD. null si es solo ida.' },
    { slug: 'numero_vuelo', label: 'Nº de vuelo', tipo: 'texto', min: false, descripcion_ai: 'Número o números de vuelo tal como aparecen (ej. AV8520).' },
    { slug: 'escalas', label: 'Escalas', tipo: 'numero', min: false, descripcion_ai: 'Cuántas escalas tiene la ida. 0 si es directo. null si la pantalla no lo dice.' },
    { slug: 'familia_tarifa', label: 'Tarifa', tipo: 'texto', min: false, descripcion_ai: 'Nombre de la familia tarifaria: basic, light, full, flex, economy...' },
    { slug: 'equipaje_bodega', label: 'Equipaje de bodega', tipo: 'boolean', min: false, alerta_revision: true, descripcion_ai: 'true si la tarifa INCLUYE equipaje de bodega, false si lo excluye explícitamente, null si no se ve.' },
    { slug: 'equipaje_mano', label: 'Equipaje de mano', tipo: 'boolean', min: false, alerta_revision: true, descripcion_ai: 'true si INCLUYE equipaje de mano, false si solo artículo personal, null si no se ve.' },
    { slug: 'pax', label: 'Pasajeros', tipo: 'numero', min: true, descripcion_ai: 'Número de pasajeros de la reserva. Si la pantalla no lo dice, devuelve null: no supongas 1.' },
    MONEDA,
    PRECIO_TOTAL,
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
    { slug: 'hotel', label: 'Hotel', tipo: 'texto', min: true, descripcion_ai: 'Nombre del hotel tal como aparece.' },
    { slug: 'ciudad', label: 'Ciudad', tipo: 'texto', min: true, descripcion_ai: 'Ciudad o zona del hotel según la pantalla. Si no aparece, devuelve null: NO la deduzcas del destino del viaje.' },
    { slug: 'tipo_habitacion', label: 'Habitación', tipo: 'texto', min: true, descripcion_ai: 'Tipo de habitación seleccionada (doble estándar, suite, vista al mar...).' },
    { slug: 'regimen', label: 'Régimen', tipo: 'texto', min: false, descripcion_ai: 'Régimen de alimentación: solo alojamiento, desayuno, media pensión, todo incluido.' },
    { slug: 'check_in', label: 'Check-in', tipo: 'fecha', min: true, descripcion_ai: 'Fecha de entrada en formato AAAA-MM-DD.' },
    { slug: 'check_out', label: 'Check-out', tipo: 'fecha', min: true, descripcion_ai: 'Fecha de salida en formato AAAA-MM-DD.' },
    { slug: 'noches', label: 'Noches', tipo: 'numero', min: false, descripcion_ai: 'Número de noches si la pantalla lo dice. Si no, devuelve null: se deriva de las fechas.' },
    { slug: 'ocupacion', label: 'Ocupación', tipo: 'texto', min: false, descripcion_ai: 'Ocupación de la habitación tal como aparece (ej. 2 adultos + 1 menor).' },
    { slug: 'politica_cancelacion', label: 'Cancelación', tipo: 'texto', min: false, alerta_revision: true, descripcion_ai: 'Política de cancelación en una línea: no reembolsable, gratis hasta tal fecha...' },
    {
      slug: 'impuestos_incluidos',
      label: 'Impuestos incluidos',
      tipo: 'boolean',
      min: true,
      alerta_revision: true,
      descripcion_ai:
        'true si el precio mostrado YA incluye impuestos y tasas; false si la pantalla dice que se pagan aparte ' +
        '(resort fee, city tax, IVA no incluido). Si no lo dice, devuelve null: no supongas que están incluidos.',
    },
    MONEDA,
    PRECIO_TOTAL,
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
    { slug: 'fecha', label: 'Fecha', tipo: 'fecha', min: false, descripcion_ai: 'Fecha de la actividad en formato AAAA-MM-DD.' },
    { slug: 'duracion', label: 'Duración', tipo: 'texto', min: false, descripcion_ai: 'Duración tal como aparece (3 horas, día completo...).' },
    { slug: 'idioma', label: 'Idioma', tipo: 'texto', min: false, descripcion_ai: 'Idioma en que se presta el servicio.' },
    { slug: 'pax', label: 'Personas', tipo: 'numero', min: true, descripcion_ai: 'Número de personas de la reserva. Si no se ve, null: no supongas 1.' },
    MONEDA,
    PRECIO_TOTAL,
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
    { slug: 'fecha_hora', label: 'Fecha', tipo: 'fecha', min: false, descripcion_ai: 'Fecha del servicio en formato AAAA-MM-DD.' },
    { slug: 'pax', label: 'Personas', tipo: 'numero', min: true, descripcion_ai: 'Número de personas. Si no se ve, null: no supongas 1.' },
    MONEDA,
    PRECIO_TOTAL,
    basePrecio(['total', 'por_pax'], 'total = es el precio del trayecto completo; por_pax = es el precio por persona.'),
  ],
}

const RANURAS: Record<string, DefinicionRanura> = {
  [VUELO.slug]: VUELO,
  [HOTEL.slug]: HOTEL,
  [ACTIVIDAD.slug]: ACTIVIDAD,
  [TRASLADO.slug]: TRASLADO,
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

/** Slugs del registro. Expuesto para pruebas y para el PR. */
export function slugsDeRanura(): string[] {
  return Object.keys(RANURAS)
}
