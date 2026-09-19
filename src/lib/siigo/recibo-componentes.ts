/**
 * El recibo de caja se parte por CONCEPTO: uno por el honorario, otro por la plata que
 * se recauda para un tercero.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * Decisión de Mauricio (2026-09-17). Un pago del cliente producía UN recibo por el
 * total, y ese total entraba entero a la cuenta contable del tipo de comprobante
 * configurado. Pero un pago mixto cubre dos cosas distintas: el honorario, que es
 * ingreso, y la tarifa UPME, que es plata de terceros que SOENA recauda y gira.
 * Medido en producción el 2026-09-19 sobre los 425 cobros vivos de SOENA: **63 mixtos**
 * (317 solo honorario, 45 solo tarifa).
 *
 * **Es el tipo de comprobante lo que decide a qué cuenta entra la plata.** La API de
 * Siigo NO acepta la cuenta contable en el payload: el recibo `Detailed`, el único que
 * traía `items[].account.code`, fue retirado de la API (reconfirmado contra la cuenta
 * real de SOENA el 2026-09-19). Por eso los dos recibos salen con el mismo
 * `type: 'AdvancePayment'` de hoy y lo único que cambia entre ellos es `document.id` y
 * la observación.
 *
 * ⚠️ **Qué comprobante lleva cada componente es CONFIGURACIÓN, no conocimiento del
 * código.** El número lo declara la línea y lo decide Mauricio; aquí no se asume qué
 * significa ninguno.
 *
 * ── El reparto no se inventa: se consume ───────────────────────────────────
 *
 * `imputarPago` (`lib/upme/imputacion-pago.ts`) y la vista `v_cobro_valor` son la ÚNICA
 * regla de reparto del sistema desde el 2026-08-18: honorario primero, después la
 * tarifa. Este módulo la lee y no la modifica. El componente `honorario` es
 * `a_tramo1 + a_tramo2 + excedente` y el `pasante` es `a_tarifa`, que son las dos bolsas
 * que `ImputacionPago` ya expone con esos mismos nombres.
 *
 * ── Regla de compatibilidad, y qué protege ─────────────────────────────────
 *
 * **Una línea que no declara `recibo_por_concepto` se comporta exactamente como hoy:**
 * un recibo por el total, con `reciboDocumentId` y `recibo_concepto`, y la marca guardada
 * como OBJETO. No es cortesía: `mis_cobros_de_servicio` (el módulo Valida API, otro
 * workspace) lee la marca con `siigo_recibo ->> 'numero'`, que sobre una lista devuelve
 * NULL sin dar error. Lo que no se configura no cambia de forma.
 *
 * Módulo PURO: sin DB, sin red. Lo importan el servidor (para emitir) y el navegador
 * (para pintar la tarjeta del cobro), así que un solo criterio responde las tres
 * preguntas —¿tiene recibo?, ¿qué número muestro?, ¿qué PDF abro?— en vez de repetirse
 * en cada consumidor. Es el patrón de `esPorcionPendienteDeConfirmar` del PR #738.
 */

/** Las dos bolsas en que se parte un pago. Lista CERRADA y en orden de imputación. */
export const COMPONENTES_RECIBO = ['honorario', 'pasante'] as const
export type ComponenteRecibo = (typeof COMPONENTES_RECIBO)[number]

export function esComponenteRecibo(v: unknown): v is ComponenteRecibo {
  return typeof v === 'string' && (COMPONENTES_RECIBO as readonly string[]).includes(v)
}

/**
 * Sufijo de la clave de idempotencia de cada componente.
 *
 * ⚠️ **Estos valores NO se cambian nunca.** `claveIdempotencia` es determinista desde el
 * cobro: si el sufijo cambia entre despliegues, un reintento deja de reconocer el recibo
 * que ya existe en Siigo y emite otro, consumiendo numeración en la contabilidad del
 * cliente. Eso no se deshace.
 *
 * Son neutros a propósito (`rcpas`, no `rcupme`): el componente `pasante` es "plata de
 * un tercero", y quién sea ese tercero es asunto de la línea, no de la clave.
 */
