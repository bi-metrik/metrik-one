/**
 * ePayco APIFY integration — consulta transacciones con desglose de comisiones.
 *
 * Usa el endpoint APIFY (apify.epayco.co) que devuelve los movimientos reales
 * (comision, IVA, ReteFuente, ReteICA) tal como aparecen en el dashboard.
 *
 * Auth: JWT via login con PUBLIC_KEY + PRIVATE_KEY. Token expira en 20 min.
 */

const APIFY_URL = 'https://apify.epayco.co'

// ── Types ────────────────────────────────────────────────────────────────────

export interface EpaycoMovement {
  description: string
  number: number
  type: string
  /** Valor con signo: positivo = abono, "- 1234" = descuento */
  operation: number | string
  date: string
  amount: string
}

export interface EpaycoTransaction {
  referencePayco: number
  amount: number
  status: string
  response: string
  franchise: string
  bank: string
  numberCard: string
  transactionDate: string
  currency: string
  bill: string
  authorization: string
  firstName: string
  lastName: string
  email: string
  document: string
  movements: EpaycoMovement[]
}

export interface EpaycoDesglose {
  ref_payco: number
  monto_bruto: number
  comision: number
  iva_comision: number
  retefuente: number
  reteica: number
  total_descuentos: number
  monto_neto: number
  franquicia: string
  banco: string
  estado: string
  fecha: string
  factura: string
  pagador_nombre: string
  pagador_documento: string
  pagador_email: string
}

// ── Token cache ──────────────────────────────────────────────────────────────

let cachedToken: string | null = null
let tokenExpiresAt = 0

async function getApifyToken(): Promise<string> {
  // Reuse token if still valid (with 2 min buffer)
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken
  }

  const publicKey = process.env.EPAYCO_PUBLIC_KEY
  const privateKey = process.env.EPAYCO_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    throw new Error('EPAYCO_PUBLIC_KEY o EPAYCO_PRIVATE_KEY no configuradas')
  }

  const credentials = Buffer.from(`${publicKey}:${privateKey}`).toString('base64')
  const res = await fetch(`${APIFY_URL}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${credentials}`,
    },
  })

  if (!res.ok) {
    throw new Error(`ePayco login failed: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  const token = data.token as string
  if (!token) {
    throw new Error('ePayco login: no token in response')
  }

  cachedToken = token
  // JWT expires in 20 min — cache for 18 min to be safe
  tokenExpiresAt = Date.now() + 18 * 60 * 1000

  return token
}

// ── Transaction detail ───────────────────────────────────────────────────────

export async function getTransactionDetail(refPayco: number): Promise<EpaycoTransaction> {
  const token = await getApifyToken()

  const res = await fetch(`${APIFY_URL}/transaction/detail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ filter: { referencePayco: refPayco } }),
  })

  if (!res.ok) {
    throw new Error(`ePayco transaction/detail failed: ${res.status}`)
  }

  const json = await res.json()
  if (!json.success) {
    throw new Error(`ePayco: ${json.textResponse ?? 'Error consultando transaccion'}`)
  }

  return json.data as EpaycoTransaction
}

// ── Parse movements into structured breakdown ────────────────────────────────

function parseOperation(op: number | string): number {
  if (typeof op === 'number') return Math.abs(op)
  // ePayco returns strings like "- 15837" or "- 3009.03"
  const cleaned = String(op).replace(/[^0-9.\-]/g, '')
  return Math.abs(parseFloat(cleaned) || 0)
}

function matchMovement(mov: EpaycoMovement, keywords: string[]): boolean {
  const desc = mov.description.toLowerCase()
  const type = mov.type.toLowerCase()
  return keywords.some(kw => desc.includes(kw) || type.includes(kw))
}

export function parseDesglose(tx: EpaycoTransaction): EpaycoDesglose {
  let montoBruto = 0
  let comision = 0
  let ivaComision = 0
  let retefuente = 0
  let reteica = 0

  for (const mov of tx.movements) {
    if (matchMovement(mov, ['valor total', 'abono transac'])) {
      montoBruto = parseOperation(mov.operation)
    } else if (matchMovement(mov, ['iva costo procesamiento', 'iva costo'])) {
      // IVA must be checked BEFORE comision (both contain "costo procesamiento")
      ivaComision = parseOperation(mov.operation)
    } else if (matchMovement(mov, ['costo procesamiento'])) {
      comision = parseOperation(mov.operation)
    } else if (matchMovement(mov, ['retefuente'])) {
      retefuente = parseOperation(mov.operation)
    } else if (matchMovement(mov, ['reteica'])) {
      reteica = parseOperation(mov.operation)
    }
  }

  // Fallback: if movements didn't have the total, use tx.amount
  if (montoBruto === 0) montoBruto = tx.amount

  const totalDescuentos = comision + ivaComision + retefuente + reteica
  const montoNeto = montoBruto - totalDescuentos

  return {
    ref_payco: tx.referencePayco,
    monto_bruto: montoBruto,
    comision,
    iva_comision: ivaComision,
    retefuente,
    reteica,
    total_descuentos: totalDescuentos,
    monto_neto: Math.round(montoNeto * 100) / 100,
    franquicia: tx.franchise,
    banco: tx.bank,
    estado: tx.status,
    fecha: tx.transactionDate,
    factura: tx.bill,
    pagador_nombre: `${tx.firstName} ${tx.lastName}`.trim(),
    pagador_documento: tx.document,
    pagador_email: tx.email,
  }
}

// ── High-level: query + parse in one call ────────────────────────────────────

export async function consultarTransaccionEpayco(refPayco: number): Promise<EpaycoDesglose> {
  const tx = await getTransactionDetail(refPayco)
  return parseDesglose(tx)
}
