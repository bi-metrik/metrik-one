// Endpoint para que el skill /workflow local publique workflows a la biblioteca.
// Auth: Bearer WORKFLOWS_SYNC_SECRET (no expone service role al caller).
// Internamente usa service role para acceder a Storage + tabla.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

interface SyncBody {
  cliente_slug: string
  cliente_nombre?: string
  proyecto_slug: string
  nombre_flujo: string
  version: number
  linea_negocio: string
  tipo_proceso?: string
  fase_cubierta?: string[]
  fase_detallada?: string
  estado?: string
  tags?: string[]
  autor_proceso?: string
  autor_tecnico?: string
  owner_calidad?: string
  basado_en?: string | null
  total_fases?: number
  total_etapas?: number
  total_bloques?: number
  tiene_condicionales?: boolean
  fecha_actualizacion?: string
  linea_negocio_cliente?: string | null
  html_content_b64: string
  pdf_content_b64?: string | null
  metadata?: Record<string, unknown>
}

function checkAuth(req: NextRequest): string | null {
  const secret = process.env.WORKFLOWS_SYNC_SECRET
  if (!secret) return 'WORKFLOWS_SYNC_SECRET no configurado en servidor'
  const header = req.headers.get('authorization') || ''
  const token = header.replace(/^Bearer\s+/i, '')
  if (!token || token !== secret) return 'Unauthorized'
  return null
}

function requiredFields(b: Partial<SyncBody>): string | null {
  const required: (keyof SyncBody)[] = [
    'cliente_slug', 'proyecto_slug', 'nombre_flujo',
    'version', 'linea_negocio', 'html_content_b64'
  ]
  for (const k of required) {
    if (b[k] === undefined || b[k] === null || b[k] === '') return `Falta campo: ${k}`
  }
  return null
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req)
  if (authErr) return NextResponse.json({ error: authErr }, { status: 401 })

  let body: SyncBody
  try {
    body = await req.json() as SyncBody
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }

  const fieldErr = requiredFields(body)
  if (fieldErr) return NextResponse.json({ error: fieldErr }, { status: 400 })

  const svc = createServiceClient()

  // Storage paths
  const basePath = `${body.cliente_slug}/${body.proyecto_slug}/${body.nombre_flujo}-v${body.version}`
  const htmlPath = `${basePath}.html`
  const pdfPath = body.pdf_content_b64 ? `${basePath}.pdf` : null

  // Upload HTML
  const htmlBuffer = Buffer.from(body.html_content_b64, 'base64')
  const { error: htmlErr } = await svc.storage
    .from('workflows')
    .upload(htmlPath, htmlBuffer, {
      contentType: 'text/html',
      upsert: true,
    })
  if (htmlErr) {
    return NextResponse.json({ error: `Upload HTML: ${htmlErr.message}` }, { status: 500 })
  }

  // Upload PDF (opcional)
  if (pdfPath && body.pdf_content_b64) {
    const pdfBuffer = Buffer.from(body.pdf_content_b64, 'base64')
    const { error: pdfErr } = await svc.storage
      .from('workflows')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })
    if (pdfErr) {
      return NextResponse.json({ error: `Upload PDF: ${pdfErr.message}` }, { status: 500 })
    }
  }

  // Upsert tabla
  const record = {
    cliente_slug: body.cliente_slug,
    cliente_nombre: body.cliente_nombre ?? null,
    proyecto_slug: body.proyecto_slug,
    nombre_flujo: body.nombre_flujo,
    version: body.version,
    linea_negocio: body.linea_negocio,
    tipo_proceso: body.tipo_proceso ?? null,
    fase_cubierta: body.fase_cubierta ?? null,
    fase_detallada: body.fase_detallada ?? null,
    estado: body.estado ?? 'en_construccion',
    tags: body.tags ?? [],
    autor_proceso: body.autor_proceso ?? null,
    autor_tecnico: body.autor_tecnico ?? null,
    owner_calidad: body.owner_calidad ?? null,
    basado_en: body.basado_en ?? null,
    total_fases: body.total_fases ?? null,
    total_etapas: body.total_etapas ?? null,
    total_bloques: body.total_bloques ?? null,
    tiene_condicionales: body.tiene_condicionales ?? false,
    html_storage_path: htmlPath,
    pdf_storage_path: pdfPath,
    metadata: body.metadata ?? {},
    fecha_actualizacion: body.fecha_actualizacion ?? null,
    linea_negocio_cliente: body.linea_negocio_cliente ?? null,
  }

  // admin_workflows not in generated types yet — migration 20260422000001
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: upsertErr } = await ((svc as any).from('admin_workflows'))
    .upsert(record, {
      onConflict: 'cliente_slug,proyecto_slug,linea_negocio,nombre_flujo,version',
    })
    .select('id')
    .single()

  if (upsertErr) {
    return NextResponse.json({ error: `Upsert: ${upsertErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    id: data.id,
    html_storage_path: htmlPath,
    pdf_storage_path: pdfPath,
  })
}
