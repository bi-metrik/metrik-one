import { redirect } from 'next/navigation'
import { getContextoCalidad, getMuro } from '../actions'
import MuroEnApp from './muro-en-app'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * El muro dentro de la app.
 *
 * Ocultar el item del menu para el ejecutor NO impide teclear la URL, asi que
 * la page guarda por su cuenta: el muro es el televisor del piso, no una
 * herramienta del agente.
 */
export default async function MuroEnAppPage() {
  const ctx = await getContextoCalidad()
  if (!ctx) redirect('/')
  if (!ctx.canViewCalidadTodos) redirect('/calidad')

  const data = await getMuro()
  if (!data) redirect('/calidad')

  return (
    <MuroEnApp
      data={data}
      nombreWorkspace={ctx.nombreWorkspace}
      token={ctx.muroToken}
      muroPublico={ctx.muroPublico}
    />
  )
}
