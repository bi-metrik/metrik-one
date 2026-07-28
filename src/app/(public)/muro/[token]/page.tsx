import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { getMuroPorWorkspace } from '@/app/(app)/calidad/actions'
import MuroView from '@/app/(app)/calidad/components/muro-view'

// Desde v2 el muro lleva facturacion (cierres del dia y montos en dolares), asi
// que ningun buscador debe levantarlo ni cachearlo. `noarchive` + `nosnippet`
// ademas evitan que quede una copia o un extracto en resultados aunque alguien
// enlace la URL desde otra parte.
export const metadata: Metadata = {
  title: 'Muro de calidad',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    nosnippet: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
}

// El muro cambia con cada llamada que entra: nunca cachear.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Muro proyectable, publico por enlace y sin sesion.
 *
 * Va en (public) como ya hace /cert: el middleware deja pasar /muro/ sin login,
 * porque un televisor del piso no tiene quien inicie sesion cada manana.
 *
 * TRES gates, no uno:
 *   1. El workspace tiene modules.calidad_llamadas.
 *   2. El workspace declaro explicitamente config_extra.muro_publico. Tener el
 *      modulo NO alcanza: exponer el muro a internet es una decision aparte.
 *   3. El token de la URL coincide con config_extra.muro_token (no adivinable).
 *
 * Cualquiera que falle → 404, sin pistas de si el workspace existe.
 *
 * Lo que se expone esta acotado por la RPC get_calidad_muro, que no devuelve
 * `cliente_ref` ni ninguna columna monetaria, y que corta los agentes a su
 * nombre de pila.
 */
export default async function MuroPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token || token.length < 8) notFound()

  const svc = createServiceClient()
  const { data: ws } = await svc
    .from('workspaces')
    .select('id, name, modules, config_extra')
    .eq('config_extra->>muro_token', token)
    .maybeSingle()

  if (!ws) notFound()

  const modules = (ws as { modules: Record<string, boolean> | null }).modules
  const configExtra = (ws as { config_extra: Record<string, unknown> | null }).config_extra ?? {}

  if (!modules?.calidad_llamadas) notFound()
  if ((configExtra as { muro_publico?: boolean }).muro_publico !== true) notFound()

  const data = await getMuroPorWorkspace(ws.id as string)
  if (!data) notFound()

  return <MuroView data={data} nombreWorkspace={ws.name as string} proyectable />
}
