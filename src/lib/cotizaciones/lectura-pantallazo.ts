/**
 * Qué se acepta de un pantallazo y qué se rechaza — y en qué se convierte lo aceptado.
 *
 * Paso 3 del motor de cotización de Trappvel (§3.3 rechazo, §3.4 proceso, §3.5 filas).
 *
 * ## RX1 es la razón de ser de este archivo
 *
 * *«Si la imagen muestra un listado de resultados, un comparador o una grilla de
 * aerolíneas, el modelo RECHAZA y pide la pantalla del itinerario ya elegido. Nunca
 * escoge una fila.»*
 *
 * Una captura del buscador tiene seis tarifas y el sistema no tiene forma de saber
 * cuál quiso quien la pegó. Si elige, elige mal cinco de cada seis veces y el error es
 * **mudo**: sale un precio plausible, con la aerolínea correcta, por el número
 * equivocado. Rechazar cuesta una captura nueva; acertar por azar cuesta el margen del
 * viaje.
 *
 * Por eso el rechazo vive en DOS capas y no en una:
 *
 *  1. En el prompt (`src/lib/ai/extraer-ranura.ts`): el modelo clasifica la imagen
 *     ANTES de extraer nada y tiene una instrucción explícita de negarse ante N
 *     opciones. No es una validación posterior sobre campos ya leídos.
 *  2. Aquí: lo que el modelo devuelve se juzga de forma determinista. Un veredicto
 *     que no sea «detalle único» no crea nada, y los mínimos que falten tampoco.
 *
 * ## Por qué es un módulo puro
 *
 * Lo que decide si un número entra a un costo se prueba sin red y sin base. Metido
 * dentro de la server action, la única forma de ejercitar RX1 sería pagar una llamada
 * a Gemini por caso de prueba.
 */

import type { CampoRanura, DefinicionRanura } from './ranuras-pantallazo'
import { camposMinimos, MINIMOS_DE_COSTO } from './ranuras-pantallazo'

// ── Lo que devuelve el modelo, antes de juzgarlo ─────────────────────────────

/**
 * Cómo clasificó el modelo la imagen. Es lo PRIMERO que responde, antes de extraer.
 *
 * ⚠️ `varias_opciones` no es un error del modelo: es la respuesta correcta ante un
 * listado, y el indicador de que la guía de captura funciona (§8).
 */
export type VeredictoImagen =
  | 'detalle_unico'
  | 'varias_opciones'
  | 'otra_ranura'
  | 'no_es_pantalla_de_precio'

export interface ValorLeido {
  value: string | null
  confidence: number
}

export interface FilaDesglose {
  concepto: string | null
  cantidad: number | null
  unidad: string | null
  valor_unitario: number | null
  moneda: string | null
  confidence: number
}

/**
 * Una fila de la tabla por tipo de pasajero, tal como la leyó el modelo (TP1).
 *
 * ⚠️ `subtotal_tipo` es el valor de TODA la fila. El modelo no divide ni multiplica: el
 * unitario lo calcula el servidor (`tarifa-pasajero.ts`).
 */
export interface FilaTipoPaxCruda {
  tipo: 'adulto' | 'nino' | 'infante'
  cantidad: number
  subtotal_tipo: number
  moneda: string | null
  confidence: number
}

/**
 * Un icono de la fila de equipaje, tal como el modelo dice verlo.
 *
 * ⚠️ `estado` describe el PÍXEL, no la tarifa: `encendido` es «está pintado de un color»
 * y `apagado` es «está en gris, negro, plano o tachado». Que el icono vaya incluido en la
 * tarifa se deriva después (`derivarEquipajeDeLosIconos`, `src/lib/ai/extraer-ranura.ts`).
 *
 * Se conserva crudo en la lectura porque es la EVIDENCIA del equipaje: sin ella, un
 * equipaje mal leído no se puede diagnosticar — hay que adivinar si el modelo describió
 * mal los iconos o si el cruce no llegó a correr. Costó una corrida entera del banco real
 * el 2026-09-17 no tenerlo.
 */
export interface IconoEquipajeCrudo {
  dibujo: string | null
  /** El color concreto que el modelo dice ver: «azul», «gris oscuro», «negro». */
  color: string | null
  /** Cómo lo clasificó el modelo: «encendido» / «apagado», tal como respondió. */
  clasificado: string | null
  /** El veredicto del servidor tras cruzar las dos respuestas. `null` = no se puede leer. */
  estado: 'encendido' | 'apagado' | null
}

