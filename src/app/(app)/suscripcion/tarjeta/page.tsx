import Link from 'next/link'
import { notFound } from 'next/navigation'
import { contextoSuscripcion } from '@/lib/seccion-suscripcion/contexto-servidor'
import { epaycoHabilitado, llavePublicaEpayco } from '@/lib/suscripciones/pasarela/epayco'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { TEXTO_ACEPTA_V15 } from '@/lib/valida-cda/tarjeta-cda'
import { autorizacionParaMostrar } from '@/lib/valida-cda/tarjeta-cda-servidor'
import { FormularioTarjetaCda } from './formulario-tarjeta-cda'

export const dynamic = 'force-dynamic'

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">Suscripción</p>
        <h1 className="text-xl font-bold text-tinta">Pago automático con tarjeta</h1>
      </header>
      {children}
    </div>
  )
}

function Aviso({ texto, enlace }: { texto: string; enlace?: { href: string; label: string } }) {
  return (
    <Marco>
      <p data-aviso-tarjeta-cda className="rounded-lg border border-border bg-papel p-4 text-sm text-tinta">
        {texto}
      </p>
      <Link href={enlace?.href ?? '/suscripcion?tab=pagos'} className="text-sm font-semibold text-acento underline underline-offset-2">
        {enlace?.label ?? 'Volver a Suscripción'}
      </Link>
    </Marco>
  )
}

/**
 * `/suscripcion/tarjeta`: registrar o cambiar la tarjeta del pago automático de un CDA (Términos v1.5, 2.4).
 * La única página del espacio con la política de contenido de ePayco (`next.config.ts`, `RUTA_TARJETA_CDA`):
 * ningún script de terceros salvo jQuery y ePayco.js.
 *
 * La misma puerta que `/suscripcion` (solo la persona designada; a cualquier otro, 404) y además: su propia
 * sesión (no «Ver como»), ePayco encendido y la v1.5 aceptada (D2). Todo lo vuelve a exigir la acción.
 */
export default async function TarjetaCdaPage() {
  const ctx = await contextoSuscripcion()
  if (ctx.tipo !== 'ok' || ctx.producto !== 'valida_cda' || !ctx.contrato.negocioId) notFound()

  if (ctx.soloLectura) return <Aviso texto="Estás viendo la suscripción como otra persona: es solo lectura." />
  const llave = llavePublicaEpayco()
  if (!epaycoHabilitado() || !llave) return <Aviso texto="El pago con tarjeta no está disponible en este momento." />

  const r = await autorizacionParaMostrar(ctx)
  if (!r.ok) {
    return r.aceptaV15 ? (
      <Aviso texto={TEXTO_ACEPTA_V15} enlace={{ href: '/valida?modificacion=1', label: 'Revisar y aceptar la versión 1.5' }} />
    ) : (
      <Aviso texto={r.error} />
    )
  }
  const { user } = await getCachedUser()
  if (!user?.email) return <Aviso texto="Tu usuario no tiene correo registrado. Escríbenos y lo resolvemos." />

  return (
    <Marco>
      <p className="text-sm text-tinta-suave">
        {r.cambiar
          ? 'La tarjeta nueva reemplaza a la anterior, que le pedimos a ePayco borrar. Lo que ya debes no se cobra solo.'
          : 'Cada período se cobra a esta tarjeta en tu fecha de renovación. Lo que ya debes no se cobra solo: después te preguntamos.'}
      </p>
      <FormularioTarjetaCda llavePublica={llave} correo={user.email} autorizacion={r.texto} cambiar={r.cambiar} />
    </Marco>
  )
}
