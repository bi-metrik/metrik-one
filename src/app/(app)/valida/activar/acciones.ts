'use server'

import { revalidatePath } from 'next/cache'
import { textoErrorActivacion } from '@/lib/valida-registro/activacion'
import { activarPlanValida } from '@/lib/valida-registro/activacion-servidor'

/**
 * «Activar plan». ⚠️ Endpoint alcanzable desde cualquier sesión: `activarPlanValida` resuelve todo en
 * el servidor (sesión, espacio autogestionado, dueña, registro) y la base lo vuelve a exigir. Del
 * formulario solo se toma el archivo del RUT, que es opcional.
 */
export async function activarPlan(formulario: FormData): Promise<{ ok: true; destino: string } | { ok: false; error: string }> {
  const archivo = formulario.get('rut')
  const rut = archivo instanceof File && archivo.size > 0 ? archivo : null
  const r = await activarPlanValida({ rut })
  if (!r.ok) return { ok: false, error: textoErrorActivacion(r.error) }
  revalidatePath('/valida')
  revalidatePath('/suscripcion')
  return r
}
