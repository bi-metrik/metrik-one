'use server';

/**
 * Responsable por control + bitácora de aceptación (R2).
 *
 * Cierra el hueco que un auditor abre primero: los controles de la matriz no
 * dicen quién responde por ellos. Aquí se nomina el CARGO, se registra la
 * ACEPTACIÓN de la persona que lo ocupa, y se deriva qué controles quedaron sin
 * cubrir o con la aceptación desactualizada.
 *
 * NINGUNA función de este archivo llama a Informa ni a Valida. Todo sale de la
 * matriz de riesgo ya cargada: cada consulta a la fuente es facturable contra la
 * cuenta del cliente y nominar un responsable no necesita preguntarle a nadie.
 *
 * Genérico y configurable por workspace: no hay una sola condición sobre el slug
 * del tenant. Los cargos son datos del workspace, no una lista en el código.
 */

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/supabase/auth-user';
import { getWorkspace } from './get-workspace';
import { resolverNombresUsuarios } from './_usuarios';
import { todayBogotaISO } from '@/lib/dates/bogota';
import {
  armarSnapshot,
  claveCargo,
  indexarEstadosAceptacion,
  indicadoresResponsables,
  puedeGestionarResponsables,
  validarAceptacion,
  validarCargo,
  type AceptacionConNombres,
  type AceptacionInput,
  type ComplianceAceptacion,
  type ComplianceCargo,
  type ControlParaCobertura,
  type EstadoAceptacionControl,
  type IndicadoresResponsables,
  BUCKET_SOPORTES,
} from '@/lib/compliance/responsables';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const COLUMNAS_ACEPTACION =
  'id, cargo_id, persona_nombre, persona_documento, aceptada_por, registrada_por, medio, soporte_path, fecha_aceptacion, controles_snapshot, created_at';

const COLUMNAS_CONTROL =
  'id, referencia, nombre_control, actividad_control, periodicidad, tipo_control, cargo_responsable_id, responsable_id, updated_at';


/**
 * Techo de filas de bitácora que se leen para calcular cobertura.
 *
 * Se toman las MÁS RECIENTES, que son las que deciden. Si un workspace superara
 * el techo, los cargos que solo aparecen más atrás quedarían fuera del índice y
 * sus controles se mostrarían como "sin aceptación" — el lado conservador: la
 * pantalla pide aceptar de nuevo, nunca da por cubierto a quien no verificó.
 */
const LIMITE_BITACORA = 2000;

// ─── Guards ────────────────────────────────────────────────────────────────

async function guardOficial(): Promise<
  { ok: true; workspaceId: string; userId: string | null } | { ok: false; error: string }
> {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  if (!puedeGestionarResponsables(role)) {
    return { ok: false, error: 'forbidden_solo_oficial_cumplimiento' };
  }

  const { user } = await getCachedUser();
  return { ok: true, workspaceId, userId: user?.id ?? null };
}

// ─── Catálogo de cargos ────────────────────────────────────────────────────

/**
 * Crea un cargo del catálogo.
 *
 * El duplicado se detecta ANTES de mandar el insert, comparando por la clave
 * normalizada (la misma que aplica el índice único de la base). Dejar que
 * reviente la constraint funcionaría igual, pero el mensaje sería un error de
 * Postgres en vez de "ya existe 'Coordinador Compliance'".
 */
export async function crearCargo(input: {
  nombre: string;
  orden?: number | null;
}): Promise<Result<ComplianceCargo>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  const errValidacion = validarCargo(input.nombre);
  if (errValidacion) return { ok: false, error: errValidacion };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // `.eq('workspace_id')` no sobra: el service client bypasea RLS, así que el
  // aislamiento por workspace se pone a mano.
  const { data: existentes, error: errLectura } = await svc
    .from('compliance_cargos')
    .select('id, nombre')
    .eq('workspace_id', guard.workspaceId);
  if (errLectura) return { ok: false, error: errLectura.message };

  const clave = claveCargo(input.nombre);
  const choque = ((existentes ?? []) as Array<{ id: string; nombre: string }>).find(
    (c) => claveCargo(c.nombre) === clave,
  );
  if (choque) {
    return { ok: false, error: `cargo_duplicado (ya existe "${choque.nombre}")` };
  }

  const { data, error } = await svc
    .from('compliance_cargos')
    .insert({
      workspace_id: guard.workspaceId,
      nombre: input.nombre.trim(),
      orden: input.orden ?? (existentes?.length ?? 0),
    })
    .select('id, nombre, activo, orden')
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath('/compliance/responsables');
  return { ok: true, data: data as ComplianceCargo };
}

