/**
 * Comisión de canal de un servicio contratado: la regla, en un solo lugar.
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §4.15 (entrega A2
 * declara el dato; el motor que escribe el gasto es B3).
 *
 * ## Qué decidió Mauricio el 2026-09-15
 *
 * - **Licencia de cada CDA:** el CDA paga $150.000 y AFI se queda con **$50.000, monto fijo**.
 * - **Paquete de Valida API:** **20 % sobre cada paquete**.
 * - El motor de cobro **tiene que admitir las dos formas**: monto fijo y porcentaje.
 *
 * Y N3, del mismo día: **el porcentaje sale del negocio o del contrato, no de un valor que
 * fije alguien una vez para todos.** Por eso:
 *
 * - el catálogo de servicios no declara comisión (lo hace cumplir `catalogo/definicion.ts`);
 * - `contactos.comision_porcentaje` —que existe hoy con **10 por defecto**— **no se lee aquí
 *   ni en ninguna parte del motor**. Un valor por defecto es exactamente el «valor global» que
 *   N3 prohíbe, y además pagaría comisiones que nadie pactó;
 * - **no hay comisión implícita**: un contrato sin `comision` no genera ninguna. Ausente
 *   significa que no se pactó, nunca «usá el default».
 *
 * ## Por qué el modo es explícito y no se deduce
 *
 * Deducirlo de qué campo viene lleno (`pct` o `monto_fijo`) convierte un olvido en una
 * comisión de otra naturaleza: un contrato al que se le borró el `pct` pasaría a cobrar por
 * monto. `modo` se escribe, y lo que no calce con él se rechaza al guardar (CHECK en la base)
 * y aquí.
 *
 * Módulo puro. El único que decide cuánta comisión se debe; lo consumen la ficha del contrato,
 * el motor de cobro (B3) y la liquidación.
 */

/** Sobre qué cobros aplica la comisión. */
export const BASES_COMISION = ['cada_cobro', 'primer_cobro'] as const
export type BaseComision = (typeof BASES_COMISION)[number]

export const MODOS_COMISION = ['porcentaje', 'monto_fijo'] as const
export type ModoComision = (typeof MODOS_COMISION)[number]

export interface Comision {
  /** Empresa del canal en el directorio de metrik (AFI, la promotora de 4D SOFT). */
  beneficiario_empresa_id: string
  /** NIT del canal: es el `tercero_nit` del gasto, y el gasto se emite contra él. */
  beneficiario_nit: string
  modo: ModoComision
  /** Solo con `porcentaje`. Entre 0 y 100, exclusivo el 0. */
  pct?: number
  /** Solo con `monto_fijo`. En pesos, por cobro. */
  monto_fijo?: number
  base: BaseComision
  /** Pago único al cerrar el contrato, aparte de la comisión por cobro. Opcional. */
  fee_unico?: number
}

export interface ProblemaComision {
  campo: string
  mensaje: string
}

/**
 * Comprueba la coherencia de una comisión declarada. Devuelve los problemas; vacío es válida.
 *
 * El criterio que gobierna: **un campo ausente nunca autoriza un cobro ni una comisión**. Una
 * comisión a medias no se «completa» con ceros ni con defaults; se rechaza, y quien la
 * configuró la escribe entera.
 */
export function problemasDeComision(c: unknown): ProblemaComision[] {
  const p: ProblemaComision[] = []
  if (c === null || typeof c !== 'object' || Array.isArray(c)) {
    return [{ campo: '(raíz)', mensaje: 'la comisión tiene que ser un objeto' }]
  }
  const o = c as Partial<Comision> & Record<string, unknown>

  if (typeof o.beneficiario_empresa_id !== 'string' || o.beneficiario_empresa_id.trim() === '') {
    p.push({ campo: 'beneficiario_empresa_id', mensaje: 'falta la empresa del canal' })
  }
  if (typeof o.beneficiario_nit !== 'string' || o.beneficiario_nit.trim() === '') {
    p.push({ campo: 'beneficiario_nit', mensaje: 'falta el NIT del canal (va como tercero del gasto)' })
  }
  if (typeof o.modo !== 'string' || !(MODOS_COMISION as readonly string[]).includes(o.modo)) {
    p.push({ campo: 'modo', mensaje: `modo tiene que ser ${MODOS_COMISION.join(' o ')}` })
  }
  if (typeof o.base !== 'string' || !(BASES_COMISION as readonly string[]).includes(o.base)) {
    p.push({ campo: 'base', mensaje: `base tiene que ser ${BASES_COMISION.join(' o ')}` })
  }

  if (o.modo === 'porcentaje') {
    if (typeof o.pct !== 'number' || !Number.isFinite(o.pct) || o.pct <= 0 || o.pct > 100) {
      p.push({ campo: 'pct', mensaje: 'un porcentaje se declara y va entre 0 (exclusivo) y 100' })
    }
    if (o.monto_fijo !== undefined) {
      p.push({ campo: 'monto_fijo', mensaje: 'no aplica con modo `porcentaje`' })
    }
  } else if (o.modo === 'monto_fijo') {
    if (typeof o.monto_fijo !== 'number' || !Number.isFinite(o.monto_fijo) || o.monto_fijo <= 0) {
      p.push({ campo: 'monto_fijo', mensaje: 'un monto fijo se declara y es mayor que cero' })
    }
    if (o.pct !== undefined) p.push({ campo: 'pct', mensaje: 'no aplica con modo `monto_fijo`' })
  }

  if (o.fee_unico !== undefined && (typeof o.fee_unico !== 'number' || !Number.isFinite(o.fee_unico) || o.fee_unico <= 0)) {
    p.push({ campo: 'fee_unico', mensaje: 'si se declara, es un número mayor que cero' })
  }

  return p
}

