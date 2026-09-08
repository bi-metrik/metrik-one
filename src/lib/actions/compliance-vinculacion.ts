'use server';

/**
 * Panel del oficial sobre los expedientes de vinculación (CCBF).
 *
 * El expediente NO vive en ONE. Vive en `metrik-valida`, que es donde están la
 * retención de 5 años, el trigger anti-DELETE y la bitácora encadenada por
 * hashes. Estas funciones leen por API en cada carga y no guardan nada: dos
 * copias que difieren valen menos que una sola.
 *
 * Autenticación: el mismo Bearer por workspace que ya usa la consulta de listas
 * (`valida_api_key` en `config_extra`, con el key de entorno como respaldo). No
 * se inventa un canal nuevo.
 *
 * Todo sale del servidor. El navegador nunca ve el api key ni habla con Valida.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/supabase/auth-user';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getWorkspace } from './get-workspace';
import {
  alertasDeExpediente,
  exigeConstanciaSinLectura,
  kitDeExpediente,
  puedeDecidirVinculacion,
  puedeVerVinculacion,
  resumirExpedientes,
  validarMotivoRechazo,
  type Alerta,
  type ExpedienteCampo,
  type ExpedienteDetalle,
  type ExpedienteDoc,
  type ExpedienteFila,
  type ResumenVinculacion,
} from '@/lib/compliance/vinculacion';
import { urlDeSolicitud } from '@/lib/compliance/solicitud-vinculacion';

const VALIDA_API_BASE = process.env.VALIDA_API_BASE ?? 'https://api.valida.metrikone.co';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

type Guard = { workspaceId: string; userId: string | null; role: string | null; apiKey: string };

// ─── Acceso ───────────────────────────────────────────────────────────────

async function apiKeyDelWorkspace(workspaceId: string): Promise<string | null> {
  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (svc.from('workspaces') as any)
    .select('config_extra')
    .eq('id', workspaceId)
    .single();
  const key = (data?.config_extra as Record<string, unknown> | null)?.valida_api_key;
  if (typeof key === 'string' && key.length > 0) return key;
  return process.env.VALIDA_API_KEY ?? null;
}

async function guardVinculacion(): Promise<Result<Guard>> {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  if (!puedeVerVinculacion(role)) return { ok: false, error: 'forbidden_sin_acceso_a_vinculacion' };
  const apiKey = await apiKeyDelWorkspace(workspaceId);
  if (!apiKey) return { ok: false, error: 'valida_api_key_no_configurada' };
  const { user } = await getCachedUser();
  return { ok: true, data: { workspaceId, userId: user?.id ?? null, role: role ?? null, apiKey } };
}

// ─── Llamada ──────────────────────────────────────────────────────────────

/**
 * Un fallo de red no puede leerse como "no hay expedientes". Devuelve error
 * explícito y la pantalla lo muestra, en vez de una lista vacía que se
 * confunde con un workspace sin vinculaciones.
 */
