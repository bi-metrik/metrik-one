// ============================================================
// Lo que comparten las tres vistas de plata del negocio.
//
// Movimientos, Resultado y el bloque de Ejecución pintan los mismos pesos con las
// mismas etiquetas. Escritas tres veces se desincronizan, y el síntoma es la misma
// categoría rotulada distinto según en qué bloque la mires.
// ============================================================

import { TIPOS_RUBRO } from '@/lib/catalogos/constants'
import { TIPO_RUBRO_SIN_DETALLE } from '@/lib/negocios/presupuesto-ejecucion'

export const CATEGORIA_LABELS: Record<string, string> = {
  materiales: 'Materiales',
  transporte: 'Transporte',
  servicios_profesionales: 'Servicios profesionales',
  viaticos: 'Viáticos',
  software: 'Software',
  impuestos_seguros: 'Impuestos/Seguros',
  mano_de_obra: 'Mano de obra',
  alimentacion: 'Alimentación',
  comision: 'Comisiones',
  arriendo: 'Arriendo',
  marketing: 'Marketing',
  capacitacion: 'Capacitación',
  otros: 'Otros',
}

// Etiqueta de cada rubro. Sale del catálogo (`TIPOS_RUBRO`), no de una copia a mano:
// una lista paralela se desincroniza y el síntoma es un rubro rotulado con su slug.
export const RUBRO_LABELS: Record<string, string> = {
  ...Object.fromEntries(TIPOS_RUBRO.map(t => [t.value, t.label])),
  [TIPO_RUBRO_SIN_DETALLE]: 'Sin desglosar',
}

export const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

/** Día y mes abreviado, para las filas de detalle. */
export const fmtFecha = (f: string) => {
  const d = new Date(f.length <= 10 ? `${f}T12:00:00` : f)
  return Number.isNaN(d.getTime())
    ? f
    : new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' }).format(d)
}

export const plural = (n: number, singular: string, plural: string) =>
  n === 1 ? `1 ${singular}` : `${n} ${plural}`

export function barColor(pct: number): string {
  if (pct >= 100) return 'bg-red-500'
  if (pct >= 90) return 'bg-amber-500'
  return 'bg-acento'
}

export function barTextColor(pct: number): string {
  if (pct >= 100) return 'text-red-600'
  if (pct >= 90) return 'text-amber-600'
  return 'text-acento'
}
