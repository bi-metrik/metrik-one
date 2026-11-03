/**
 * El ORÁCULO de la batería: lo que una cotización debe dar según las decisiones de Mauricio del
 * 2026-10-29, calculado con aritmética de negocio y SIN las funciones del motor. Si el motor y el
 * oráculo dicen lo mismo, el motor cumple la decisión; si se escribieran con el mismo código, la
 * prueba no probaría nada.
 *
 * D2 · margen general = (lo que paga el cliente − lo que paga la agencia) / lo que paga el cliente,
 *      sobre TODAS las líneas que van al cliente.
 *        Neta: la agencia paga el valor del proveedor.
 *        Pública: la agencia paga el precio público menos su comisión.
 *      Una Pública sin comisión no tiene costo de agencia conocido: el margen no se puede medir y la
 *      cotización no puede salir (D3).
 */

import type { CasoBateria, LineaEsperada, SujetoEsperado } from './casos'

/** Para comparar nombres: sin mayúsculas, sin tildes, sin espacios de más. */
export function clave(nombre: string | null | undefined): string {
  return (nombre ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function lineaEsperada(caso: CasoBateria, nombre: string): LineaEsperada {
  const l = caso.lineas.find(x => clave(x.nombre) === clave(nombre))
  if (!l) throw new Error(`El caso ${caso.clave} no declara la línea «${nombre}»`)
  return l
}

/** Lo que paga la agencia por una línea. `null` = una Pública sin comisión: no se sabe. */
export function costoDeAgencia(l: LineaEsperada): number | null {
  if (l.tarifa === 'neta') return l.costo
  if (l.comision === null || l.comision === undefined) return null
  return l.costo - l.comision
}

export interface MargenEsperado {
  /** Lo que paga el cliente por este sujeto, ya con los descuentos sobre el total. */
  cliente: number
  /** Lo que paga la agencia. `null` si alguna Pública no tiene comisión. */
  agencia: number | null
  /** El margen general (D2), en %. `null` = no se puede medir (D3: no sale). */
  margenPct: number | null
  /** Las Públicas sin comisión de este sujeto. */
  publicasSinComision: string[]
}

export function margenEsperado(caso: CasoBateria, sujeto: SujetoEsperado): MargenEsperado {
  const lineas = sujeto.lineas.map(n => lineaEsperada(caso, n))
  const bruto = lineas.reduce((a, l) => a + l.precio, 0)
  const cliente = Math.round(bruto * (1 - caso.descuentoTotalPct / 100))
  const costos = lineas.map(costoDeAgencia)
  const publicasSinComision = lineas.filter((l, i) => costos[i] === null).map(l => l.nombre)
  const agencia = publicasSinComision.length > 0 ? null : (costos as number[]).reduce((a, c) => a + c, 0)
  return {
    cliente,
    agencia,
    margenPct: agencia === null || cliente <= 0 ? null : ((cliente - agencia) / cliente) * 100,
    publicasSinComision,
  }
}

/** ¿Algún sujeto que va al cliente queda bajo el piso o sin margen medible? Entonces no sale limpio. */
export function algunoBajoElPiso(caso: CasoBateria): boolean {
  return caso.sujetos.some(s => {
    const m = margenEsperado(caso, s).margenPct
    return m === null || m < caso.pisoPct
  })
}

/** ¿El régimen dice SOLO desayuno? («Alojamiento y desayuno» sí; «(FULL) Desayuno, Almuer.» no). */
export function soloDesayuno(regimen: string): boolean {
  const r = clave(regimen)
  return /desayuno/.test(r) && !/(almuer|cena|full|todo incluido|pension|all inclusive)/.test(r)
}
