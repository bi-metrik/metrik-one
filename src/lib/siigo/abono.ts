/**
 * El abono del honorario a la factura: qué se cruza, contra qué y por cuánto.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Decisión de Mauricio (2026-09-22). La factura dejó de esperar a que el honorario esté
 * recaudado: sale en cualquier momento, a crédito (forma de pago 1055). Eso crea una cuenta
 * por cobrar en Siigo, y esa cuenta tiene que cerrarse cuando el cliente paga. Si el pago
 * del honorario se sigue registrando como ANTICIPO suelto (`AdvancePayment`), la factura
 * queda abierta para siempre y el anticipo flotando al lado. Por eso la porción honorario
 * de cada pago pasa a ser un ABONO a la factura (`DebtPayment`), que es lo que Diana ya
 * hacía a mano: 8 abonos en el Siigo de SOENA, medidos el 2026-09-22.
 *
 * ── La forma, verificada contra la API y contra los abonos reales ───────────
 *
 * `POST /v1/vouchers` con `type: 'DebtPayment'` exige `items[].due.{prefix, consecutive,
 * quote}` y `items[].value` (doc: developers.siigo.com/docs/siigoapi/voucher/1-create-voucher).
 *
 * ⚠️ **El `prefix` del vencimiento NO es el campo `prefix` de la factura.** Medido el
 * 2026-09-22 con un GET a FV-2-540: la factura trae `prefix: "SOE"` (el de la resolución
 * DIAN), `number: 540` y `name: "FV-2-540"`, y los abonos que Diana hizo a mano cruzan
 * `due.prefix: "FV-2"` (RC-1-41 contra FV-2-225). El vencimiento se arma del NOMBRE, no
 * del campo que se llama igual. `due.date` es el `due_date` de la cuota de la factura:
 * RC-1-33 cruza FV-1-6 (fechada 2025-03-07) con `due.date: 2025-12-22`, que es el
 * vencimiento de su cuota y no la fecha del documento.
 *
 * Módulo PURO: sin DB, sin red. `recibos.ts` hace el GET de la factura y la escritura.
 */

/** La factura tal como la devuelve `GET /v1/invoices/{id}`. Solo lo que se usa. */
export interface FacturaSiigoLeida {
  id?: string
  name?: string
  number?: number | string
  date?: string
  total?: number
  /** Saldo pendiente de pago. Es lo que pone el tope del abono. */
  balance?: number | string | null
  annulled?: boolean
  customer?: { identification?: string; branch_office?: number | string }
  payments?: Array<{ id?: number; value?: number; due_date?: string }>
}

/** A qué cuota de qué factura se le aplica el abono. */
export interface Vencimiento {
  prefix: string
  consecutive: number
  quote: number
  date?: string
}

/**
 * Por qué ONE NO hace el abono y se lo deja a Tesorería.
 *
 * Lista CERRADA: la pantalla tiene una frase para cada uno, y un motivo nuevo sin su
 * frase se leería como un pendiente sin explicación.
 */
export const MOTIVOS_ABONO_A_MANO = [
  /** El cobro tiene retención: el abono necesita más ítems (impuestos y descuentos). */
  'retencion',
  /** La factura ya no tiene saldo: el honorario de este pago es sobrepago. */
  'factura_saldada',
  'factura_anulada',
  /** La factura tiene más de una cuota: ONE no decide a cuál abonar. */
  'factura_con_cuotas',
  /** La factura está a nombre de otro tercero: el abono no se cruza a ciegas. */
  'factura_de_otro_tercero',
  /** No se pudo leer a qué vencimiento abonar (nombre o número de la factura). */
  'factura_ilegible',
  /** El negocio tiene factura, pero no el vínculo con Siigo (cargada a mano, sin adoptar). */
  'factura_sin_vinculo',
] as const
export type MotivoAbonoAMano = (typeof MOTIVOS_ABONO_A_MANO)[number]

