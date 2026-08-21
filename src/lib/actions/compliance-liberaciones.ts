'use server';

/**
 * Liberación de contrapartes por el oficial de cumplimiento (R4).
 *
 * Cierra el ciclo del módulo: la consulta encuentra hallazgos y ESTO registra
 * qué decidió el oficial sobre ellos. Sin esta bitácora, el workspace opera sin
 * evidencia de debida diligencia.
 *
 * NINGUNA función de este archivo llama a Informa ni a Valida. Todo sale de lo
 * ya guardado en `consultas_listas_dual`: cada consulta a la fuente es facturable
 * contra la cuenta del cliente, y decidir sobre un hallazgo no necesita volver a
 * preguntar. Si alguna vez hace falta re-consultar, esa es otra acción y se ve.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getWorkspace } from './get-workspace';
import { resolverNombresUsuarios } from './_usuarios';
import { todayBogotaISO } from '@/lib/dates/bogota';
import {
  claveContraparte,
  indexarCoberturas,
  partesContraparte,
  puedeLiberarContrapartes,
  validarLiberacion,
  type ComplianceLiberacion,
  type Cobertura,
  type LiberacionConNombres,
  type LiberacionInput,
} from '@/lib/compliance/liberaciones';
import type { InformaMatch } from './compliance-dual';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const COLUMNAS_LIBERACION =
  'id, consulta_id, documento_tipo, documento_numero, nombre, decision, justificacion, vigente_desde, vigente_hasta, control_id, liberada_por, created_at';

/**
 * Techo de filas de bitácora que se leen para calcular cobertura.
 *
 * Se toman las MÁS RECIENTES, que son las que deciden. Si un workspace superara
 * el techo, las contrapartes que solo aparecen más atrás quedarían fuera del
 * índice y se mostrarían como "pendiente de decisión" — el lado conservador: la
 * pantalla pide decidir de nuevo, nunca da por cubierto a quien no verificó.
 */
const LIMITE_BITACORA = 2000;

// ─── Guards ────────────────────────────────────────────────────────────────

async function guardOficial(): Promise<
  { ok: true; workspaceId: string; userId: string | null } | { ok: false; error: string }
> {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  if (!puedeLiberarContrapartes(role)) {
    return { ok: false, error: 'forbidden_solo_oficial_cumplimiento' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { ok: true, workspaceId, userId: user?.id ?? null };
}

// ─── Escritura ─────────────────────────────────────────────────────────────

/**
 * Registra una decisión del oficial. Es la ÚNICA vía de escritura: no hay
 * actualizar ni borrar, ni aquí ni en la base (un trigger rechaza UPDATE y
 * DELETE). Revocar una liberación es registrar un rechazo.
 *
 * La identidad de la contraparte NO llega del cliente: se toma de la consulta
 * sobre la que se decide. Así la fila no puede quedar apuntando a una
 * contraparte distinta de la de la evidencia — que sería la peor forma de
 * fallar, porque la bitácora se vería impecable.
 */
export async function registrarDecisionContraparte(
  input: LiberacionInput,
): Promise<Result<ComplianceLiberacion>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  const hoy = todayBogotaISO();
  const errValidacion = validarLiberacion(input, hoy);
  if (errValidacion) return { ok: false, error: errValidacion };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // `.eq('workspace_id')` no sobra: el service client bypasea RLS, así que el
  // aislamiento por workspace se pone a mano.
  const { data: consulta, error: errConsulta } = await svc
    .from('consultas_listas_dual')
    .select('id, nombre_consultado, documento_tipo, documento_numero, severidad')
    .eq('id', input.consulta_id)
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle();

  if (errConsulta) return { ok: false, error: errConsulta.message };
  if (!consulta) return { ok: false, error: 'consulta_no_encontrada' };

  if (consulta.severidad !== 'alto') {
    return {
      ok: false,
      error: 'consulta_sin_hallazgo (no hay nada que decidir sobre una consulta sin coincidencias)',
    };
  }

  const identidad = partesContraparte(consulta.documento_tipo, consulta.documento_numero);
  if (!identidad) {
    return {
      ok: false,
      error:
        'consulta_sin_documento (esa consulta se hizo solo por nombre; la vigencia se ata al documento, así que no se puede liberar por esta vía)',
    };
  }

  const controlId = input.control_id?.trim() || null;
  if (controlId) {
    const { data: control, error: errControl } = await svc
      .from('riesgos_controles')
      .select('id')
      .eq('id', controlId)
      .eq('workspace_id', guard.workspaceId)
      .maybeSingle();
    if (errControl) return { ok: false, error: errControl.message };
    if (!control) return { ok: false, error: 'control_no_encontrado' };
  }

  const { data, error } = await svc
    .from('compliance_liberaciones')
    .insert({
      workspace_id: guard.workspaceId,
      consulta_id: consulta.id,
      documento_tipo: identidad.tipo,
      documento_numero: identidad.numero,
      nombre: consulta.nombre_consultado ?? null,
      decision: input.decision,
      justificacion: input.justificacion.trim(),
      // La vigencia arranca HOY, no cuando diga el cliente: una liberación
      // retroactiva cubriría contrataciones que ocurrieron sin ella.
      vigente_desde: hoy,
      vigente_hasta: input.decision === 'liberada' ? input.vigente_hasta : null,
      control_id: controlId,
      liberada_por: guard.userId,
    })
    .select(COLUMNAS_LIBERACION)
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as ComplianceLiberacion };
}

