/**
 * Reglas del módulo Ferretería (piloto Marketplace, alianza Dimpro x MeTRIK).
 *
 * Puro: lo usan el servidor (server actions y el endpoint del cron) y la pantalla, para que
 * el aviso que ve quien edita y el rechazo del servidor salgan de la misma cuenta.
 *
 * Spec: `docs/specs/2026-09-24_modulo-ferreteria-dimpro.md`, §3 y §4.
 */

/** Precio de venta neto de IVA, pasarela (3%), garantías (2%), GMF (0,4%) e ICA (1% sin IVA). */
export const FACTOR_PRECIO = 0.777933
/** Costo Uyusa sin su IVA, que es descontable (costo / 1,19). */
export const FACTOR_COSTO = 0.840336
/** Regla de precio del piloto: bajo 1,25 x costo F se exige motivo escrito. */
export const MULTIPLO_REGLA = 1.25

export const ESTADOS_PUBLICACION = [
  'borrador',
  'en_revision',
  'activa',
  'pausada',
  'agotada',
  'vendida',
  'rechazada',
  'eliminada',
] as const
export type EstadoPublicacion = (typeof ESTADOS_PUBLICACION)[number]

export const ETIQUETA_ESTADO: Record<EstadoPublicacion, string> = {
  borrador: 'Borrador',
  en_revision: 'En revisión de Meta',
  activa: 'Activa',
  pausada: 'Pausada',
  agotada: 'Agotada',
  vendida: 'Vendida',
  rechazada: 'Rechazada',
  eliminada: 'Eliminada',
}

export const LINEAS = ['impulso', 'ticket_alto', 'precio_agresivo'] as const
export type Linea = (typeof LINEAS)[number]
export const ETIQUETA_LINEA: Record<Linea, string> = {
  impulso: 'Impulso',
  ticket_alto: 'Ticket alto',
  precio_agresivo: 'Precio agresivo',
}

export const CANALES = ['marketplace', 'tienda', 'whatsapp'] as const
export type Canal = (typeof CANALES)[number]

export const CANALES_CONVERSACION = ['messenger', 'whatsapp'] as const
export type CanalConversacion = (typeof CANALES_CONVERSACION)[number]

export const RESULTADOS_CONVERSACION = ['pregunto', 'cotizo', 'vendio', 'perdida'] as const
export type ResultadoConversacion = (typeof RESULTADOS_CONVERSACION)[number]

export const RUTAS_VENTA = ['recoge', 'despacho'] as const
export type RutaVenta = (typeof RUTAS_VENTA)[number]

export function esEstado(v: unknown): v is EstadoPublicacion {
  return typeof v === 'string' && (ESTADOS_PUBLICACION as readonly string[]).includes(v)
}
export function esLinea(v: unknown): v is Linea {
  return typeof v === 'string' && (LINEAS as readonly string[]).includes(v)
}

/** Redondeo a peso, sin sesgo de coma flotante (0,5 sube). */
function aPeso(n: number): number {
  return Math.round(n + Number.EPSILON)
}

/** Ganancia por venta = precio x 0,777933 - costo x 0,840336, redondeada a peso. */
export function gananciaPorVenta(precio: number, costoF: number): number {
  return aPeso(precio * FACTOR_PRECIO - costoF * FACTOR_COSTO)
}

/**
 * Margen por venta = ganancia por venta / precio (fracción: 0,106 = 10,6 %). Parte de la misma
 * ganancia que muestra la pantalla, así que margen y ganancia nunca se contradicen.
 * `null` si falta el precio (o no es positivo) o falta la ganancia (sin costo vigente).
 */
export function margenPorVenta(ganancia: number | null | undefined, precio: number | null | undefined): number | null {
  if (ganancia == null || !Number.isFinite(ganancia)) return null
  if (precio == null || !Number.isFinite(precio) || precio <= 0) return null
  return ganancia / precio
}

/** Margen en porcentaje con un decimal fijo, estilo colombiano: 0,1062 → «10,6 %». `null` → «—». */
export function formatoMargen(margen: number | null): string {
  if (margen == null) return '—'
  const texto = (margen * 100).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  // -0,04 % redondea a «-0,0»: se pinta «0,0 %» para no sugerir una pérdida que no se ve.
  return `${texto === '-0,0' ? '0,0' : texto} %`
}

/** Precio al que la ganancia es cero (redondeado hacia arriba a peso). */
export function precioPiso(costoF: number): number {
  return Math.ceil((costoF * FACTOR_COSTO) / FACTOR_PRECIO - 1e-9)
}