export interface CobroDeCiclo {
  /** Valor del cobro que se aprobó, en pesos. Es la base del porcentaje. */
  valor: number
  /** Si es el primer cobro aprobado de este contrato. Decide `primer_cobro` y el `fee_unico`. */
  esPrimerCobro: boolean
}

export interface ComisionCalculada {
  /** Comisión por este cobro. 0 significa que no corresponde, y `motivo` dice por qué. */
  valor: number
  /** Pago único, solo en el primer cobro y solo si se declaró. */
  feeUnico: number
  motivo:
    | 'sin_comision_pactada'
    | 'base_primer_cobro_ya_pasado'
    | 'porcentaje'
    | 'monto_fijo'
  /** Cómo se llegó al número, para la descripción del gasto y para la pantalla. */
  detalle: string
}

/**
 * Cuánta comisión genera un cobro aprobado.
 *
 * El redondeo es **al peso más cercano**: el gasto se registra en pesos y un decimal en una
 * cuenta por pagar se vuelve un descuadre de centavos que nadie puede cerrar. Con monto fijo
 * no hay redondeo que hacer.
 *
 * Lanza si la comisión declarada es incoherente: llegar hasta aquí con una comisión inválida
 * significaría escribir un gasto por un número inventado. La validación va antes, al guardar
 * el contrato.
 */
export function calcularComision(comision: Comision | null | undefined, cobro: CobroDeCiclo): ComisionCalculada {
  if (comision === null || comision === undefined) {
    return { valor: 0, feeUnico: 0, motivo: 'sin_comision_pactada', detalle: 'el contrato no pactó comisión' }
  }

  const problemas = problemasDeComision(comision)
  if (problemas.length > 0) {
    throw new Error(
      `comisión incoherente, no se calcula: ${problemas.map((x) => `${x.campo} — ${x.mensaje}`).join('; ')}`,
    )
  }

  const feeUnico = cobro.esPrimerCobro ? (comision.fee_unico ?? 0) : 0

  if (comision.base === 'primer_cobro' && !cobro.esPrimerCobro) {
    return {
      valor: 0,
      feeUnico,
      motivo: 'base_primer_cobro_ya_pasado',
      detalle: 'la comisión pactada es solo sobre el primer cobro, que ya se liquidó',
    }
  }

  if (comision.modo === 'monto_fijo') {
    const valor = comision.monto_fijo as number
    return {
      valor,
      feeUnico,
      motivo: 'monto_fijo',
      detalle: `monto fijo pactado de ${valor} por cobro`,
    }
  }

  const pct = comision.pct as number
  const valor = Math.round((cobro.valor * pct) / 100)
  return {
    valor,
    feeUnico,
    motivo: 'porcentaje',
    detalle: `${pct} % de ${cobro.valor}`,
  }
}

/**
 * `external_ref` del gasto de comisión. Es lo que hace que un evento repetido de la pasarela
 * no cree dos comisiones (§4.15): la misma llave, el mismo gasto.
 */
export function refComisionCiclo(cicloId: string): string {
  return `comision-ciclo-${cicloId}`
}

export function refComisionFeeUnico(servicioContratadoId: string): string {
  return `comision-fee-${servicioContratadoId}`
}

export function refComisionReverso(devolucionId: string): string {
  return `comision-reverso-${devolucionId}`
}
