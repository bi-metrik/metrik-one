/**
 * La fecha de los cobros que crea `BloqueDatosMultiPago` (trigger `auto_cobros_multi`) y
 * la que muestra el bloque — sigue a SOE-013.
 *
 * `autoCrearCobrosMulti` fechaba cada cobro con `todayBogotaISO()`, el día en que alguien
 * guardaba el bloque: el mismo defecto que el #312 corrigió para el bloque «Pagos». Como
 * `v_venta_mes_comercial.fecha_venta = min(cobros.fecha)`, un pago de septiembre
 * registrado en octubre corría la venta de mes. Decisión de Mauricio 2026-08-18: **la
 * fecha del cobro es la del pago**.
 *
 * Fuente elegida: ePayco. El campo del bloque ES la referencia ePayco («Referencia
 * ePayco»), y ePayco entrega la fecha de la transacción (`transactionDate`), la misma que
 * usa `registrarPagoEpayco`. Una fecha tecleada a mano sería un tercer dato que puede
 * contradecir a la pasarela, y obligaría a cambiar el formulario y su regla de completitud.
 *
 * Solo se consulta lo que puede ser una referencia de ePayco (numérica pura, como
 * `ref_payco`) y solo en un workspace que cobra por ePayco: la cuenta es GLOBAL (la de
 * SOENA). En cualquier otro caso —referencia no numérica, otro workspace, ePayco caído o
 * lento, fecha ilegible— el cobro se fecha con el día del registro, que es lo único cierto,
 * y la nota del cobro lo dice. Nunca se inventa la fecha en silencio.
 *
 * Puro: las dependencias (módulo, consulta, hoy) entran por parámetro.
 */

import { fechaTransaccionBogota } from './fecha-transaccion'

/** Una consulta a ePayco que no responde en este plazo no frena el guardado. */
export const PLAZO_CONSULTA_EPAYCO_MS = 8_000

/** La referencia como `ref_payco` (entero positivo), o null si no puede serlo. */
export function refPaycoDe(referencia: string | null | undefined): number | null {
  const s = String(referencia ?? '').trim()
  if (!/^\d{1,15}$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export interface DepsFechaCobroMulti {
  /** ¿El workspace cobra por ePayco? Se pregunta solo si hay alguna referencia consultable. */
  puedeConsultar: () => Promise<boolean>
  /** `consultarTransaccionEpayco`: devuelve el crudo de la fecha en `fecha`. */
  consultar: (refPayco: number) => Promise<{ fecha?: string | null }>
  /** Día del registro (Bogotá), el respaldo. */
  hoy: string
  plazoMs?: number
}

export interface FechaCobroMulti {
  fecha: string
  /** true si la fecha es la de ePayco; false si es la del registro. */
  dePago: boolean
}

async function conPlazo<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined
  const vence = new Promise<null>((res) => { t = setTimeout(() => res(null), ms) })
  try {
    return await Promise.race([p, vence])
  } finally {
    if (t) clearTimeout(t)
  }
}

/**
 * La fecha de cada referencia nueva, en el mismo orden. Una referencia repetida se consulta
 * una sola vez. Nunca lanza.
 */
export async function fechasDeCobrosMulti(
  referencias: ReadonlyArray<string>,
  deps: DepsFechaCobroMulti,
): Promise<FechaCobroMulti[]> {
  const respaldo: FechaCobroMulti = { fecha: deps.hoy, dePago: false }
  const consultables = [...new Set(referencias.map(refPaycoDe).filter((n): n is number => n !== null))]
  if (consultables.length === 0) return referencias.map(() => respaldo)

  let puede = false
  try {
    puede = await deps.puedeConsultar()
  } catch {
    puede = false
  }
  if (!puede) return referencias.map(() => respaldo)

  const plazo = deps.plazoMs ?? PLAZO_CONSULTA_EPAYCO_MS
  const porRef = new Map<number, string | null>()
  await Promise.all(
    consultables.map(async (ref) => {
      try {
        const tx = await conPlazo(deps.consultar(ref), plazo)
        porRef.set(ref, fechaTransaccionBogota(tx?.fecha ?? null))
      } catch {
        porRef.set(ref, null)
      }
    }),
  )

  return referencias.map((r) => {
    const ref = refPaycoDe(r)
    const fecha = ref === null ? null : porRef.get(ref) ?? null
    return fecha ? { fecha, dePago: true } : respaldo
  })
}

/** La nota del cobro: si la fecha es la del registro, lo dice (patrón de `registrarPagoEpayco`). */
export function notaCobroMulti(referencia: string, dePago: boolean): string {
  if (dePago) return 'Pago'
  return `Pago — fecha de registro: ePayco no devolvio una fecha legible para la ref ${String(referencia ?? '').trim() || '(vacia)'}`
}

// ── Lo que muestra el bloque ────────────────────────────────────────────────

export interface CobroMultiConFecha {
  external_ref: string | null
  monto: number | null
  fecha: string | null
  tipo_cobro?: string | null
}

/**
 * La fecha de cada fila del bloque, tomada del cobro con la misma referencia y el mismo
 * valor. Empareja por MULTIPLICIDAD, igual que la idempotencia de `autoCrearCobrosMulti`:
 * dos abonos reales con la misma referencia y valor tienen dos cobros, y cada fila toma uno.
 * Una fila sin cobro (aún sin guardar, o con un valor que no se registró) no tiene fecha.
 */
export function fechasDePagosMulti(
  pagos: ReadonlyArray<{ referencia_epayco: string; valor_pago: number | '' }>,
  cobros: ReadonlyArray<CobroMultiConFecha>,
): Array<string | null> {
  const centavos = (v: unknown) => Math.round(Number(v) * 100)
  const libres = cobros.filter((c) => (c.tipo_cobro ?? 'pago') === 'pago' && !!c.fecha)
  const usados = new Set<number>()
  return pagos.map((p) => {
    if (p.valor_pago === '' || !p.referencia_epayco) return null
    const i = libres.findIndex(
      (c, idx) =>
        !usados.has(idx) &&
        (c.external_ref ?? '') === p.referencia_epayco &&
        centavos(c.monto) === centavos(p.valor_pago),
    )
    if (i < 0) return null
    usados.add(i)
    return libres[i].fecha
  })
}