/** 1,25 x costo F, redondeado hacia arriba a peso. */
export function precioRegla(costoF: number): number {
  return Math.ceil(costoF * MULTIPLO_REGLA - 1e-9)
}

export interface CostoLista {
  fecha_lista: string
  costo_f: number
  costo_d: number | null
}

/** El costo vigente es el de la lista más reciente. `null` si el producto no tiene costos. */
export function costoVigente<T extends CostoLista>(costos: readonly T[]): T | null {
  let mejor: T | null = null
  for (const c of costos) if (!mejor || c.fecha_lista > mejor.fecha_lista) mejor = c
  return mejor
}

/** El costo vigente EN una fecha: la lista más reciente publicada ese día o antes. */
export function costoEnFecha<T extends CostoLista>(costos: readonly T[], fecha: string): T | null {
  return costoVigente(costos.filter((c) => c.fecha_lista <= fecha))
}

export type VeredictoPiso =
  | { ok: true; ganancia: number; bajoRegla: boolean; piso: number; regla: number }
  | { ok: false; codigo: 'sin_costo' | 'ganancia_negativa' | 'falta_motivo' | 'precio_invalido'; mensaje: string; ganancia?: number; piso?: number; regla?: number }

/**
 * Valida un precio contra el costo vigente (§4.4):
 *   - sin costo vigente no hay cómo medir el piso, y se rechaza;
 *   - ganancia negativa se rechaza siempre;
 *   - bajo 1,25 x costo F exige un motivo escrito, que queda en la bitácora.
 */
export function validarPiso(precio: number, costoF: number | null, motivo?: string | null): VeredictoPiso {
  if (!Number.isFinite(precio) || precio <= 0) {
    return { ok: false, codigo: 'precio_invalido', mensaje: 'El precio tiene que ser un número mayor que cero.' }
  }
  if (costoF == null || !Number.isFinite(costoF) || costoF <= 0) {
    return {
      ok: false,
      codigo: 'sin_costo',
      mensaje: 'El producto no tiene costo vigente: sin costo no se puede validar el piso del precio.',
    }
  }
  const ganancia = gananciaPorVenta(precio, costoF)
  const piso = precioPiso(costoF)
  const regla = precioRegla(costoF)
  if (ganancia < 0) {
    return {
      ok: false,
      codigo: 'ganancia_negativa',
      mensaje: `Con este precio la venta pierde ${formatoPesos(-ganancia)}. El precio mínimo sin pérdida es ${formatoPesos(piso)}.`,
      ganancia,
      piso,
      regla,
    }
  }
  const bajoRegla = precio < costoF * MULTIPLO_REGLA
  if (bajoRegla && !(motivo && motivo.trim().length > 0)) {
    return {
      ok: false,
      codigo: 'falta_motivo',
      mensaje: `El precio queda bajo la regla del piloto (1,25 x costo = ${formatoPesos(regla)}). Escribe el motivo; queda en la bitácora.`,
      ganancia,
      piso,
      regla,
    }
  }
  return { ok: true, ganancia, bajoRegla, piso, regla }
}

export function formatoPesos(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

export type SemaforoPendiente = 'rojo' | 'ambar' | null

/** Horas tras las que un pendiente sin confirmar cuenta como dos corridas perdidas. */
export const HORAS_PENDIENTE_ROJO = 48

/**
 * Un cambio pendiente en el canal se pinta en ámbar; en rojo si el cron ya falló dos veces al
 * aplicarlo, o si lleva más de 48 horas (dos corridas diarias) sin que nadie lo confirme.
 */
export function semaforoPendiente(
  pub: { pendiente_en_canal: boolean; pendiente_desde: string | null; intentos_fallidos: number },
  ahora: Date,
): SemaforoPendiente {
  if (!pub.pendiente_en_canal) return null
  if (pub.intentos_fallidos >= 2) return 'rojo'
  if (pub.pendiente_desde) {
    const horas = (ahora.getTime() - new Date(pub.pendiente_desde).getTime()) / 3_600_000
    if (horas > HORAS_PENDIENTE_ROJO) return 'rojo'
  }
  return 'ambar'
}

/** Quién cambia precio, estado o texto desde ONE (decidido el 24-sep: Dietmar y MeTRIK). */
export const ROLES_EDITORES = ['owner', 'admin', 'supervisor'] as const

export function puedeEditarFerreteria(role: string | null | undefined): boolean {
  return !!role && (ROLES_EDITORES as readonly string[]).includes(role)
}
