import { redirect } from 'next/navigation'
import { getMiAgente } from '../actions'
import { slugAgente } from '../types'

export const dynamic = 'force-dynamic'

/**
 * Atajo al perfil propio.
 *
 * Existe para que el menu pueda tener una entrada fija: el perfil vive en
 * `/calidad/agente/[slug]` y el slug depende de quien mira, asi que sin este
 * puente el ejecutor solo llegaba a su perfil haciendo clic en un nombre desde
 * la lista — algo que no puede hacer, porque solo ve sus propias llamadas.
 *
 * Su perfil es la pantalla que le dice que mejorar. Que fuera la mas dificil de
 * encontrar para la unica persona a quien va dirigida no tenia sentido.
 */
export default async function MiPerfilPage() {
  const agente = await getMiAgente()
  if (!agente) redirect('/calidad')
  redirect(`/calidad/agente/${slugAgente(agente)}`)
}
