'use server';

/**
 * Base de sujetos de debida diligencia: empleados y terceros.
 *
 * Lo que esta pantalla resuelve y ninguna otra resolvía: que el ejecutor pueda
 * abrir una lista y ver a quién tiene vinculado y si puede contratarlo. Hasta
 * ahora eso solo se sabía consultando de a uno, y el resultado no quedaba
 * asociado a nadie.
 *
 * ── El recorte por rol, que es la razón de que esto no sea /liberaciones ──
 *
 * El ejecutor ve el semáforo y la fecha de vencimiento. NO ve el fundamento del
 * hallazgo, ni en qué lista salió, ni la justificación del oficial. Eso vive en
 * `/compliance/liberaciones` y sigue siendo de owner/admin (dictamen Lucía
 * 2026-09-04): el ejecutor necesita la respuesta operativa, no la información
 * reservada que la sustenta, entre otras cosas porque es quien habla a diario
 * con la contraparte.
 *
 * NINGUNA función de este archivo llama a Informa ni a Valida.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/supabase/auth-user';
import { getWorkspace } from './get-workspace';
import { todayBogotaISO } from '@/lib/dates/bogota';
import { claveContraparte, type ComplianceLiberacion } from '@/lib/compliance/liberaciones';
import {
  claveSujeto,
  esTipoSujeto,
  indexarConsultasLimpias,
  indexarUltimasConsultas,
  normalizarDocumento,
  puedeGestionarSujetos,
  puedeVerSujetos,
  resumirSujetos,
  situacionSujeto,
  validarMotivoCierre,
  validarSujeto,
  type ComplianceSujeto,
  type ResumenSujetos,
  type SituacionSujeto,
  type TipoSujeto,
  type UltimaConsulta,
} from '@/lib/compliance/sujetos';
import { puedeLiberarContrapartes } from '@/lib/compliance/liberaciones';
import {
  indexarVinculaciones,
  type RefExpediente,
  type VinculacionDeSujeto,
} from '@/lib/compliance/vinculacion-sujeto';
import { traerTodo } from '@/lib/supabase/paginar';
import { revalidatePath } from 'next/cache';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

type Guard = {
  workspaceId: string;
  userId: string | null;
  role: string | null;
  esOficial: boolean;
};

async function guardSujetos(): Promise<Result<Guard>> {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  if (!puedeVerSujetos(role)) return { ok: false, error: 'forbidden_sin_acceso_a_sujetos' };
  const { user } = await getCachedUser();
  return {
    ok: true,
    data: {
      workspaceId,
      userId: user?.id ?? null,
      role: role ?? null,
      esOficial: puedeLiberarContrapartes(role),
    },
  };
}

async function guardGestion(): Promise<Result<Guard>> {
  const g = await guardSujetos();
  if (!g.ok) return g;
  if (!puedeGestionarSujetos(g.data.role)) {
    return { ok: false, error: 'forbidden_sin_permiso_de_gestion' };
  }
  return g;
}

// ─── Lectura ───────────────────────────────────────────────────────────────

export type FilaSujeto = ComplianceSujeto & {
  situacion: SituacionSujeto;
  responsable_nombre: string | null;
  segmento_nombre: string | null;
  /** Solo para el oficial: el resto no ve la nota interna. */
  notas: string | null;
  /**
   * El expediente de vinculación de esta contraparte, si tiene. `null` no
   * significa "no está vinculada": significa que en ONE no hay espejo de
   * ninguno. El espejo llega por webhook desde Valida y un workspace con el
   * webhook sin configurar los tendría todos en null.
   */
  vinculacion: VinculacionDeSujeto | null;
  /**
   * La consulta a listas más reciente de este sujeto, de cualquier severidad.
   * Solo informativa: el estado NO sale de aquí (ver `UltimaConsulta`).
   */
  ultimaConsulta: UltimaConsulta | null;
};

