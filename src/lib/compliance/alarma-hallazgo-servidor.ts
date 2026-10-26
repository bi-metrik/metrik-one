/**
 * La alarma de hallazgo, con base de datos y correo. Las reglas viven en
 * `alarma-hallazgo.ts`; aquí solo se escriben las filas y se manda el correo.
 *
 * Sin `'use server'` a propósito: reciben `workspaceId` por parámetro y no
 * validan rol, así que no pueden ser endpoints (mismo criterio que
 * `barrido.ts`). Las llama una server action que ya pasó su guard.
 *
 * NUNCA lanzan: la consulta ya se pagó y ya quedó guardada. Un aviso que no sale
 * se registra en el log y no deshace la consulta.
 */

import { correoHallazgos, type AvisoHallazgo } from './correo-hallazgo';
import {
  TIPO_ALARMA_HALLAZGO,
  contenidoAlarmaHallazgo,
  enlaceContraparte,
  grupoClaveHallazgo,
} from './alarma-hallazgo';
import { claveContraparte } from './liberaciones';
import { rotuloTriage } from './bandeja';
import type { TierResuelto } from './tier-fuentes';

const FROM_CORREO = 'MéTRIK ONE <noreply@metrikone.co>';

/** Quien recibe la campana (owner y admin); el correo va solo a la dueña. */
export type Oficial = { id: string; role: string; platform_admin: boolean | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function oficialesDelWorkspace(svc: any, workspaceId: string): Promise<Oficial[]> {
  const { data } = await svc
    .from('profiles')
    .select('id, role, platform_admin')
    .eq('workspace_id', workspaceId)
    .in('role', ['owner', 'admin']);
  return (data ?? []) as Oficial[];
}

export type ConsultaConHallazgo = {
  consulta_id: string;
  nombre: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
  total_matches: number;
  tier_maximo: TierResuelto | null;
  lote_id: string | null;
};

export type AlarmaAbierta = {
  /** false si la contraparte ya tenía su alarma abierta: es el mismo caso. */
  abierta: boolean;
  aviso: AvisoHallazgo;
};

/**
 * Abre la alarma de una consulta con hallazgo: una fila de campana por oficial,
 * todas con la `grupo_clave` de la contraparte.
 *
 * Deduplica por contraparte: si ya hay una alarma pendiente, no crea otra. Tres
 * consultas al mismo proveedor son un solo caso, y la decisión las cierra todas.
 * La consulta por nombre no tiene clave: avisa igual, como aviso normal.
 */
export async function abrirAlarmaHallazgo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  consulta: ConsultaConHallazgo,
): Promise<AlarmaAbierta | null> {
  try {
    const grupo = grupoClaveHallazgo(consulta.documento_tipo, consulta.documento_numero);
    const clave = claveContraparte(consulta.documento_tipo, consulta.documento_numero);
    const aviso: AvisoHallazgo = {
      texto: contenidoAlarmaHallazgo({
        nombre: consulta.nombre,
        documentoTipo: consulta.documento_tipo,
        documentoNumero: consulta.documento_numero,
        totalMatches: consulta.total_matches,
        rotulo: rotuloTriage(consulta.tier_maximo).texto,
      }),
      enlace: enlaceContraparte(clave),
    };

    if (grupo) {
      const { data: abiertas, error: errLeer } = await svc
        .from('notificaciones')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('grupo_clave', grupo)
        .eq('estado', 'pendiente')
        .limit(1);
      // Si no se puede leer, se avisa: un aviso de más se ve; uno de menos no.
      if (errLeer) console.error('[alarma-hallazgo] no se pudo leer la alarma abierta', grupo, errLeer.message);
      else if ((abiertas ?? []).length > 0) return { abierta: false, aviso };
    }

    const oficiales = await oficialesDelWorkspace(svc, workspaceId);
    if (oficiales.length === 0) {
      console.error('[alarma-hallazgo] el workspace no tiene oficial con rol a quien avisar', workspaceId);
      return null;
    }

    const filas = oficiales.map((o) => ({
      workspace_id: workspaceId,
      destinatario_id: o.id,
      tipo: TIPO_ALARMA_HALLAZGO,
      estado: 'pendiente',
      contenido: aviso.texto,
      entidad_tipo: null,
      entidad_id: null,
      deep_link: aviso.enlace,
      grupo_clave: grupo,
      metadata: {
        consulta_id: consulta.consulta_id,
        documento_tipo: consulta.documento_tipo,
        documento_numero: consulta.documento_numero,
        total_matches: consulta.total_matches,
        tier_maximo: consulta.tier_maximo,
        lote_id: consulta.lote_id,
      },
    }));
    const { error } = await svc.from('notificaciones').insert(filas);
    if (error) {
      console.error('[alarma-hallazgo] no se pudo abrir la alarma', grupo, error.message);
      return null;
    }
    return { abierta: true, aviso };
  } catch (e) {
    console.error('[alarma-hallazgo] abrir:', (e as Error).message);
    return null;
  }
}

/**
 * El correo a la dueña del workspace (`role = 'owner'`), que es la oficial.
 * Devuelve a cuántas direcciones salió.
 *
 * `excluirProfileId`: quien hizo la consulta ya vio el resultado en pantalla;
 * mandarle a ella misma un correo de lo que acaba de ver es ruido. La campana sí
 * le queda: es su pendiente.
 *
 * ⚠️ Como los demás avisos internos, no deja traza en `avisos_cliente`: un
 * rebote no se ve en ONE.
 */
export async function enviarCorreoHallazgos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  avisos: AvisoHallazgo[],
  opciones: { excluirProfileId?: string | null; tituloLote?: string | null } = {},
): Promise<number> {
  if (avisos.length === 0) return 0;
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.error('[alarma-hallazgo] RESEND_API_KEY no configurada: la campana salió, el correo no');
      return 0;
    }
    const oficiales = await oficialesDelWorkspace(svc, workspaceId);
    const duenas = oficiales.filter(
      (o) => o.role === 'owner' && !o.platform_admin && o.id !== opciones.excluirProfileId,
    );
    if (duenas.length === 0) return 0;

    const { data: ws } = await svc.from('workspaces').select('name, slug').eq('id', workspaceId).maybeSingle();
    if (!ws?.slug) return 0;

    const destinatarios: string[] = [];
    for (const o of duenas) {
      const { data: u } = await svc.auth.admin.getUserById(o.id);
      const email = u?.user?.email as string | undefined;
      if (email) destinatarios.push(email);
    }
    if (destinatarios.length === 0) return 0;

    const { asunto, html } = correoHallazgos({
      avisos,
      workspaceNombre: (ws.name as string | null) ?? (ws.slug as string),
      workspaceSlug: ws.slug as string,
      baseDomain: (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim(),
      tituloLote: opciones.tituloLote ?? null,
    });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_CORREO, to: destinatarios, subject: asunto, html }),
    });
    if (!res.ok) {
      console.error('[alarma-hallazgo] Resend falló:', res.status, await res.text().catch(() => ''));
      return 0;
    }
    return destinatarios.length;
  } catch (e) {
    console.error('[alarma-hallazgo] correo:', (e as Error).message);
    return 0;
  }
}
