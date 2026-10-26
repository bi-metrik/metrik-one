/**
 * Alertas internas a MéTRIK (2026-10-26): que nos enteremos antes que el cliente.
 *
 * Hasta hoy un cron que fallaba devolvía 500 o guardaba el error en su resumen JSON, y un cargue masivo
 * pausado le avisaba al CLIENTE pero no a MéTRIK: todo quedaba en los logs de Vercel, sin nadie mirando.
 * Esto manda un correo interno por el mismo canal de los avisos de reverso (`enviarCorreoInternoPorResend`,
 * Resend, a `AVISO_INTERNO_PARA`), sin servicios nuevos ni tablas nuevas:
 *
 *   - Cron con fallas: los campos `*_error` con valor (o un error que reventó el cron entero). Un correo por
 *     cron y ventana (hora o día): la `Idempotency-Key` de Resend lo deduplica 24 h, así que el cron de cada
 *     minuto que falla 60 veces manda UN correo por hora.
 *   - Cargue masivo de Valida: pausado más de MINUTOS_PAUSA_AVISO, o activo sin avanzar más de
 *     MINUTOS_ATASCO_AVISO (`updated_at` lo mueven el turno, cada fila y el cierre). Un correo por lote y
 *     por ese estado (la llave lleva el `updated_at`): si el lote vuelve a pausarse, avisa otra vez.
 *     Un lote que sigue quieto después no vuelve a avisar: el correo ya dijo que está quieto.
 *
 * Lo puro (qué avisar y el texto) está separado del envío para probarlo.
 */

import { enviarCorreoInternoPorResend, type EnvioCorreoInterno } from '@/lib/cobros/reverso-pasarela-servidor'

export const AVISO_INTERNO_PARA = 'mauricio.moreno@metrik.com.co'

/** Un cargue pausado tanto tiempo ya no es "el cliente lo reanuda enseguida". */
export const MINUTOS_PAUSA_AVISO = 30
/** Un cargue activo sin una fila terminada ni un turno en este tiempo está atascado (un turno dura 60 s). */
export const MINUTOS_ATASCO_AVISO = 15
/**
 * El vigía corre cada 15 min (`debeVigilarLotes`) y avisa un lote SOLO mientras lleva entre el plazo y el
 * plazo + 30 min en ese estado: dos corridas, por si una falla, y la llave de Resend evita el doble
 * correo. Así no se llama a Resend cada minuto por cada lote quieto.
 */
export const MINUTOS_VENTANA_AVISO = 30

/** El vigía de lotes va en las corridas del minuto 0, 15, 30 y 45 del cron de cada minuto. */
export function debeVigilarLotes(ahora: Date): boolean {
  return ahora.getUTCMinutes() % 15 === 0
}

function escapar(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function correo(subject: string, lineas: string[], idempotencyKey: string) {
  const text = lineas.join('\n')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5"><pre style="white-space:pre-wrap;font-family:inherit">${escapar(text)}</pre></div>`
  return { to: AVISO_INTERNO_PARA, subject, text, html, idempotencyKey }
}

// ─── Crons ──────────────────────────────────────────────────────────────────────

/** `nombre_error: mensaje` de cada campo `*_error` con valor en el resumen de un cron. */
export function fallasDeResumen(resumen: Record<string, unknown>): string[] {
  return Object.entries(resumen)
    .filter(([k, v]) => k.endsWith('_error') && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 500))
}

export function ventanaDe(ahora: Date, ventana: 'hora' | 'dia'): string {
  const iso = ahora.toISOString()
  return ventana === 'hora' ? iso.slice(0, 13) : iso.slice(0, 10)
}

export function correoFallaCron(cron: string, fallas: string[], ahora: Date, ventana: 'hora' | 'dia') {
  return correo(
    `[ONE] El cron ${cron} falló`,
    [
      `El cron ${cron} terminó con ${fallas.length} falla(s) (${ahora.toISOString()}).`,
      '',
      ...fallas.map((f) => `- ${f}`),
      '',
      `Revisar los logs de Vercel de /api/crons/${cron}. Este aviso sale a lo sumo una vez por ${ventana === 'hora' ? 'hora' : 'día'}.`,
    ],
    `one-cron-${cron}-${ventanaDe(ahora, ventana)}`,
  )
}

/** Best-effort: nunca lanza ni cambia la respuesta del cron. */
export async function avisarFallaCron(
  cron: string,
  fallas: string[],
  opciones: { ventana: 'hora' | 'dia'; ahora?: Date; enviar?: EnvioCorreoInterno },
): Promise<boolean> {
  if (!fallas.length) return false
  try {
    const r = await (opciones.enviar ?? enviarCorreoInternoPorResend)(correoFallaCron(cron, fallas, opciones.ahora ?? new Date(), opciones.ventana))
    if (!r.ok) console.error(`[alertas-internas] cron ${cron}: ${r.error}`)
    return r.ok
  } catch (e) {
    console.error(`[alertas-internas] cron ${cron}:`, (e as Error)?.message ?? e)
    return false
  }
}