/**
 * Activa o desactiva un cargo. NO hay borrado, y no es un olvido.
 *
 * Un cargo que ya nominó controles y firmó aceptaciones no se puede hacer
 * desaparecer sin romper la trazabilidad: las FK de la base lo bloquean
 * (`on delete restrict`). Desactivar lo saca del selector y lo deja en la
 * bitácora, que es lo que un auditor espera encontrar.
 */
export async function cambiarEstadoCargo(input: {
  cargo_id: string;
  activo: boolean;
}): Promise<Result<ComplianceCargo>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;
  if (!input.cargo_id?.trim()) return { ok: false, error: 'cargo_requerido' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('compliance_cargos')
    .update({ activo: input.activo })
    .eq('id', input.cargo_id)
    .eq('workspace_id', guard.workspaceId)
    .select('id, nombre, activo, orden')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'cargo_no_encontrado' };
  revalidatePath('/compliance/responsables');
  return { ok: true, data: data as ComplianceCargo };
}

// ─── Nominación ────────────────────────────────────────────────────────────

/**
 * Nomina el cargo responsable de un control y, en la MISMA operación, el usuario
 * de ONE que lo opera.
 *
 * Los dos van juntos a propósito. Son cosas distintas —nominar no es ejecutar—
 * pero separarlas en dos acciones invita al error que el modelo no puede
 * detectar: nominar el cargo, dar por hecho que el operador ya ve el control, y
 * dejarlo invisible para él. El acceso del operador cuelga de `responsable_id`
 * (ver `operadorVeControl`), así que pedir ambos en un solo guardado es la
 * mitigación.
 *
 * `usuario_responsable_id` nulo es un valor válido y frecuente: casi ningún
 * control de esta matriz se ejecuta dentro de ONE.
 */
export async function nominarResponsableControl(input: {
  control_id: string;
  cargo_responsable_id: string | null;
  usuario_responsable_id?: string | null;
}): Promise<Result<{ control_id: string }>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;
  if (!input.control_id?.trim()) return { ok: false, error: 'control_requerido' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const cargoId = input.cargo_responsable_id?.trim() || null;
  if (cargoId) {
    const { data: cargo, error: errCargo } = await svc
      .from('compliance_cargos')
      .select('id, activo')
      .eq('id', cargoId)
      .eq('workspace_id', guard.workspaceId)
      .maybeSingle();
    if (errCargo) return { ok: false, error: errCargo.message };
    if (!cargo) return { ok: false, error: 'cargo_no_encontrado' };
    // Nominar a un cargo desactivado dejaría el control colgando de algo que ya
    // no se ofrece y que nadie va a volver a hacer firmar.
    if (!cargo.activo) return { ok: false, error: 'cargo_inactivo' };
  }

  const usuarioId = input.usuario_responsable_id?.trim() || null;
  if (usuarioId) {
    // El usuario tiene que ser del MISMO workspace: si no, nominarlo le daría
    // acceso a un control ajeno por la vía del filtro del operador.
    const { data: perfil, error: errPerfil } = await svc
      .from('profiles')
      .select('id')
      .eq('id', usuarioId)
      .eq('workspace_id', guard.workspaceId)
      .maybeSingle();
    if (errPerfil) return { ok: false, error: errPerfil.message };
    if (!perfil) return { ok: false, error: 'usuario_no_encontrado_en_el_workspace' };
  }

  const { data, error } = await svc
    .from('riesgos_controles')
    .update({ cargo_responsable_id: cargoId, responsable_id: usuarioId })
    .eq('id', input.control_id)
    .eq('workspace_id', guard.workspaceId)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'control_no_encontrado' };

  // El UPDATE mueve `updated_at` (trigger de la migración 20260822000001), así
  // que la aceptación que cubría este control queda desactualizada sola. Es el
  // efecto buscado: cambiar de responsable exige volver a hacer aceptar.
  revalidatePath('/compliance/responsables');
  revalidatePath('/controles');
  return { ok: true, data: { control_id: data.id as string } };
}

// ─── Aceptación ────────────────────────────────────────────────────────────

/**
 * Registra la aceptación de un cargo sobre TODOS sus controles vigentes.
 *
 * Es la única vía de escritura de la bitácora: no hay actualizar ni borrar, ni
 * aquí ni en la base (un trigger rechaza UPDATE y DELETE). Corregir una
 * aceptación es registrar otra.
 *
 * ⚠️ La foto se arma en el SERVIDOR desde lo que la matriz dice AHORA, nunca
 * desde lo que mandó el cliente. Si el navegador pudiera dictar el `updated_at`
 * de la foto, podría declarar vigente una aceptación sobre un control que ya
 * cambió, y la bitácora se vería impecable — que es la peor forma de fallar.
 */