async function pedirAValida<T>(
  apiKey: string,
  ruta: string,
  init?: RequestInit,
): Promise<Result<T>> {
  try {
    const res = await fetch(`${VALIDA_API_BASE}${ruta}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      return { ok: false, error: body.error ?? body.message ?? `http_${res.status}` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: 'valida_no_responde' };
  }
}

// ─── Bandeja ──────────────────────────────────────────────────────────────

export type BandejaVinculacion = {
  expedientes: ExpedienteFila[];
  total: number;
  resumen: ResumenVinculacion;
  puedeDecidir: boolean;
};

export async function listarVinculaciones(
  filtro: { estado?: string; limite?: number } = {},
): Promise<Result<BandejaVinculacion>> {
  const g = await guardVinculacion();
  if (!g.ok) return g;

  const params = new URLSearchParams();
  if (filtro.estado) params.set('estado', filtro.estado);
  params.set('limite', String(Math.min(Math.max(filtro.limite ?? 100, 1), 200)));

  const r = await pedirAValida<{ total: number; expedientes: ExpedienteFila[] }>(
    g.data.apiKey,
    `/api/v1/kyc/expedientes?${params.toString()}`,
  );
  if (!r.ok) return r;

  const expedientes = r.data.expedientes ?? [];
  return {
    ok: true,
    data: {
      expedientes,
      total: r.data.total ?? expedientes.length,
      resumen: resumirExpedientes(expedientes),
      puedeDecidir: puedeDecidirVinculacion(g.data.role),
    },
  };
}

// ─── Detalle ──────────────────────────────────────────────────────────────

export type DetalleVinculacion = {
  expediente: ExpedienteDetalle;
  documentos: ExpedienteDoc[];
  campos: ExpedienteCampo[];
  kit: string[];
  alertas: Alerta[];
  puedeDecidir: boolean;
};

export async function detalleVinculacion(
  expedienteId: string,
): Promise<Result<DetalleVinculacion>> {
  const g = await guardVinculacion();
  if (!g.ok) return g;

  const base = `/api/v1/kyc/expedientes/${encodeURIComponent(expedienteId)}`;
  const [exp, docs, campos] = await Promise.all([
    pedirAValida<ExpedienteDetalle>(g.data.apiKey, base),
    pedirAValida<{ documentos: ExpedienteDoc[] }>(g.data.apiKey, `${base}/docs`),
    pedirAValida<{ campos: ExpedienteCampo[] }>(g.data.apiKey, `${base}/campos`),
  ]);

  if (!exp.ok) return exp;
  // Documentos y campos que no cargan NO se sustituyen por listas vacías: el
  // oficial estaría decidiendo sobre un expediente que se ve incompleto sin
  // serlo. La pantalla muestra el error y no ofrece el botón.
  if (!docs.ok) return docs;
  if (!campos.ok) return campos;

  const documentos = docs.data.documentos ?? [];
  const listaCampos = campos.data.campos ?? [];
  const kit = [...kitDeExpediente(exp.data.sector, exp.data.tipo_sujeto)];

  return {
    ok: true,
    data: {
      expediente: exp.data,
      documentos,
      campos: listaCampos,
      kit,
      alertas: alertasDeExpediente(documentos, listaCampos, kit),
      puedeDecidir: puedeDecidirVinculacion(g.data.role),
    },
  };
}

// ─── La decisión ──────────────────────────────────────────────────────────

export async function decidirVinculacion(input: {
  expedienteId: string;
  decision: 'aprobado' | 'rechazado';
  motivo?: string;
  sinLectura?: boolean;
}): Promise<Result<{ estado: string }>> {
  const g = await guardVinculacion();
  if (!g.ok) return g;
  if (!puedeDecidirVinculacion(g.data.role)) {
    return { ok: false, error: 'forbidden_sin_permiso_para_decidir' };
  }
  if (input.decision !== 'aprobado' && input.decision !== 'rechazado') {
    return { ok: false, error: 'decision_invalida' };
  }

  const motivo = (input.motivo ?? '').trim();
  if (input.decision === 'rechazado') {
    const err = validarMotivoRechazo(motivo);
    if (err) return { ok: false, error: err };
  }

  // La constancia se exige acá, no en la pantalla. Una casilla que solo vive en
  // el navegador no es un control: se salta con una llamada directa a la acción,
  // y lo que queda en el expediente es una aprobación limpia de un expediente
  // que no lo estaba. Se recalculan las alertas contra Valida en este momento
  // porque entre que el oficial abrió la pantalla y decidió pudo entrar un
  // documento o terminar una lectura.
  let sinLectura = false;
  if (input.decision === 'aprobado') {
    const det = await detalleVinculacion(input.expedienteId);
    if (!det.ok) return { ok: false, error: det.error };
    if (exigeConstanciaSinLectura(det.data.alertas)) {
      if (input.sinLectura !== true) return { ok: false, error: 'falta_constancia_sin_lectura' };
      sinLectura = true;
    }
  }

  const r = await pedirAValida<{ estado: string }>(
    g.data.apiKey,
    `/api/v1/kyc/expedientes/${encodeURIComponent(input.expedienteId)}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({
        decision: input.decision,
        motivo: motivo.length > 0 ? motivo : null,
        // Queda en la bitácora de Valida quién decidió. Sin esto el expediente
        // diría que decidió "el oficial" sin nombre, que ante un auditor es lo
        // mismo que no decir nada.
        oc_revisor_id: g.data.userId,
        // Queda en el expediente que se aprobó sin que la plataforma lo
        // respaldara. Es el dato que separa, en una auditoría, al que revisó
        // por fuera del que aprobó sin mirar.
        sin_lectura: sinLectura,
      }),
    },
  );
  if (!r.ok) return { ok: false, error: await traducirErrorVinculacion(r.error) };

  revalidatePath('/compliance/vinculacion');
  revalidatePath(`/compliance/vinculacion/${input.expedienteId}`);
  return { ok: true, data: { estado: r.data.estado } };
}

