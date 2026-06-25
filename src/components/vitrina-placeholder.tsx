import MetrikLockup from '@/components/metrik-lockup'

const METRIK_URL = 'https://metrik.com.co'

interface VitrinaPlaceholderProps {
  /** Título de la vitrina (ej. "Números", "Tableros"). */
  title: string
  /** Copy comercial (voz de marca). */
  body: string
  /** Texto del CTA. Default: "Hablemos con MeTRIK". */
  ctaLabel?: string
}

/**
 * Empty-state comercial premium para workspaces en `config_extra.modo_vitrina`.
 * Un cliente Valida-only ve una muestra curada de lo que MeTRIK ONE ofrece,
 * en vez de los datos reales del módulo (que no compró). Marca obligatoria:
 * Montserrat (heredada), Verde Métrica #10B981, Negro Carbón #1A1A1A, lockup
 * oficial y sello "Powered by MéTRIK". No inventar diseño ni colores fuera de
 * tokens.
 */
export default function VitrinaPlaceholder({
  title,
  body,
  ctaLabel = 'Hablemos con MeTRIK',
}: VitrinaPlaceholderProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card px-8 py-12 text-center shadow-sm">
        <div className="mb-8 flex justify-center">
          <MetrikLockup size="md" />
        </div>

        <h1
          className="mb-4 text-2xl font-bold tracking-tight"
          style={{ color: '#1A1A1A' }}
        >
          {title}
        </h1>

        <p className="mx-auto mb-8 max-w-md text-[15px] leading-relaxed text-muted-foreground">
          {body}
        </p>

        <a
          href={METRIK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-lg px-6 py-3 text-sm font-semibold text-white transition-colors hover:brightness-95"
          style={{ backgroundColor: '#10B981' }}
        >
          {ctaLabel}
        </a>

        <div className="mt-10 border-t border-border pt-6">
          <a
            href={METRIK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            Powered by MéTRIK
          </a>
        </div>
      </div>
    </div>
  )
}
