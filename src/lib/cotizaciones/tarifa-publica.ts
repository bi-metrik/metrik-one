/**
 * TARIFA PÚBLICA O NETA (reunión con Trappvel del 2026-10-22, punto 1).
 *
 * La tarifa al público ya trae la comisión de la agencia; a la neta es a la que se le pone un
 * margen de utilidad. Cada línea de costo dice cuál de las dos es:
 *
 *  · **Neta** (por defecto): el precio es lo que cobra el proveedor. Se le pone el margen, como
 *    siempre. Es la de toda línea guardada antes de esto, para que ninguna cotización cambie.
 *  · **Pública**: el precio ya trae la comisión de la agencia (un proveedor de tours con precio
 *    comisionable, un vuelo a precio público). El margen de la línea arranca en 0 y el cliente paga el precio público; si alguien
 *    quiere, lo sube a mano.
 *
 * ## Dónde vive
 *
 * En `items.tarifa_pax.tipoTarifa` (jsonb), sin migración: la línea de viaje ya guarda ahí su
 * lectura, sus precios a mano y su origen. Ausente = Neta. Se guarda también una Neta ELEGIDA por
 * una persona, para que una propuesta posterior del tarifario no la pise.
 *
 * ## El margen mínimo (decisiones D2 y D3 de Mauricio, 2026-10-29)
 *
 * El margen general es el de TODAS las líneas: (lo que paga el cliente − lo que paga la agencia) /
 * lo que paga el cliente. Por una Pública la agencia paga el precio público menos su comisión, que
 * la asesora escribe a mano en % o en pesos (`comisionPct` / `comisionMonto`). Sin comisión, el
 * margen no se puede medir y la cotización no se puede enviar (el PDF sale como borrador). Hasta
 * el 2026-10-29 una Pública quedaba fuera de la medida y una tarifa solo de Públicas quedaba
 * exenta del mínimo: así salía limpia una cotización con dos Netas a costo (COT-2026-0009).
 *
 * Puro: lo usan la cascada (`totales.ts`), la tarjeta y las acciones.
 */

export type TipoTarifa = 'neta' | 'publica'

/**
 * Quién decidió el tipo: una persona en la tarjeta, ONE con lo que dice el tarifario, o ONE con lo
 * que dice el pantallazo (precio público + comisión de la agencia, QA Trappvel M6 del 2026-10-29).
 */
export type OrigenTipoTarifa = 'persona' | 'tarifario' | 'pantallazo'

export interface DecisionTipoTarifa {
  tipo: TipoTarifa
  origen: OrigenTipoTarifa
  por: string | null
  en: string
  /**
   * La comisión que trae la tarifa Pública, si alguien la escribió (reglas de margen del
   * 2026-10-27, `reglas-margen.ts`). Con ella la línea entra al margen global con su comisión; sin
   * ella, sale de la base. Ausente en toda decisión anterior y en toda Neta.
   */
  comisionPct?: number | null
  /**
   * La comisión en PESOS, por toda la línea (D3, 2026-10-29: «en % o en pesos»). Excluye a
   * `comisionPct`: la decisión guarda una de las dos. Ausente en todo lo anterior.
   */
  comisionMonto?: number | null
}

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** La decisión guardada en `tarifa_pax.tipoTarifa`, revisada. `null` = nadie decidió (Neta). */
export function leerTipoTarifa(raw: unknown): DecisionTipoTarifa | null {
  if (!esObj(raw)) return null
  if (raw.tipo !== 'neta' && raw.tipo !== 'publica') return null
  const comision = Number(raw.comisionPct)
  const monto = Number(raw.comisionMonto)
  const conMonto = raw.tipo === 'publica' && raw.comisionMonto !== null && raw.comisionMonto !== undefined && raw.comisionMonto !== ''
    && Number.isFinite(monto) && monto >= 0
  const conComision = !conMonto && raw.tipo === 'publica' && raw.comisionPct !== null && raw.comisionPct !== undefined
    && Number.isFinite(comision) && comision >= 0 && comision < 100
  return {
    tipo: raw.tipo,
    origen: raw.origen === 'tarifario' || raw.origen === 'pantallazo' ? raw.origen : 'persona',
    por: typeof raw.por === 'string' ? raw.por.slice(0, 200) : null,
    en: typeof raw.en === 'string' ? raw.en : '',
    // Sin comisión la llave no aparece: la decisión se lee igual que antes.
    ...(conComision ? { comisionPct: comision } : {}),
    ...(conMonto ? { comisionMonto: Math.round(monto) } : {}),
  }
}