export interface LecturaCruda {
  veredicto: VeredictoImagen
  /** Una línea del modelo explicando qué vio. Se usa para el mensaje de rechazo. */
  observacion: string | null
  campos: Record<string, ValorLeido>
  desglose: FilaDesglose[]
  /** La fila de iconos de equipaje que el modelo dice ver, en orden y sin interpretar. */
  iconosEquipaje?: IconoEquipajeCrudo[]
  /** Filas por tipo de pasajero. Vacío cuando la pantalla trae un solo total. */
  porTipoPax?: FilaTipoPaxCruda[]
  /** El total de la tabla por tipo de pasajero («Total General», «Sub-Total»). */
  totalGeneral?: number | null
  /** Cuántas opciones con precio propio contó el modelo en la captura (RX1, regla 7.5). */
  opcionesVisibles?: number | null
}

/**
 * Lo que la lectura puede tomar del ítem cuando la captura no lo muestra (regla 7.4).
 *
 * Trappvel cotiza hoteles desde la TARJETA del listado, y la tarjeta no trae fechas. Sin
 * esto, RX2 rechazaría su forma real de trabajar. Lo tomado va marcado para revisión y
 * NUNCA cuenta como evidencia para comparar dos capturas (CC1).
 */
export interface ContextoLectura {
  fechasViaje?: { inicio: string | null; fin: string | null } | null
  /**
   * La moneda que la persona indicó a mano porque la captura solo muestra «$» (RX3). Se
   * usa SOLO si la captura no la trae, y queda marcada para revisión.
   */
  monedaIndicada?: string | null
  /**
   * Cargue por casillas: RX2 solo por los mínimos de COSTO (`MINIMOS_DE_COSTO`). Los
   * descriptivos que falten se avisan. Ver el comentario de `MINIMOS_DE_COSTO`.
   */
  soloMinimosDeCosto?: boolean
}

/** «--MM-DD»: la pantalla mostró día y mes, sin año. */
const SIN_ANIO = /^--(\d{2})-(\d{2})$/

/**
 * Completa el año de una fecha que la pantalla muestra sin él, con el año del viaje.
 *
 * Medido contra el modelo vivo el 2026-09-16: con la instrucción de devolver null cuando
 * no hay año, el modelo **inventó 2023** en dos pantallazos de Amadeus («Vie, 23 Oct») y
 * en LATAM sí devolvió null — que rechazaba la captura por la fecha de salida. Darle una
 * forma legítima de decir «sin año» y completarlo aquí con el viaje es lo único estable.
 *
 * El año es el del inicio del viaje; si así la fecha queda más de 30 días ANTES del
 * inicio, es del año siguiente (un regreso «02 Ene» de un viaje que sale el 29 de dic).
 */
export function completarAnio(valor: string, inicioViaje: string | null): string | null {
  const m = SIN_ANIO.exec(valor.trim())
  if (!m) return valor
  const inicio = /^(\d{4})-(\d{2})-(\d{2})/.exec(inicioViaje ?? '')
  if (!inicio) return null
  const anio = Number(inicio[1])
  const candidato = Date.UTC(anio, Number(m[1]) - 1, Number(m[2]))
  const base = Date.UTC(anio, Number(inicio[2]) - 1, Number(inicio[3]))
  const final = candidato < base - 30 * 86_400_000 ? anio + 1 : anio
  return `${final}-${m[1]}-${m[2]}`
}

// ── El veredicto del sistema ─────────────────────────────────────────────────

export type CodigoRechazo = 'RX1' | 'RX2' | 'RX3' | 'RX4' | 'RX5' | 'RX6'

export interface Rechazo {
  ok: false
  codigo: CodigoRechazo
  /** Qué pasó, para el registro. */
  motivo: string
  /**
   * Qué hacer, en palabras de quien cotiza. Nunca un código de error: quien lee esto
   * está con el proveedor abierto en otra pestaña y tiene que saber qué capturar.
   */
  instruccion: string
}

/** Un campo ya juzgado: valor limpio, si hay que revisarlo, y con cuánta certeza. */
export interface CampoLeido {
  slug: string
  label: string
  valor: string | null
  confidence: number
  alertaRevision: boolean
  /** El valor no está en la imagen: se tomó del ítem o del viaje (7.4). */
  delItem?: boolean
}

export interface Aceptacion {
  ok: true
  ranura: string
  campos: CampoLeido[]
  desglose: FilaDesglose[]
  /** Avisos que NO bloquean pero que alguien tiene que ver antes de confirmar. */
  avisos: string[]
  porTipoPax: FilaTipoPaxCruda[]
  totalGeneral: number | null
}

