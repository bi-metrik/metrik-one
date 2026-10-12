/**
 * Correo al equipo del motor de recordatorios (Vera F3-5: «avisos de fecha límite a 3 días y el
 * día a operaciones, en la app y por correo»; vencido a los aprobadores).
 *
 * El mismo texto del aviso de la app, con el enlace al negocio en el subdominio del espacio. El
 * correo vive en `profiles.email` (no en `staff`). Sin correo, o sin la llave de Resend, el aviso
 * queda `omitido` con su motivo: el de la app ya salió por su lado y no se reintenta tres días
 * algo que no se arregla solo.
 *
 * La llave de idempotencia de Resend va por hecho y persona: si el cron se cae después de mandar
 * y antes de marcar, el reintento no duplica el correo.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

const ASUNTOS: Record<string, string> = {
  pago_proveedor_por_vencer: 'Pago a proveedor por vencer',
  pago_proveedor_vencido: 'Pago a proveedor vencido',
  cuota_por_vencer: 'Cuota del cliente por vencer',
  cobro_vencido: 'Cuota del cliente vencida',
  toque_seguimiento: 'Toque de seguimiento',
}

export function asuntoDelCorreo(tipo: string, negocio: string): string {
  return `${ASUNTOS[tipo] ?? 'Recordatorio'} · ${negocio}`.slice(0, 200)
}

function escapar(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function enlaceAlNegocio(slug: string | null, negocioId: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  const host = slug ? `${slug}.${base}` : base
  const protocolo = base.startsWith('localhost') ? 'http' : 'https'
  return `${protocolo}://${host}/negocios/${negocioId}`
}

export function cuerpoDelCorreo(texto: string, enlace: string): { html: string; text: string } {
  return {
    text: `${texto}\n\nAbrir el negocio: ${enlace}`,
    html:
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1A1A1A">` +
      `<p>${escapar(texto)}</p>` +
      `<p><a href="${escapar(enlace)}" style="color:#059669">Abrir el negocio</a></p></div>`,
  }
}

export class CorreosDelEquipo {
  private correos = new Map<string, string | null>()
  private slugs = new Map<string, string | null>()
  constructor(private svc: Db) {}

  private async correoDe(profileId: string): Promise<string | null> {
    if (this.correos.has(profileId)) return this.correos.get(profileId) ?? null
    const { data } = await this.svc.from('profiles').select('email').eq('id', profileId).maybeSingle()
    const correo = ((data as { email?: string | null } | null)?.email ?? '').trim() || null
    this.correos.set(profileId, correo)
    return correo
  }

  private async slugDe(workspaceId: string): Promise<string | null> {
    if (this.slugs.has(workspaceId)) return this.slugs.get(workspaceId) ?? null
    const { data } = await this.svc.from('workspaces').select('slug').eq('id', workspaceId).maybeSingle()
    const slug = ((data as { slug?: string | null } | null)?.slug ?? '').trim() || null
    this.slugs.set(workspaceId, slug)
    return slug
  }

  /** `enviado`, u `omitido` con motivo. Lanza si Resend responde error (el motor lo reintenta). */
  async mandar(p: {
    profileId: string
    workspaceId: string
    negocioId: string
    negocioNombre: string
    tipo: string
    texto: string
    idempotencyKey: string
  }): Promise<{ estado: 'enviado' | 'omitido'; motivo: string | null }> {
    const para = await this.correoDe(p.profileId)
    if (!para) return { estado: 'omitido', motivo: 'sin_correo' }
    const key = process.env.RESEND_API_KEY
    if (!key) return { estado: 'omitido', motivo: 'sin_resend_api_key' }
    const enlace = enlaceAlNegocio(await this.slugDe(p.workspaceId), p.negocioId)
    const cuerpo = cuerpoDelCorreo(p.texto, enlace)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': p.idempotencyKey },
      body: JSON.stringify({
        from: 'MéTRIK ONE <noreply@metrikone.co>',
        to: [para],
        subject: asuntoDelCorreo(p.tipo, p.negocioNombre),
        html: cuerpo.html,
        text: cuerpo.text,
      }),
    })
    if (!res.ok) {
      const detalle = await res.text().catch(() => '')
      throw new Error(`Resend ${res.status}: ${detalle.slice(0, 200)}`)
    }
    return { estado: 'enviado', motivo: null }
  }
}
