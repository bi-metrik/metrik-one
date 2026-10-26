import { z } from 'zod'
import { esquemaRed } from '@/lib/errores-cliente/reporte'
import { MAX_NAVS, VERSION_BEACON } from './colector'
import { MAX_BYTES_RUM } from './limites'
import { normalizarRuta } from './ruta'

/**
 * El beacon que manda `components/rum/rum-red.tsx` a `POST /api/rum` (ver `colector.ts`).
 * Solo servidor: trae Zod.
 *
 * Las rutas se vuelven a normalizar aqui aunque el navegador ya lo haga: el endpoint es
 * publico y no se fia de lo que le llega. Lo que no esta en la lista se descarta.
 */

export { MAX_BYTES_RUM }

const ruta = z
  .string()
  .max(400)
  .transform((s) => normalizarRuta(s))

const ms = z.number().min(0).max(600_000)

const esquemaVital = z.object({
  n: z.enum(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']),
  v: z.number().min(0).max(600_000),
  r: z.enum(['good', 'needs-improvement', 'poor']).optional(),
  ruta,
})

const esquemaNav = z.object({
  de: ruta,
  a: ruta,
  ms,
  tipo: z.enum(['tarjeta', 'enlace', 'historial']),
})

const esquemaBeacon = z.object({
  v: z.literal(VERSION_BEACON),
  carga: z.string().regex(/^[A-Za-z0-9-]{1,40}$/),
  ciclo: z.number().int().min(1).max(1000),
  entrada: ruta,
  ruta,
  version: z.string().max(100).optional(),
  red: esquemaRed,
  enLinea: z.boolean().optional(),
  segDesdeCarga: z.number().min(0).max(10_000_000).optional(),
  vitales: z.array(esquemaVital).max(5),
  navs: z.array(esquemaNav).max(MAX_NAVS),
  navsDescartadas: z.number().int().min(0).max(100_000).optional(),
})

export type BeaconRum = z.infer<typeof esquemaBeacon>

export type ResultadoBeacon = { ok: true; beacon: BeaconRum } | { ok: false; status: 400 | 413 }

export function leerBeacon(cuerpo: string, contentLength?: string | null): ResultadoBeacon {
  const declarado = contentLength ? Number(contentLength) : NaN
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_RUM) return { ok: false, status: 413 }
  if (new TextEncoder().encode(cuerpo).length > MAX_BYTES_RUM) return { ok: false, status: 413 }
  let json: unknown
  try {
    json = JSON.parse(cuerpo)
  } catch {
    return { ok: false, status: 400 }
  }
  const r = esquemaBeacon.safeParse(json)
  if (!r.success) return { ok: false, status: 400 }
  if (r.data.vitales.length === 0 && r.data.navs.length === 0) return { ok: false, status: 400 }
  return { ok: true, beacon: r.data }
}

/** Celular o computador, del user-agent. El user-agent completo no va al log. */
export function tipoDeDispositivo(userAgent: string | null): 'movil' | 'escritorio' | undefined {
  if (!userAgent) return undefined
  return /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent) ? 'movil' : 'escritorio'
}
