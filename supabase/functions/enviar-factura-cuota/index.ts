// Edge function — manda la factura de una cuota: aviso en la campana + correo con PDF y XML.
//
// Decisión de Mauricio (2026-10-28): sale SIEMPRE, sin importar cómo se registró la factura. Por eso
// no la llama la server action sino la base:
//
//   · `trg_encolar_envio_factura_cuota` (AFTER INSERT OR UPDATE OF numero, pdf_sha256, xml_sha256 en
//     `facturas_cuota`) encola una fila en `envios_factura_cuota` y llama aquí por pg_net con
//     `{envio_id}` y el secreto de `notificar-etapa` (NOTIFICAR_ETAPA_SECRET).
//   · El job `enviar-factura-cuota-reintentos` (pg_cron, cada 10 min) vuelve a llamar por las filas
//     pendientes o fallidas (menos de 3 intentos).
//
// Las decisiones viven en `_shared/enviar-factura-cuota-flujo.ts` (probado con vitest). Aquí solo se
// lee y se escribe: la base, Storage (`documentos-servicio`) y Resend.
//
// Secretos: NOTIFICAR_ETAPA_SECRET, RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (los
// mismos de `notificar-etapa` y `avisar-asignacion`).

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  ENLACE_PAGOS,
  TIPO_AVISO_FACTURA,
  contenidoAvisoFactura,
  grupoClaveFactura,
  planAvisoFactura,
  type PendientePrevio,
} from '../_shared/aviso-factura-cuota.ts';
import { nombreServicio } from '../_shared/correo-factura-cuota.ts';
import { CORREO_MAURICIO, enviarCorreoInterno, htmlDeTexto } from '../_shared/correo-interno.ts';
import { idDeRespuestaResend, registrarAvisoEquipo } from '../_shared/aviso-equipo.ts';
import {
  CANDADO_MS,
  MAX_INTENTOS,
  base64DeBytes,
  procesarEnvio,
  textoAvisoEquipoFalla,
  type ContratoEnvio,
  type EnvioFila,
  type PuertosEnvio,
} from '../_shared/enviar-factura-cuota-flujo.ts';

// Sin el `Database` generado (ver `notificar-etapa`): el `any` es el ESQUEMA, no el cliente.
// deno-lint-ignore no-explicit-any
type Supabase = SupabaseClient<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const BUCKET = 'documentos-servicio';

const COLUMNAS_ENVIO =
  'id, workspace_id, factura_cuota_id, plan_cobro_cuota_id, numero, pdf_sha256, xml_sha256, estado, intentos, aviso_campana_at, correo_enviado_at, created_at';

function json(cuerpo: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
}

