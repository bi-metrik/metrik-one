import { NextRequest } from 'next/server';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';

const VALIDA_API_BASE = process.env.VALIDA_API_BASE ?? 'https://api.valida.metrikone.co';

// Proxy server-side al endpoint de PDF de Valida. Usa la api_key server-only
// para que el cliente nunca la vea.
//
// ⚠️ Esta ruta trae el reporte SARLAFT de un `consulta_id` con una credencial
// que NO es del usuario. Antes no comprobaba nada: cualquier usuario autenticado
// de CUALQUIER workspace obtenia el reporte de una consulta ajena con solo
// conocer el UUID. La unica barrera era el middleware exigiendo sesion, que no
// mira a quien pertenece la consulta. Misma familia que las dos fugas
// cross-tenant cerradas el 2026-06-02 (`staff_areas` y las 7 vistas).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ consulta_id: string }> },
) {
  const { consulta_id } = await params;
  const apiKey = process.env.VALIDA_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'valida_api_key_missing' }, { status: 500 });
  }

  // 1) Sesion propia, sin depender de que el middleware la exija.
  const { workspaceId, error: wsError } = await getWorkspace();
  if (wsError || !workspaceId) {
    return Response.json({ error: 'no_autenticado' }, { status: 401 });
  }

  // 2) Pertenencia. `valida_consultas.valida_consulta_id` guarda el id que Valida
  //    devuelve, que es exactamente el que llega en la URL (`buildPDFUrl` recibe
  //    `resultado.consulta_id`, el del upstream).
  //
  //    Se consulta con service-role a proposito: la comprobacion es contra el
  //    workspace ya resuelto del usuario, no contra lo que su token alcance.
  const svc = createServiceClient();
  const { data: registro } = await svc
    .from('valida_consultas')
    .select('workspace_id')
    .eq('valida_consulta_id', consulta_id)
    .maybeSingle();

  if (registro && registro.workspace_id !== workspaceId) {
    return Response.json({ error: 'consulta_de_otro_workspace' }, { status: 403 });
  }

  // ⚠️ Limite conocido y deliberado: si NO hay registro, se deja pasar.
  // `/compliance/validacion` (`src/lib/actions/valida.ts`) consulta a Valida y NO
  // persiste nada localmente, asi que sus reportes no tienen fila contra la cual
  // comprobar; exigirla romperia esa pantalla. El hueco que queda es acotado: un
  // id efimero no esta almacenado en ninguna parte, asi que solo lo conoce quien
  // lo genero. Todo lo que SI queda registrado (la superficie `/valida`, que es
  // la enumerable) queda cerrado.
  // Cierre definitivo = que `/compliance/validacion` tambien persista su consulta.

  const upstream = await fetch(`${VALIDA_API_BASE}/api/v1/reporte/${consulta_id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!upstream.ok) {
    return Response.json({ error: 'upstream_error', status: upstream.status }, { status: upstream.status });
  }

  const buffer = await upstream.arrayBuffer();
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="valida-reporte-${consulta_id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
