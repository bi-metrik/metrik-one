/**
 * Paleta del modulo de calidad.
 *
 * Verde Metrica, Negro Carbon, gris y linea salen del manual de marca MeTRIK
 * (identidad-visual-metrik.md). Los tres de severidad (rojo / ambar / verde
 * oscuro) son los del prototipo aprobado: no son colores de marca, son el
 * semaforo, y tienen que leerse como semaforo.
 */
export const C = {
  ink: '#1A1A1A',
  inkMuted: '#6B7280',
  line: '#E5E7EB',
  lineStrong: '#D3D5D8',
  surface: '#FFFFFF',
  surfaceAlt: '#FAF9F7',
  ground: '#F5F4F2',
  brand: '#10B981',
  brandDeep: '#059669',
  crit: '#DC2626',
  critSoft: '#FEE2E2',
  high: '#D97706',
  highSoft: '#FEF3C7',
  ok: '#059669',
  okSoft: '#D1FAE5',
} as const

/** Monoespaciada para cifras: alinea columnas y minutos. */
export const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
