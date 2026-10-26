import { z } from 'zod'
import { MAX_BYTES_LOTE_RED, MAX_EVENTOS_LOTE, type EventoRed } from './eventos'

/**
 * Validación del lote de `POST /api/red/eventos`. Un evento mal formado se descarta solo
 * (no tumba el lote): la medición nunca debe perder lo bueno por un campo raro.
 */

const ms = z.number().finite().min(0).max(7 * 24 * 3600 * 1000)
const epoch = z.number().finite().min(1_700_000_000_000).max(4_000_000_000_000)
const id = z.string().regex(/^[A-Za-z0-9-]{1,40}$/)
const texto = (max: number) => z.string().transform((s) => s.slice(0, max))

const sondas = z.object({
  n: z.number().int().min(0).max(10_000),
  perdidas: z.number().int().min(0).max(10_000),
  p50: ms.optional(),
  p95: ms.optional(),
  max: ms.optional(),
})

const pulso = z.object({
  tipo: z.literal('pulso'),
  id,
  t0: epoch,
  t1: epoch,
  visible_ms: ms,
  vercel: sondas,
  control: sondas,
  offline_ms: ms,
  sw: z.boolean(),
  red: z
    .object({ tipo: texto(10).optional(), rtt: z.number().min(0).max(600_000).optional(), bajadaMbps: z.number().min(0).max(100_000).optional() })
    .optional()
    .catch(undefined),
})

const corte = z.object({
  tipo: z.literal('corte'),
  id,
  inicio: epoch,
  dur_ms: ms,
  vercel: z.boolean(),
  control: z.boolean(),
  cierre: z.enum(['volvio', 'oculta']).optional(),
  ruta: texto(200).optional(),
  sw: z.boolean(),
})

const falla = z.object({
  tipo: z.literal('falla'),
  id,
  t: epoch,
  superficie: z.enum(['carga', 'navegacion', 'accion', 'subida', 'descarga', 'lectura']),
  ruta: texto(200).optional(),
  error: texto(300).optional(),
  dur_ms: ms.optional(),
  recuperado: z.boolean().optional(),
  intentos: z.number().int().min(0).max(100).optional(),
  sw: z.boolean().optional(),
})

const evento = z.discriminatedUnion('tipo', [pulso, corte, falla])

export type ResultadoLote = { ok: true; eventos: EventoRed[]; descartados: number } | { ok: false; status: 400 | 413 }

export function leerLoteRed(cuerpo: string): ResultadoLote {
  if (new TextEncoder().encode(cuerpo).length > MAX_BYTES_LOTE_RED) return { ok: false, status: 413 }
  let json: unknown
  try {
    json = JSON.parse(cuerpo)
  } catch {
    return { ok: false, status: 400 }
  }
  const lista = (json as { eventos?: unknown })?.eventos
  if (!Array.isArray(lista)) return { ok: false, status: 400 }
  const eventos: EventoRed[] = []
  let descartados = 0
  for (const e of lista.slice(0, MAX_EVENTOS_LOTE)) {
    const r = evento.safeParse(e)
    if (r.success) eventos.push(r.data as EventoRed)
    else descartados++
  }
  descartados += Math.max(0, lista.length - MAX_EVENTOS_LOTE)
  return { ok: true, eventos, descartados }
}
