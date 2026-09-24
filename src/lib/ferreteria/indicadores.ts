/**
 * Indicadores del módulo Ferretería (§4.3 de la spec). Puro: la pantalla le pasa las filas y el
 * día de hoy en Bogotá.
 *
 * Marketplace muestra clics ACUMULADOS por aviso. Los clics de un día son la diferencia contra
 * la medición anterior de ese aviso. La PRIMERA medición de cada aviso es la línea base: lo que
 * trae acumulado no se le atribuye a ese día (el corte del 24-sep traía semanas de clics).
 */

export interface PubIndicador {
  id: string
  codigo: string
  precio: number | null
  linea: string | null
  estado: string
}
export interface MedicionIndicador {
  publicacion_id: string
  fecha: string
  clics_acumulados: number
}
export interface ConversacionIndicador {
  publicacion_id: string
  resultado: string
}
export interface VentaIndicador {
  publicacion_id: string
  ganancia: number
}

export interface MetricaPublicacion {
  clics: number | null
  clics7d: number | null
  conversaciones: number
  ventas: number
  ganancia: number
  ultimoClic: string | null
  diasDesdeUltimoClic: number | null
}

export interface Agrupado {
  clave: string
  publicaciones: number
  clics: number
  conversaciones: number
  ventas: number
  ganancia: number
}

export interface Indicadores {
  clicsPorDia: { fecha: string; clics: number }[]
  porPublicacion: Record<string, MetricaPublicacion>
  totales: { clics: number; conversaciones: number; ventas: number; ganancia: number }
  tasaConversacionPorClic: number | null
  tasaVentaPorConversacion: number | null
  porLinea: Agrupado[]
  porRangoPrecio: Agrupado[]
  sinClics7d: string[]
}

export const RANGOS_PRECIO = [
  { clave: 'Menos de $50.000', hasta: 50_000 },
  { clave: '$50.000 a $150.000', hasta: 150_000 },
  { clave: '$150.000 a $400.000', hasta: 400_000 },
  { clave: '$400.000 o más', hasta: Infinity },
] as const

export function rangoDePrecio(precio: number | null): string {
  if (precio == null) return 'Sin precio'
  return RANGOS_PRECIO.find((r) => precio < r.hasta)!.clave
}

function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((new Date(`${hasta}T12:00:00Z`).getTime() - new Date(`${desde}T12:00:00Z`).getTime()) / 86_400_000)
}

export function calcularIndicadores(
  pubs: PubIndicador[],
  mediciones: MedicionIndicador[],
  conversaciones: ConversacionIndicador[],
  ventas: VentaIndicador[],
  hoy: string,
): Indicadores {
  const porPub = new Map<string, MedicionIndicador[]>()
  for (const m of mediciones) {
    const l = porPub.get(m.publicacion_id) ?? []
    l.push(m)
    porPub.set(m.publicacion_id, l)
  }

  const clicsDia = new Map<string, number>()
  const porPublicacion: Record<string, MetricaPublicacion> = {}
  const limite7 = restarDias(hoy, 7)

  for (const p of pubs) {
    const serie = (porPub.get(p.id) ?? []).slice().sort((a, b) => a.fecha.localeCompare(b.fecha))
    let ultimoClic: string | null = null
    for (let i = 1; i < serie.length; i++) {
      const delta = Math.max(0, serie[i].clics_acumulados - serie[i - 1].clics_acumulados)
      clicsDia.set(serie[i].fecha, (clicsDia.get(serie[i].fecha) ?? 0) + delta)
      if (delta > 0) ultimoClic = serie[i].fecha
    }
    const ultima = serie.at(-1)
    let clics7d: number | null = null
    if (ultima) {
      const base = [...serie].reverse().find((m) => m.fecha <= limite7) ?? serie[0]
      clics7d = Math.max(0, ultima.clics_acumulados - base.clics_acumulados)
    }
    const convs = conversaciones.filter((c) => c.publicacion_id === p.id)
    const vts = ventas.filter((v) => v.publicacion_id === p.id)
    porPublicacion[p.id] = {
      clics: ultima ? ultima.clics_acumulados : null,
      clics7d,
      conversaciones: convs.length,
      ventas: vts.length,
      ganancia: vts.reduce((s, v) => s + Number(v.ganancia), 0),
      ultimoClic,
      diasDesdeUltimoClic: ultimoClic ? diasEntre(ultimoClic, hoy) : null,
    }
  }

  const totales = {
    clics: Object.values(porPublicacion).reduce((s, m) => s + (m.clics ?? 0), 0),
    conversaciones: conversaciones.length,
    ventas: ventas.length,
    ganancia: ventas.reduce((s, v) => s + Number(v.ganancia), 0),
  }

  const agrupar = (clave: (p: PubIndicador) => string): Agrupado[] => {
    const grupos = new Map<string, Agrupado>()
    for (const p of pubs) {
      const k = clave(p)
      const g = grupos.get(k) ?? { clave: k, publicaciones: 0, clics: 0, conversaciones: 0, ventas: 0, ganancia: 0 }
      const m = porPublicacion[p.id]
      g.publicaciones += 1
      g.clics += m.clics ?? 0
      g.conversaciones += m.conversaciones
      g.ventas += m.ventas
      g.ganancia += m.ganancia
      grupos.set(k, g)
    }
    return [...grupos.values()]
  }

  const ordenRango = [...RANGOS_PRECIO.map((r) => r.clave), 'Sin precio'] as string[]

  return {
    clicsPorDia: [...clicsDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, clics]) => ({ fecha, clics })),
    porPublicacion,
    totales,
    tasaConversacionPorClic: totales.clics > 0 ? totales.conversaciones / totales.clics : null,
    tasaVentaPorConversacion: totales.conversaciones > 0 ? totales.ventas / totales.conversaciones : null,
    porLinea: agrupar((p) => p.linea ?? 'sin_linea').sort((a, b) => a.clave.localeCompare(b.clave)),
    porRangoPrecio: agrupar((p) => rangoDePrecio(p.precio)).sort((a, b) => ordenRango.indexOf(a.clave) - ordenRango.indexOf(b.clave)),
    sinClics7d: pubs
      .filter((p) => p.estado === 'activa' && porPublicacion[p.id].clics7d === 0)
      .map((p) => p.codigo)
      .sort(),
  }
}
