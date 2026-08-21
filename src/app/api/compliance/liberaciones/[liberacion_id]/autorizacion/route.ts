import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/supabase/auth-user';
import {
  generarPDFAutorizacion,
  type AutorizacionData,
  type EstadoAutorizacion,
} from '@/lib/compliance/pdf-autorizacion-contratacion';
import {
  coberturaDeContraparte,
  puedeLiberarContrapartes,
  type ComplianceLiberacion,
} from '@/lib/compliance/liberaciones';
import { todayBogotaISO } from '@/lib/dates/bogota';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Sirve la autorización de contratación (PDF) de una liberación registrada.
 *
 * Se genera 100% desde ONE con datos ya guardados; NO golpea Informa ni Valida
 * (esas consultas son facturables contra la cuenta del cliente). Mismo patrón que
 * `api/compliance/listas/soporte/[consulta_id]`.
 *
 * El estado se RECALCULA al emitir, no se lee de la fila: entre la decisión y la
 * descarga la vigencia pudo vencer o el oficial pudo revocarla, y un PDF que
 * dice "autorizado" cuando ya no lo está es peor que no tenerlo.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ liberacion_id: string }> },
) {
  const { liberacion_id } = await params;

  const { user } = await getCachedUser();
  if (!user) {
    return Response.json({ error: 'no_auth' }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data: profile } = await svc
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single();

  if (!profile?.workspace_id) {
    return Response.json({ error: 'workspace_no_encontrado' }, { status: 404 });
  }

  // La pantalla de liberación es SOLO del oficial y este documento también: lo
  // que viaja al resto de la organización es el archivo, que él comparte. Dar
  // acceso a la ruta a todo el workspace sería publicar quién quedó reportado.
  if (!puedeLiberarContrapartes(profile.role)) {
    return Response.json({ error: 'permiso_denegado' }, { status: 403 });
  }

  const { data: ws } = await svc
    .from('workspaces')
    .select('name, slug, modules')
    .eq('id', profile.workspace_id)
    .single();

  const modules = (ws?.modules as Record<string, boolean>) ?? {};
  if (!modules.compliance_dual_informa) {
    return Response.json({ error: 'modulo_no_activo' }, { status: 403 });
  }

  // Filtra por workspace_id => un workspace no puede leer la autorización de otro.
  const { data: lib } = await svc
    .from('compliance_liberaciones')
    .select(
      'id, consulta_id, documento_tipo, documento_numero, nombre, decision, justificacion, vigente_desde, vigente_hasta, control_id, liberada_por, created_at',
    )
    .eq('id', liberacion_id)
    .eq('workspace_id', profile.workspace_id)
    .maybeSingle();

  if (!lib) {
    return Response.json({ error: 'liberacion_no_encontrada' }, { status: 404 });
  }

  if (lib.decision !== 'liberada') {
    // Un rechazo no autoriza nada. Emitir un documento con este membrete sobre
    // una decisión negativa invitaría a usarlo como si autorizara.
    return Response.json(
      { error: 'decision_no_autoriza (esta contraparte fue rechazada, no liberada)' },
      { status: 400 },
    );
  }

  // Estado al momento de imprimir: hace falta toda la bitácora de la contraparte,
  // porque una decisión posterior deja esta sin efecto.
  const { data: bitacora } = await svc
    .from('compliance_liberaciones')
    .select(
      'id, consulta_id, documento_tipo, documento_numero, nombre, decision, justificacion, vigente_desde, vigente_hasta, control_id, liberada_por, created_at',
    )
    .eq('workspace_id', profile.workspace_id)
    .eq('documento_tipo', lib.documento_tipo)
    .eq('documento_numero', lib.documento_numero);

  const cobertura = coberturaDeContraparte(
    (bitacora ?? []) as ComplianceLiberacion[],
    todayBogotaISO(),
  );
  const estado: EstadoAutorizacion =
    cobertura.liberacion?.id !== lib.id ? 'superada' : cobertura.cubierta ? 'vigente' : 'vencida';

  const { data: consulta } = await svc
    .from('consultas_listas_dual')
    .select('id, total_matches, matches, created_at')
    .eq('id', lib.consulta_id)
    .eq('workspace_id', profile.workspace_id)
    .maybeSingle();

  let firmante: string | null = null;
  if (lib.liberada_por) {
    const { data: p } = await svc
      .from('profiles')
      .select('full_name')
      .eq('id', lib.liberada_por)
      .maybeSingle();
    firmante = p?.full_name ?? null;
  }

  let controlReferencia: string | null = null;
  let controlNombre: string | null = null;
  if (lib.control_id) {
    const { data: ctl } = await svc
      .from('riesgos_controles')
      .select('referencia, nombre_control')
      .eq('id', lib.control_id)
      .eq('workspace_id', profile.workspace_id)
      .maybeSingle();
    controlReferencia = ctl?.referencia ?? null;
    controlNombre = ctl?.nombre_control ?? null;
  }

  const data: AutorizacionData = {
    workspace_nombre: ws?.name ?? ws?.slug ?? 'Sujeto obligado',
    liberacion_id: lib.id,
    decision: lib.decision,
    estado,
    nombre: lib.nombre ?? null,
    documento_tipo: lib.documento_tipo,
    documento_numero: lib.documento_numero,
    justificacion: lib.justificacion,
    vigente_desde: lib.vigente_desde,
    vigente_hasta: lib.vigente_hasta ?? null,
    created_at: lib.created_at,
    liberada_por_nombre: firmante,
    control_referencia: controlReferencia,
    control_nombre: controlNombre,
    consulta_id: lib.consulta_id,
    // Si la consulta se hubiera borrado, la FK lo habría impedido; el fallback
    // existe para no romper el documento si la lectura falla por otra razón.
    consulta_fecha: consulta?.created_at ?? lib.created_at,
    total_matches: consulta?.total_matches ?? 0,
    matches: Array.isArray(consulta?.matches) ? consulta.matches : [],
  };

  const buf = await generarPDFAutorizacion(data);

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="autorizacion-contratacion-${lib.id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