export type VeredictoLectura = Aceptacion | Rechazo

/**
 * Umbral de confianza. El mismo de `extract-fields.ts`: por debajo, el valor se
 * descarta en vez de guardarse dudoso.
 *
 * ⚠️ Descartar un mínimo con poca confianza dispara RX2 y rechaza la captura entera.
 * Es deliberado: media lectura de una tarifa es peor que ninguna, porque se ve igual
 * que una completa.
 */
export const CONFIANZA_MINIMA = 0.7

function limpio(v: ValorLeido | undefined): string | null {
  if (!v) return null
  if (v.confidence < CONFIANZA_MINIMA) return null
  const texto = (v.value ?? '').trim()
  return texto === '' ? null : texto
}

/**
 * Juzga una lectura contra el contrato de su ranura (§3.3).
 *
 * El orden importa y no es cosmético: primero **qué imagen es** (RX1/RX4/RX5) y solo
 * después **qué le falta** (RX2/RX3). Al revés, un listado de vuelos completo pasaría
 * la prueba de campos mínimos —los tiene todos, seis veces— y el rechazo llegaría con
 * el mensaje equivocado, o no llegaría.
 */
export function evaluarLectura(
  ranura: DefinicionRanura,
  cruda: LecturaCruda,
  contexto: ContextoLectura = {},
): VeredictoLectura {
  // RX1 en dos capas: si el modelo dice «detalle único» pero contó dos o más opciones con
  // precio, se contradice a sí mismo, y la duda se resuelve rechazando.
  const contradice = cruda.veredicto === 'detalle_unico'
    && typeof cruda.opcionesVisibles === 'number' && cruda.opcionesVisibles >= 2
  if (cruda.veredicto === 'varias_opciones' || contradice) {
    return {
      ok: false,
      codigo: 'RX1',
      motivo: `La captura muestra más de una opción tarifaria. ${cruda.observacion ?? ''}`.trim(),
      instruccion: instruccionRX1(ranura),
    }
  }
  if (cruda.veredicto === 'otra_ranura') {
    return {
      ok: false,
      codigo: 'RX4',
      motivo: `La captura no corresponde a ${ranura.label.toLowerCase()}. ${cruda.observacion ?? ''}`.trim(),
      instruccion: `Esta captura no es de ${ranura.label.toLowerCase()}. ${ranura.queSePide}`,
    }
  }
  if (cruda.veredicto === 'no_es_pantalla_de_precio') {
    return {
      ok: false,
      codigo: 'RX5',
      motivo: `La imagen no es una pantalla de reserva ni de cotización. ${cruda.observacion ?? ''}`.trim(),
      instruccion: 'Sube la pantalla del proveedor donde se ve el precio.',
    }
  }

  const campos: CampoLeido[] = ranura.campos.map(def => ({
    slug: def.slug,
    label: def.label,
    valor: limpio(cruda.campos[def.slug]),
    confidence: cruda.campos[def.slug]?.confidence ?? 0,
    alertaRevision: def.alerta_revision === true,
  }))
  const porSlug = new Map(campos.map(c => [c.slug, c]))
  const avisosDelItem: string[] = []

  // RX3 · la moneda que la persona indicó porque la captura solo muestra «$».
  const moneda = porSlug.get('moneda')
  const indicada = (contexto.monedaIndicada ?? '').trim().toUpperCase()
  if (moneda && moneda.valor === null && /^[A-Z]{3}$/.test(indicada)) {
    moneda.valor = indicada
    moneda.alertaRevision = true
    moneda.delItem = true
    avisosDelItem.push(`La captura no muestra la moneda: se usa ${indicada}, indicada a mano. Confírmala.`)
  }

  // Fechas sin año: se completan con el año del viaje, marcadas.
  const inicioViaje = contexto.fechasViaje?.inicio ?? null
  const completadas: string[] = []
  for (const def of ranura.campos.filter(d => d.tipo === 'fecha')) {
    const campo = porSlug.get(def.slug)
    if (!campo || campo.valor === null || !SIN_ANIO.test(campo.valor)) continue
    const completa = completarAnio(campo.valor, inicioViaje)
    campo.valor = completa
    if (completa !== null) {
      campo.alertaRevision = true
      completadas.push(def.label.toLowerCase())
    }
  }
  if (completadas.length > 0 && inicioViaje) {
    avisosDelItem.push(
      `La captura no muestra el año de ${completadas.join(' y ')}: se completa con el del viaje ` +
      `(${inicioViaje.slice(0, 4)}). Confírmalo.`,
    )
  }

  // 7.4 · la tarjeta de hotel no muestra las fechas: se toman las del viaje, marcadas.
  // Solo si el viaje las tiene LAS DOS: media estadía inventada es peor que el rechazo.
  if (ranura.slug === 'hotel_detalle') {
    const entrada = porSlug.get('check_in')
    const salida = porSlug.get('check_out')
    const inicio = contexto.fechasViaje?.inicio ?? null
    const fin = contexto.fechasViaje?.fin ?? null
    if (entrada && salida && (entrada.valor === null || salida.valor === null) && inicio && fin) {
      for (const [campo, valor] of [[entrada, inicio], [salida, fin]] as const) {
        if (campo.valor !== null) continue
        campo.valor = valor
        campo.alertaRevision = true
        campo.delItem = true
        campo.confidence = 0
      }
      avisosDelItem.push(
        `La captura no muestra las fechas: se toman las del viaje (${entrada.valor} a ${salida.valor}). ` +
        'Confírmalas contra el proveedor.',
      )
    }
  }

  // RX3 antes que RX2 aunque `moneda` sea un mínimo más: es el error más caro del
  // motor y su instrucción es distinta (se puede indicar a mano, no hace falta otra
  // captura). Agruparlo con los demás faltantes lo escondería en una lista.
  if (porSlug.get('moneda')?.valor === null || porSlug.get('moneda')?.valor === undefined) {
    return {
      ok: false,
      codigo: 'RX3',
      motivo: 'La captura no muestra la moneda del precio.',
      instruccion:
        'La captura no muestra en qué moneda está el precio. Sube una que lo diga, o escribe la moneda a mano: ' +
        'un número sin moneda no se puede costear.',
    }
  }

  const tieneTablaPorTipo = (cruda.porTipoPax ?? []).length > 0
  const todosFaltantes = camposMinimos(ranura).filter(def => porSlug.get(def.slug)?.valor == null)
  const faltantes = contexto.soloMinimosDeCosto
    ? todosFaltantes.filter(def =>
        MINIMOS_DE_COSTO.includes(def.slug)
        // Con tabla por tipo de pasajero el total ya es el de la tabla: `base_precio` no
        // multiplica nada y exigirlo rechazaría una captura que ya se puede costear.
        && !(tieneTablaPorTipo && def.slug === 'base_precio'))
    : todosFaltantes
  if (contexto.soloMinimosDeCosto) {
    const descriptivos = todosFaltantes.filter(def => !faltantes.includes(def))
    if (descriptivos.length > 0) {
      avisosDelItem.push(
        `La captura no muestra: ${descriptivos.map(d => d.label.toLowerCase()).join(', ')}. ` +
        'La línea conserva los datos que ya tiene: complétalos si hace falta.',
      )
    }
  }
  if (faltantes.length > 0) {
    return {
      ok: false,
      codigo: 'RX2',
      motivo: `Faltan campos mínimos: ${faltantes.map(f => f.slug).join(', ')}.`,
      instruccion: instruccionRX2(faltantes),
    }
  }

  return {
    ok: true,
    ranura: ranura.slug,
    campos,
    desglose: cruda.desglose,
    avisos: [...avisosDelItem, ...avisosDeLectura(ranura, porSlug, cruda.desglose)],
    porTipoPax: cruda.porTipoPax ?? [],
    totalGeneral: cruda.totalGeneral ?? null,
  }
}

