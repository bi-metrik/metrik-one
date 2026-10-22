/**
 * TARIFA PÚBLICA O NETA (reunión con Trappvel del 2026-10-22, L1675-1851 de la transcripción).
 *
 * «Tarifa al público, pum, ya sabemos que es comisionable; y tarifa neta es que ya podemos
 * indicarle un margen de utilidad» (Edgar). Cada línea de costo dice cuál de las dos es:
 *
 *  · **Neta** (por defecto): el precio es lo que cobra el proveedor. Se le pone el margen, como
 *    siempre. Es la de toda línea guardada antes de esto, para que ninguna cotización cambie.
 *  · **Pública**: el precio ya trae la comisión de la agencia (Civitatis, un vuelo a precio
 *    público). El margen de la línea arranca en 0 y el cliente paga el precio público; si alguien
 *    quiere, lo sube a mano.
 *
 * ## Dónde vive
 *
 * En `items.tarifa_pax.tipoTarifa` (jsonb), sin migración: la línea de viaje ya guarda ahí su
 * lectura, sus precios a mano y su origen. Ausente = Neta. Se guarda también una Neta ELEGIDA por
 * una persona, para que una propuesta posterior del tarifario no la pise.
 *
 * ## El margen mínimo
 *
 * Una línea Pública NO entra en la medida del margen mínimo: su ganancia es la comisión, que ONE
 * no conoce al cotizar. Medirla al 0 % pediría la autorización de Edgar por algo que nadie puede
 * subir. El mínimo se mide sobre las líneas Netas (`margenMedible`, `itinerarios.ts`); si una
 * tarifa solo tiene Públicas, no hay margen que exigir (`exentaDelMinimo`).
 *
 * Puro: lo usan la cascada (`totales.ts`), la tarjeta y las acciones.
 */

export type TipoTarifa = 'neta' | 'publica'

/** Quién decidió el tipo: una persona en la tarjeta, o ONE con lo que dice el tarifario. */
export type OrigenTipoTarifa = 'persona' | 'tarifario'

export interface DecisionTipoTarifa {
  tipo: TipoTarifa
  origen: OrigenTipoTarifa
  por: string | null
  en: string
}

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** La decisión guardada en `tarifa_pax.tipoTarifa`, revisada. `null` = nadie decidió (Neta). */
export function leerTipoTarifa(raw: unknown): DecisionTipoTarifa | null {
  if (!esObj(raw)) return null
  if (raw.tipo !== 'neta' && raw.tipo !== 'publica') return null
  return {
    tipo: raw.tipo,
    origen: raw.origen === 'tarifario' ? 'tarifario' : 'persona',
    por: typeof raw.por === 'string' ? raw.por.slice(0, 200) : null,
    en: typeof raw.en === 'string' ? raw.en : '',
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
  if (actual?.origen === 'persona') return null
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

/** Cómo se dice el tipo en la tarjeta. */
export const ETIQUETA_TIPO_TARIFA: Record<TipoTarifa, string> = {
  neta: 'Neta',
  publica: 'Pública',
}

/** La explicación corta de cada tipo, para el `title` y el aviso de la tarjeta. */
export const AYUDA_TIPO_TARIFA: Record<TipoTarifa, string> = {
  neta: 'Neta: es el precio del proveedor. Se le suma tu margen.',
  publica: 'Pública: el precio ya trae tu comisión. El cliente paga ese precio y no pide autorización por margen.',
}
