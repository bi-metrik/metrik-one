'use server';

/**
 * Invitar a expediente CCBF en lote, desde la base de sujetos.
 *
 * Es el paso que le sigue al cargue masivo, y es un paso aparte: cargar el
 * archivo no manda nada, invitar le escribe a terceros reales. La pantalla
 * enseña el plan —a quién sí, a quién no y por qué— antes de que salga el
 * primer correo.
 *
 * Permiso: invitar abre expediente y le escribe a nombre de la empresa, así que
 * pide la misma llave que decidir una vinculación, no la de mantener la base.
 * Quien carga proveedores no necesariamente puede escribirles.
 *
 * Las reglas de a quién se le escribe viven en
 * `@/lib/compliance/invitacion-masiva`, sin red y sin base.
 */

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getWorkspace } from './get-workspace';
import { todayBogotaISO } from '@/lib/dates/bogota';
import { puedeDecidirVinculacion } from '@/lib/compliance/vinculacion';
import { invitarContraparte } from './compliance-vinculacion';
import {
  LIMITE_INVITACIONES_LOTE,
  planearInvitacionMasiva,
  tipoPersonaDe,
  type ItemInvitacion,
  type PlanInvitacion,
  type SujetoInvitable,
} from '@/lib/compliance/invitacion-masiva';
import type { RefExpediente } from '@/lib/compliance/vinculacion-sujeto';
import type { TipoDocumento } from '@/lib/compliance/solicitud-vinculacion';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const LIMITE_LECTURA = 5000;

async function guardInvitar(): Promise<Result<{ workspaceId: string }>> {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  if (!puedeDecidirVinculacion(role)) {
    return { ok: false, error: 'forbidden_sin_permiso_para_invitar' };
  }
  return { ok: true, data: { workspaceId } };
}

// ─── El plan ───────────────────────────────────────────────────────────────

export async function previsualizarInvitacionMasiva(): Promise<Result<PlanInvitacion>> {
  const guard = await guardInvitar();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const [sujetosRes, refsRes] = await Promise.all([
    svc
      .from('compliance_sujetos')
      .select('id, tipo, documento_tipo, documento_numero, nombre, correo, relacion_hasta')
      .eq('workspace_id', guard.data.workspaceId)
      .order('nombre')
      .limit(LIMITE_LECTURA),
    svc
      .from('kyc_expediente_ref')
      .select(
        'expediente_kyc_id, razon_social, nombre, documento_tipo, documento_numero, '
        + 'estado_cache, etapa_cache, actualizado_en',
      )
      .eq('workspace_id', guard.data.workspaceId)
      .limit(LIMITE_LECTURA),
  ]);

  if (sujetosRes.error) return { ok: false, error: sujetosRes.error.message };

  const refs = (refsRes.error ? [] : (refsRes.data ?? [])) as RefExpediente[];

  // El espejo se declara vivo solo si trajo algo. Un espejo vacío es
  // indistinguible de un webhook sin configurar, y en ese caso la exclusión
  // "ya tiene expediente" no está corriendo: más vale decirlo que dejar que el
  // oficial confíe en un filtro apagado.
  const espejoVivo = !refsRes.error && refs.length > 0;

  return {
    ok: true,
    data: planearInvitacionMasiva(
      (sujetosRes.data ?? []) as SujetoInvitable[],
      refs,
      todayBogotaISO(),
      espejoVivo,
    ),
  };
}

// ─── El envío ──────────────────────────────────────────────────────────────

export type ResultadoInvitacionMasiva = {
  enviadas: number;
  /** Expediente abierto pero el correo no salió. El oficial tiene que copiar el enlace. */
  sinCorreo: Array<{ nombre: string; url: string }>;
  fallidas: Array<{ nombre: string; error: string }>;
};

/**
 * Manda las invitaciones de los items que el oficial ya vio.
 *
 * Secuencial y no en paralelo: cada invitación abre un expediente y dispara un
 * correo contra un proveedor externo. Doscientas en paralelo es la forma más
 * rápida de que el proveedor de correo nos corte por ráfaga y de que la mitad
 * quede a medio camino sin saber cuál.
 *
 * Re-valida el estado de cada item contra la base antes de escribir. El plan
 * pudo haberse visto hace veinte minutos, y en el intervalo alguien pudo haber
 * cerrado la relación o invitado a ese mismo tercero desde la bandeja.
 */
export async function enviarInvitacionesEnLote(
  items: ItemInvitacion[],
): Promise<Result<ResultadoInvitacionMasiva>> {
  const guard = await guardInvitar();
  if (!guard.ok) return guard;

  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'plan_vacio' };
  if (items.length > LIMITE_INVITACIONES_LOTE) {
    return { ok: false, error: 'lote_muy_grande' };
  }

  const fresco = await previsualizarInvitacionMasiva();
  if (!fresco.ok) return fresco;

  const invitablesAhora = new Map(
    fresco.data.items.filter((i) => i.estado === 'invitable').map((i) => [i.sujeto_id, i] as const),
  );

  const res: ResultadoInvitacionMasiva = { enviadas: 0, sinCorreo: [], fallidas: [] };

  for (const it of items) {
    const vigente = invitablesAhora.get(it.sujeto_id);
    if (!vigente || !vigente.correo) {
      // Dejó de ser invitable entre la vista previa y el botón. No es un fallo:
      // es el plan que envejeció, y decirlo es más útil que escribir de todas
      // formas.
      res.fallidas.push({ nombre: it.nombre, error: 'ya_no_aplica' });
      continue;
    }

    const r = await invitarContraparte({
      tipoSujeto: tipoPersonaDe(vigente.tipo, vigente.documento_tipo),
      denominacion: vigente.nombre,
      tipoDocumento: vigente.documento_tipo as TipoDocumento,
      documento: vigente.documento_numero,
      correo: vigente.correo,
    });

    if (!r.ok) {
      res.fallidas.push({ nombre: vigente.nombre, error: r.error });
      continue;
    }
    if (!r.data.correoSalio) {
      res.sinCorreo.push({ nombre: vigente.nombre, url: r.data.url });
      continue;
    }
    res.enviadas += 1;
  }

  revalidatePath('/compliance/sujetos');
  revalidatePath('/compliance/vinculacion');
  return { ok: true, data: res };
}