export type DecisionAbono =
  | {
      tipo: 'emitir'
      /** Lo que se abona: nunca más que el saldo de la factura. */
      valor: number
      /** Honorario de este pago que NO cupo en el saldo. Cero en el caso normal. */
      sinAbonar: number
      vencimiento: Vencimiento
      /** Fecha del documento de la factura, para el caso de un pago anterior a ella. */
      fechaFactura: string | null
      /** Tercero al que se le cruza, el de la factura. */
      cliente: { identificacion: string; branchOffice: number | null }
    }
  | { tipo: 'a_mano'; motivo: MotivoAbonoAMano; detalle: string; sinAbonar: number }
  | { tipo: 'error'; mensaje: string }

/** Centavos, no fracciones largas. Siigo exige máximo 2 decimales en `payment.value`. */
export function redondearCentavos(n: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100) / 100
}

const soloDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '')

function fmtCOP(v: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(v)
}

/**
 * La retención del cobro, como número. `null`, vacío o basura cuentan como cero.
 *
 * Con retención el abono no puede ir de un solo ítem: el cliente pagó menos que el
 * honorario porque retuvo el impuesto, y ese faltante se cruza con `items[].taxes` o
 * `items[].discounts` (el ejemplo es el RC-2-7 de SOENA, tipo `Detailed`). ONE no arma
 * eso: se lo deja a Tesorería.
 */
