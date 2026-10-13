/**
 * Cuándo entra a la cola de facturación un negocio y desde qué etapa (F5, Vera C4). Módulo puro:
 * lo usan la cola (`facturacion-actions`), la emisión y la píldora de la cabecera del negocio.
 *
 * Dos reglas conviven, por línea:
 *  · La de siempre (SOENA y las demás): `facturacion.desde_etapa_numero`, con el negocio en una
 *    etapa de número MAYOR («desde 4» = ya salió de la 4).
 *  · La del viaje (`facturacion.por_titular` en la línea): POR EVENTO y no por número de etapa,
 *    porque una empresa suele pagar contra factura y por etapa se armaba un bloqueo circular (no paga
 *    sin factura y no hay factura sin pago):
 *      - Empresa (titular con NIT, tipo 31): entra al registrar «El cliente confirmó».
 *      - Persona natural: entra con el paquete enviado Y el saldo en cero.
 *      - «Facturar ya»: la dirección la fuerza con motivo (aprobación `forzar_factura`).
 *
 * `facturacion.activo === false` saca la línea de la cola del todo (Vera F5-6: con F5 apagado,
 * ningún negocio de viaje entra, tampoco por un `desde_etapa_numero` heredado).
 */

export interface ConfigFacturacionLinea {
  /** `false` solo si la línea lo declara: la cola no la mira. */
  activo: boolean
  /** `desde_etapa_numero` propio de la línea, si lo declara. */
  desde: number | null
  /** Regla del viaje (por evento). */
  porTitular: boolean
}

export function configFacturacionLinea(configLinea: unknown): ConfigFacturacionLinea {
  const f = (configLinea && typeof configLinea === 'object'
    ? (configLinea as { facturacion?: unknown }).facturacion
    : null) as Record<string, unknown> | null | undefined
  const c = f && typeof f === 'object' ? f : {}
  const pt = c.por_titular
  return {
    activo: c.activo !== false,
    desde: typeof c.desde_etapa_numero === 'number' && Number.isFinite(c.desde_etapa_numero) ? c.desde_etapa_numero : null,
    porTitular: !!pt && typeof pt === 'object' && (pt as { activo?: unknown }).activo !== false,
  }
}

/**
 * Desde qué etapa entra cada línea a la cola (regla de siempre). Arregla que el primer valor
 * encontrado mandara para TODAS: cada línea usa el suyo; una línea sin valor propio hereda el
 * primero encontrado, como antes, así que ningún workspace cambia de cola (Max §7, Q5).
 * Una línea apagada o con la regla del viaje no tiene «desde».
 */
export function desdePorLinea(lineas: ReadonlyArray<{ id: string; config_extra?: unknown }>): Map<string, number> {
  const configs = lineas.map(l => ({ id: l.id, c: configFacturacionLinea(l.config_extra) }))
  const primero = configs.find(x => x.c.desde !== null)?.c.desde ?? null
  const out = new Map<string, number>()
  for (const { id, c } of configs) {
    if (!c.activo || c.porTitular) continue
    const d = c.desde ?? primero
    if (d !== null) out.set(id, d)
  }
  return out
}

/** ¿Alguna línea manda casos a la cola? Si no, la cola sale vacía y la pantalla lo dice. */
export function hayReglaDeCola(lineas: ReadonlyArray<{ id: string; config_extra?: unknown }>): boolean {
  if (desdePorLinea(lineas).size > 0) return true
  return lineas.some(l => {
    const c = configFacturacionLinea(l.config_extra)
    return c.activo && c.porTitular
  })
}

// ── La regla del viaje ───────────────────────────────────────────────────────

export type TipoTitularFactura = 'empresa' | 'persona'

/** Empresa = NIT (tipo 31). Sin titular, se trata como persona (la factura sale en la entrega). */
export function tipoDeTitular(titular: { tipo_documento?: unknown } | null | undefined): TipoTitularFactura {
  return titular?.tipo_documento === '31' ? 'empresa' : 'persona'
}

export interface EstadoViajeParaFactura {
  titular: { tipo_documento?: unknown } | null
  /** `metadata.confirmacion_cliente.registrada_at` presente. */
  confirmado: boolean
  /** El paquete de viaje salió (F4). */
  paqueteEnviado: boolean
  /** Precio aprobado − cobrado confirmado. */
  saldo: number
  /** Hay una aprobación `forzar_factura` aprobada. */
  forzada: boolean
}

/** Tolerancia del saldo en cero (la misma idea que `TOLERANCIA_SALDO_COP`: centavos de redondeo). */
export const TOLERANCIA_SALDO_FACTURA = 1

export type MotivoEntrada = 'empresa_confirmada' | 'persona_entregada' | 'forzada'

/** ¿Entra a la cola? Y por qué, para la traza. */
export function entraALaColaViaje(e: EstadoViajeParaFactura): { entra: boolean; motivo: MotivoEntrada | null } {
  if (e.forzada) return { entra: true, motivo: 'forzada' }
  if (tipoDeTitular(e.titular) === 'empresa') {
    return e.confirmado ? { entra: true, motivo: 'empresa_confirmada' } : { entra: false, motivo: null }
  }
  return e.paqueteEnviado && e.saldo <= TOLERANCIA_SALDO_FACTURA
    ? { entra: true, motivo: 'persona_entregada' }
    : { entra: false, motivo: null }
}

export type EstadoPildoraFactura =
  | { estado: 'apagada'; texto: string }
  | { estado: 'espera'; texto: string }
  | { estado: 'en_cola'; texto: string }
  | { estado: 'emitida'; texto: string; numero: string }

/** La píldora del riel de facturación (Noor, Riel B), en palabras. */
export function pildoraFactura(args: {
  activa: boolean
  estado: EstadoViajeParaFactura
  facturaNumero: string | null
}): EstadoPildoraFactura {
  if (args.facturaNumero) return { estado: 'emitida', texto: `Factura emitida ${args.facturaNumero}`, numero: args.facturaNumero }
  if (!args.activa) return { estado: 'apagada', texto: 'Factura: no sale todavía' }
  if (entraALaColaViaje(args.estado).entra) return { estado: 'en_cola', texto: 'Factura: en cola' }
  return tipoDeTitular(args.estado.titular) === 'empresa'
    ? { estado: 'espera', texto: 'Factura: al confirmar (empresa)' }
    : { estado: 'espera', texto: 'Factura: cuando entregues el paquete y el saldo esté en cero' }
}

/** ¿El paquete de viaje salió? Lo escribe F4 en `metadata.paquete_viaje.enviado_at`. */
export function paqueteEnviado(metadata: Record<string, unknown> | null | undefined): boolean {
  const p = (metadata ?? {}).paquete_viaje as { enviado_at?: unknown } | undefined
  return typeof p?.enviado_at === 'string' && p.enviado_at !== ''
}

/** ¿«El cliente confirmó» quedó registrado? */
export function confirmacionRegistrada(metadata: Record<string, unknown> | null | undefined): boolean {
  const c = (metadata ?? {}).confirmacion_cliente as { registrada_at?: unknown } | undefined
  return typeof c?.registrada_at === 'string' && c.registrada_at !== ''
}

/** Mínimo de caracteres del motivo de «Facturar ya». */
export const MIN_MOTIVO_FORZAR = 5