export const SUFIJO_IDEMPOTENCIA: Readonly<Record<ComponenteRecibo, string>> = Object.freeze({
  honorario: 'rchon',
  pasante: 'rcpas',
})

/** Lo que la línea declara para un componente. Todo opcional: se valida al emitir. */
export interface ConfigComponenteRecibo {
  /** Tipo de comprobante de Siigo. Es lo que decide a qué cuenta entra la plata. */
  document_id?: number
  /** Observación del documento. Sin ella no se emite: un documento contable no sale con un texto inventado. */
  concepto?: string
  /** Bloque donde se archiva el PDF. Sin él, el del recibo de la línea. */
  bloque_slug?: string
}

/** `lineas_negocio.config_extra.siigo.recibo_por_concepto`. */
export type ConfigReciboPorConcepto = Partial<Record<ComponenteRecibo, ConfigComponenteRecibo>>

/**
 * Lee `recibo_por_concepto` de la config `siigo` de la línea.
 *
 * Devuelve `null` cuando la línea no lo declara, y ese null es el interruptor de toda la
 * regla de compatibilidad: sin él, el camino de hoy.
 */
export function leerReciboPorConcepto(cfgSiigo: unknown): ConfigReciboPorConcepto | null {
  if (!cfgSiigo || typeof cfgSiigo !== 'object') return null
  const raw = (cfgSiigo as Record<string, unknown>).recibo_por_concepto
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const out: ConfigReciboPorConcepto = {}
  for (const comp of COMPONENTES_RECIBO) {
    const c = (raw as Record<string, unknown>)[comp]
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue
    const obj = c as Record<string, unknown>
    const documentId = Number(obj.document_id)
    out[comp] = {
      document_id: Number.isFinite(documentId) && documentId > 0 ? documentId : undefined,
      concepto: typeof obj.concepto === 'string' ? obj.concepto.trim() || undefined : undefined,
      bloque_slug: typeof obj.bloque_slug === 'string' ? obj.bloque_slug.trim() || undefined : undefined,
    }
  }
  // Declarado pero vacío no es "declarado": se comporta como si no estuviera.
  return Object.keys(out).length > 0 ? out : null
}

// ─────────────────────────────────────────────────────────────────────────────
// El reparto de un cobro en sus dos bolsas
// ─────────────────────────────────────────────────────────────────────────────

/** Las columnas de `v_cobro_valor` que hacen falta. Los demás nombres no se tocan. */
export interface FilaReparto {
  a_tramo1?: number | string | null
  a_tramo2?: number | string | null
  a_tarifa?: number | string | null
  excedente?: number | string | null
}

export type RepartoCobro = Readonly<Record<ComponenteRecibo, number>>

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * Las dos bolsas de un cobro, a partir de su fila de `v_cobro_valor`.
 *
 * `null` significa **no se sabe**, y quien llama tiene que parar en vez de adivinar: un
 * cobro emitido entero como honorario cuando la mitad era de terceros es exactamente el
 * error que este frente cierra.
 *
 * La única excepción es `tipo_cobro = 'pasante'`, que `v_cobro_valor` excluye a
 * propósito (no entra en la imputación del negocio) y cuya plata es toda de terceros por
 * definición. Medido el 2026-09-19: **cero** cobros así en toda la base, pero la regla
 * queda escrita para el día que haya uno.
 */
export function repartoDeCobro(
  fila: FilaReparto | null | undefined,
  cobro: { monto: number; tipo_cobro?: string | null },
): RepartoCobro | null {
  if (!fila) {
    if ((cobro.tipo_cobro ?? '').trim().toLowerCase() === 'pasante') {
      return { honorario: 0, pasante: num(cobro.monto) }
    }
    return null
  }
  return {
    honorario: num(fila.a_tramo1) + num(fila.a_tramo2) + num(fila.excedente),
    pasante: num(fila.a_tarifa),
  }
}

/**
 * Un recibo que sí va a salir, con todo lo que hace falta para emitirlo.
 *
 * `componente` y `documentId` son OPCIONALES porque el camino de siempre —una línea sin
 * `recibo_por_concepto`— emite un recibo por el total: sin componente que declarar y
 * con el comprobante único de la configuración del workspace.
 */
