import MetrikLockup from '@/components/metrik-lockup'

// A donde manda el layout de la app cuando `workspaces.subscription_status` es
// 'suspendida' (gate en src/app/(app)/layout.tsx, criterio en
// src/lib/suscripciones/estado.ts). Vive fuera del grupo (app) a propósito: si
// estuviera adentro, el mismo layout que redirige aquí la volvería a redirigir.
//
// Regla: el acceso es el producto. El impago suspende el acceso desde el vencimiento
// y hasta el recibo del pago; la suspensión no congela la licencia ni perdona las
// cuotas causadas (cerebro/reglas/pago-anticipado-habilita-acceso.md).

const CONTACTO_EMAIL = 'mauricio.moreno@metrik.com.co'
const CONTACTO_WHATSAPP = '+57 315 950 9103'

export const metadata = { title: 'Suscripción suspendida — MéTRIK one' }

export default function SuscripcionSuspendidaPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <MetrikLockup size="md" linkTo="/" />
        <div className="space-y-3">
          <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: 'var(--font-montserrat), Montserrat, sans-serif' }}>
            Tu suscripción está suspendida
          </h1>
          <p className="text-sm text-muted-foreground">
            El acceso a este espacio de trabajo quedó suspendido porque la cuota de la licencia
            está pendiente de pago. Tu información sigue intacta: en cuanto se registre el pago,
            el acceso se reactiva.
          </p>
          <p className="text-sm text-muted-foreground">
            Si ya pagaste, o si necesitas revisar el estado de tu cuenta, escríbenos y lo resolvemos.
          </p>
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-background p-4 text-sm">
          <a
            href={`mailto:${CONTACTO_EMAIL}?subject=${encodeURIComponent('Suscripción suspendida — MéTRIK one')}`}
            className="block font-medium text-foreground underline underline-offset-4"
          >
            {CONTACTO_EMAIL}
          </a>
          <p className="text-muted-foreground">WhatsApp {CONTACTO_WHATSAPP}</p>
        </div>
      </div>
    </div>
  )
}
