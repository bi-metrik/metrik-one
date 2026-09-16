import 'server-only'
import { NextResponse } from 'next/server'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'

/**
 * Puerta de módulo de las cuatro etapas del motor de auditoría (`/api/calidad/*`).
 *
 * El gate por ruta del middleware deja pasar todo `/api`, y el rol no alcanza: un owner o un
 * supervisor de CUALQUIER workspace tiene `canViewCalidadTodos`. Sin esta puerta, un espacio
 * sin el módulo de llamadas (4D SOFT, con solo `valida_api`) transcribía y auditaba audios
 * con la llave de Gemini de MeTRIK, y escribía llamadas en su workspace.
 *
 * Devuelve la respuesta de rechazo, o `null` si el workspace puede seguir. Va después de la
 * sesión y el rol de cada ruta, y antes de leer el cuerpo o de tocar Storage o Gemini.
 */
export async function puertaModuloLlamadas(): Promise<NextResponse | null> {
  const modulo = await exigirModulo(REQUISITO.llamadas)
  if (modulo.ok) return null
  if (modulo.error === 'no_autenticado') {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  if (modulo.error === 'lectura_fallida') {
    return NextResponse.json({ error: 'No se pudo verificar el módulo. Inténtalo de nuevo.' }, { status: 503 })
  }
  return NextResponse.json({ error: MENSAJE_MODULO_NO_ACTIVO }, { status: 403 })
}