export interface ComponenteAEmitir {
  componente?: ComponenteRecibo
  valor: number
  documentId?: number
  concepto: string
  bloqueSlug?: string
  sufijoIdempotencia: string
}

export type PlanDeEmision =
  | { ok: true; componentes: ComponenteAEmitir[] }
  | { ok: false; faltantes: string[] }

/**
 * Qué recibos hay que emitir para un cobro, con la configuración de su línea.
 *
 * **Regla única, sin caso especial: un recibo por cada componente cuyo valor sea mayor a
 * cero.** No hay una rama "si es mixto haz otra cosa" — es la misma regla sobre dos
 * bolsas, y en el 85% de los cobros una de las dos viene en cero. El piso de `sin_valor`
 * se aplica POR COMPONENTE: uno en cero no produce recibo y tampoco produce error.
 */
export function planDeEmision(
  reparto: RepartoCobro,
  config: ConfigReciboPorConcepto,
  bloqueSlugPorDefecto?: string,
): PlanDeEmision {
  const componentes: ComponenteAEmitir[] = []
  const faltantes: string[] = []

  for (const comp of COMPONENTES_RECIBO) {
    const valor = redondear(reparto[comp])
    if (!(valor > 0)) continue

    const cfg = config[comp]
    if (!cfg?.document_id) faltantes.push(`tipo de comprobante de "${comp}" (config de la línea)`)
    if (!cfg?.concepto) faltantes.push(`concepto de "${comp}" (config de la línea)`)
    if (!cfg?.document_id || !cfg.concepto) continue

    componentes.push({
      componente: comp,
      valor,
      documentId: cfg.document_id,
      concepto: cfg.concepto,
      bloqueSlug: cfg.bloque_slug ?? bloqueSlugPorDefecto,
      sufijoIdempotencia: SUFIJO_IDEMPOTENCIA[comp],
    })
  }

  if (faltantes.length > 0) return { ok: false, faltantes }
  return { ok: true, componentes }
}

/**
 * Centavos, no fracciones largas.
 *
 * ⚠️ No es un redondeo de compensación y no debe volverse uno. Los dos tramos salen de
 * `v_cobro_valor`, que parte el monto sin dejar residuo (comprobado el 2026-09-19 sobre
 * las 425 filas de SOENA: `honorario + pasante = monto` en las 425, y ningún cobro de la
 * base tiene centavos). Esto solo evita que un `0.30000000000000004` viaje a Siigo.
 */
function redondear(n: number): number {
  return Math.round(num(n) * 100) / 100
}

// ─────────────────────────────────────────────────────────────────────────────
// La marca: `cobros.siigo_recibo`
// ─────────────────────────────────────────────────────────────────────────────

/** Lo que queda escrito en el cobro cuando el recibo se emite. */
export interface MarcaRecibo {
  numero: string
  siigo_id: string
  valor: number
  archivo_url: string | null
  /**
   * Id del PDF en Drive.
   *
   * Desde el 2026-09-16 el archivo NACE CERRADO (ya no se abre a cualquiera con el
   * enlace), así que `archivo_url` sirve de referencia pero no para abrirlo: lo abre
   * `/api/archivos/cobro`, que baja los bytes con la cuenta de servicio y necesita el id.
   * Las marcas anteriores no lo traen y su id se saca del enlace (`idDeArchivoDrive`).
   */
  drive_file_id?: string | null
  at: string
  por: string | null
  /** Fecha del DOCUMENTO en Siigo. Puede no ser la del pago: ver `fecha_motivo`. */
  fecha?: string
  /** Cuándo entró la plata. Es la que el cliente reconoce. */
  fecha_pago?: string
  /**
   * Por qué el documento no lleva la fecha del pago.
   *
   * Se guarda en vez de confiar en que alguien recuerde: cuando alguien pregunte por
   * qué un recibo tiene dos fechas, la respuesta está en el dato (Mauricio, 2026-09-07).
   */
  fecha_motivo?: string | null
  /**
   * Qué concepto acusa este recibo.
   *
   * ⚠️ **Ausente en las 17 marcas anteriores al 2026-09-19** (16 en `soena`, 1 en
   * `metrik`), y en todas las que emite una línea sin `recibo_por_concepto`. Ausente
   * significa "acusa el total", no "es honorario".
   */
  componente?: ComponenteRecibo
  /** Recibo cargado a mano (`cargarReciboManual`). No lo escribe la emisión. */
  origen?: string
  sha256?: string
  storage_bucket?: string
  storage_path?: string
}