function instruccionRX1(ranura: DefinicionRanura): string {
  if (ranura.slug === 'vuelo_detalle') {
    return 'Selecciona el vuelo y sube la pantalla del itinerario elegido.'
  }
  if (ranura.slug === 'hotel_detalle') {
    return 'Elige la habitación y el régimen, y sube la pantalla de esa tarifa.'
  }
  return `Elige una sola opción y sube su pantalla. ${ranura.queSePide}`
}

function instruccionRX2(faltantes: CampoRanura[]): string {
  const lista = faltantes.map(f => f.label.toLowerCase()).join(', ')
  return faltantes.length === 1
    ? `No se ve ${lista}. Sube una captura que lo incluya.`
    : `No se ven estos datos: ${lista}. Sube una captura que los incluya.`
}

/**
 * Avisos que acompañan a una lectura aceptada. No bloquean: se muestran al lado del
 * dato para que quien confirma los mire.
 *
 * ⚠️ El aviso del desglose que no cuadra es el que más importa. Un desglose inventado
 * por el modelo se ve exactamente igual que uno leído, y su suma es lo único que lo
 * delata sin abrir la imagen.
 */
function avisosDeLectura(
  ranura: DefinicionRanura,
  porSlug: Map<string, CampoLeido>,
  desglose: FilaDesglose[],
): string[] {
  const avisos: string[] = []

  const moneda = porSlug.get('moneda')?.valor
  if (moneda && moneda.toUpperCase() !== 'COP') {
    avisos.push(
      `El precio está en ${moneda.toUpperCase()}. Escribe la tasa de cambio antes de confirmar: ` +
      'el sistema no inventa una.',
    )
  }

  // 7.3 · impuestos que se pagan en destino, en otra moneda: nota al cliente, no costo.
  const impuestosDestino = numero(porSlug.get('impuestos_destino_valor')?.valor)
  const monedaDestino = (porSlug.get('impuestos_destino_moneda')?.valor ?? moneda ?? '').toUpperCase()
  if (ranura.slug === 'hotel_detalle' && impuestosDestino !== null && impuestosDestino > 0) {
    avisos.push(
      `Impuestos y tasas a pagar en destino: ${impuestosDestino.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ` +
      `${monedaDestino}. Los paga el pasajero en el hotel: van al cliente como nota, no al costo.`,
    )
  } else if (ranura.slug === 'hotel_detalle' && porSlug.get('impuestos_incluidos')?.valor === 'false') {
    avisos.push(
      'La captura dice que los impuestos NO están incluidos. El costo que se cargue no los tiene: ' +
      'agrégalos como rubro aparte si van por cuenta del pasajero.',
    )
  } else if (ranura.slug === 'hotel_detalle' && porSlug.get('impuestos_incluidos')?.valor == null) {
    // No es mínimo (la tarjeta del listado no lo dice), pero tampoco se supone.
    avisos.push(
      'La captura no dice si el precio incluye impuestos y tasas. Confírmalo con el proveedor antes de ' +
      'confirmar el costo.',
    )
  }

  const total = numero(porSlug.get('precio_total')?.valor)
  if (desglose.length > 0 && total !== null && !desgloseReconcilia(desglose, total)) {
    avisos.push(
      `El desglose que leyó no suma el total de la captura ` +
      `(${Math.round(sumaDesglose(desglose)).toLocaleString('es-CO')} contra ` +
      `${Math.round(total).toLocaleString('es-CO')}). Se descartó y se usa el total. ` +
      'Si necesitas el detalle, cárgalo a mano.',
    )
  }

  const monedasDesglose = new Set(
    desglose.map(f => (f.moneda ?? '').trim().toUpperCase()).filter(Boolean),
  )
  if (moneda && monedasDesglose.size > 0 && !monedasDesglose.has(moneda.toUpperCase())) {
    avisos.push('El desglose viene en otra moneda que el total. Revisa las dos antes de confirmar.')
  }

  return avisos
}