export type ExpedienteSujetos = {
  sujetos: FilaSujeto[];
  resumen: ResumenSujetos;
  hoy: string;
  esOficial: boolean;
  /** El workspace no adoptó periodicidad: hay habilitados sin fecha de revalidación. */
  sinPeriodicidad: boolean;
  /**
   * No se pudo leer el historial de consultas: la columna "Última consulta"
   * viene vacía para todos y la pantalla lo dice, en vez de mostrar "—" como
   * si nadie se hubiera consultado.
   */
  ultimaConsultaNoDisponible: boolean;
};

/**
 * La fecha la ve todo el que ve la base; el resultado (si hubo hallazgo y de qué
 * severidad) solo el oficial, por el mismo dictamen que deja el fundamento del
 * hallazgo en /liberaciones. Se recorta en el servidor por la misma razón que la
 * nota interna: ocultarlo en el cliente no lo ocultaría.
 */
function ultimaConsultaVisible(
  ultima: UltimaConsulta | null,
  esOficial: boolean,
): UltimaConsulta | null {
  if (!ultima || esOficial) return ultima;
  return { created_at: ultima.created_at, severidad: null };
}

export async function listarSujetos(): Promise<Result<ExpedienteSujetos>> {
  const guard = await guardSujetos();
  if (!guard.ok) return guard;
  const { workspaceId, esOficial } = guard.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const hoy = todayBogotaISO();

  const [sujetosRes, liberacionesRes, consultasRes, segmentosRes, perfilesRes, refsRes, ultimasRes] = await Promise.all([
    svc
      .from('compliance_sujetos')
      .select(
        'id, tipo, documento_tipo, documento_numero, nombre, staff_id, segmento_id, responsable_profile_id, relacion_desde, relacion_hasta, motivo_cierre, notas, created_at',
      )
      .eq('workspace_id', workspaceId)
      .order('nombre', { ascending: true }),
    svc
      .from('compliance_liberaciones')
      .select(
        'id, consulta_id, documento_tipo, documento_numero, nombre, decision, justificacion, vigente_desde, vigente_hasta, control_id, liberada_por, created_at, seguimiento',
      )
      .eq('workspace_id', workspaceId),
    // Las limpias, que alimentan el estado. COMPLETAS por páginas: con un tope,
    // PostgREST corta en 1.000 sin avisar y el sujeto cuya última limpia quede
    // afuera sale "sin consultar". A diferencia de la columna informativa, si
    // esta lectura falla se cae la pantalla: un estado sin su evidencia mentiría.
    traerTodo<{
      documento_tipo: string | null;
      documento_numero: string | null;
      created_at: string;
      vigente_hasta: string | null;
    }>(
      (desde, hasta) =>
        svc
          .from('consultas_listas_dual')
          .select('documento_tipo, documento_numero, created_at, vigente_hasta')
          .eq('workspace_id', workspaceId)
          .eq('severidad', 'sin_hallazgo')
          .not('documento_numero', 'is', null)
          .order('id')
          .range(desde, hasta),
      { etiqueta: 'sujetos/consultas-limpias' },
    ).then(
      (filas) => ({ ok: true as const, filas }),
      (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
    ),
    svc.from('compliance_segmentos').select('id, nombre').eq('workspace_id', workspaceId),
    svc.from('profiles').select('id, full_name').eq('workspace_id', workspaceId),
    // El espejo de los expedientes de vinculación. Se lee entero por workspace
    // porque son pocos (uno por contraparte invitada) y el cruce por documento
    // se hace en memoria, igual que el de liberaciones y consultas.
    svc
      .from('kyc_expediente_ref')
      .select(
        'expediente_kyc_id, razon_social, nombre, documento_tipo, documento_numero, estado_cache, etapa_cache, actualizado_en',
      )
      .eq('workspace_id', workspaceId),
    // La última consulta de cualquier severidad, para la columna informativa.
    // Va aparte de la de consultas limpias (que alimenta el estado y no se
    // toca) y se trae COMPLETA por páginas: PostgREST corta en 1.000 filas sin
    // avisar, y un tope aquí dejaría la fecha en "—" a sujetos que sí se
    // consultaron. Solo este workspace: el mismo documento consultado por otro
    // cliente no es una evaluación de este.
    traerTodo<{
      documento_tipo: string | null;
      documento_numero: string | null;
      created_at: string;
      severidad: string | null;
    }>(
      (desde, hasta) =>
        svc
          .from('consultas_listas_dual')
          .select('documento_tipo, documento_numero, created_at, severidad')
          .eq('workspace_id', workspaceId)
          .not('documento_numero', 'is', null)
          .order('id')
          .range(desde, hasta),
      { etiqueta: 'sujetos/ultima-consulta' },
    ).then(
      (filas) => ({
        todas: indexarUltimasConsultas(filas),
        // Para el estado (`en_revision`) cuenta la última CONCLUYENTE: una
        // consulta fallida después de un hallazgo no dice que salió limpio, y
        // tomarla como la última escondería el hallazgo.
        concluyentes: indexarUltimasConsultas(
          filas.filter((f) => f.severidad === 'alto' || f.severidad === 'sin_hallazgo'),
        ),
      }),
      () => null,
    ),
  ]);

  if (sujetosRes.error) return { ok: false, error: sujetosRes.error.message };
  if (liberacionesRes.error) return { ok: false, error: liberacionesRes.error.message };
  if (!consultasRes.ok) return { ok: false, error: consultasRes.error };
  const consultasLimpias = consultasRes.filas;

  // El espejo NO es fuente: si falla, la pantalla vale igual sin la columna de
  // vinculación. Tumbar la base de sujetos entera por un espejo caído sería
  // dejar al ejecutor sin lo que sí es suyo.
  const vinculaciones = indexarVinculaciones(
    refsRes.error ? [] : ((refsRes.data ?? []) as RefExpediente[]),
  );

  const sujetos = (sujetosRes.data ?? []) as Array<ComplianceSujeto & { notas: string | null }>;

  // Liberaciones agrupadas por contraparte. La regla de cuál manda vive en
  // `coberturaDeContraparte`, no acá: aquí solo se agrupa.
  const porClave = new Map<string, ComplianceLiberacion[]>();
  for (const l of (liberacionesRes.data ?? []) as ComplianceLiberacion[]) {
    const clave = claveContraparte(l.documento_tipo, l.documento_numero);
    if (!clave) continue;
    const acc = porClave.get(clave);
    if (acc) acc.push(l);
    else porClave.set(clave, [l]);
  }

  // La consulta limpia MÁS RECIENTE de cada contraparte. Llegan por id, así que
  // el índice compara fechas en vez de quedarse con la primera.
  const limpias = indexarConsultasLimpias(consultasLimpias);

  const nombreSegmento = new Map<string, string>(
    ((segmentosRes.data ?? []) as Array<{ id: string; nombre: string }>).map((s) => [s.id, s.nombre]),
  );
  const nombrePerfil = new Map<string, string>(
    ((perfilesRes.data ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [
      p.id,
      p.full_name ?? '',
    ]),
  );

  const filas: FilaSujeto[] = sujetos.map((s) => {
    const clave = claveSujeto(s);
    const situacion = situacionSujeto(
      s,
      clave ? (porClave.get(clave) ?? []) : [],
      clave ? (limpias.get(clave) ?? null) : null,
      hoy,
      // Sin enmascarar: el estado se calcula con la severidad real. Lo que se
      // le oculta al ejecutor es la severidad en la columna, no el estado.
      clave && ultimasRes ? (ultimasRes.concluyentes.get(clave) ?? null) : null,
    );
    return {
      ...s,
      situacion,
      responsable_nombre: s.responsable_profile_id
        ? (nombrePerfil.get(s.responsable_profile_id) ?? null)
        : null,
      segmento_nombre: s.segmento_id ? (nombreSegmento.get(s.segmento_id) ?? null) : null,
      vinculacion: clave ? (vinculaciones.get(clave) ?? null) : null,
      ultimaConsulta: ultimaConsultaVisible(
        clave && ultimasRes ? (ultimasRes.todas.get(clave) ?? null) : null,
        esOficial,
      ),
      // La nota interna es del oficial. Al ejecutor le llega null, y le llega
      // null desde el servidor: ocultarla en el cliente no la ocultaría.
      notas: esOficial ? s.notas : null,
    };
  });

  const resumen = resumirSujetos(
    filas.map((f) => f.situacion),
    hoy,
  );

  return {
    ok: true,
    data: {
      sujetos: filas,
      resumen,
      hoy,
      esOficial,
      sinPeriodicidad: filas.some(
        (f) => f.situacion.estado === 'habilitado' && f.situacion.venceEl === null,
      ),
      ultimaConsultaNoDisponible: ultimasRes === null,
    },
  };
}

export type EventoSujeto = {
  id: string;
  evento: string;
  detalle: string | null;
  motivo: string | null;
  actor_nombre: string | null;
  created_at: string;
};

export async function historialSujeto(sujetoId: string): Promise<Result<EventoSujeto[]>> {
  const guard = await guardSujetos();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('compliance_sujeto_eventos')
    .select('id, evento, detalle, motivo, actor, created_at')
    .eq('workspace_id', guard.data.workspaceId)
    .eq('sujeto_id', sujetoId)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, error: error.message };

  const actores = [
    ...new Set(
      ((data ?? []) as Array<{ actor: string | null }>)
        .map((e) => e.actor)
        .filter((a): a is string => !!a),
    ),
  ];
  const nombres = new Map<string, string>();
  if (actores.length > 0) {
    const { data: perfiles } = await svc.from('profiles').select('id, full_name').in('id', actores);
    for (const p of (perfiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      nombres.set(p.id, p.full_name ?? '');
    }
  }

  return {
    ok: true,
    data: ((data ?? []) as Array<EventoSujeto & { actor: string | null }>).map((e) => ({
      id: e.id,
      evento: e.evento,
      detalle: e.detalle,
      motivo: e.motivo,
      actor_nombre: e.actor ? (nombres.get(e.actor) ?? null) : null,
      created_at: e.created_at,
    })),
  };
}

/** Personal activo que todavía no tiene ficha de sujeto. */
export async function listarStaffSinSujeto(): Promise<
  Result<Array<{ id: string; full_name: string; position: string | null }>>
> {
  const guard = await guardGestion();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const [staffRes, sujetosRes] = await Promise.all([
    svc
      .from('staff')
      .select('id, full_name, position')
      .eq('workspace_id', guard.data.workspaceId)
      .eq('is_active', true)
      .order('full_name'),
    svc
      .from('compliance_sujetos')
      .select('staff_id')
      .eq('workspace_id', guard.data.workspaceId)
      .not('staff_id', 'is', null),
  ]);

  if (staffRes.error) return { ok: false, error: staffRes.error.message };

  const yaTienen = new Set(
    ((sujetosRes.data ?? []) as Array<{ staff_id: string }>).map((s) => s.staff_id),
  );

  return {
    ok: true,
    data: ((staffRes.data ?? []) as Array<{ id: string; full_name: string; position: string | null }>).filter(
      (s) => !yaTienen.has(s.id),
    ),
  };
}

export async function listarSegmentosParaSujetos(): Promise<
  Result<Array<{ id: string; nombre: string }>>
> {
  const guard = await guardSujetos();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('compliance_segmentos')
    .select('id, nombre')
    .eq('workspace_id', guard.data.workspaceId)
    .eq('activo', true)
    .order('orden');

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as Array<{ id: string; nombre: string }> };
}

// ─── Escritura ─────────────────────────────────────────────────────────────

/**
 * Las referencias que llegan del navegador tienen que ser de ESTE workspace.
 *
 * Todo este archivo escribe con el cliente de servicio, que no pasa por RLS, y las llaves
 * foráneas solo exigen que el id exista en alguna parte: sin esto, una ficha se podía
 * amarrar al personal, al segmento o al usuario de otro cliente. Un id ajeno se contesta
 * igual que uno inexistente. No se exporta: en un archivo `'use server'` todo export es
 * un endpoint.
 */
async function referenciaAjena(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  refs: { staff_id?: string | null; segmento_id?: string | null; responsable_profile_id?: string | null },
): Promise<string | null> {
  const comprobaciones: Array<[string | null | undefined, string, string]> = [
    [refs.staff_id, 'staff', 'Esa persona no está en el personal de este espacio.'],
    [refs.segmento_id, 'compliance_segmentos', 'Ese segmento no existe.'],
    [refs.responsable_profile_id, 'profiles', 'Ese responsable no es de este espacio.'],
  ];
  for (const [id, tabla, mensaje] of comprobaciones) {
    if (!id) continue;
    const { data } = await svc
      .from(tabla)
      .select('id')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!data) return mensaje;
  }
  return null;
}