function puertos(svc: Supabase, resendKey: string): PuertosEnvio {
  const ahora = () => new Date().toISOString();
  // El plan (ancla) de la cuota se lee una vez por llamada.
  const anclas = new Map<string, { negocio_id: string | null; suscripcion_id: string | null }>();

  async function anclaDe(envio: EnvioFila) {
    const ya = anclas.get(envio.id);
    if (ya) return ya;
    const { data: cuota, error } = await svc.from('plan_cobro_cuotas')
      .select('plan_cobro_id').eq('id', envio.plan_cobro_cuota_id).maybeSingle();
    if (error || !cuota) throw new Error(`no se pudo leer la cuota: ${error?.message ?? 'no existe'}`);
    const { data: plan, error: ep } = await svc.from('planes_cobro')
      .select('negocio_id, suscripcion_id').eq('id', cuota.plan_cobro_id).maybeSingle();
    if (ep || !plan) throw new Error(`no se pudo leer el plan: ${ep?.message ?? 'no existe'}`);
    const a = { negocio_id: plan.negocio_id ?? null, suscripcion_id: plan.suscripcion_id ?? null };
    anclas.set(envio.id, a);
    return a;
  }

  return {
    ahora,

    async tomar(envioId) {
      const vence = new Date(Date.now() - CANDADO_MS).toISOString();
      const { data, error } = await svc.from('envios_factura_cuota')
        .update({ tomado_at: ahora() })
        .eq('id', envioId)
        .in('estado', ['pendiente', 'fallido'])
        .is('correo_enviado_at', null)
        .lt('intentos', MAX_INTENTOS)
        .or(`tomado_at.is.null,tomado_at.lt.${vence}`)
        .select(COLUMNAS_ENVIO)
        .maybeSingle();
      if (error) throw new Error(`no se pudo tomar el envío: ${error.message}`);
      return (data as EnvioFila | null) ?? null;
    },

    async contexto(envio) {
      const { data: factura, error: ef } = await svc.from('facturas_cuota')
        .select('numero, pdf_path, pdf_sha256, xml_path, xml_sha256').eq('id', envio.factura_cuota_id).maybeSingle();
      if (ef) throw new Error(`no se pudo leer la factura: ${ef.message}`);
      const vigente = !!factura && factura.numero === envio.numero &&
        (factura.pdf_sha256 ?? null) === envio.pdf_sha256 && (factura.xml_sha256 ?? null) === envio.xml_sha256;

      const { data: cuota, error: ec } = await svc.from('plan_cobro_cuotas')
        .select('numero, monto, plan_cobro_id').eq('id', envio.plan_cobro_cuota_id).maybeSingle();
      if (ec || !cuota) throw new Error(`no se pudo leer la cuota: ${ec?.message ?? 'no existe'}`);
      const { count, error: en } = await svc.from('plan_cobro_cuotas')
        .select('id', { count: 'exact', head: true }).eq('plan_cobro_id', cuota.plan_cobro_id);
      if (en) throw new Error(`no se pudo contar las cuotas: ${en.message}`);

      const ancla = await anclaDe(envio);
      // El ancla del plan: un negocio o (desde 20261016) una suscripción.
      const filtro = ancla.negocio_id
        ? { columna: 'negocio_id', valor: ancla.negocio_id }
        : ancla.suscripcion_id
          ? { columna: 'suscripcion_id', valor: ancla.suscripcion_id }
          : null;
      let contratos: ContratoEnvio[] = [];
      if (filtro) {
        const { data, error } = await svc.from('servicios_contratados')
          .select('id, estado, vigente_desde, workspace_pagador_id, aceptante_designado_id, servicio_slug')
          .eq(filtro.columna, filtro.valor)
          .eq('workspace_id', envio.workspace_id);
        if (error) throw new Error(`no se pudo leer el contrato: ${error.message}`);
        contratos = (data ?? []) as ContratoEnvio[];
      }

      return {
        vigente,
        pdfPath: factura?.pdf_path ?? null,
        xmlPath: factura?.xml_path ?? null,
        cuota: { numero: Number(cuota.numero), monto: Number(cuota.monto) },
        totalCuotas: count ?? Number(cuota.numero),
        contratos,
      };
    },

    async pagador(envio, contrato) {
      const { data: ws } = await svc.from('workspaces').select('slug').eq('id', contrato.workspace_pagador_id).maybeSingle();

      let servicio = nombreServicio(null);
      if (contrato.servicio_slug) {
        const { data: cat } = await svc.from('catalogo_servicios')
          .select('slug, modulo, nombre').eq('slug', contrato.servicio_slug).maybeSingle();
        servicio = nombreServicio(cat ?? { slug: contrato.servicio_slug, modulo: null, nombre: null });
      }

      // La empresa pagadora: la del negocio, o la declarada en la suscripción.
      const ancla = await anclaDe(envio);
      let empresa: { nombre: string | null; correo: string | null } = { nombre: null, correo: null };
      if (ancla.negocio_id) {
        const { data: neg } = await svc.from('negocios').select('empresa_id').eq('id', ancla.negocio_id).maybeSingle();
        if (neg?.empresa_id) {
          const { data: emp } = await svc.from('empresas')
            .select('nombre, razon_social, email_fiscal').eq('id', neg.empresa_id).maybeSingle();
          if (emp) empresa = { nombre: emp.razon_social || emp.nombre || null, correo: emp.email_fiscal ?? null };
        }
      } else if (ancla.suscripcion_id) {
        const { data: sus } = await svc.from('suscripciones_producto')
          .select('razon_social, correo_facturacion').eq('id', ancla.suscripcion_id).maybeSingle();
        if (sus) empresa = { nombre: sus.razon_social ?? null, correo: sus.correo_facturacion ?? null };
      }

      // El email vive en auth.users, no en profiles.
      let correoDesignado: string | null = null;
      if (contrato.aceptante_designado_id) {
        const { data: u } = await svc.auth.admin.getUserById(contrato.aceptante_designado_id);
        correoDesignado = u?.user?.email ?? null;
      }

      return { slug: (ws?.slug as string | undefined) ?? null, servicio, empresa, correoDesignado };
    },

    async previos(envio) {
      const { data, error } = await svc.from('envios_factura_cuota')
        .select('id, numero, estado, aviso_campana_at, correo_enviado_at, created_at')
        .eq('plan_cobro_cuota_id', envio.plan_cobro_cuota_id)
        .neq('id', envio.id)
        .lt('created_at', envio.created_at);
      if (error) throw new Error(`no se pudo leer los envíos anteriores: ${error.message}`);
      return data ?? [];
    },

    async avisarCampana(p) {
      const grupo = grupoClaveFactura(p.cuotaId);
      const { data: pendientes, error } = await svc.from('notificaciones')
        .select('id, destinatario_id')
        .eq('workspace_id', p.workspacePagadorId)
        .eq('grupo_clave', grupo)
        .eq('estado', 'pendiente');
      // Sin saber si ya hay uno pendiente no se crea otro: un aviso duplicado se ve peor que uno tarde.
      if (error) throw new Error(`no se pudo leer el aviso previo: ${error.message}`);
      const plan = planAvisoFactura(p.destinatarios, (pendientes ?? []) as PendientePrevio[]);
      const contenido = contenidoAvisoFactura({
        numeroFactura: p.numeroFactura,
        numeroCuota: p.numeroCuota,
        reemplazo: p.reemplazo,
      });
      const metadata = {
        cuota_id: p.cuotaId,
        numero_cuota: p.numeroCuota,
        numero_factura: p.numeroFactura,
        servicio_contratado_id: p.contratoId,
        via: 'factura_cuota',
      };
      if (plan.actualizar.length > 0) {
        const upd = await svc.from('notificaciones')
          .update({ contenido, metadata, deep_link: ENLACE_PAGOS, updated_at: ahora() })
          .in('id', plan.actualizar)
          .eq('estado', 'pendiente');
        if (upd.error) throw new Error(`no se pudo actualizar el aviso: ${upd.error.message}`);
      }
      if (plan.crear.length > 0) {
        const ins = await svc.from('notificaciones').insert(plan.crear.map((destinatarioId) => ({
          workspace_id: p.workspacePagadorId,
          destinatario_id: destinatarioId,
          tipo: TIPO_AVISO_FACTURA,
          estado: 'pendiente',
          contenido,
          // La cuota y el contrato son del espacio cobrador: no hay entidad del pagador que abrir.
          entidad_tipo: null,
          entidad_id: null,
          deep_link: ENLACE_PAGOS,
          grupo_clave: grupo,
          metadata,
        })));
        if (ins.error) throw new Error(`no se pudo crear el aviso: ${ins.error.message}`);
      }
    },

    async descargarBase64(path) {
      const { data, error } = await svc.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error(`no se pudo descargar ${path}: ${error?.message ?? 'vacío'}`);
      return base64DeBytes(new Uint8Array(await data.arrayBuffer()));
    },

    async enviarCorreo(m) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': m.idempotencyKey,
          },
          body: JSON.stringify({
            from: m.from,
            to: m.to,
            ...(m.cc.length ? { cc: m.cc } : {}),
            bcc: m.bcc,
            reply_to: m.replyTo,
            subject: m.subject,
            html: m.html,
            text: m.text,
            attachments: m.attachments,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) return { ok: true, id: await idDeRespuestaResend(res) };
        const detalle = (await res.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ');
        return { ok: false, error: `resend_${res.status}${detalle ? `: ${detalle}` : ''}` };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    async guardar(envioId, cambios) {
      const { error } = await svc.from('envios_factura_cuota').update(cambios).eq('id', envioId);
      if (error) throw new Error(`no se pudo guardar el envío: ${error.message}`);
    },

    async avisarEquipo(p) {
      const { asunto, texto } = textoAvisoEquipoFalla(p);
      const r = await enviarCorreoInterno(
        { to: CORREO_MAURICIO, subject: asunto, text: texto, html: htmlDeTexto(texto), idempotencyKey: `factura-cuota-falla/${p.envioId}` },
        { llave: resendKey },
      );
      await registrarAvisoEquipo(svc, {
        origen: 'enviar-factura-cuota',
        workspaceId: null,
        estado: r.ok ? 'enviado' : 'fallido',
        destino: CORREO_MAURICIO,
        titulo: asunto,
        motivo: r.ok ? null : r.error,
      });
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const esperado = Deno.env.get('NOTIFICAR_ETAPA_SECRET');
  if (!esperado) return json({ error: 'server_misconfigured', detail: 'NOTIFICAR_ETAPA_SECRET' }, 500);
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ') || auth.slice(7).trim() !== esperado) return json({ error: 'unauthorized' }, 401);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'server_misconfigured', detail: 'RESEND_API_KEY' }, 500);

  let body: { envio_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const envioId = typeof body?.envio_id === 'string' ? body.envio_id : '';
  if (!/^[0-9a-f-]{36}$/i.test(envioId)) return json({ error: 'envio_id requerido' }, 400);

  const svc: Supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const r = await procesarEnvio(envioId, puertos(svc, resendKey));
    if (r.estado === 'fallido') console.error('[enviar-factura-cuota] falló', envioId, r.intentos, r.error);
    else console.log('[enviar-factura-cuota]', envioId, JSON.stringify(r));
    // 200 siempre que la llamada se atendió: el reintento lo decide el job, no pg_net.
    return json({ ok: true, ...r });
  } catch (e) {
    console.error('[enviar-factura-cuota] error al tomar el envío', envioId, (e as Error).message);
    return json({ error: 'db_error' }, 500);
  }
});