/** Lo que suma el desglose leído. */
function sumaDesglose(desglose: FilaDesglose[]): number {
  return desglose.reduce((acc, f) => acc + (f.cantidad ?? 1) * (f.valor_unitario ?? 0), 0)
}

/**
 * ¿El desglose cuadra con el total de la captura?
 *
 * ⚠️ **Medido contra el modelo vivo, dos corridas sobre la MISMA imagen.** En una, la
 * fila «Tarifa aérea (2 adultos) COP 1.860.000» volvió como `cantidad 2 ×
 * valor_unitario 930.000` y el desglose sumó exacto. En la otra, como `cantidad 2 ×
 * valor_unitario 1.860.000`: el desglose sumó **4.260.000 contra un total de
 * 2.400.000**, un 78% de más. El modelo es inestable en si el número de una fila es
 * unitario o de línea; el TOTAL, en cambio, salió idéntico y con confianza 1 en las
 * dos corridas.
 *
 * Por eso cuando no cuadran **gana el total** y el desglose se descarta. Proponer un
 * costo 78% mayor con un aviso al lado es apostar a que alguien lea el aviso, y quien
 * confirma está confirmando, no recalculando.
 *
 * 1% de tolerancia: los proveedores redondean y una diferencia de pesos no es señal.
 */
export function desgloseReconcilia(desglose: FilaDesglose[], total: number): boolean {
  return Math.abs(sumaDesglose(desglose) - total) <= Math.max(1, total * 0.01)
}

// ── De la lectura a los rubros (R-P8, R-P6) ──────────────────────────────────