export type CrearSujetoInput = {
  tipo: string;
  documento_tipo: string;
  documento_numero: string;
  nombre: string;
  staff_id?: string | null;
  segmento_id?: string | null;
  responsable_profile_id?: string | null;
  relacion_desde?: string | null;
};

export async function crearSujeto(input: CrearSujetoInput): Promise<Result<{ id: string }>> {
  const guard = await guardGestion();
  if (!guard.ok) return guard;

  const problema = validarSujeto(input);
  if (problema) return { ok: false, error: problema };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const ajena = await referenciaAjena(svc, guard.data.workspaceId, input);
  if (ajena) return { ok: false, error: ajena };

  const { data, error } = await svc
    .from('compliance_sujetos')
    .insert({
      workspace_id: guard.data.workspaceId,
      tipo: input.tipo as TipoSujeto,
      documento_tipo: input.documento_tipo.trim().toUpperCase(),
      documento_numero: normalizarDocumento(input.documento_numero),
      nombre: input.nombre.trim(),
      staff_id: input.staff_id || null,
      segmento_id: input.segmento_id || null,
      responsable_profile_id: input.responsable_profile_id || guard.data.userId,
      relacion_desde: input.relacion_desde || todayBogotaISO(),
      created_by: guard.data.userId,
    })
    .select('id')
    .single();

  if (error) {
    // El unique de identidad. Decir "ya existe" es útil; decir el código de
    // Postgres no lo es.
    if (String(error.code) === '23505') {
      return { ok: false, error: 'Ese documento ya está en la base. Búscalo en la lista.' };
    }
    return { ok: false, error: error.message };
  }

  await svc.rpc('compliance_registrar_evento_sujeto', {
    p_workspace_id: guard.data.workspaceId,
    p_sujeto_id: data.id,
    p_evento: 'alta',
    p_detalle: `${input.nombre.trim()} (${input.documento_tipo.trim().toUpperCase()} ${normalizarDocumento(input.documento_numero)})`,
    p_motivo: null,
    p_actor: guard.data.userId,
  });

  revalidatePath('/compliance/sujetos');
  return { ok: true, data: { id: data.id as string } };
}