// ─── Cargue masivo de Valida ────────────────────────────────────────────────────

export type LoteVigilado = {
  id: string
  workspace_id: string
  estado: string
  motivo_pausa: string | null
  detalle_pausa: string | null
  total: number
  procesadas: number
  updated_at: string
}

export type AvisoLote = { lote: LoteVigilado; tipo: 'pausado' | 'atascado'; minutos: number }

export function lotesParaAvisar(lotes: LoteVigilado[], ahoraMs: number): AvisoLote[] {
  const out: AvisoLote[] = []
  for (const l of lotes) {
    const minutos = Math.floor((ahoraMs - Date.parse(l.updated_at)) / 60_000)
    if (Number.isNaN(minutos)) continue
    const enVentana = (plazo: number) => minutos >= plazo && minutos < plazo + MINUTOS_VENTANA_AVISO
    if (l.estado === 'pausado' && enVentana(MINUTOS_PAUSA_AVISO)) out.push({ lote: l, tipo: 'pausado', minutos })
    else if (['en_cola', 'procesando', 'preparando'].includes(l.estado) && enVentana(MINUTOS_ATASCO_AVISO)) {
      out.push({ lote: l, tipo: 'atascado', minutos })
    }
  }
  return out
}

export function correoAvisoLote(a: AvisoLote, slug: string | null) {
  const { lote, tipo, minutos } = a
  const que = tipo === 'pausado'
    ? `está pausado hace ${minutos} min (motivo: ${lote.motivo_pausa ?? 'sin motivo'}${lote.detalle_pausa ? ` — ${lote.detalle_pausa}` : ''})`
    : `está ${lote.estado} sin avanzar hace ${minutos} min`
  return correo(
    `[ONE] Cargue de Valida ${tipo === 'pausado' ? 'pausado' : 'atascado'}${slug ? ` en ${slug}` : ''}`,
    [
      `El cargue ${lote.id} del espacio ${slug ?? lote.workspace_id} ${que}.`,
      `Avance: ${lote.procesadas} de ${lote.total} filas.`,
      '',
      tipo === 'pausado'
        ? 'El cliente recibió su aviso si el lote tiene 100 filas o más. Revisar si hace falta ayudarle (bolsa, términos, llave).'
        : 'Ningún trabajador lo está moviendo: revisar los logs de /api/crons/valida-lotes.',
    ],
    `one-lote-${tipo}-${lote.id}-${lote.updated_at}`,
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Lee los lotes que pueden estar quietos y avisa los que pasaron su plazo. Nunca lanza. */
export async function vigilarLotesValida(
  db: Db,
  opciones: { ahoraMs?: number; enviar?: EnvioCorreoInterno } = {},
): Promise<{ revisados: number; avisados: number; error?: string }> {
  const ahoraMs = opciones.ahoraMs ?? Date.now()
  const enviar = opciones.enviar ?? enviarCorreoInternoPorResend
  try {
    const hasta = new Date(ahoraMs - MINUTOS_ATASCO_AVISO * 60_000).toISOString()
    const desde = new Date(ahoraMs - (MINUTOS_PAUSA_AVISO + MINUTOS_VENTANA_AVISO) * 60_000).toISOString()
    const { data, error } = await db
      .from('valida_lotes')
      .select('id, workspace_id, estado, motivo_pausa, detalle_pausa, total, procesadas, updated_at')
      .in('estado', ['pausado', 'en_cola', 'procesando', 'preparando'])
      .lte('updated_at', hasta)
      .gte('updated_at', desde)
      .limit(50)
    if (error) return { revisados: 0, avisados: 0, error: error.message }
    const avisos = lotesParaAvisar((data ?? []) as LoteVigilado[], ahoraMs)
    let avisados = 0
    for (const a of avisos) {
      const { data: ws } = await db.from('workspaces').select('slug').eq('id', a.lote.workspace_id).maybeSingle()
      const r = await enviar(correoAvisoLote(a, (ws as { slug?: string } | null)?.slug ?? null))
      if (r.ok) avisados += 1
      else console.error(`[alertas-internas] lote ${a.lote.id}: ${r.error}`)
    }
    return { revisados: (data ?? []).length, avisados }
  } catch (e) {
    return { revisados: 0, avisados: 0, error: (e as Error)?.message ?? String(e) }
  }
}
