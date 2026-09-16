import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getMuroPublico } from '@/app/(app)/calidad/muro-publico'
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
 * TRES gates, no uno (aplicados en `getMuroPublico`, `calidad/muro-publico.ts`):
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

  // Los tres gates (token, modulo y opt-in) los aplica `getMuroPublico`, dentro de la
  // misma funcion que lee con service_role. Antes vivian aqui y la lectura era una
  // server action aparte que no validaba nada.
  const muro = await getMuroPublico(token)
  if (!muro) notFound()

  return <MuroView data={muro.data} nombreWorkspace={muro.nombreWorkspace} proyectable />
}