export type ActualizarSujetoInput = {
  id: string;
  tipo?: string;
  segmento_id?: string | null;
  responsable_profile_id?: string | null;
  notas?: string | null;
};

export async function actualizarSujeto(input: ActualizarSujetoInput): Promise<Result<null>> {
  const guard = await guardGestion();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const patch: Record<string, unknown> = {};
  if (input.tipo !== undefined) {
    if (!esTipoSujeto(input.tipo)) return { ok: false, error: 'Ese tipo de sujeto no existe.' };
    patch.tipo = input.tipo;
  }
  if (input.segmento_id !== undefined) patch.segmento_id = input.segmento_id || null;
  if (input.responsable_profile_id !== undefined) {
    patch.responsable_profile_id = input.responsable_profile_id || null;
  }
  // La nota interna es del oficial: si el ejecutor pudiera escribirla, la
  // separación entre lo que ve y lo que decide cada uno se caería por el lado
  // de la escritura.
  if (input.notas !== undefined) {
    if (!guard.data.esOficial) return { ok: false, error: 'forbidden_notas_solo_oficial' };
    patch.notas = input.notas || null;
  }
  if (Object.keys(patch).length === 0) return { ok: true, data: null };

  const ajena = await referenciaAjena(svc, guard.data.workspaceId, {
    segmento_id: patch.segmento_id as string | null | undefined,
    responsable_profile_id: patch.responsable_profile_id as string | null | undefined,
  });
  if (ajena) return { ok: false, error: ajena };

  const { error } = await svc
    .from('compliance_sujetos')
    .update(patch)
    .eq('id', input.id)
    .eq('workspace_id', guard.data.workspaceId);

  if (error) return { ok: false, error: error.message };

  await svc.rpc('compliance_registrar_evento_sujeto', {
    p_workspace_id: guard.data.workspaceId,
    p_sujeto_id: input.id,
    p_evento: 'cambio_datos',
    p_detalle: Object.keys(patch).join(', '),
    p_motivo: null,
    p_actor: guard.data.userId,
  });

  revalidatePath('/compliance/sujetos');
  return { ok: true, data: null };
}

