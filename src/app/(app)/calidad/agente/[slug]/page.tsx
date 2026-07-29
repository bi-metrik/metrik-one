import { notFound } from 'next/navigation'
import { getPerfilAgente } from '../../actions'
import PerfilAgenteClient from './perfil-client'

export const dynamic = 'force-dynamic'

/**
 * Perfil de agente.
 *
 * El guard vive en `getPerfilAgente`, no aqui: valida modulo, rol y —para un
 * ejecutor— que el perfil sea el suyo, resolviendo el nombre desde su
 * `staff_id` en vez de confiar en el slug de la URL. Si algo de eso falla
 * devuelve null y esta pagina responde 404, sin decir si el agente existe.
 */
export default async function PerfilAgentePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const perfil = await getPerfilAgente(slug)
  if (!perfil) notFound()

  return <PerfilAgenteClient perfil={perfil} />
}
