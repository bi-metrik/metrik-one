/**
 * Etapa 3 del motor: guardar la llamada auditada.
 *
 * TODO LO QUE ENTRA A LA BASE SE RE-VALIDA AQUI. La auditoria vuelve del
 * navegador porque las etapas van en peticiones separadas (el reloj de la
 * funcion no da para hacerlo todo de una), y eso la convierte en entrada no
 * confiable: los codigos de bloque se contrastan contra la lista blanca, la
 * severidad y el titulo salen de la rubrica y no del payload, y el semaforo se
 * recalcula desde las banderas. Si el modelo —o cualquiera— manda algo raro,
 * esto falla ruidosamente en vez de escribirlo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { createServiceClient } from '@/lib/supabase/server'
import {
  NOMBRE_BLOQUE,
  SEVERIDAD_BANDERA,
  TITULO_BANDERA,
  semaforoDesdeBanderas,
  validarBloques,
  type Auditoria,
  type BloqueCodigo,
} from '@/lib/calidad/motor-auditoria'

export const runtime = 'nodejs'
// 300 s: el presupuesto real de este proyecto (Fluid compute activo). Si no se
// declara, la funcion hereda el default y puede cortar antes.
export const maxDuration = 300

/** Rotulo del lote: distingue lo auditado en vivo de lo sembrado. */
const LOTE_MOTOR = 'auditada-en-vivo'

function segundos(momento?: string): number {
  if (!momento) return 0
  const p = momento.split(':').map((n) => Number(n) || 0)
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2]
  if (p.length === 2) return p[0] * 60 + p[1]
  return 0
}

export async function POST(req: NextRequest) {
  const { role, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId || !role) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  if (!getRolePermissions(role).canViewCalidadTodos) {
    return NextResponse.json({ error: 'Sin permiso para auditar llamadas' }, { status: 403 })
  }

  const cuerpo = (await req.json()) as {
    auditoria?: Auditoria
    agenteNombre?: string
    nombreArchivo?: string
    duracionSeg?: number
  }
  const a = cuerpo.auditoria
  if (!a?.tecnica?.bloques?.length) {
    return NextResponse.json({ error: 'Falta la auditoría.' }, { status: 400 })
  }

  try {
    validarBloques(a.tecnica.bloques)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Bloques inválidos' },
      { status: 422 },
    )
  }

  // Los totales se recalculan: el numero guardado tiene que ser la suma de sus
  // partes, venga como venga en el payload.
  const bloques = a.tecnica.bloques.map((b) => ({
    ...b,
    puntaje: b.items?.length ? b.items.reduce((s, i) => s + (i.puntaje ?? 0), 0) : b.puntaje,
  }))
  const puntajeTecnico = bloques.reduce((s, b) => s + b.puntaje, 0)

  const presentes = (a.cumplimiento?.banderas ?? []).filter((b) => b.presente)
  const codigosRaros = presentes.filter((b) => !SEVERIDAD_BANDERA[b.codigo])
  if (codigosRaros.length > 0) {
    return NextResponse.json(
      { error: `Banderas no reconocidas: ${codigosRaros.map((b) => b.codigo).join(', ')}` },
      { status: 422 },
    )
  }
  const { semaforo } = semaforoDesdeBanderas(a.cumplimiento?.banderas ?? [])

  const svc = createServiceClient()
  const conv = a.conversacion ?? {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fila, error: eLl } = await (svc as any)
    .from('calidad_llamadas')
    .insert({
      workspace_id: workspaceId,
      cliente_ref: `AUD-${Date.now().toString(36).toUpperCase()}`,
      fecha_hora: new Date().toISOString(),
      direccion: 'entrante',
      duracion_seg: Math.round(cuerpo.duracionSeg ?? Number(conv.duracion_seg ?? 0)),
      agente_staff_id: staffId ?? null,
      agente_nombre: cuerpo.agenteNombre?.trim() || 'Sin identificar',
      puntaje_tecnico: puntajeTecnico,
      semaforo,
      habla_agente_pct: conv.habla_agente_pct ?? null,
      habla_cliente_pct: conv.habla_cliente_pct ?? null,
      turnos: conv.turnos ?? null,
      repreguntas: conv.repreguntas_agente ?? null,
      monologos_45s: conv.monologos_45s ?? null,
      detalle_completo: true,
      es_real: true,
      lote: LOTE_MOTOR,
      cerro_venta: false,
    })
    .select('id')
    .single()

  if (eLl || !fila) {
    return NextResponse.json({ error: `No se pudo guardar: ${eLl?.message}` }, { status: 500 })
  }
  const llamadaId = (fila as { id: string }).id

  const filasBloques = bloques.map((b, i) => ({
    workspace_id: workspaceId,
    llamada_id: llamadaId,
    orden: i + 1,
    // El nombre sale de la rubrica, no de como lo titule el modelo.
    nombre: NOMBRE_BLOQUE[b.codigo as BloqueCodigo],
    puntaje: b.puntaje,
    puntaje_max: b.maximo,
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: eB } = await (svc as any).from('calidad_llamadas_bloques').insert(filasBloques)
  if (eB) return NextResponse.json({ error: `Bloques: ${eB.message}` }, { status: 500 })

  if (presentes.length > 0) {
    const filasHallazgos = presentes.map((b) => ({
      workspace_id: workspaceId,
      llamada_id: llamadaId,
      eje: 'cumplimiento',
      codigo: b.codigo,
      // Severidad y titulo de la rubrica: estables entre corridas y legibles.
      severidad: SEVERIDAD_BANDERA[b.codigo],
      titulo: TITULO_BANDERA[b.codigo],
      hecho: b.cita ? `En ${b.momento ?? 'la llamada'}: ${b.cita}` : (b.motivo ?? null),
      cita: b.cita ?? null,
      segundo: segundos(b.momento),
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: eH } = await (svc as any)
      .from('calidad_llamadas_hallazgos')
      .insert(filasHallazgos)
    if (eH) return NextResponse.json({ error: `Hallazgos: ${eH.message}` }, { status: 500 })
  }

  return NextResponse.json({
    id: llamadaId,
    puntajeTecnico,
    semaforo,
    banderas: presentes.length,
  })
}