export async function registrarAceptacion(
  input: AceptacionInput,
): Promise<Result<ComplianceAceptacion>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  const hoy = todayBogotaISO();
  const errValidacion = validarAceptacion(input, hoy);
  if (errValidacion) return { ok: false, error: errValidacion };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const { data: cargo, error: errCargo } = await svc
    .from('compliance_cargos')
    .select('id, nombre')
    .eq('id', input.cargo_id)
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle();
  if (errCargo) return { ok: false, error: errCargo.message };
  if (!cargo) return { ok: false, error: 'cargo_no_encontrado' };

  const { data: controles, error: errControles } = await svc
    .from('riesgos_controles')
    .select('id, referencia, nombre_control, updated_at')
    .eq('workspace_id', guard.workspaceId)
    .eq('cargo_responsable_id', input.cargo_id)
    .order('referencia', { ascending: true });
  if (errControles) return { ok: false, error: errControles.message };

  const lista = (controles ?? []) as Array<{
    id: string;
    referencia: string | null;
    nombre_control: string | null;
    updated_at: string | null;
  }>;
  if (lista.length === 0) {
    return {
      ok: false,
      error:
        'cargo_sin_controles (nomina al menos un control a este cargo antes de hacerle aceptar la responsabilidad)',
    };
  }

  // El soporte llega como path del bucket. Se comprueba que pertenezca a ESTE
  // workspace: el service client no pasa por RLS, así que sin este guard un path
  // ajeno quedaría archivado como propio.
  const soportePath = input.soporte_path?.trim() || null;
  if (soportePath && !soportePath.startsWith(`${guard.workspaceId}/`)) {
    return { ok: false, error: 'soporte_fuera_del_workspace' };
  }

  const { data, error } = await svc
    .from('compliance_aceptaciones')
    .insert({
      workspace_id: guard.workspaceId,
      cargo_id: cargo.id,
      persona_nombre: input.persona_nombre.trim(),
      persona_documento: input.persona_documento.trim(),
      // Quién firmó y quién registró son cosas distintas: el firmante casi nunca
      // tiene cuenta. Con `documento_cargado` el usuario de la sesión es el
      // oficial que carga el papel, no la persona que se comprometió.
      aceptada_por: input.medio === 'firma_one' ? guard.userId : null,
      registrada_por: guard.userId,
      medio: input.medio,
      soporte_path: soportePath,
      fecha_aceptacion: input.fecha_aceptacion?.trim() || hoy,
      controles_snapshot: armarSnapshot(lista),
    })
    .select(COLUMNAS_ACEPTACION)
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath('/compliance/responsables');
  return { ok: true, data: data as ComplianceAceptacion };
}

/**
 * Sube el documento firmado y devuelve su path.
 *
 * Va al bucket PRIVADO `compliance-soportes`, bajo el prefijo del workspace: un
 * soporte lleva nombre y documento de identidad de una persona, y en un bucket
 * público bastaría adivinar la ruta. La descarga se sirve por una ruta
 * autenticada con guard de rol, nunca por URL directa.
 */