/** El tipo de una línea, leído del jsonb crudo de `items.tarifa_pax`. Sin decisión, Neta. */
export function tipoTarifaDeLinea(tarifaPax: unknown): TipoTarifa {
  if (!esObj(tarifaPax)) return 'neta'
  return leerTipoTarifa(tarifaPax.tipoTarifa)?.tipo ?? 'neta'
}

/** ¿La línea es de tarifa pública? Lo pregunta la cascada en cada línea: barato y sin lanzar. */
export function esTarifaPublica(tarifaPax: unknown): boolean {
  return tipoTarifaDeLinea(tarifaPax) === 'publica'
}

/**
 * Lo que propone el tarifario del proveedor según su canal (`oferta-tarifas.ts`): un precio al
 * público o comisionable → Pública; uno neto → Neta. Si el tarifario no lo dice, `null` (queda
 * Neta, como siempre).
 */
export function tipoPropuestoPorCanal(canal: string | null | undefined): TipoTarifa | null {
  if (canal === 'publica' || canal === 'comisionable') return 'publica'
  if (canal === 'neta') return 'neta'
  return null
}

/**
 * ¿Hay que escribir la propuesta del tarifario sobre la línea? Nunca encima de lo que eligió una
 * persona. Devuelve la decisión nueva, `'quitar'` (la propuesta anterior ya no aplica) o `null`
 * (nada que cambiar).
 */
export function propuestaDelTarifario(
  actual: DecisionTipoTarifa | null,
  canal: string | null | undefined,
  en: string,
): DecisionTipoTarifa | 'quitar' | null {
  // Lo que propuso el pantallazo tampoco lo pisa el tarifario: es la lectura de ESTA tarifa.
  if (actual?.origen === 'persona' || actual?.origen === 'pantallazo') return null
  const tipo = tipoPropuestoPorCanal(canal)
  if (tipo === null || tipo === 'neta') return actual ? 'quitar' : null
  if (actual?.tipo === tipo) return null
  return { tipo, origen: 'tarifario', por: null, en }
}

/**
 * El margen con que queda la línea al cambiar de tipo. `margenDelProveedor` es el que trae la
 * lectura cuando el proveedor mostró precio al cliente Y costo de la agencia (ya en la convención
 * de la cotización): ese manda en los dos tipos, porque el costo guardado ya es el neto.
 *
 *  · Pública sin margen del proveedor → 0: el cliente paga el precio público.
 *  · Neta sin margen del proveedor → `null`: hereda el de la cotización, como siempre.
 */
export function margenAlElegirTipo(tipo: TipoTarifa, margenDelProveedor: number | null): number | null {
  if (margenDelProveedor !== null && Number.isFinite(margenDelProveedor)) return margenDelProveedor
  return tipo === 'publica' ? 0 : null
}

// ── La comisión de una Pública (D3 de Mauricio, 2026-10-29) ──────────────────

/** La comisión como la escribe la asesora: en % del precio público o en pesos por toda la línea. */
export interface ComisionEscrita {
  tipo: 'pct' | 'monto'
  valor: number
}

/**
 * El margen REAL de una opción Pública (brief del 2026-10-29, falla 1): lo que queda de su precio
 * después de pagar lo que la agencia paga por ella, el costo menos la comisión. Con el precio igual
 * al público es comisión / precio público: $300.000 sobre $2.000.000 da 15 %, y 20 % da 20 %. La
 * comisión en % va sobre el precio público (`comisionEnPesos`); en pesos, nunca más que él.
 * `null` sin comisión escrita o sin precio: no hay con qué medirlo (D3).
 */
export function margenDeOpcionPublica(a: {
  comision: ComisionEscrita | null
  precioPublico: number
  costo: number
  precio: number
}): number | null {
  const c = a.comision
  if (!c || !Number.isFinite(c.valor) || c.valor < 0) return null
  if (!(a.precio > 0)) return null
  const base = Math.max(0, Number(a.precioPublico) || 0)
  const pesos = c.tipo === 'monto' ? Math.min(base, c.valor) : c.valor < 100 ? (c.valor / 100) * base : null
  if (pesos === null) return null
  return ((a.precio - (a.costo - pesos)) / a.precio) * 100
}

