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

import { createServiceClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/supabase/auth-user';
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
  type MotivoCobertura,
} from '@/lib/compliance/liberaciones';
import {
  calcularIndicadores,
  etiquetaDeContraparte,
  type EtiquetaBandeja,
  type IndicadoresBandeja,
} from '@/lib/compliance/bandeja';
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

/**
 * Techo de consultas que se leen para armar la bandeja. Igual que el de la
 * bitácora, se toman las más recientes. Si se alcanza, la bandeja lo DICE en
 * pantalla: un techo silencioso se lee como "esto es todo", y aquí lo que
 * faltaría son hallazgos sin decidir.
 */
const LIMITE_CONSULTAS = 5000;

// ─── Guards ────────────────────────────────────────────────────────────────

async function guardOficial(): Promise<
  { ok: true; workspaceId: string; userId: string | null } | { ok: false; error: string }
> {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  if (!puedeLiberarContrapartes(role)) {
    return { ok: false, error: 'forbidden_solo_oficial_cumplimiento' };
  }

  const { user } = await getCachedUser();
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
  /** Las cinco poblaciones del dictamen, en el orden en que se muestran. */
  sin_cobertura_vigente: ContraparteConHallazgo[];
  hallazgos_sin_decidir: ContraparteConHallazgo[];
  excepciones_vigentes: ContraparteConHallazgo[];
  rechazadas: ContraparteConHallazgo[];
  /**
   * Vigilancia continua es un CONTADOR, no una lista: nadie necesita ver los
   * nombres de las contrapartes que están bien (regla 1 de interfaz del
   * dictamen). "Por vencer" no se puede calcular todavía — depende de
   * `vigente_hasta` por consulta, que lo produce R2.
   */
  vigilancia_continua: number;
  /**
   * Hallazgos que quedan fuera del mecanismo. NO se ocultan: una fila que
   * desaparece en silencio es indistinguible de una que no existe, y aquí lo
   * que desaparecería es un hallazgo sin resolver.
   */
  sin_documento: HallazgoSinDocumento[];
  /**
   * Contrapartes cuya última consulta falló (`severidad='error'`). No son
   * limpias ni reportadas: no se sabe. Contarlas como vigilancia continua sería
   * repetir el falso negativo de agosto en otra capa.
   */
  sin_resultado: number;
  indicadores: IndicadoresBandeja;
  /** El techo de lectura se alcanzó: la bandeja no está mostrando todo. */
  truncado: boolean;
};

/** Fila cruda de `consultas_listas_dual` que la bandeja necesita. */
type ConsultaBandeja = {
  id: string;
  nombre_consultado: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
  severidad: string;
  total_matches: number;
  matches: InformaMatch[];
  created_at: string;
};

/**
 * La bandeja del oficial. Los estados se DERIVAN, no se guardan.
 *
 * Cinco poblaciones (dictamen Lucía 2026-08-24), que salen de cruzar dos cosas
 * que ya están en producción: si la ÚLTIMA consulta de la contraparte trajo
 * hallazgo, y qué devuelve `coberturaDeContraparte()` (R4). Guardar el estado en
 * una columna invita a que se desincronice: la vigencia vence sola con el
 * calendario y ninguna columna se entera.
 *
 * Antes esto devolvía dos grupos —cubiertas y no cubiertas— y ese corte metía en
 * el mismo cajón a la que nunca pasó por el oficial, a la que está operando con
 * el permiso caducado y a la que fue rechazada. Son tres cosas distintas, y la
 * del medio es la única donde la empresa está expuesta sin que nadie lo haya
 * decidido así.
 */
