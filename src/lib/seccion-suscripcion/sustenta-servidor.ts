import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { etiquetaRol } from '@/lib/usuarios-espacio/reglas'
import { escaparHtml } from '@/lib/usuarios-espacio/correo'
import {
  CLAVE_SUSTENTA,
  asuntoAvisoLead,
  descartadaHasta,
  mostrarSugerencia,
  textoAvisoLead,
} from './sugerencias'

/**
 * El bloque de Sustenta del lado del servidor: si se muestra, «Ahora no» y «Quiero que me contacten».
 *
 * - El descarte vive en `sugerencias_descartadas` (por persona, no en localStorage): cambia de equipo
 *   y la tarjeta sigue oculta los 30 días.
 * - El interés vive en `interes_servicios`, único por (espacio, servicio): esa restricción es la que
 *   hace idempotente el lead. Dos clics, dos pestañas o dos personas del mismo CDA crean UN contacto.
 * - El lead va al espacio de metrik (directorio comercial de MeTRIK) y el aviso a Mauricio por correo.
 *
 * Todo por cliente de servicio: las dos tablas son server-only.
 */

/** El espacio de MeTRIK: donde vive el directorio comercial al que llega el lead. */
export const WORKSPACE_METRIK_ID = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
/** A quién se le avisa de un lead de Sustenta (decisión de Mauricio, 2026-09-23). */
export const CORREO_AVISO_LEAD = 'mauricio.moreno@metrik.com.co'

type Svc = ReturnType<typeof createServiceClient>

export async function estadoSugerencia(p: {
  workspaceId: string
  usuarioId: string
  ahora: Date
}): Promise<{ mostrar: boolean; yaSolicitado: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const [descarte, interes] = await Promise.all([
    svc
      .from('sugerencias_descartadas')
      .select('descartada_hasta')
      .eq('profile_id', p.usuarioId)
      .eq('clave', CLAVE_SUSTENTA)
      .maybeSingle(),
    svc
      .from('interes_servicios')
      .select('id, contacto_id')
      .eq('workspace_origen_id', p.workspaceId)
      .eq('servicio', CLAVE_SUSTENTA)
      .maybeSingle(),
  ])
  // Si no se puede leer, no se muestra: una sugerencia comercial no justifica un error en pantalla.
  if (descarte.error || interes.error) return { mostrar: false, yaSolicitado: false }
  const yaSolicitado = Boolean(interes.data)
  return {
    yaSolicitado,
    mostrar: mostrarSugerencia({
      descartadaHasta: (descarte.data?.descartada_hasta as string | undefined) ?? null,
      yaSolicitado,
      ahora: p.ahora,
    }),
  }
}

export async function descartarSugerencia(p: { usuarioId: string; ahora: Date }): Promise<{ ok: true } | { ok: false; error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const { error } = await svc.from('sugerencias_descartadas').upsert(
    {
      profile_id: p.usuarioId,
      clave: CLAVE_SUSTENTA,
      descartada_hasta: descartadaHasta(p.ahora),
      updated_at: p.ahora.toISOString(),
    },
    { onConflict: 'profile_id,clave' },
  )
  if (error) {
    console.error('[sustenta] descartar:', error.message)
    return { ok: false, error: 'No se pudo guardar. Intenta de nuevo.' }
  }
  return { ok: true }
}

export type ResultadoContacto =
  | { ok: true; yaExistia: boolean; avisoEnviado: boolean }
  | { ok: false; error: string }

/**
 * «Quiero que me contacten». Reclama el único por (espacio, servicio); si ya estaba, no crea nada
 * más y responde como éxito (la persona ya quedó en lista). Si crear el contacto falla, suelta el
 * reclamo para que se pueda reintentar. El correo a Mauricio no deshace el lead si falla: el lead ya
 * está en el directorio y es lo que importa.
 */
