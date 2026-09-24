/**
 * Liquidación mensual de la alianza Dimpro x MeTRIK en Ferretería.
 *
 * Regla de Mauricio (24-sep): al cierre de cada mes se suma la ganancia de TODAS las ventas del
 * mes, pérdidas incluidas, y el total se reparte 50/50 dé lo que dé. Si el mes da pérdida,
 * MeTRIK le paga a Dimpro el 50 % de la pérdida. Cada mes se liquida solo: nada se arrastra al
 * mes siguiente.
 *
 * Por eso la parte de MeTRIK NO es un costo de cada negocio: por venta no existe (una venta con
 * pérdida daría una "comisión" negativa, que rompería los gastos), solo existe por mes.
 *
 * Puro: lo usan la pantalla y las pruebas. El mes sale de `fecha_venta`, que es una fecha de
 * calendario escrita en Colombia (sin hora), así que no hay zona horaria que convertir.
 */

/** Fracción de la ganancia del mes que le corresponde a MeTRIK. Una sola constante. */
export const PARTE_METRIK = 0.5

export interface VentaLiquidable {
  /** `YYYY-MM-DD`, fecha de la venta en Bogotá. */
  fecha_venta: string
  precio_final: number
  costo_dia: number
  /** Con signo: una venta bajo costo trae ganancia negativa. */
  ganancia: number
}

export interface MesLiquidacion {
  /** `YYYY-MM`. */
  mes: string
  /** El mes en curso sigue sumando ventas; los anteriores ya no cambian. */
  estado: 'abierto' | 'cerrado'
  ventas: number
  ingreso: number
  costo: number
  /** Ganancia total de la línea en el mes, con signo. */
  ganancia: number
  parteDimpro: number
  /** Con signo. Positiva: MeTRIK cobra. Negativa: MeTRIK aporta. */
  parteMetrik: number
}

const aCentavos = (n: number) => Math.round(n * 100) / 100

/**
 * Reparte la ganancia de un mes. La parte de MeTRIK se redondea al centavo y la de Dimpro es el
 * resto, para que las dos sumen exactamente el total.
 */
export function repartirGanancia(ganancia: number): { dimpro: number; metrik: number } {
  const metrik = aCentavos(ganancia * PARTE_METRIK)
  const dimpro = aCentavos(ganancia - metrik)
  // -0 se pinta como "-$0": un mes en cero no le debe nada a nadie.
  return { dimpro: dimpro === 0 ? 0 : dimpro, metrik: metrik === 0 ? 0 : metrik }
}

/** Meses con ventas, del más reciente al más viejo. */
export function liquidacionMensual(ventas: VentaLiquidable[], hoyISO: string): MesLiquidacion[] {
  const mesActual = hoyISO.slice(0, 7)
  const porMes = new Map<string, { ventas: number; ingreso: number; costo: number; ganancia: number }>()
  for (const v of ventas) {
    const mes = v.fecha_venta.slice(0, 7)
    const acc = porMes.get(mes) ?? { ventas: 0, ingreso: 0, costo: 0, ganancia: 0 }
    acc.ventas += 1
    acc.ingreso += Number(v.precio_final)
    acc.costo += Number(v.costo_dia)
    acc.ganancia += Number(v.ganancia)
    porMes.set(mes, acc)
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([mes, acc]) => {
      const ganancia = aCentavos(acc.ganancia)
      const { dimpro, metrik } = repartirGanancia(ganancia)
      return {
        mes,
        // Un mes posterior al actual solo existe con una fecha mal escrita; se trata como abierto
        // para que no aparezca como liquidado.
        estado: mes >= mesActual ? 'abierto' : 'cerrado',
        ventas: acc.ventas,
        ingreso: aCentavos(acc.ingreso),
        costo: aCentavos(acc.costo),
        ganancia,
        parteDimpro: dimpro,
        parteMetrik: metrik,
      }
    })
}

/**
 * Cómo se lee la parte de MeTRIK de un mes (decidido por Mauricio el 24-sep): positiva, MeTRIK
 * le cobra a Dimpro; negativa, MeTRIK le aporta a Dimpro el valor absoluto.
 */
export function sentidoLiquidacion(parteMetrik: number): { texto: string; valor: number } {
  if (parteMetrik > 0) return { texto: 'MeTRIK cobra a Dimpro', valor: parteMetrik }
  if (parteMetrik < 0) return { texto: 'MeTRIK aporta a Dimpro', valor: -parteMetrik }
  return { texto: 'Sin saldo entre las partes', valor: 0 }
}

/** Pesos con signo delante del símbolo: `-$12.000`, no `$-12.000`. */
export function formatoPesosConSigno(n: number): string {
  const r = Math.round(n)
  const abs = `$${Math.abs(r).toLocaleString('es-CO')}`
  return r < 0 ? `-${abs}` : abs
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** `2026-09` → `septiembre 2026`. */
export function nombreMes(mes: string): string {
  const [a, m] = mes.split('-')
  const i = Number(m) - 1
  return MESES[i] ? `${MESES[i]} ${a}` : mes
}