// ─── Lectura: bitácora de una contraparte ──────────────────────────────────

/**
 * Bitácora completa de una contraparte, de la más reciente a la más antigua.
 *
 * Consulta por la identidad CANÓNICA (la misma que se guardó), así que el índice
 * por (workspace, tipo, numero, created_at desc) la resuelve sin ordenar.
 */
export async function listarBitacoraContraparte(input: {
  documento_tipo: string;
  documento_numero: string;
}): Promise<Result<LiberacionConNombres[]>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  const identidad = partesContraparte(input.documento_tipo, input.documento_numero);
  if (!identidad) return { ok: false, error: 'documento_requerido' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('compliance_liberaciones')
    .select(COLUMNAS_LIBERACION)
    .eq('workspace_id', guard.workspaceId)
    .eq('documento_tipo', identidad.tipo)
    .eq('documento_numero', identidad.numero)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, error: error.message };

  const filas = (data ?? []) as ComplianceLiberacion[];
  return { ok: true, data: await enriquecerLiberaciones(svc, guard.workspaceId, filas) };
}

/**
 * Resuelve lo que la bitácora referencia por id: quién firmó y qué control citó.
 * Sin esto la pantalla mostraría uuids, que no le dicen nada a nadie.
 */
async function enriquecerLiberaciones(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  filas: ComplianceLiberacion[],
): Promise<LiberacionConNombres[]> {
  if (filas.length === 0) return [];

  const userMap = await resolverNombresUsuarios(svc, filas.map((f) => f.liberada_por));

  const controlIds = Array.from(new Set(filas.map((f) => f.control_id).filter(Boolean))) as string[];
  const controlMap = new Map<string, { referencia: string | null; nombre: string | null }>();
  if (controlIds.length > 0) {
    const { data: controles } = await svc
      .from('riesgos_controles')
      .select('id, referencia, nombre_control')
      .eq('workspace_id', workspaceId)
      .in('id', controlIds);
    for (const c of (controles ?? []) as Array<{
      id: string;
      referencia: string | null;
      nombre_control: string | null;
    }>) {
      controlMap.set(c.id, { referencia: c.referencia, nombre: c.nombre_control });
    }
  }

  return filas.map((f) => {
    const control = f.control_id ? controlMap.get(f.control_id) : undefined;
    return {
      ...f,
      liberada_por_nombre: f.liberada_por ? (userMap.get(f.liberada_por) ?? null) : null,
      control_referencia: control?.referencia ?? null,
      control_nombre: control?.nombre ?? null,
    };
  });
}

// ─── Lectura: contrapartes con hallazgo ────────────────────────────────────

export type HallazgoDeConsulta = {
  consulta_id: string;
  created_at: string;
  total_matches: number;
  matches: InformaMatch[];
};

export type ContraparteConHallazgo = {
  /** `claveContraparte` — identifica la fila en la pantalla. */
  clave: string;
  documento_tipo: string;
  documento_numero: string;
  nombre: string | null;
  /** Consultas con hallazgo de esta contraparte, de la más reciente a la más antigua. */
  consultas: HallazgoDeConsulta[];
  /** La consulta sobre la que se va a decidir: la más reciente con hallazgo. */
  consulta_vigente_id: string;
  ultima_consulta_fecha: string;
  total_matches: number;
  cobertura: Cobertura;
};

/** Consulta con hallazgo que NO se puede liberar porque se hizo solo por nombre. */
export type HallazgoSinDocumento = {
  consulta_id: string;
  nombre: string | null;
  created_at: string;
  total_matches: number;
};

export type TableroLiberaciones = {
  /** Contrapartes con hallazgo SIN liberación vigente. Es la cola del oficial. */
  pendientes: ContraparteConHallazgo[];
  /** Contrapartes con hallazgo YA cubiertas por una liberación vigente. */
  cubiertas: ContraparteConHallazgo[];
  /**
   * Hallazgos que quedan fuera del mecanismo. NO se ocultan: una fila que
   * desaparece en silencio es indistinguible de una que no existe, y aquí lo
   * que desaparecería es un hallazgo sin resolver.
   */
  sin_documento: HallazgoSinDocumento[];
};