export async function pedirContactoSustenta(p: {
  workspaceId: string
  usuarioId: string
  role: string
  empresaIdEnMetrik: string | null
  cobradorId: string
  empresaNombre: string | null
}): Promise<ResultadoContacto> {
  const svc = createServiceClient() as Svc
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = svc as any

  // La empresa del contrato vive en el directorio del espacio que cobra. Solo se enlaza si ese espacio
  // es metrik: una FK a una empresa de otro inquilino no se inventa.
  const empresaId = p.cobradorId === WORKSPACE_METRIK_ID ? p.empresaIdEnMetrik : null

  const reclamo = await s
    .from('interes_servicios')
    .insert({
      workspace_origen_id: p.workspaceId,
      servicio: CLAVE_SUSTENTA,
      solicitado_por: p.usuarioId,
      empresa_id: empresaId,
    })
    .select('id')
    .maybeSingle()
  if (reclamo.error) {
    // 23505: ya había un «quiero que me contacten» de este espacio. Idempotente.
    if (reclamo.error.code === '23505') return { ok: true, yaExistia: true, avisoEnviado: false }
    console.error('[sustenta] reclamo:', reclamo.error.message)
    return { ok: false, error: 'No se pudo registrar tu solicitud. Intenta de nuevo.' }
  }
  const interesId = (reclamo.data as { id: string }).id

  const [perfilR, wsR, authR] = await Promise.all([
    s.from('profiles').select('full_name').eq('id', p.usuarioId).maybeSingle(),
    s.from('workspaces').select('slug, name').eq('id', p.workspaceId).maybeSingle(),
    svc.auth.admin.getUserById(p.usuarioId),
  ])
  const persona = (perfilR.data?.full_name as string | undefined)?.trim() || 'Sin nombre'
  const correo = authR.data?.user?.email ?? null
  const slug = (wsR.data?.slug as string | undefined) ?? 'sin-espacio'
  const empresa = p.empresaNombre ?? (wsR.data?.name as string | undefined) ?? slug

  const contacto = await s
    .from('contactos')
    .insert({
      workspace_id: WORKSPACE_METRIK_ID,
      nombre: `${persona} - ${empresa}`.slice(0, 200),
      email: correo,
      segmento: 'primer_contacto',
      fuente_adquisicion: 'contacto_directo',
      fuente_detalle: 'Sección Suscripción de ONE: pidió conocer Sustenta',
      custom_data: {
        origen_interes: {
          servicio: CLAVE_SUSTENTA,
          workspace_origen_id: p.workspaceId,
          workspace_origen_slug: slug,
          empresa_id: empresaId,
          empresa_nombre: empresa,
          interes_id: interesId,
        },
      },
    })
    .select('id')
    .maybeSingle()
  if (contacto.error || !contacto.data) {
    console.error('[sustenta] contacto:', contacto.error?.message)
    // Se suelta el reclamo: sin lead, la solicitud no quedó hecha y se tiene que poder reintentar.
    await s.from('interes_servicios').delete().eq('id', interesId)
    return { ok: false, error: 'No se pudo registrar tu solicitud. Intenta de nuevo.' }
  }
  const contactoId = (contacto.data as { id: string }).id
  const enlace = await s.from('interes_servicios').update({ contacto_id: contactoId }).eq('id', interesId)
  if (enlace.error) console.error('[sustenta] enlace del contacto:', enlace.error.message)

  const aviso = await avisarLead({
    empresa,
    espacioSlug: slug,
    persona,
    correo,
    rol: etiquetaRol(p.role),
  })
  if (!aviso.ok) console.error('[sustenta] aviso:', aviso.error)
  return { ok: true, yaExistia: false, avisoEnviado: aviso.ok }
}

async function avisarLead(d: {
  empresa: string
  espacioSlug: string
  persona: string
  correo: string | null
  rol: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  const texto = textoAvisoLead(d)
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1A1A1A">${texto
    .split('\n')
    .map((l) => `<p style="margin:0 0 8px 0">${escaparHtml(l)}</p>`)
    .join('')}</div>`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'MéTRIK ONE <noreply@metrikone.co>',
      to: [CORREO_AVISO_LEAD],
      ...(d.correo ? { reply_to: d.correo } : {}),
      subject: asuntoAvisoLead(d),
      text: texto,
      html,
    }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string }
    return { ok: false, error: `Resend ${res.status}: ${err.message ?? res.statusText}` }
  }
  return { ok: true }
}
