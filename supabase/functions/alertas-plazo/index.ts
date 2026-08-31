// ============================================================
// alertas-plazo — el correo que avisa que un plazo se cumplio
//
// QUE RESUELVE:
//   Hay tramites donde el evento importante es que NO pase nada. En SOENA, el
//   cliente radica su devolucion de IVA ante la DIAN y a partir de ahi corren dos
//   relojes: a los 15 dias habiles puede llegar el auto inadmisorio, y a los 50
//   deberia llegar la plata. Nadie los estaba contando.
//
// POR QUE UN CRON Y NO UN TRIGGER:
//   `notificar-etapa` dispara cuando un negocio ENTRA a una etapa. Aqui el negocio
//   no se mueve: justamente lleva semanas quieto. No hay cambio de fila que un
//   trigger pueda escuchar, asi que alguien tiene que preguntar todos los dias.
//
// POR QUE UN RESUMEN Y NO UN CORREO POR CASO:
//   Medido el 2026-08-31: 141 negocios abiertos en Seguimiento. Un correo por caso
//   convierte el aviso en ruido el primer dia que se destape la represa. Va un
//   correo por hito con la lista, y cada caso aparece una sola vez en su vida
//   (`alertas_plazo_log`, UNIQUE por negocio + hito).
//
// AUTENTICACION — por que reusa NOTIFICAR_ETAPA_SECRET:
//   Es el mismo perfil de llamador (un cron interno de este proyecto que manda
//   correo) y el secreto ya vive en el vault Y en las variables de la funcion.
//   Un secreto nuevo obligaria a un paso manual en el dashboard para que esto
//   arranque, y un aviso que no arranca no avisa nada.
//
// Lo dispara el cron `alertas-plazo-diario` (8:00 Bogota) via pg_net.
// ============================================================

import { getServiceClient } from '../_shared/supabase-client.ts';

const FROM = 'MéTRIK ONE <noreply@metrikone.co>';

// Las edge functions no tienen el `Database` generado y sin el supabase-js resuelve
// toda fila como `never`. Mismo `any` acotado que usa `notificar-etapa`: es el
// ESQUEMA, no el cliente, y vive en un solo sitio.
// deno-lint-ignore no-explicit-any
type Supabase = any; // eslint-disable-line @typescript-eslint/no-explicit-any

type Fila = {
  negocio_id: string;
  workspace_id: string;
  codigo: string | null;
  nombre: string;
  etapa: string;
  hito: string;
  hito_titulo: string;
  dias_habiles: number;
  fecha_ancla: string;
  ancla_origen: 'declarada' | 'estimada';
  dias_transcurridos: number;
  festivos_cargados: boolean;
};

