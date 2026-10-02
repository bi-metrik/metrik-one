// Edge function `solicitud-texto` — la solicitud de viaje sin formulario.
//
// La web pega o escribe lo que contó el cliente y esto lo entiende con el MISMO motor del bot de
// WhatsApp (`_shared/wa-entendimiento.ts`), que vive solo en Deno: copiarlo a `src/` sería un
// segundo motor. Diseño: `proyectos/trappvel/clarity/docs/diseno/noor-solicitud-sin-formulario-2026-10-02.md`.
//
// Quién la llama: las server actions `entenderSolicitud` / `cargarSolicitud` / `descartarSolicitud`
// (`src/app/(app)/negocios/solicitud-texto-actions.ts`) con el JWT de QUIEN está en pantalla.
// Se despliega CON verificación de JWT (el default): el gateway rechaza una llamada sin sesión, y
// aquí se vuelve a validar el usuario y se lee su perfil. El workspace sale de su perfil (la misma
// fila que manda en el RLS), nunca del cuerpo de la petición.
//
// Operaciones (POST JSON):
//   · { op: 'entender', texto, quien: 'cliente' | 'notas', negocio_id?, contacto_id? }
//   · { op: 'cargar', entendimiento_id, quitar?, contacto?, negocio? }
//   · { op: 'descartar', entendimiento_id }
//
// Detrás del mismo módulo que el bot: sin `modules.bandeja_solicitudes_wa`, 403.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { bandejaActiva } from '../_shared/wa-bandeja-reglas.ts';
import { cargarTexto, descartarTexto, entenderTexto, type Contexto } from '../_shared/solicitud-texto.ts';
import type { SupabaseClient } from '../_shared/types.ts';

/** Quien puede cargar una solicitud: los mismos roles que trabajan negocios (no lectura ni contador). */
const ROLES = new Set(['owner', 'admin', 'supervisor', 'operator']);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function contexto(req: Request, svc: SupabaseClient): Promise<Contexto | Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ ok: false, error: 'no_autenticado', mensaje: 'Sin sesión.' }, 401);
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: u, error } = await anon.auth.getUser(token);
  if (error || !u?.user) return json({ ok: false, error: 'no_autenticado', mensaje: 'Sesión vencida.' }, 401);

  const { data: perfil } = await svc.from('profiles').select('workspace_id, role').eq('id', u.user.id).maybeSingle();
  const workspaceId = (perfil?.workspace_id as string | null) ?? null;
  if (!workspaceId) return json({ ok: false, error: 'sin_workspace', mensaje: 'Sin espacio de trabajo.' }, 403);
  if (!ROLES.has(String(perfil?.role ?? ''))) return json({ ok: false, error: 'sin_permiso', mensaje: 'Tu rol no carga solicitudes.' }, 403);

  const { data: ws } = await svc.from('workspaces').select('modules').eq('id', workspaceId).maybeSingle();
  if (!bandejaActiva((ws?.modules ?? null) as Record<string, unknown> | null)) {
    return json({ ok: false, error: 'sin_modulo', mensaje: 'Este espacio no tiene la solicitud por texto.' }, 403);
  }
  const { data: st } = await svc.from('staff').select('id').eq('profile_id', u.user.id).eq('workspace_id', workspaceId).maybeSingle();
  return { workspaceId, staffId: (st?.id as string | null) ?? null };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'metodo', mensaje: 'Solo POST.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'cuerpo', mensaje: 'JSON inválido.' }, 400);
  }

  const svc = getServiceClient() as unknown as SupabaseClient;
  const ctx = await contexto(req, svc);
  if (ctx instanceof Response) return ctx;

  try {
    switch (body.op) {
      case 'entender': {
        const quien = body.quien === 'notas' ? 'notas' : body.quien === 'cliente' ? 'cliente' : null;
        if (!quien || typeof body.texto !== 'string') return json({ ok: false, error: 'cuerpo', mensaje: 'Faltan el texto o quién lo escribió.' }, 400);
        return json(await entenderTexto(svc, ctx, {
          texto: body.texto, quien,
          negocioId: typeof body.negocio_id === 'string' ? body.negocio_id : null,
          contactoId: typeof body.contacto_id === 'string' ? body.contacto_id : null,
        }));
      }
      case 'cargar': {
        if (typeof body.entendimiento_id !== 'string') return json({ ok: false, error: 'cuerpo', mensaje: 'Falta el entendimiento.' }, 400);
        return json(await cargarTexto(svc, ctx, {
          entendimientoId: body.entendimiento_id,
          quitar: Array.isArray(body.quitar) ? body.quitar.filter((x): x is string => typeof x === 'string') : [],
          contacto: (body.contacto ?? null) as Parameters<typeof cargarTexto>[2]['contacto'],
          negocio: (body.negocio ?? null) as Parameters<typeof cargarTexto>[2]['negocio'],
        }));
      }
      case 'descartar': {
        if (typeof body.entendimiento_id !== 'string') return json({ ok: false, error: 'cuerpo', mensaje: 'Falta el entendimiento.' }, 400);
        return json(await descartarTexto(svc, ctx, { entendimientoId: body.entendimiento_id }));
      }
      default:
        return json({ ok: false, error: 'op', mensaje: 'Operación desconocida.' }, 400);
    }
  } catch (err) {
    console.error('[solicitud-texto] error inesperado:', err);
    return json({ ok: false, error: 'base', mensaje: 'Algo falló. Tu texto sigue aquí: inténtalo otra vez.' }, 500);
  }
});