export async function subirSoporteAceptacion(
  formData: FormData,
): Promise<Result<{ path: string }>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  const archivo = formData.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false, error: 'archivo_requerido' };
  }
  if (archivo.size > 10 * 1024 * 1024) {
    return { ok: false, error: 'archivo_muy_grande (máximo 10 MB)' };
  }

  const ext = (archivo.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${guard.workspaceId}/aceptaciones/${crypto.randomUUID()}.${ext || 'pdf'}`;

  const svc = createServiceClient();
  const { error } = await svc.storage
    .from(BUCKET_SOPORTES)
    .upload(path, archivo, { contentType: archivo.type || 'application/octet-stream', upsert: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { path } };
}

/** URL firmada de corta vida para ver el soporte. Guard de rol y de workspace. */
export async function urlSoporteAceptacion(input: {
  aceptacion_id: string;
}): Promise<Result<{ url: string }>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data: fila, error } = await svc
    .from('compliance_aceptaciones')
    .select('soporte_path')
    .eq('id', input.aceptacion_id)
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!fila?.soporte_path) return { ok: false, error: 'aceptacion_sin_soporte' };

  const { data: firmada, error: errFirma } = await svc.storage
    .from(BUCKET_SOPORTES)
    .createSignedUrl(fila.soporte_path, 60);

  if (errFirma) return { ok: false, error: errFirma.message };
  return { ok: true, data: { url: firmada.signedUrl as string } };
}

// ─── El tablero del oficial ────────────────────────────────────────────────

export type ControlConResponsable = {
  id: string;
  referencia: string | null;
  nombre_control: string | null;
  actividad_control: string | null;
  periodicidad: string | null;
  tipo_control: string | null;
  cargo_responsable_id: string | null;
  cargo_nombre: string | null;
  responsable_id: string | null;
  responsable_nombre: string | null;
  updated_at: string | null;
  estado: EstadoAceptacionControl;
};

export type UsuarioDelWorkspace = { id: string; nombre: string };

export type TableroResponsables = {
  controles: ControlConResponsable[];
  cargos: ComplianceCargo[];
  usuarios: UsuarioDelWorkspace[];
  aceptaciones: AceptacionConNombres[];
  indicadores: IndicadoresResponsables;
};

/**
 * Todo lo que la pantalla del oficial necesita, en una pasada.
 *
 * Los estados se DERIVAN, no se guardan. Guardar "aceptado" en una columna
 * invita a que se desincronice: el control cambia y ninguna columna se entera.
 */
export async function listarTableroResponsables(): Promise<Result<TableroResponsables>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const [ctrlRes, cargosRes, aceptRes] = await Promise.all([
    svc
      .from('riesgos_controles')
      .select(COLUMNAS_CONTROL)
      .eq('workspace_id', guard.workspaceId)
      .order('referencia', { ascending: true }),
    svc
      .from('compliance_cargos')
      .select('id, nombre, activo, orden')
      .eq('workspace_id', guard.workspaceId)
      .order('orden', { ascending: true }),
    svc
      .from('compliance_aceptaciones')
      .select(COLUMNAS_ACEPTACION)
      .eq('workspace_id', guard.workspaceId)
      .order('created_at', { ascending: false })
      .limit(LIMITE_BITACORA),
  ]);

  if (ctrlRes.error) return { ok: false, error: ctrlRes.error.message };
  if (cargosRes.error) return { ok: false, error: cargosRes.error.message };
  if (aceptRes.error) return { ok: false, error: aceptRes.error.message };

  const controlesRaw = (ctrlRes.data ?? []) as Array<Record<string, unknown>>;
  const cargos = (cargosRes.data ?? []) as ComplianceCargo[];
  const aceptaciones = (aceptRes.data ?? []) as ComplianceAceptacion[];

  const cargoNombre = new Map(cargos.map((c) => [c.id, c.nombre]));

  const paraCobertura: ControlParaCobertura[] = controlesRaw.map((c) => ({
    id: c.id as string,
    cargo_responsable_id: (c.cargo_responsable_id as string | null) ?? null,
    updated_at: (c.updated_at as string | null) ?? null,
  }));
  const estados = indexarEstadosAceptacion(paraCobertura, aceptaciones);

  const usuarios = await listarUsuariosDelWorkspace(svc, guard.workspaceId);
  const nombrePorUsuario = new Map(usuarios.map((u) => [u.id, u.nombre]));

  const controles: ControlConResponsable[] = controlesRaw.map((c) => {
    const id = c.id as string;
    const cargoId = (c.cargo_responsable_id as string | null) ?? null;
    const userId = (c.responsable_id as string | null) ?? null;
    return {
      id,
      referencia: (c.referencia as string | null) ?? null,
      nombre_control: (c.nombre_control as string | null) ?? null,
      actividad_control: (c.actividad_control as string | null) ?? null,
      periodicidad: (c.periodicidad as string | null) ?? null,
      tipo_control: (c.tipo_control as string | null) ?? null,
      cargo_responsable_id: cargoId,
      cargo_nombre: cargoId ? (cargoNombre.get(cargoId) ?? null) : null,
      responsable_id: userId,
      responsable_nombre: userId ? (nombrePorUsuario.get(userId) ?? null) : null,
      updated_at: (c.updated_at as string | null) ?? null,
      estado: estados.get(id) ?? {
        cubierto: false,
        motivo: 'sin_cargo',
        aceptacion: null,
        updated_at_aceptado: null,
      },
    };
  });

  const nombresRegistradores = await resolverNombresUsuarios(
    svc,
    aceptaciones.map((a) => a.registrada_por),
  );

  return {
    ok: true,
    data: {
      controles,
      cargos,
      usuarios,
      aceptaciones: aceptaciones.map((a) => ({
        ...a,
        cargo_nombre: cargoNombre.get(a.cargo_id) ?? null,
        registrada_por_nombre: a.registrada_por
          ? (nombresRegistradores.get(a.registrada_por) ?? null)
          : null,
      })),
      indicadores: indicadoresResponsables(estados),
    },
  };
}

/**
 * Usuarios del workspace, para el selector de "quién lo opera en ONE".
 *
 * Es un selector OPCIONAL y corto a propósito: la mayoría de los controles se
 * ejecutan fuera de la plataforma y no van a tener a nadie aquí.
 */
async function listarUsuariosDelWorkspace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
): Promise<UsuarioDelWorkspace[]> {
  const { data } = await svc
    .from('profiles')
    .select('id, full_name')
    .eq('workspace_id', workspaceId)
    .order('full_name', { ascending: true });

  return ((data ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => ({
    id: p.id,
    nombre: p.full_name ?? 'Sin nombre',
  }));
}