/**
 * Las marcas de un cobro, SIEMPRE como lista.
 *
 * Tolera la forma vieja (objeto suelto) porque hay 17 marcas ya escritas con ella y
 * porque toda línea sin `recibo_por_concepto` la sigue escribiendo. Es el único sitio
 * del sistema que conoce las dos formas.
 */
export function recibosDelCobro(guardada: unknown): MarcaRecibo[] {
  if (!guardada) return []
  const lista = Array.isArray(guardada) ? guardada : [guardada]
  return lista.filter(
    (m): m is MarcaRecibo =>
      !!m && typeof m === 'object' && typeof (m as MarcaRecibo).numero === 'string' && (m as MarcaRecibo).numero !== '',
  )
}

/** ¿Este cobro tiene al menos un recibo emitido? */
export function tieneRecibo(guardada: unknown): boolean {
  return recibosDelCobro(guardada).length > 0
}

/** El primer recibo del cobro, que es el que se muestra donde solo cabe uno. */
export function primerRecibo(guardada: unknown): MarcaRecibo | null {
  return recibosDelCobro(guardada)[0] ?? null
}

/**
 * ¿Alguna marca acusa el TOTAL en vez de un componente?
 *
 * Una marca sin `componente` no dice qué concepto respalda, así que no se puede saber
 * qué le falta al cobro. Se toma como cubierto entero, y esa asimetría es deliberada:
 * los 3 mixtos que ya tienen recibo por el total se quedan como están. Volver a emitir
 * consume numeración en la contabilidad del cliente y no se deshace; si hay que
 * corregirlos, se corrigen en Siigo, no en ONE.
 */
export function hayReciboPorElTotal(guardada: unknown): boolean {
  return recibosDelCobro(guardada).some(m => !esComponenteRecibo(m.componente))
}

/** Los componentes que ya tienen su recibo. */
export function componentesEmitidos(guardada: unknown): Set<ComponenteRecibo> {
  const out = new Set<ComponenteRecibo>()
  for (const m of recibosDelCobro(guardada)) {
    if (esComponenteRecibo(m.componente)) out.add(m.componente)
  }
  return out
}

/**
 * Qué componentes quedan por emitir.
 *
 * `esperados` vacío significa que la línea no declara componentes: basta un recibo
 * cualquiera, que es el criterio de hoy.
 */
export function componentesPendientes(
  guardada: unknown,
  esperados: readonly ComponenteRecibo[],
): ComponenteRecibo[] {
  if (hayReciboPorElTotal(guardada)) return []
  if (esperados.length === 0) return tieneRecibo(guardada) ? [] : []
  const emitidos = componentesEmitidos(guardada)
  return esperados.filter(c => !emitidos.has(c))
}

/**
 * ¿Está acusada toda la plata de este cobro?
 *
 * **El estado deja de ser binario.** Un cobro mixto con el recibo del honorario emitido
 * y el de la tarifa no está PENDIENTE, no resuelto: si se viera resuelto, el panel
 * volvería a esconder trabajo, que es justo lo que el PR #581 corrigió.
 */
export function reciboCompleto(guardada: unknown, esperados: readonly ComponenteRecibo[]): boolean {
  if (!tieneRecibo(guardada)) return false
  if (hayReciboPorElTotal(guardada)) return true
  if (esperados.length === 0) return true
  return componentesPendientes(guardada, esperados).length === 0
}

/** Los componentes con plata en este cobro. Vacío = no hay nada que acusar. */
export function componentesConValor(reparto: RepartoCobro | null): ComponenteRecibo[] {
  if (!reparto) return []
  return COMPONENTES_RECIBO.filter(c => redondear(reparto[c]) > 0)
}