/** La comisión guardada en la decisión, como se escribe. `null` = nadie la escribió. */
export function comisionEscrita(d: DecisionTipoTarifa | null | undefined): ComisionEscrita | null {
  if (!d || d.tipo !== 'publica') return null
  if (d.comisionMonto !== null && d.comisionMonto !== undefined) return { tipo: 'monto', valor: d.comisionMonto }
  if (d.comisionPct !== null && d.comisionPct !== undefined) return { tipo: 'pct', valor: d.comisionPct }
  return null
}

/** ¿Se puede guardar esta comisión? `null` = sí. */
export function motivoComisionInvalida(c: ComisionEscrita): string | null {
  if (c.tipo !== 'pct' && c.tipo !== 'monto') return 'La comisión es en % o en pesos.'
  if (!Number.isFinite(c.valor) || c.valor < 0) return 'Escribe la comisión: un número desde 0.'
  if (c.tipo === 'pct' && c.valor >= 100) return 'La comisión en % va de 0 a 99,9.'
  if (c.tipo === 'monto' && c.valor > 100_000_000_000) return 'Escribe la comisión en pesos, sin puntos ni símbolo.'
  return null
}

/**
 * La decisión de Pública con esta comisión (o sin ninguna, con `null`). Guarda UNA de las dos llaves:
 * `comisionPct` o `comisionMonto`.
 */
export function conComision(d: DecisionTipoTarifa, c: ComisionEscrita | null): DecisionTipoTarifa {
  const { comisionPct: _p, comisionMonto: _m, ...resto } = d
  void _p
  void _m
  if (!c) return resto
  return c.tipo === 'pct'
    ? { ...resto, comisionPct: Math.round(c.valor * 100) / 100 }
    : { ...resto, comisionMonto: Math.round(c.valor) }
}

/** Cómo se dice el tipo en la tarjeta. */
export const ETIQUETA_TIPO_TARIFA: Record<TipoTarifa, string> = {
  neta: 'Neta',
  publica: 'Pública',
}

/** La explicación corta de cada tipo, para el `title` y el aviso de la tarjeta. */
export const AYUDA_TIPO_TARIFA: Record<TipoTarifa, string> = {
  neta: 'Neta: es el precio del proveedor. Se le suma tu margen.',
  publica: 'Pública: el precio ya trae tu comisión. El cliente paga ese precio; escribe tu comisión para que entre al margen de la cotización.',
}

// ── La Pública que trae el pantallazo (QA Trappvel M6 y M7, 2026-10-29) ─────

/** Lo que la confirmación anotó de los dos precios de la captura (`margen-proveedor.ts`). */
export interface DosPreciosDelPantallazo {
  precioCliente: number
  costoAgencia: number
  margenPct: number
}

/**
 * Cuántas veces el precio público cabe en el costo guardado de la línea.
 *
 * Cuando el pantallazo trae el precio al público Y lo que paga la agencia (o la comisión), el costo
 * de la línea se guarda NETO (`montoDeCosto`, hallazgo 7.1) y su margen propio es la comisión: el
 * precio sale igual al público. Para una Pública eso quiere decir que su precio público NO es su
 * costo sino `costo × precioCliente / costoAgencia`. Sin los dos precios, 1: el costo ES el precio
 * público, como en toda Pública de siempre (las cifras no cambian).
 */
export function factorPublicoDelPantallazo(dos: DosPreciosDelPantallazo | null | undefined): number {
  if (!dos) return 1
  const p = Number(dos.precioCliente)
  const c = Number(dos.costoAgencia)
  if (!Number.isFinite(p) || !Number.isFinite(c) || c <= 0 || p <= c) return 1
  return p / c
}

/** Los dos precios anotados en `tarifa_pax.confirmada.margenProveedor`, leídos del jsonb crudo. */
export function dosPreciosDeTarifa(tarifaPax: unknown): DosPreciosDelPantallazo | null {
  if (!esObj(tarifaPax) || !esObj(tarifaPax.confirmada)) return null
  const m = tarifaPax.confirmada.margenProveedor
  if (!esObj(m)) return null
  const precioCliente = Number(m.precioCliente)
  const costoAgencia = Number(m.costoAgencia)
  const margenPct = Number(m.margenPct)
  if (![precioCliente, costoAgencia, margenPct].every(Number.isFinite)) return null
  return { precioCliente, costoAgencia, margenPct }
}