export async function listarTableroLiberaciones(): Promise<Result<TableroLiberaciones>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // Se leen TODAS las consultas, no solo las de severidad 'alto': sin las
  // limpias no se puede contar vigilancia continua, y sin las de error no se
  // puede distinguir "salió limpia" de "no se supo".
  const { data: consultasRaw, error: errConsultas } = await svc
    .from('consultas_listas_dual')
    .select('id, nombre_consultado, documento_tipo, documento_numero, severidad, total_matches, matches, created_at')
    .eq('workspace_id', guard.workspaceId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_CONSULTAS);

  if (errConsultas) return { ok: false, error: errConsultas.message };

  const { data: liberacionesRaw, error: errLiberaciones } = await svc
    .from('compliance_liberaciones')
    .select(COLUMNAS_LIBERACION)
    .eq('workspace_id', guard.workspaceId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_BITACORA);

  if (errLiberaciones) return { ok: false, error: errLiberaciones.message };

  const hoy = todayBogotaISO();
  const coberturas = indexarCoberturas(
    (liberacionesRaw ?? []) as ComplianceLiberacion[],
    hoy,
  );

  const consultas = (consultasRaw ?? []) as ConsultaBandeja[];
  const porClave = new Map<string, ContraparteConHallazgo>();
  /** Severidad de la consulta más reciente CONCLUYENTE de cada contraparte. */
  const ultimaConcluyente = new Map<string, string>();
  const sinDocumento: HallazgoSinDocumento[] = [];

  for (const c of consultas) {
    const clave = claveContraparte(c.documento_tipo, c.documento_numero);

    // Sin documento no hay a qué atar la vigencia: la liberación cuelga de la
    // contraparte y la contraparte se identifica por documento. Solo se
    // reportan las que además traen hallazgo — una consulta limpia por nombre
    // no deja nada pendiente.
    if (!clave) {
      if (c.severidad === 'alto') {
        sinDocumento.push({
          consulta_id: c.id,
          nombre: c.nombre_consultado ?? null,
          created_at: c.created_at,
          total_matches: c.total_matches ?? 0,
        });
      }
      continue;
    }

    // Las consultas vienen ordenadas desc: la primera concluyente que aparece
    // por contraparte es la que decide su población.
    if (!ultimaConcluyente.has(clave) && (c.severidad === 'alto' || c.severidad === 'sin_hallazgo')) {
      ultimaConcluyente.set(clave, c.severidad);
    }

    if (c.severidad !== 'alto') continue;

    const hallazgo: HallazgoDeConsulta = {
      consulta_id: c.id,
      created_at: c.created_at,
      total_matches: c.total_matches ?? 0,
      matches: Array.isArray(c.matches) ? c.matches : [],
    };

    const existente = porClave.get(clave);
    if (existente) {
      existente.consultas.push(hallazgo);
      // El nombre puede faltar en una consulta y estar en otra de la misma
      // contraparte: se conserva el primero que aparezca.
      existente.nombre = existente.nombre ?? (c.nombre_consultado ?? null);
      continue;
    }

    porClave.set(clave, {
      clave,
      documento_tipo: c.documento_tipo as string,
      documento_numero: c.documento_numero as string,
      nombre: c.nombre_consultado ?? null,
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

  const buckets: Record<EtiquetaBandeja, ContraparteConHallazgo[]> = {
    sin_cobertura_vigente: [],
    hallazgos_sin_decidir: [],
    excepciones_vigentes: [],
    rechazadas: [],
    vigilancia_continua: [],
  };

  for (const contraparte of porClave.values()) {
    // Una contraparte que volvió a consultarse y salió limpia deja de estar en
    // una bandeja de hallazgo, aunque conserve consultas viejas con
    // coincidencias: lo que define la población es la ÚLTIMA consulta.
    const tieneHallazgo = ultimaConcluyente.get(contraparte.clave) === 'alto';
    const motivo: MotivoCobertura = contraparte.cobertura.motivo;
    buckets[etiquetaDeContraparte(tieneHallazgo, motivo)].push(contraparte);
  }

  // La cola se ordena por ANTIGÜEDAD (la más vieja arriba), no por severidad:
  // lo que se mide acá es cuánto lleva la empresa sabiendo algo sin decidir.
  buckets.hallazgos_sin_decidir.sort((a, b) =>
    a.ultima_consulta_fecha.localeCompare(b.ultima_consulta_fecha));
  buckets.sin_cobertura_vigente.sort((a, b) =>
    a.ultima_consulta_fecha.localeCompare(b.ultima_consulta_fecha));

  // Vigilancia continua se cuenta sobre TODAS las contrapartes concluyentes sin
  // hallazgo, no solo las que alguna vez lo tuvieron.
  let limpias = 0;
  for (const [, severidad] of ultimaConcluyente) {
    if (severidad !== 'alto') limpias++;
  }

  // Contrapartes con documento cuya única evidencia es un error: no se sabe.
  const clavesConDocumento = new Set<string>();
  for (const c of consultas) {
    const clave = claveContraparte(c.documento_tipo, c.documento_numero);
    if (clave) clavesConDocumento.add(clave);
  }
  const sinResultado = clavesConDocumento.size - ultimaConcluyente.size;

  return {
    ok: true,
    data: {
      sin_cobertura_vigente: buckets.sin_cobertura_vigente,
      hallazgos_sin_decidir: buckets.hallazgos_sin_decidir,
      excepciones_vigentes: buckets.excepciones_vigentes,
      rechazadas: buckets.rechazadas,
      vigilancia_continua: limpias,
      sin_documento: sinDocumento,
      sin_resultado: sinResultado,
      indicadores: calcularIndicadores(
        buckets.hallazgos_sin_decidir.map((c) => c.ultima_consulta_fecha),
        buckets.sin_cobertura_vigente.length,
        hoy,
      ),
      truncado: consultas.length >= LIMITE_CONSULTAS,
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
