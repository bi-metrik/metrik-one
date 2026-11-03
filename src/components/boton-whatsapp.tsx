import { MessageCircle } from 'lucide-react'

/**
 * Botón «Abrir WhatsApp con el mensaje» para los avisos que el motor de recordatorios deja
 * a la comercial cuando el envío es `wa_manual` (encuesta postviaje, cuotas): el motor guarda
 * en `notificaciones.metadata.wa_url` el enlace con teléfono y texto (`enlaceWhatsApp`).
 *
 * Componente aparte a propósito: la campana se está rediseñando en otra sesión y el punto de
 * inserción allá es una sola línea.
 *
 * `metadata` es jsonb libre: solo se abre un enlace `https://wa.me/` o
 * `https://api.whatsapp.com/`. Cualquier otra cosa no pinta nada. Se abre la URL EXACTA
 * guardada (no se rearma), solo se valida.
 */

export interface EnlaceWhatsApp {
  url: string
  /** El enlace no trae número: WhatsApp abre con el texto y la persona elige el chat. */
  sinTelefono: boolean
}

const ORIGENES = new Set(['https://wa.me', 'https://api.whatsapp.com'])

export function leerEnlaceWhatsApp(metadata: unknown): EnlaceWhatsApp | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as Record<string, unknown>).wa_url
  if (typeof raw !== 'string') return null
  // Prefijo literal Y origen parseado: lo primero descarta mayúsculas raras o espacios, lo
  // segundo descarta trucos como `https://wa.me@otro.com` o `https://wa.me.otro.com`.
  if (!raw.startsWith('https://wa.me/') && !raw.startsWith('https://api.whatsapp.com/')) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (!ORIGENES.has(u.origin) || u.username || u.password) return null

  const numero = u.hostname === 'wa.me'
    ? u.pathname.replace(/^\/+/, '').replace(/\/+$/, '')
    : (u.searchParams.get('phone') ?? '')
  return { url: raw, sinTelefono: !/\d/.test(numero) }
}

export function BotonWhatsApp({ metadata }: { metadata: unknown }) {
  const enlace = leerEnlaceWhatsApp(metadata)
  if (!enlace) return null
  return (
    // Sin propagar: abrir WhatsApp no es abrir el aviso (no navega ni lo marca completado).
    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
      <a
        href={enlace.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] whitespace-nowrap font-medium text-foreground transition-colors hover:bg-accent sm:min-h-8 sm:w-auto"
      >
        <MessageCircle className="h-3.5 w-3.5 shrink-0" style={{ color: '#25D366' }} />
        Abrir WhatsApp con el mensaje
      </a>
      {enlace.sinTelefono && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Sin teléfono: elige el chat en WhatsApp
        </p>
      )}
    </div>
  )
}
