/**
 * Etapa 2 del motor: auditar la transcripcion ya redactada.
 *
 * Trabaja sobre texto, asi que su tiempo no depende de la duracion del audio:
 * ~30-37 s con las dos pasadas en paralelo, siempre.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { auditarTranscripcion } from '@/lib/calidad/motor-auditoria'
import { getPromptsAuditoria } from '@/lib/calidad/prompts'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !role) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  if (!getRolePermissions(role).canViewCalidadTodos) {
    return NextResponse.json({ error: 'Sin permiso para auditar llamadas' }, { status: 403 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'El motor de auditoría no está configurado.' }, { status: 503 })
  }

  const { transcripcion } = (await req.json()) as { transcripcion?: string }
  if (!transcripcion?.trim()) {
    return NextResponse.json({ error: 'Falta la transcripción.' }, { status: 400 })
  }

  try {
    const prompts = await getPromptsAuditoria(workspaceId)
    const auditoria = await auditarTranscripcion(transcripcion, prompts, apiKey)
    return NextResponse.json({ auditoria })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Falló la auditoría.' },
      { status: 502 },
    )
  }
}
