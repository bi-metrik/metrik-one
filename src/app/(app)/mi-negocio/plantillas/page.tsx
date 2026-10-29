import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { esEditorDePlantillas } from '@/lib/plantillas-documento/servidor'
import { TIPOS_PLANTILLA } from '@/lib/plantillas-documento/catalogo'
import { leerPlantilla, type PantallaPlantilla } from './actions'
import PlantillasClient from './plantillas-client'

/**
 * Configuración → Plantillas de documentos. Solo para la lista explícita de editores del
 * workspace (`plantillas_documento_editores`): a cualquier otra persona la pantalla no
 * existe. Ocultar el enlace no es la seguridad; esta guarda y la de cada acción sí.
 */
export default async function PlantillasPage() {
  const { supabase, workspaceId, impersonating } = await getWorkspace()
  const { user } = await getCachedUser()
  if (!user) redirect('/login')
  if (!workspaceId || impersonating || !(await esEditorDePlantillas(supabase, workspaceId, user.id))) {
    redirect('/mi-negocio')
  }

  const pantallas: PantallaPlantilla[] = []
  for (const tipo of TIPOS_PLANTILLA) {
    const r = await leerPlantilla(tipo)
    if (r.ok) pantallas.push(r.pantalla)
  }
  return <PlantillasClient pantallasIniciales={pantallas} />
}
