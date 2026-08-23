import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/supabase/auth-user';
import {
  generarPDFCartaResponsabilidades,
  type CartaResponsabilidadesData,
  type ControlEnCarta,
} from '@/lib/compliance/pdf-carta-responsabilidades';
import {
  puedeGestionarResponsables,
  type ComplianceAceptacion,
} from '@/lib/compliance/responsables';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Sirve la carta de asignación de responsabilidades (PDF) de un cargo.
 *
 * Es el documento que el responsable firma SIN necesitar cuenta en ONE: dar
 * cuentas masivamente crea riesgo, porque el módulo expone quién quedó reportado
 * en listas restrictivas. Lo que circula por la organización es este papel, no
 * la pantalla.
 *
 * Se genera 100% desde datos ya guardados; NO golpea Informa ni Valida (esas
 * consultas son facturables contra la cuenta del cliente). Mismo patrón de ruta
 * autenticada y filtrada por workspace que
 * `api/compliance/liberaciones/[liberacion_id]/autorizacion`.
 *
 * La lista de controles se lee AL EMITIR, no se congela: entre una emisión y la
 * siguiente el oficial pudo nominar controles nuevos al cargo, y una carta que
 * omita uno haría firmar menos de lo que se espera.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ cargo_id: string }> },
) {
  const { cargo_id } = await params;

  const { user } = await getCachedUser();
  if (!user) {
    return Response.json({ error: 'no_auth' }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data: profile } = await svc
    .from('profiles')
    .select('workspace_id, role, full_name')
    .eq('id', user.id)
    .single();

  if (!profile?.workspace_id) {
    return Response.json({ error: 'workspace_no_encontrado' }, { status: 404 });
  }

  // La emisión es del oficial. El PDF sí circula por la organización, pero lo
  // reparte él: abrir la ruta a todo el workspace convertiría el catálogo de
  // responsabilidades en algo que cualquiera puede enumerar.
  if (!puedeGestionarResponsables(profile.role)) {
    return Response.json({ error: 'permiso_denegado' }, { status: 403 });
  }

  const { data: ws } = await svc
    .from('workspaces')
    .select('name, slug, modules')
    .eq('id', profile.workspace_id)
    .single();

  const modules = (ws?.modules as Record<string, boolean>) ?? {};
  // El módulo de riesgos y controles es el que habilita esto, no el dual de
  // listas: un workspace puede tener matriz de riesgo sin consultar listas.
  if (!modules.compliance) {
    return Response.json({ error: 'modulo_no_activo' }, { status: 403 });
  }

  // Filtra por workspace_id => un workspace no puede emitir la carta de otro.
  const { data: cargo } = await svc
    .from('compliance_cargos')
    .select('id, nombre')
    .eq('id', cargo_id)
    .eq('workspace_id', profile.workspace_id)
    .maybeSingle();

  if (!cargo) {
    return Response.json({ error: 'cargo_no_encontrado' }, { status: 404 });
  }

  const { data: controles } = await svc
    .from('riesgos_controles')
    .select('referencia, nombre_control, actividad_control, periodicidad, tipo_control, config_extra')
    .eq('workspace_id', profile.workspace_id)
    .eq('cargo_responsable_id', cargo.id)
    .order('referencia', { ascending: true });

  const lista = (controles ?? []) as Array<Record<string, unknown>>;
  if (lista.length === 0) {
    // Una carta sin controles no le pide nada a nadie, y firmarla daría la
    // impresión de que el cargo quedó cubierto.
    return Response.json(
      {
        error:
          'cargo_sin_controles (nomina al menos un control a este cargo antes de emitir su carta)',
      },
      { status: 400 },
    );
  }

  const enCarta: ControlEnCarta[] = lista.map((c) => {
    const extra = (c.config_extra as Record<string, unknown> | null) ?? {};
    return {
      referencia: (c.referencia as string | null) ?? null,
      nombre_control: (c.nombre_control as string | null) ?? null,
      actividad_control: (c.actividad_control as string | null) ?? null,
      periodicidad: (c.periodicidad as string | null) ?? null,
      tipo_control: (c.tipo_control as string | null) ?? null,
      // La matriz todavía no tiene columna de evidencia. Se lee de `config_extra`
      // si el workspace la declaró, y si no, el PDF imprime el criterio genérico
      // en vez de dejar el renglón vacío: un campo en blanco en un documento que
      // alguien firma se lee como "no hay que conservar nada".
      evidencia: typeof extra.evidencia === 'string' ? extra.evidencia : null,
    };
  });

  // Si el cargo ya aceptó, la carta deja de ser una solicitud y pasa a ser la
  // constancia de lo que se firmó. Se toma la MÁS RECIENTE, la misma que decide
  // la cobertura.
  const { data: aceptaciones } = await svc
    .from('compliance_aceptaciones')
    .select('persona_nombre, fecha_aceptacion, created_at')
    .eq('workspace_id', profile.workspace_id)
    .eq('cargo_id', cargo.id)
    .order('created_at', { ascending: false })
    .limit(1);

  const ultima = ((aceptaciones ?? []) as Array<Partial<ComplianceAceptacion>>)[0];

  const data: CartaResponsabilidadesData = {
    workspace_nombre: ws?.name ?? ws?.slug ?? 'Sujeto obligado',
    cargo_id: cargo.id,
    cargo_nombre: cargo.nombre,
    controles: enCarta,
    emitida_por_nombre: profile.full_name ?? null,
    emitida_en: new Date().toISOString(),
    aceptacion_previa: ultima
      ? {
          persona_nombre: ultima.persona_nombre as string,
          fecha_aceptacion: ultima.fecha_aceptacion as string,
        }
      : null,
  };

  const buf = await generarPDFCartaResponsabilidades(data);

  const slug = cargo.nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="carta-responsabilidades-${slug || cargo.id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
