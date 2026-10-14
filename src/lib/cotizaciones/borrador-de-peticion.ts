/**
 * El borrador de «Aceptar» tal como llega por la red, ya validado. Lo usa la ruta del lote
 * (`aceptar-lote`, C5); la de una sola captura conserva su propia lectura, que no se toca.
 *
 * No confía en nada: lo que no tiene la forma esperada devuelve `null` y la fila vuelve con su
 * causa. La firma de la lectura la verifica después `aceptarCapturaDeBandeja`.
 */

import type { BorradorParaAceptar } from '@/app/(app)/negocios/tarifa-pax-actions'

const DECISIONES = new Set(['auto', 'opcion', 'habitacion', 'reemplazar', 'nueva', 'hermana', 'completa'])

const texto = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null)

export function borradorDePeticion(raw: unknown): BorradorParaAceptar | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Partial<Record<keyof BorradorParaAceptar, unknown>>
  if (typeof c.tipo !== 'string' || typeof c.lecturaJson !== 'string' || typeof c.firma !== 'string' || !DECISIONES.has(String(c.decision))) return null
  const p = (c.pistas && typeof c.pistas === 'object' ? c.pistas : {}) as Record<string, unknown>
  return {
    tipo: c.tipo as BorradorParaAceptar['tipo'],
    lecturaJson: c.lecturaJson,
    firma: c.firma,
    pistas: { lugar: texto(p.lugar, 120), origen: texto(p.origen, 120), destino: texto(p.destino, 120) },
    decision: c.decision as BorradorParaAceptar['decision'],
    destinoId: typeof c.destinoId === 'string' ? c.destinoId : null,
    imagen: typeof c.imagen === 'string' ? c.imagen : null,
    correcciones: Array.isArray(c.correcciones)
      ? (c.correcciones as unknown[]).filter((x): x is { slug: string; valor: string } =>
        !!x && typeof (x as { slug?: unknown }).slug === 'string' && typeof (x as { valor?: unknown }).valor === 'string')
      : null,
    idAceptacion: typeof c.idAceptacion === 'string' ? c.idAceptacion : null,
  }
}