type Linea = {
  id: string;
  nombre: string;
  workspace_id: string;
  config_extra: { alertas_plazo?: { areas?: string[] } } | null;
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const expected = Deno.env.get('NOTIFICAR_ETAPA_SECRET');
  if (!expected) return json({ error: 'server_misconfigured', detail: 'NOTIFICAR_ETAPA_SECRET' }, 500);
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ') || auth.slice(7).trim() !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'server_misconfigured', detail: 'RESEND_API_KEY' }, 500);

  // `seco: true` calcula y responde SIN mandar correo ni escribir el log. Es como
  // se verifica en produccion que la cuenta de dias da lo que debe antes de que el
  // primer correo salga a tres personas reales.
  let seco = false;
  try {
    const body = await req.json();
    seco = body?.seco === true;
  } catch { /* sin cuerpo: corrida normal */ }

  const supabase = getServiceClient();

  // Toda linea que declare hitos entra. Ninguna mencion a SOENA en el codigo.
  const { data: lineasRaw, error: errLineas } = await supabase
    .from('lineas_negocio')
    .select('id, nombre, workspace_id, config_extra')
    .not('config_extra->alertas_plazo', 'is', null);

  if (errLineas) {
    console.error('[alertas-plazo] no se pudieron leer las lineas:', errLineas.message);
    return json({ error: 'lineas_ilegibles', detail: errLineas.message }, 500);
  }

  const lineas = (lineasRaw ?? []) as Linea[];
  const reporte: unknown[] = [];

  for (const linea of lineas) {
    const { data: filasRaw, error } = await supabase.rpc('plazos_pendientes', { p_linea_id: linea.id });
    if (error) {
      console.error(`[alertas-plazo] ${linea.nombre}: ${error.message}`);
      reporte.push({ linea: linea.nombre, error: error.message });
      continue;
    }

    const filas = (filasRaw ?? []) as Fila[];
    if (filas.length === 0) {
      reporte.push({ linea: linea.nombre, vencidos: 0 });
      continue;
    }

    const areas = linea.config_extra?.alertas_plazo?.areas ?? [];
    const correos = await correosDeAreas(supabase, linea.workspace_id, areas);
    if (correos.length === 0) {
      // Se reporta en vez de fallar en silencio: un area sin nadie con correo es
      // exactamente el caso que hay que ver, no el que hay que tragarse.
      console.error(`[alertas-plazo] ${linea.nombre}: areas ${areas.join(',')} sin correos`);
      reporte.push({ linea: linea.nombre, vencidos: filas.length, omitido: 'sin_destinatarios' });
      continue;
    }

    const slug = await slugDelWorkspace(supabase, linea.workspace_id);

    // Un correo por hito: "se cumplieron los 15" y "se cumplieron los 50" son dos
    // acciones distintas para operaciones, y mezclarlas obliga a leer para separar.
    const porHito = new Map<string, Fila[]>();
    for (const f of filas) {
      const acc = porHito.get(f.hito) ?? [];
      acc.push(f);
      porHito.set(f.hito, acc);
    }

    for (const [hito, casos] of porHito) {
      const titulo = `${casos[0].hito_titulo} — ${casos.length} ${casos.length === 1 ? 'caso' : 'casos'}`;

      if (seco) {
        reporte.push({ linea: linea.nombre, hito, casos: casos.length, a: correos, seco: true });
        continue;
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: correos, subject: titulo, html: armarHtml(casos, slug) }),
      });

      if (!res.ok) {
        // Sin log: manana vuelve a intentarlo con los mismos casos. Escribir el log
        // antes de que el correo salga es la forma de perder un aviso para siempre.
        const detail = await res.text();
        console.error('[alertas-plazo] Resend fallo:', res.status, detail);
        reporte.push({ linea: linea.nombre, hito, casos: casos.length, error: `resend_${res.status}` });
        continue;
      }

      const { error: errLog } = await supabase.from('alertas_plazo_log').insert(
        casos.map((c) => ({
          negocio_id: c.negocio_id,
          workspace_id: c.workspace_id,
          hito: c.hito,
          fecha_ancla: c.fecha_ancla,
          ancla_origen: c.ancla_origen,
          dias_habiles: c.dias_habiles,
          destinatarios: correos,
        })),
      );
      if (errLog) console.error('[alertas-plazo] el correo salio pero el log no:', errLog.message);

      reporte.push({ linea: linea.nombre, hito, casos: casos.length, a: correos.length });
    }
  }

  return json({ ok: true, seco, lineas: lineas.length, reporte });
});

/**
 * Los correos del staff activo de unas areas.
 *
 * Se reparte por `staff_areas` y no por una lista de personas escrita a mano: el
 * dia que entre o salga alguien de operaciones, el aviso lo sigue el area sola.
 * `is_active` importa — en SOENA hay dos personas de operaciones inactivas que no
 * pueden volver a recibir nada.
 */