export function retencionDelCobro(retencion: unknown): number {
  const n = Number(retencion ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * El vencimiento que cruza el abono, a partir de la factura leída de Siigo.
 *
 * `null` cuando no se puede armar sin adivinar: un nombre sin consecutivo, o un
 * `number` que contradice al nombre. Mandar un vencimiento inventado le aplicaría el
 * pago a OTRA factura, que es peor que no aplicarlo.
 */
export function vencimientoDeFactura(f: FacturaSiigoLeida): Vencimiento | null {
  const nombre = String(f.name ?? '').trim()
  // El nombre es «tipo + código + número» (doc de `GET /v1/invoices/{id}`): FV-2-540.
  // Se exigen las TRES partes: con solo dos ("FV-2") el consecutivo sería el código del
  // comprobante, y el abono cruzaría la factura número 2.
  const m = /^([A-Za-z]+-\d+)-(\d+)$/.exec(nombre)
  if (!m) return null
  const consecutivo = Number(m[2])
  if (!Number.isSafeInteger(consecutivo)) return null
  if (f.number != null && f.number !== '' && Number(f.number) !== consecutivo) return null
  const cuota = (f.payments ?? [])[0]
  const fecha = typeof cuota?.due_date === 'string' && cuota.due_date ? cuota.due_date : undefined
  return { prefix: m[1], consecutive: consecutivo, quote: 1, ...(fecha ? { date: fecha } : {}) }
}

/**
 * ¿Se abona este honorario a esta factura, y por cuánto?
 *
 * El orden de las preguntas importa: primero lo que impide cruzar a ciegas (anulada, de
 * otro tercero, con cuotas, ilegible), y solo después la plata. Un saldo que no llegó es
 * un ERROR y no un "a mano": sin saber el saldo no hay tope, y reintentar puede resolverlo.
 *
 * ⚠️ **El tope es el saldo de SIIGO, no una resta hecha en ONE.** El saldo de Siigo ya
 * descuenta los abonos que Diana haya cruzado a mano, que ONE no ve. Restar en ONE los
 * abonos que ONE conoce abonaría por encima de lo que la factura todavía debe.
 */
export function decidirAbono(input: {
  /** Porción honorario de ESTE cobro, del reparto de `v_cobro_valor`. */
  honorario: number
  factura: FacturaSiigoLeida
  /** Número de la factura como lo conoce ONE, para los textos. */
  numeroFactura: string
  /** Tercero del negocio en Siigo. */
  identificacionCliente: string
}): DecisionAbono {
  const honorario = redondearCentavos(input.honorario)
  const f = input.factura
  const numero = input.numeroFactura || String(f.name ?? 'la factura')

  if (f.annulled === true) {
    return {
      tipo: 'a_mano', motivo: 'factura_anulada', sinAbonar: honorario,
      detalle: `La factura ${numero} está anulada en Siigo: el honorario de este pago no tiene a qué abonarse.`,
    }
  }

  const delCliente = soloDigitos(input.identificacionCliente)
  const deLaFactura = soloDigitos(f.customer?.identification)
  if (deLaFactura && delCliente && deLaFactura !== delCliente) {
    return {
      tipo: 'a_mano', motivo: 'factura_de_otro_tercero', sinAbonar: honorario,
      detalle: `La factura ${numero} está a nombre de otro tercero (${deLaFactura}): el abono se cruza a mano.`,
    }
  }

  if ((f.payments ?? []).length > 1) {
    return {
      tipo: 'a_mano', motivo: 'factura_con_cuotas', sinAbonar: honorario,
      detalle: `La factura ${numero} tiene ${(f.payments ?? []).length} cuotas: el abono se cruza a mano.`,
    }
  }

  const vencimiento = vencimientoDeFactura(f)
  if (!vencimiento) {
    return {
      tipo: 'a_mano', motivo: 'factura_ilegible', sinAbonar: honorario,
      detalle: `No se pudo leer el consecutivo de la factura ${numero}: el abono se cruza a mano.`,
    }
  }

  const saldoCrudo = f.balance
  const saldo = saldoCrudo == null || saldoCrudo === '' ? NaN : Number(saldoCrudo)
  if (!Number.isFinite(saldo)) {
    return { tipo: 'error', mensaje: `Siigo no devolvió el saldo de la factura ${numero}.` }
  }
  const saldoCentavos = redondearCentavos(saldo)

  if (!(saldoCentavos > 0)) {
    return {
      tipo: 'a_mano', motivo: 'factura_saldada', sinAbonar: honorario,
      detalle: `La factura ${numero} ya no tiene saldo: el honorario de este pago (${fmtCOP(honorario)}) queda sin abonar, es sobrepago.`,
    }
  }

  const valor = Math.min(honorario, saldoCentavos)
  const branch = f.customer?.branch_office
  const branchOffice = branch == null || branch === '' ? null : Number(branch)
  return {
    tipo: 'emitir',
    valor,
    sinAbonar: redondearCentavos(honorario - valor),
    vencimiento,
    fechaFactura: typeof f.date === 'string' && f.date ? f.date : null,
    cliente: {
      identificacion: input.identificacionCliente,
      branchOffice: Number.isFinite(branchOffice) ? branchOffice : null,
    },
  }
}

/**
 * La RAZÓN corta de cada motivo, para la pantalla. Una por motivo: la lista es cerrada.
 * Se lee detrás de «el abono a mano en Siigo:».
 */
export const ETIQUETA_ABONO_A_MANO: Readonly<Record<MotivoAbonoAMano, string>> = Object.freeze({
  retencion: 'el pago trae retención',
  factura_saldada: 'la factura ya no tenía saldo (sobrepago)',
  factura_anulada: 'la factura está anulada',
  factura_con_cuotas: 'la factura tiene varias cuotas',
  factura_de_otro_tercero: 'la factura es de otro tercero',
  factura_ilegible: 'no se pudo leer la factura',
  factura_sin_vinculo: 'la factura no está vinculada a Siigo (adóptala)',
})

/** ¿Es uno de los motivos conocidos? Una marca con un motivo que no está en la lista se nombra genérico. */
export function esMotivoAbonoAMano(v: unknown): v is MotivoAbonoAMano {
  return typeof v === 'string' && (MOTIVOS_ABONO_A_MANO as readonly string[]).includes(v)
}