/**
 * Cierre de relación: "ya no hace parte del proceso".
 *
 * NO es inhabilitar, y la diferencia es el motivo de que esta función exista
 * separada de las liberaciones. Cerrar no borra, no oculta y no cambia el estado
 * de cumplimiento: el sujeto sigue en la base con su historial, y en auditoría
 * se puede responder qué estado tenía el día que se le firmó.
 */
export async function cerrarRelacionSujeto(
  sujetoId: string,
  fecha: string,
  motivo: string,
): Promise<Result<null>> {
  const guard = await guardGestion();
  if (!guard.ok) return guard;

  const problema = validarMotivoCierre(motivo);
  if (problema) return { ok: false, error: problema };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { error } = await svc.rpc('compliance_cerrar_relacion_sujeto', {
    p_workspace_id: guard.data.workspaceId,
    p_sujeto_id: sujetoId,
    p_fecha: fecha || todayBogotaISO(),
    p_motivo: motivo.trim(),
    p_actor: guard.data.userId,
  });

  if (error) return { ok: false, error: traducirErrorSujeto(error.message) };

  revalidatePath('/compliance/sujetos');
  return { ok: true, data: null };
}

export async function reabrirRelacionSujeto(
  sujetoId: string,
  fecha: string,
  motivo: string,
): Promise<Result<null>> {
  const guard = await guardGestion();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { error } = await svc.rpc('compliance_reabrir_relacion_sujeto', {
    p_workspace_id: guard.data.workspaceId,
    p_sujeto_id: sujetoId,
    p_fecha: fecha || todayBogotaISO(),
    p_motivo: motivo.trim() || null,
    p_actor: guard.data.userId,
  });

  if (error) return { ok: false, error: traducirErrorSujeto(error.message) };

  revalidatePath('/compliance/sujetos');
  return { ok: true, data: null };
}

/** Los errores que la base levanta a propósito, en el idioma de quien los ve. */
function traducirErrorSujeto(mensaje: string): string {
  if (mensaje.includes('sujeto_no_pertenece_al_workspace')) {
    return 'Ese sujeto no es de este workspace.';
  }
  if (mensaje.includes('relacion_ya_cerrada')) {
    return 'La relación con este sujeto ya estaba cerrada.';
  }
  if (mensaje.includes('relacion_ya_abierta')) {
    return 'La relación con este sujeto ya está abierta.';
  }
  if (mensaje.includes('cierre_anterior_al_inicio_de_la_relacion')) {
    return 'La fecha de cierre no puede ser anterior al inicio de la relación.';
  }
  if (mensaje.includes('motivo_de_cierre_obligatorio')) {
    return 'Escribe por qué termina la relación. Queda en la bitácora.';
  }
  return mensaje;
}
