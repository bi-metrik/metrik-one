import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { createServiceClient } from '@/lib/supabase/server'
import { cargarReporteSupertransporte } from '@/lib/compliance/reporte-supertransporte/servidor'
import {
  construirLibroSupertransporte,
  nombreArchivoSupertransporte,
} from '@/lib/compliance/reporte-supertransporte/excel'
import { baseUrlDelWorkspace } from '@/lib/negocios/construir-export-negocios'
import { nowBogotaTimestamp } from '@/lib/dates/bogota'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Excel de soporte del Reporte Supertransporte (pestaña de /tableros).
 *
 * Recibe el MISMO periodo que la pestaña (`periodo` | `meses` | `desde`+`hasta`) y lo
 * resuelve con la misma función: las cifras del archivo son las de la pantalla.
 *
 * Mismo gate que la pestaña: permiso de ver Números y módulo `compliance`.
 */
export async function GET(req: NextRequest) {
  const { workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return new NextResponse('No autenticado', { status: 401 })
  if (!getRolePermissions(role ?? '').canViewNumbers) {
    return new NextResponse('Sin permisos', { status: 403 })
  }

  const svc = createServiceClient()
  const { data: ws } = await svc
    .from('workspaces')
    .select('name, slug, modules')
    .eq('id', workspaceId)
    .maybeSingle()
  const modules = ((ws?.modules as Record<string, boolean> | null) ?? {})
  if (!modules.compliance) return new NextResponse('Módulo no activo', { status: 403 })
  if (!ws?.slug) return new NextResponse('Workspace sin slug', { status: 500 })

  const params = Object.fromEntries(new URL(req.url).searchParams.entries())
  try {
    const reporte = await cargarReporteSupertransporte(workspaceId, params)
    const buffer = construirLibroSupertransporte(reporte, {
      baseUrl: baseUrlDelWorkspace(ws.slug as string),
      workspaceNombre: (ws.name as string | null) ?? (ws.slug as string),
      generado: nowBogotaTimestamp(),
    })
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nombreArchivoSupertransporte(reporte)}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (e) {
    console.error('[reporte-supertransporte] excel:', (e as Error).message)
    return new NextResponse('No pudimos armar el reporte. Intenta de nuevo en unos minutos.', { status: 500 })
  }
}