async function correosDeAreas(
  supabase: Supabase,
  workspaceId: string,
  areas: string[],
): Promise<string[]> {
  if (areas.length === 0) return [];

  const { data: staffRows } = await supabase
    .from('staff')
    .select('id, profile_id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .not('profile_id', 'is', null);

  const staff = (staffRows ?? []) as Array<{ id: string; profile_id: string }>;
  if (staff.length === 0) return [];

  const { data: areaRows } = await supabase
    .from('staff_areas')
    .select('staff_id')
    .in('staff_id', staff.map((s) => s.id))
    .in('area', areas);

  const conArea = new Set(((areaRows ?? []) as Array<{ staff_id: string }>).map((a) => a.staff_id));
  const perfiles = [...new Set(staff.filter((s) => conArea.has(s.id)).map((s) => s.profile_id))];

  const correos: string[] = [];
  for (const pid of perfiles) {
    const { data: user } = await supabase.auth.admin.getUserById(pid);
    if (user?.user?.email) correos.push(user.user.email);
  }
  return correos;
}

async function slugDelWorkspace(supabase: Supabase, workspaceId: string): Promise<string> {
  const { data } = await supabase.from('workspaces').select('slug').eq('id', workspaceId).maybeSingle();
  return (data?.slug as string | undefined) ?? '';
}

/**
 * El correo.
 *
 * Cada fila dice de donde salio su reloj. Una fecha "estimada" es una cuenta que
 * arranco de la cita, no de la radicacion: quien la lea tiene que poder distinguirla
 * de un dato que alguien escribio, o va a tratar una aproximacion como un hecho.
 */
function armarHtml(casos: Fila[], slug: string): string {
  const baseDomain = Deno.env.get('BASE_DOMAIN') ?? 'metrikone.co';
  const hayEstimadas = casos.some((c) => c.ancla_origen === 'estimada');
  const sinFestivos = casos.some((c) => !c.festivos_cargados);

  const filas = casos.map((c) => {
    const etiqueta = c.codigo ? `${c.codigo} — ${c.nombre}` : c.nombre;
    const link = `https://${slug}.${baseDomain}/negocios/${c.negocio_id}`;
    const marca = c.ancla_origen === 'estimada'
      ? '<span style="color:#B45309;font-size:11px"> (fecha estimada)</span>'
      : '';
    return `<tr>
      <td style="padding:9px 0;border-bottom:1px solid #F3F4F6;font-size:13px">
        <a href="${link}" style="color:#1A1A1A;text-decoration:none;font-weight:600">${escapar(etiqueta)}</a>
        <div style="color:#6B7280;font-size:12px;margin-top:2px">
          ${escapar(c.etapa)} · desde el ${escapar(c.fecha_ancla)}${marca}
        </div>
      </td>
      <td style="padding:9px 0;border-bottom:1px solid #F3F4F6;text-align:right;font-size:13px;white-space:nowrap;color:#374151">
        ${c.dias_transcurridos} días hábiles
      </td>
    </tr>`;
  }).join('');

  const notaEstimadas = hayEstimadas
    ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#B45309;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:11px 13px">
        Las marcadas como <strong>fecha estimada</strong> cuentan desde la cita en la DIAN más los días
        que suele tardar la radicación, porque nadie escribió la fecha real. Al escribirla en el bloque de
        seguimiento, el conteo se corrige solo.
      </p>`
    : '';

  const notaFestivos = sinFestivos
    ? `<p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#991B1B;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:11px 13px">
        El calendario de festivos de este año no está cargado, así que la cuenta puede ir adelantada.
      </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:#F5F4F2;font-family:Helvetica,Arial,sans-serif;color:#1A1A1A">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">Plazo cumplido</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${escapar(casos[0].hito_titulo)}</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#374151">
      ${casos.length === 1 ? 'Este caso cumplió' : `Estos ${casos.length} casos cumplieron`} el plazo de
      ${casos[0].dias_habiles} días hábiles. Cada uno aparece en este correo una sola vez.
    </p>
    <table style="width:100%;border-collapse:collapse">${filas}</table>
    ${notaEstimadas}
    ${notaFestivos}
    <p style="margin:24px 0 0;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:14px">Enviado por MéTRIK ONE</p>
  </div>
</body></html>`;
}

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