// ─── Mensajes ─────────────────────────────────────────────────────────────

export async function traducirErrorVinculacion(error: string): Promise<string> {
  switch (error) {
    case 'valida_api_key_no_configurada':
      return 'Este espacio de trabajo todavía no tiene llave de Valida configurada.';
    case 'valida_no_responde':
      return 'No se pudo hablar con Valida. Vuelve a intentar en un momento.';
    case 'forbidden_sin_acceso_a_vinculacion':
    case 'falta_constancia_sin_lectura':
      return 'Este expediente está incompleto. Marca la constancia para aprobarlo así.';
    case 'forbidden_sin_permiso_para_decidir':
      return 'Esta pantalla es del oficial de cumplimiento.';
    case 'invalid_api_key':
      return 'La llave de Valida de este espacio de trabajo no es válida.';
    case 'not_found':
      return 'Ese expediente no existe o no es de este espacio de trabajo.';
    case 'estado_invalido':
      return 'El expediente ya no está por revisar: alguien más lo decidió mientras lo mirabas.';
    default:
      return error;
  }
}

// ─── El enlace público de solicitud ───────────────────────────────────────

/**
 * El enlace que la empresa comparte para que un proveedor pida vincularse.
 *
 * No se "genera": se pide y ya está. Valida lo crea perezosamente la primera
 * vez. Un enlace que hay que generar es un enlace que la mitad de los clientes
 * nunca va a tener, y entonces la única vía sigue siendo crear expedientes uno
 * por uno, que es justo lo que esto viene a evitar.
 *
 * El host lo pone ONE, que es quien sabe bajo qué subdominio está atendiendo.
 * Valida solo devuelve el camino.
 */
export type EnlaceSolicitud = {
  url: string;
  activa: boolean;
  rotadoEn: string | null;
};

type RespuestaEnlace = { token: string; activa: boolean; rotado_en: string | null; ruta: string };

/**
 * El origen desde el que se está sirviendo la petición. En producción el
 * subdominio del tenant llega en `x-forwarded-host`; en local no hay proxy y
 * queda `host` con http.
 */
async function origenActual(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function enlaceDeSolicitud(): Promise<Result<EnlaceSolicitud>> {
  const g = await guardVinculacion();
  if (!g.ok) return g;

  const r = await pedirAValida<RespuestaEnlace>(g.data.apiKey, '/api/v1/kyc/solicitud-enlace');
  if (!r.ok) return { ok: false, error: await traducirErrorVinculacion(r.error) };

  return {
    ok: true,
    data: {
      url: urlDeSolicitud(await origenActual(), r.data.ruta),
      activa: r.data.activa,
      rotadoEn: r.data.rotado_en,
    },
  };
}

/**
 * Cambiar el enlace. Es la salida cuando se filtró: el anterior deja de servir
 * de inmediato. Los expedientes ya creados no se tocan, cada uno tiene su
 * propio token.
 *
 * Solo quien puede decidir puede rotar. Rotar sin avisar deja sin puerta a todo
 * el que tenga el enlace viejo pegado en un correo, y esa consecuencia no es de
 * quien solo mira la bandeja.
 */
export async function rotarEnlaceDeSolicitud(): Promise<Result<EnlaceSolicitud>> {
  const g = await guardVinculacion();
  if (!g.ok) return g;
  if (!puedeDecidirVinculacion(g.data.role)) {
    return { ok: false, error: await traducirErrorVinculacion('forbidden_sin_permiso_para_decidir') };
  }

  const r = await pedirAValida<RespuestaEnlace>(g.data.apiKey, '/api/v1/kyc/solicitud-enlace/rotar', {
    method: 'POST',
  });
  if (!r.ok) return { ok: false, error: await traducirErrorVinculacion(r.error) };

  revalidatePath('/compliance/vinculacion');
  return {
    ok: true,
    data: {
      url: urlDeSolicitud(await origenActual(), r.data.ruta),
      activa: r.data.activa,
      rotadoEn: r.data.rotado_en,
    },
  };
}