export interface RubroPropuesto {
  /**
   * Concepto tal como se muestra y como se guarda en `rubros.descripcion`.
   *
   * ⚠️ NO es `rubros.tipo`. Este comentario decía que el CHECK de esa columna tenía seis
   * valores y rechazaba `'tarifa'`: desde el 2026-09-14 admite también `tarifa`,
   * `impuestos` y `fee_proveedor` (`TIPOS_RUBRO_VIAJE`, `lib/catalogos/constants.ts`).
   * La tarifa por pasajero ya escribe `tarifa`; este cargue de un solo total sigue en
   * `servicios_prof` y el concepto en la descripción.
   */
  concepto: string
  cantidad: number
  unidad: string
  /** En la moneda de la captura, todavía sin convertir. */
  valorUnitario: number
  moneda: string
}

/**
 * El costo que propone la captura, ya resuelto el `base_precio` (R-P6).
 *
 * *«`base_precio` (total contra por pax, total contra por noche) es lo que convierte
 * un precio correcto en un margen falso.»* Un hotel de 4 noches a USD 180 la noche
 * cargado como total deja el costo en una cuarta parte, y el margen sale del 75%: una
 * cifra que nadie cuestiona porque se ve bien.
 *
 * El multiplicador SIEMPRE existe cuando se llega aquí: `pax` y las fechas del hotel
 * son campos mínimos, así que una lectura que pasó RX2 los tiene. No hay rama de
 * "no se pudo determinar": eso ya se rechazó.
 */
export function rubrosPropuestos(
  ranura: DefinicionRanura,
  campos: CampoLeido[],
  desglose: FilaDesglose[],
): RubroPropuesto[] {
  const porSlug = new Map(campos.map(c => [c.slug, c.valor]))
  const moneda = (porSlug.get('moneda') ?? 'COP').toUpperCase()

  const totalLeido = numero(porSlug.get('precio_total'))

  // Con desglose, manda el desglose: crear además un rubro por el total contaría el
  // mismo dinero dos veces (§3.5). PERO solo si el desglose cuadra con el total — ver
  // `desgloseReconcilia`. Cuando no cuadra se cae al total, que es el número estable.
  if (desglose.length > 0 && (totalLeido === null || desgloseReconcilia(desglose, totalLeido))) {
    return desglose.map(f => ({
      concepto: (f.concepto ?? 'Tarifa').trim() || 'Tarifa',
      cantidad: f.cantidad && f.cantidad > 0 ? f.cantidad : 1,
      unidad: (f.unidad ?? ranura.unidadPorDefecto).trim() || ranura.unidadPorDefecto,
      valorUnitario: f.valor_unitario ?? 0,
      moneda: (f.moneda ?? moneda).toUpperCase(),
    }))
  }

  const total = totalLeido ?? 0
  const base = porSlug.get('base_precio')
  const { cantidad, unidad } = multiplicador(ranura, porSlug, base)

  return [{
    concepto: 'Tarifa',
    cantidad,
    unidad,
    valorUnitario: total,
    moneda,
  }]
}

/**
 * Cuántas unidades multiplica el precio leído, y cómo se llaman.
 *
 * `total` siempre da 1: el número ya es el precio completo. Los demás valores del
 * enum sacan su multiplicador de un campo mínimo de la propia ranura.
 */
function multiplicador(
  ranura: DefinicionRanura,
  porSlug: Map<string, string | null>,
  base: string | null | undefined,
): { cantidad: number; unidad: string } {
  if (base === 'por_pax') {
    return { cantidad: Math.max(1, numero(porSlug.get('pax')) ?? 1), unidad: 'pax' }
  }
  if (base === 'por_noche') {
    return { cantidad: Math.max(1, nochesDeEstadia(porSlug)), unidad: 'noches' }
  }
  return { cantidad: 1, unidad: ranura.unidadPorDefecto }
}

/**
 * Noches de la estadía: las que declara la captura, y si no, las que dicen las fechas.
 *
 * Derivar de las fechas NO contradice R-P4 («nada se infiere fuera de la imagen»): las
 * dos fechas están EN la imagen y son campos mínimos. Restar dos fechas es aritmética,
 * no una suposición sobre el destino del viaje.
 */
export function nochesDeEstadia(porSlug: Map<string, string | null>): number {
  const declaradas = numero(porSlug.get('noches'))
  if (declaradas !== null && declaradas > 0) return Math.round(declaradas)

  const entrada = fecha(porSlug.get('check_in'))
  const salida = fecha(porSlug.get('check_out'))
  if (entrada === null || salida === null) return 1
  const dias = Math.round((salida - entrada) / 86_400_000)
  return dias > 0 ? dias : 1
}