/**
 * El tablero del oficial. Los estados se DERIVAN, no se guardan.
 *
 * `con hallazgo` = consulta con severidad='alto' sin liberación vigente que la
 * cubra. Guardar ese estado en una columna invita a que se desincronice: la
 * vigencia vence sola con el calendario y ninguna columna se entera.
 */
export async function listarTableroLiberaciones(): Promise<Result<TableroLiberaciones>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const { data: consultasRaw, error: errConsultas } = await svc
    .from('consultas_listas_dual')
    .select('id, nombre_consultado, documento_tipo, documento_numero, total_matches, matches, created_at')
    .eq('workspace_id', guard.workspaceId)
    .eq('severidad', 'alto')
    .order('created_at', { ascending: false });

  if (errConsultas) return { ok: false, error: errConsultas.message };

  const { data: liberacionesRaw, error: errLiberaciones } = await svc
    .from('compliance_liberaciones')
    .select(COLUMNAS_LIBERACION)
    .eq('workspace_id', guard.workspaceId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_BITACORA);

  if (errLiberaciones) return { ok: false, error: errLiberaciones.message };

  const coberturas = indexarCoberturas(
    (liberacionesRaw ?? []) as ComplianceLiberacion[],
    todayBogotaISO(),
  );

  const porClave = new Map<string, ContraparteConHallazgo>();
  const sinDocumento: HallazgoSinDocumento[] = [];

  for (const c of (consultasRaw ?? []) as Array<Record<string, unknown>>) {
    const documentoTipo = (c.documento_tipo as string | null) ?? null;
    const documentoNumero = (c.documento_numero as string | null) ?? null;
    const clave = claveContraparte(documentoTipo, documentoNumero);

    const hallazgo: HallazgoDeConsulta = {
      consulta_id: c.id as string,
      created_at: c.created_at as string,
      total_matches: (c.total_matches as number) ?? 0,
      matches: Array.isArray(c.matches) ? (c.matches as InformaMatch[]) : [],
    };

    if (!clave) {
      sinDocumento.push({
        consulta_id: hallazgo.consulta_id,
        nombre: (c.nombre_consultado as string | null) ?? null,
        created_at: hallazgo.created_at,
        total_matches: hallazgo.total_matches,
      });
      continue;
    }

    const existente = porClave.get(clave);
    if (existente) {
      existente.consultas.push(hallazgo);
      // El nombre puede faltar en una consulta y estar en otra de la misma
      // contraparte: se conserva el primero que aparezca.
      existente.nombre = existente.nombre ?? ((c.nombre_consultado as string | null) ?? null);
      continue;
    }

    // La primera que llega es la más reciente (la consulta viene ordenada desc),
    // y es sobre la que el oficial decide.
    porClave.set(clave, {
      clave,
      documento_tipo: documentoTipo as string,
      documento_numero: documentoNumero as string,
      nombre: (c.nombre_consultado as string | null) ?? null,
      consultas: [hallazgo],
      consulta_vigente_id: hallazgo.consulta_id,
      ultima_consulta_fecha: hallazgo.created_at,
      total_matches: hallazgo.total_matches,
      cobertura: coberturas.get(clave) ?? {
        cubierta: false,
        motivo: 'sin_registro',
        liberacion: null,
      },
    });
  }

  const todas = Array.from(porClave.values());
  return {
    ok: true,
    data: {
      pendientes: todas.filter((c) => !c.cobertura.cubierta),
      cubiertas: todas.filter((c) => c.cobertura.cubierta),
      sin_documento: sinDocumento,
    },
  };
}

// ─── Catálogo de controles para el formulario ──────────────────────────────

export type ControlParaLiberacion = {
  id: string;
  referencia: string | null;
  nombre: string | null;
};

/**
 * Controles del workspace, para el selector opcional del formulario.
 *
 * Amarrar la decisión a un control es lo que convierte la matriz de riesgo en
 * algo vivo en vez de un documento decorativo. Es opcional a propósito: un
 * workspace sin matriz cargada tiene que poder liberar igual.
 */
export async function listarControlesParaLiberacion(): Promise<Result<ControlParaLiberacion[]>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('riesgos_controles')
    .select('id, referencia, nombre_control')
    .eq('workspace_id', guard.workspaceId)
    .order('referencia', { ascending: true });

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    data: ((data ?? []) as Array<{ id: string; referencia: string | null; nombre_control: string | null }>).map(
      (c) => ({ id: c.id, referencia: c.referencia, nombre: c.nombre_control }),
    ),
  };
}
