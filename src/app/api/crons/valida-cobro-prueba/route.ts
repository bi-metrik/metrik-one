import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { procesarCobrosTrasPrueba } from '@/lib/valida-registro/cobro-prueba-servidor'
import { entornoDeCobro } from '@/lib/valida-registro/cobro-prueba'

/**
 * Solo el paso 7a de `procesar-planes-cobro` (aviso de 48 h, cobro al cumplirse los 7 días de la
 * prueba de Valida y borrado de tarjetas canceladas), para correrlo A MANO en un preview sin correr
 * el cron entero: el cron completo en un preview mandaría enlaces y correos a clientes reales, porque
 * los previews usan la base de producción. Este paso, en cambio, solo toca los registros que abrió
 * ESE despliegue (`cobro_entorno = 'preview'`).
 *
 * NO está en `vercel.json`: en producción lo corre el cron diario dentro de `procesar-planes-cobro`.
 *
 * Quién lo puede llamar:
 *   - con `Authorization: Bearer $CRON_SECRET`, en cualquier despliegue;
 *   - en un preview (nunca en producción), una persona de soporte de MeTRIK con sesión
 *     (`profiles.platform_admin`): abrir la URL en el navegador basta.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function esSoporteEnPreview(): Promise<boolean> {
  if (entornoDeCobro() === 'production') return false
  const { user } = await getCachedUser()
  if (!user?.id) return false
  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (svc.from('profiles') as any).select('platform_admin').eq('id', user.id).maybeSingle()
  return (data as { platform_admin?: boolean } | null)?.platform_admin === true
}

export async function GET(req: NextRequest) {
  const conSecreto = !!process.env.CRON_SECRET && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  if (!conSecreto && !(await esSoporteEnPreview())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const resumen = await procesarCobrosTrasPrueba({ db: createServiceClient() })
  return NextResponse.json({ ok: true, entorno: entornoDeCobro(), resumen })
}