/** La comisión que dice el pantallazo, en % del precio público (la casilla de la tarjeta). */
export function comisionDelPantallazo(dos: DosPreciosDelPantallazo): ComisionEscrita | null {
  const pct = Math.round(dos.margenPct * 100) / 100
  return Number.isFinite(pct) && pct > 0 && pct < 100 ? { tipo: 'pct', valor: pct } : null
}

/**
 * M6 (QA Trappvel, viaje 04): el pantallazo dice el precio al público y la comisión de la agencia
 * («Tarifa Pública, comisión agencia 12 % incluida»). Eso ES una tarifa Pública: ONE la propone así,
 * con la comisión leída, en vez de dejarla Neta. El precio y el margen no cambian (el costo sigue
 * siendo el neto y el margen la comisión); cambia cómo se dice y que la comisión ya viene escrita.
 *
 * Devuelve la decisión nueva, `'quitar'` (la propuesta del pantallazo ya no aplica) o `null` (nada
 * que cambiar). Nunca pisa lo que eligió una persona ni lo que propuso el tarifario.
 */
export function propuestaDelPantallazo(
  actual: DecisionTipoTarifa | null,
  dos: DosPreciosDelPantallazo | null,
  traeComision: boolean,
  en: string,
): DecisionTipoTarifa | 'quitar' | null {
  if (actual && actual.origen !== 'pantallazo') return null
  const comision = dos && traeComision ? comisionDelPantallazo(dos) : null
  if (!comision) return actual ? 'quitar' : null
  const nueva = conComision({ tipo: 'publica', origen: 'pantallazo', por: null, en }, comision)
  if (actual && actual.tipo === 'publica' && actual.comisionPct === nueva.comisionPct && actual.comisionMonto === undefined) return null
  return nueva
}

/**
 * M7 (QA Trappvel, viaje 04): en una Pública, «Ajustar» deja escribir un precio distinto del
 * público. Decisión de Mauricio del 2026-10-29: ante un valor fuera de lo pactado, una confirmación
 * «¿Estás seguro? …» con la cifra, sin bloquear ni avisar a nadie. `null` = el precio es el público
 * (al peso). Puro: lo usa la tarjeta antes de guardar.
 *
 * @param que «el precio por adulto», «el precio de la opción».
 */
export function confirmacionFueraDeLaPublica(a: { precio: number; publico: number; que: string }): string | null {
  const precio = Math.round(Number(a.precio) || 0)
  const publico = Math.round(Number(a.publico) || 0)
  if (!(publico > 0) || Math.abs(precio - publico) <= 1) return null
  const diferencia = Math.abs(precio - publico)
  const pesos = (n: number) => '$' + n.toLocaleString('es-CO').replace(/,/g, '.')
  return `¿Estás seguro? Esto está por fuera de la tarifa pública: ${a.que} queda en ${pesos(precio)} y la tarifa pública es ${pesos(publico)} (${pesos(diferencia)} ${precio < publico ? 'menos' : 'más'}).`
}

/**
 * ¿El pantallazo dice la comisión de la agencia? Sí cuando el neto se derivó de ella, o cuando
 * la lectura trae la casilla «Comisión de la agencia» (en plata o en %) aunque también trajera el
 * neto escrito: la captura del viaje 04 decía «Tarifa Pública (comisión agencia 12 % incluida)»,
 * el neto y la comisión. Un neto sin comisión (solo «precio neto») no basta para llamarla Pública.
 */
export function lecturaTraeComision(lectura: {
  costoAgenciaOrigen?: string | null
  campos?: readonly { label: string; valor: string | null }[] | null
} | null | undefined): boolean {
  if (!lectura) return false
  if (lectura.costoAgenciaOrigen === 'derivado_comision') return true
  return (lectura.campos ?? []).some(c => c.label.startsWith('Comisión de la agencia') && !!c.valor && Number(String(c.valor).replace(',', '.')) > 0)
}