function fecha(valor: string | null | undefined): number | null {
  if (!valor) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim())
  if (!m) return null
  // UTC a propósito: la resta solo mide días entre dos fechas de calendario, y usar
  // la zona local haría que un cambio de huso moviera una noche.
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** Un número leído por el modelo (sin separadores de miles), o `null`. */
export function numeroLeido(valor: string | null | undefined): number | null {
  return numero(valor)
}

function numero(valor: string | null | undefined): number | null {
  if (valor === null || valor === undefined || valor.trim() === '') return null
  const n = Number(valor.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * El valor en pesos, dada una tasa de cambio escrita por una persona.
 *
 * ⚠️ El sistema NO tiene fuente de TRM y no la va a inventar (R-P5). Con moneda
 * distinta de COP, la tasa la escribe quien confirma o la confirmación no procede: una
 * tasa adivinada es un costo adivinado, y de ahí sale un margen adivinado.
 */
export function montoEnCOP(valor: number, moneda: string, tasa: number | null): number | null {
  if (moneda.toUpperCase() === 'COP') return Math.round(valor)
  if (tasa === null || !Number.isFinite(tasa) || tasa <= 0) return null
  return Math.round(valor * tasa)
}

// ── De la lectura al ítem (nombre y descripción) ─────────────────────────────

/**
 * Cómo queda descrita la línea después de una captura aceptada.
 *
 * Los campos leídos no tienen hoy columna propia en `items` —no existe
 * `items.aerolinea`— así que lo que vale para el cliente se escribe en el nombre y la
 * descripción, que son las dos que el PDF ya imprime. Lo que se pierde es el dato
 * ESTRUCTURADO que pedirá el puntaje de experiencia (§2.6.1): eso necesita migración y
 * está fuera de este paso.
 *
 * ⚠️ Un campo que no se leyó NO aparece (R-P2). «Vuelo AVIANCA · escalas: » se lee
 * como un dato en cero, y cero escalas es una afirmación: el vuelo es directo.
 */
export function resumenDeLinea(
  ranura: DefinicionRanura,
  campos: CampoLeido[],
): { nombre: string; descripcion: string } {
  const v = (slug: string) => campos.find(c => c.slug === slug)?.valor ?? null
  const partes: (string | null)[] = []

  if (ranura.slug === 'vuelo_detalle') {
    const ruta = [v('origen'), v('destino')].filter(Boolean).join('–')
    const nombre = [v('aerolinea'), ruta].filter(Boolean).join(' ') || ranura.label
    partes.push(
      etiqueta('Salida', v('fecha_salida')),
      etiqueta('Regreso', v('fecha_regreso')),
      etiqueta('Vuelo', v('numero_vuelo')),
      etiqueta('Tarifa', v('familia_tarifa')),
      escalasTexto(v('escalas'), v('escala_ida'), v('escala_regreso')),
      equipajeTexto(v('equipaje_bodega'), v('equipaje_mano'), v('equipaje_personal')),
    )
    return { nombre, descripcion: unir(partes) }
  }

  if (ranura.slug === 'hotel_detalle') {
    const nombre = [v('hotel'), v('ciudad')].filter(Boolean).join(' · ') || ranura.label
    partes.push(
      etiqueta('Habitación', v('tipo_habitacion')),
      etiqueta('Régimen', v('regimen')),
      rangoFechas(v('check_in'), v('check_out')),
      etiqueta('Ocupación', v('ocupacion')),
      etiqueta('Cancelación', v('politica_cancelacion')),
    )
    return { nombre, descripcion: unir(partes) }
  }

  if (ranura.slug === 'actividad_detalle') {
    const nombre = v('nombre') || ranura.label
    partes.push(
      etiqueta('Ciudad', v('ciudad')),
      etiqueta('Fecha', v('fecha')),
      etiqueta('Duración', v('duracion')),
      etiqueta('Idioma', v('idioma')),
      etiqueta('Proveedor', v('proveedor')),
    )
    return { nombre, descripcion: unir(partes) }
  }

  const nombre = v('trayecto') || ranura.label
  partes.push(
    etiqueta('Vehículo', v('tipo_vehiculo')),
    etiqueta('Fecha', v('fecha_hora')),
    etiqueta('Proveedor', v('proveedor')),
  )
  return { nombre, descripcion: unir(partes) }
}

function etiqueta(nombre: string, valor: string | null): string | null {
  return valor ? `${nombre}: ${valor}` : null
}

/**
 * La escala, dicha con la ciudad cuando la captura la muestra.
 *
 * *«El cliente quiere saber si hace escala en Bogotá o en Panamá»* (Alejandra,
 * 2026-09-16). El conteo sin el dónde no le sirve a nadie, pero sigue siendo lo único
 * que muestran algunas pantallas: sin ciudades leídas, esto imprime exactamente lo que
 * imprimía antes.
 *
 * ⚠️ El REGRESO no se afirma nunca por omisión. Un itinerario cuyo recorrido de vuelta
 * no se ve en la captura sale sin línea de regreso, no como «regreso directo»: eso
 * último es una afirmación sobre algo que nadie leyó (R-P2).
 */
export function escalasTexto(
  valor: string | null,
  escalaIda: string | null = null,
  escalaRegreso: string | null = null,
): string | null {
  const ida = (escalaIda ?? '').trim() || null
  const regreso = (escalaRegreso ?? '').trim() || null

  if (ida === null && regreso === null) {
    if (valor === null) return null
    const n = numero(valor)
    if (n === null) return null
    return n === 0 ? 'Directo' : n === 1 ? '1 escala' : `${n} escalas`
  }

  // Ida y regreso por la misma ciudad es el caso normal de un viaje con conexión, y
  // decirlo dos veces alarga la línea sin agregar nada.
  if (ida !== null && regreso !== null && sinTildes(ida) === sinTildes(regreso)) {
    return `Escala en ${ida} (ida y regreso)`
  }

  const partes: string[] = []
  if (ida !== null) partes.push(`Escala ida: ${ida}`)
  else if (numero(valor) === 0) partes.push('Ida directa')
  if (regreso !== null) partes.push(`Escala regreso: ${regreso}`)
  return partes.length > 0 ? partes.join(' · ') : null
}

function sinTildes(t: string): string {
  return t.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * El equipaje, dicho sin contradecirse.
 *
 * ⚠️ Los dos campos se redactan por SEPARADO. Concatenarlos bajo un «Incluye» imprimía
 * *«Incluye sin equipaje de bodega y equipaje de mano»* en la línea que ve el cliente
 * — salió del primer render contra el modelo vivo, no de una prueba.
 */
/**
 * El equipaje, dicho sin contradecirse y con el artículo personal aparte.
 *
 * ⚠️ Los campos se redactan por SEPARADO. Concatenarlos bajo un «Incluye» imprimía
 * *«Incluye sin equipaje de bodega y equipaje de mano»* en la línea que ve el cliente
 * — salió del primer render contra el modelo vivo, no de una prueba.
 *
 * ⚠️ El artículo personal existe como tercer campo desde el 2026-09-17: en una tarifa
 * Basic de Avianca es lo ÚNICO que va resaltado, y decir «sin equipaje de mano» a secas
 * se lee como que el pasajero viaja con las manos vacías. `solo artículo personal` solo
 * se afirma cuando la captura dijo que los otros dos NO van: con uno de ellos en `null`
 * la frase sería una afirmación sobre lo que nadie leyó.
 *
 * ⚠️ Y la exclusión se dice con todas las letras. «Solo artículo personal» a secas deja
 * que el cliente complete el resto: lo que compró es el morral, y lo que NO compró es la
 * maleta de cabina y la de bodega. Esa es la línea que evita la discusión en el mostrador.
 */
function equipajeTexto(
  bodega: string | null,
  mano: string | null,
  personal: string | null,
): string | null {
  if (personal === 'true' && mano === 'false' && bodega === 'false') {
    return 'Solo artículo personal (sin equipaje de mano ni de bodega)'
  }

  const trozos: string[] = []
  if (bodega === 'true') trozos.push('Con equipaje de bodega')
  if (bodega === 'false') trozos.push('Sin equipaje de bodega')
  if (mano === 'true') trozos.push('con equipaje de mano')
  if (mano === 'false') trozos.push('sin equipaje de mano')
  if (personal === 'true' && mano !== 'true') trozos.push('con artículo personal')
  return trozos.length > 0 ? trozos.join(', ') : null
}

function rangoFechas(entrada: string | null, salida: string | null): string | null {
  if (!entrada && !salida) return null
  if (entrada && salida) return `${entrada} a ${salida}`
  return entrada ?? salida
}

function unir(partes: (string | null)[]): string {
  return partes.filter(Boolean).join(' · ')
}
