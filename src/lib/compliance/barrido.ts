/**
 * R3 — el motor. Corre el barrido de un workspace: selecciona, respeta el tope,
 * re-consulta, compara y deja evidencia.
 *
 * Por qué vive acá y no dentro de un archivo `'use server'`:
 *
 *   - Tiene dos entradas con contextos distintos: el cron (sin sesión, sin
 *     cookies, sin usuario) y el botón del oficial. Un archivo de server actions
 *     exporta endpoints; una función que recibe `workspaceId` por parámetro y no
 *     valida rol NO puede ser un endpoint. El guard del rol se queda en
 *     `compliance-monitoreo.ts`, que es quien decide con qué workspace llamar.
 *
 * Por qué NO hay nada en metrik-valida: Valida ya expone la consulta como API y
 * ONE ya la consume. El reparto que el alcance imaginaba —ONE decide, Valida
 * ejecuta y difunde— agregaría un contrato entre repos para mover datos que solo
 * ONE tiene (liberaciones, periodicidad, notificaciones). El delta se calcula
 * donde vive el historial.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { todayBogotaISO } from '@/lib/dates/bogota';
import {
  claveContraparte,
  indexarCoberturas,
  type ComplianceLiberacion,
} from './liberaciones';
import { etiquetaDeContraparte, type EtiquetaBandeja } from './bandeja';
import {
  aplicarTope,
  cupoRestante,
  compararConsultas,
  efectoDeDelta,
  evaluarCandidato,
  inicioDePeriodo,
  modoDelBarrido,
  DEFAULT_HORIZONTE_RECHAZADAS_MESES,
  type ConfigMonitoreo,
  type FotoConsulta,
  type ModoBarrido,
  type Seleccionado,
} from './monitoreo';
import { clasificarParaGuardar, calcularVigenciaParaGuardar } from './persistencia-consulta';
import type { TierResuelto } from './tier-fuentes';
import type { InformaMatch } from '@/lib/actions/compliance-dual';

const VALIDA_API_BASE = process.env.VALIDA_API_BASE || 'https://api.valida.metrikone.co';

/** Techo del universo que se examina. Si se topa, el barrido lo dice. */
const LIMITE_CONSULTAS = 5000;
const LIMITE_LIBERACIONES = 5000;

export type ResumenBarrido = {
  barrido_id: string | null;
  modo: ModoBarrido;
  dia: string;
  cupo_periodo: number | null;
  consumidas_periodo_antes: number;
  candidatos: number;
  ejecutadas: number;
  diferidas: number;
  con_delta: number;
  notificadas: number;
  fallidas: number;
  corte_por_tope: boolean;
  /**
   * Contrapartes con hallazgo que el barrido NO puede cubrir porque la consulta
   * se hizo por nombre y no hay documento al cual atar la identidad. Se reporta
   * en vez de callarse: es el hueco de la cobertura del barrido.
   */
  sin_documento: number;
  universo_truncado: boolean;
};

type FilaConsulta = {
  id: string;
  documento_tipo: string | null;
  documento_numero: string | null;
  nombre_consultado: string | null;
  tipo_persona: string | null;
  severidad: string;
  total_matches: number | null;
  matches: unknown;
  created_at: string;
  vigente_hasta: string | null;
  tier_maximo: string | null;
  segmento_id: string | null;
};

type Contraparte = {
  clave: string;
  documento_tipo: string;
  documento_numero: string;
  nombre: string | null;
  tipo_persona: 'natural' | 'juridica';
  ultima: FilaConsulta;
  etiqueta: EtiquetaBandeja;
  decidida_en: string | null;
};

/**
 * Un barrido completo para un workspace.
 *
 * El encabezado se inserta ANTES de gastar la primera consulta y se actualiza al
 * final. Si el proceso se cae a mitad de camino, queda la fila con lo que
 * alcanzó a hacer: una evidencia parcial es evidencia, una corrida sin rastro no
 * se distingue de una corrida que nunca pasó.
 */
export async function ejecutarBarrido(
  workspaceId: string,
  hoyISO: string = todayBogotaISO(),
): Promise<ResumenBarrido> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const config = await cargarConfigMonitoreo(svc, workspaceId);
  const modo = modoDelBarrido(config);

  const { contrapartes, sinDocumento, truncado } = await cargarUniverso(svc, workspaceId, hoyISO);

  const seleccionados: Seleccionado[] = [];
  for (const c of contrapartes) {
    const ev = evaluarCandidato(
      {
        clave: c.clave,
        etiqueta: c.etiqueta,
        vigente_hasta: c.ultima.vigente_hasta,
        decidida_en: c.decidida_en,
      },
      hoyISO,
      config,
    );
    if (ev.barrer) {
      seleccionados.push({
        clave: c.clave,
        etiqueta: c.etiqueta,
        vigente_hasta: c.ultima.vigente_hasta,
        decidida_en: c.decidida_en,
        motivo: ev.motivo,
      });
    }
  }

  const consumidas = await consumidasEnPeriodo(svc, workspaceId, hoyISO);
  // En simulación el cupo es cero: se selecciona y se registra todo, no se
  // llama a la fuente ni una vez.
  const disponible = modo === 'ejecucion' ? cupoRestante(config, consumidas) : 0;
  const corte = aplicarTope(seleccionados, disponible);

  const resumen: ResumenBarrido = {
    barrido_id: null,
    modo,
    dia: hoyISO,
    cupo_periodo: config.cupo_periodo,
    consumidas_periodo_antes: consumidas,
    candidatos: seleccionados.length,
    ejecutadas: 0,
    diferidas: corte.diferidos.length,
    con_delta: 0,
    notificadas: 0,
    fallidas: 0,
    // En simulación nada se ejecuta, pero eso lo explica `modo`. Marcar corte
    // acá haría ver un tope apretado donde lo que falta es adoptarlo.
    corte_por_tope: modo === 'ejecucion' && corte.corte_por_tope,
    sin_documento: sinDocumento,
    universo_truncado: truncado,
  };

  const { data: cab } = await svc
    .from('compliance_barridos')
    .insert({
      workspace_id: workspaceId,
      dia: hoyISO,
      modo,
      cupo_periodo: config.cupo_periodo,
      consumidas_periodo_antes: consumidas,
      candidatos: seleccionados.length,
      diferidas: corte.diferidos.length,
      corte_por_tope: resumen.corte_por_tope,
    })
    .select('id')
    .single();

  const barridoId: string | null = cab?.id ?? null;
  resumen.barrido_id = barridoId;
  if (!barridoId) return resumen;

  const porClave = new Map(contrapartes.map((c) => [c.clave, c] as const));
  const slug = await slugDeWorkspace(svc, workspaceId);
  const oficiales = await oficialesDelWorkspace(svc, workspaceId);

  for (const s of corte.diferidos) {
    const c = porClave.get(s.clave);
    if (!c) continue;
    await svc.from('compliance_barrido_items').insert({
      barrido_id: barridoId,
      workspace_id: workspaceId,
      documento_tipo: c.documento_tipo,
      documento_numero: c.documento_numero,
      nombre: c.nombre,
      etiqueta: c.etiqueta,
      motivo: s.motivo,
      consulta_anterior_id: c.ultima.id,
      diferida: true,
    });
  }

  for (const s of corte.ejecutar) {
    const c = porClave.get(s.clave);
    if (!c) continue;
    const r = await barrerContraparte(svc, {
      workspaceId,
      barridoId,
      slug,
      contraparte: c,
      motivo: s.motivo,
      oficiales,
    });
    if (r.fallo) resumen.fallidas += 1;
    else resumen.ejecutadas += 1;
    if (r.delta) resumen.con_delta += 1;
    if (r.notificada) resumen.notificadas += 1;
  }

  await svc
    .from('compliance_barridos')
    .update({
      ejecutadas: resumen.ejecutadas,
      con_delta: resumen.con_delta,
      notificadas: resumen.notificadas,
      fallidas: resumen.fallidas,
    })
    .eq('id', barridoId);

  return resumen;
}

// ─── Universo ──────────────────────────────────────────────────────────────

/**
 * Reconstruye la bandeja para efectos del barrido: por contraparte, la ÚLTIMA
 * consulta concluyente y la etiqueta que produce.
 *
 * Solo contrapartes con documento. Una consulta hecha por nombre no se puede
 * atar con certeza a la misma persona en la siguiente vuelta, y un barrido que
 * cree estar cubriendo a alguien que no es, miente. Las que quedan afuera se
 * cuentan y se reportan: es el hueco real de la cobertura, no un detalle.
 */
async function cargarUniverso(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  hoyISO: string,
): Promise<{ contrapartes: Contraparte[]; sinDocumento: number; truncado: boolean }> {
  const { data: consultasRaw } = await svc
    .from('consultas_listas_dual')
    .select(
      'id, documento_tipo, documento_numero, nombre_consultado, tipo_persona, severidad, '
      + 'total_matches, matches, created_at, vigente_hasta, tier_maximo, segmento_id',
    )
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_CONSULTAS);

  const { data: liberacionesRaw } = await svc
    .from('compliance_liberaciones')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_LIBERACIONES);

  const consultas = (consultasRaw ?? []) as FilaConsulta[];
  const coberturas = indexarCoberturas(
    (liberacionesRaw ?? []) as ComplianceLiberacion[],
    hoyISO,
  );

  const porClave = new Map<string, Contraparte>();
  let sinDocumento = 0;

  for (const c of consultas) {
    // Solo las concluyentes definen población: una fila `error` no dice si la
    // contraparte está limpia o reportada, y tratarla como cualquiera de las dos
    // sería inventar un hecho.
    if (c.severidad !== 'alto' && c.severidad !== 'sin_hallazgo') continue;

    const clave = claveContraparte(c.documento_tipo, c.documento_numero);
    if (!clave) {
      if (c.severidad === 'alto') sinDocumento += 1;
      continue;
    }
    // Vienen ordenadas desc: la primera que aparece por clave es la última.
    if (porClave.has(clave)) continue;

    const cobertura = coberturas.get(clave) ?? {
      cubierta: false,
      motivo: 'sin_registro' as const,
      liberacion: null,
    };

    porClave.set(clave, {
      clave,
      documento_tipo: c.documento_tipo as string,
      documento_numero: c.documento_numero as string,
      nombre: c.nombre_consultado ?? null,
      tipo_persona: c.tipo_persona === 'juridica' ? 'juridica' : 'natural',
      ultima: c,
      etiqueta: etiquetaDeContraparte(c.severidad === 'alto', cobertura.motivo),
      decidida_en: cobertura.liberacion?.created_at?.slice(0, 10) ?? null,
    });
  }

  return {
    contrapartes: [...porClave.values()],
    sinDocumento,
    truncado: consultas.length >= LIMITE_CONSULTAS,
  };
}

// ─── Una contraparte ───────────────────────────────────────────────────────

type ResultadoItem = { fallo: boolean; delta: boolean; notificada: boolean };

async function barrerContraparte(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  ctx: {
    workspaceId: string;
    barridoId: string;
    slug: string | null;
    contraparte: Contraparte;
    motivo: 'vigencia_vencida' | 'sin_vigencia';
    oficiales: { id: string }[];
  },
): Promise<ResultadoItem> {
  const { contraparte: c } = ctx;

  const base = {
    barrido_id: ctx.barridoId,
    workspace_id: ctx.workspaceId,
    documento_tipo: c.documento_tipo,
    documento_numero: c.documento_numero,
    nombre: c.nombre,
    etiqueta: c.etiqueta,
    motivo: ctx.motivo,
    consulta_anterior_id: c.ultima.id,
    matches_antes: c.ultima.total_matches ?? 0,
  };

  if (!ctx.slug) {
    await svc.from('compliance_barrido_items').insert({
      ...base,
      error_mensaje: 'workspace_slug_no_encontrado',
    });
    return { fallo: true, delta: false, notificada: false };
  }

  const consulta = await consultarValida(ctx.slug, {
    tipo: c.tipo_persona,
    identificacion: c.documento_numero,
  });

  if (!consulta.ok) {
    // La consulta falló: se deja constancia y NO se persiste una fila de
    // historial. Una fila `error` en `consultas_listas_dual` sin vigencia
    // sacaría a la contraparte del barrido de mañana por no tener con qué
    // compararla — el fallo del proveedor se convertiría en un hueco silencioso.
    await svc.from('compliance_barrido_items').insert({
      ...base,
      error_mensaje: consulta.error.slice(0, 500),
    });
    return { fallo: true, delta: false, notificada: false };
  }

  const matches = Array.isArray(consulta.data.matches) ? consulta.data.matches : [];
  const total = consulta.data.total_matches ?? 0;
  const clasificacion = await clasificarParaGuardar(matches);
  const vigencia = await calcularVigenciaParaGuardar(ctx.workspaceId, clasificacion);

  const { data: filaNueva } = await svc
    .from('consultas_listas_dual')
    .insert({
      workspace_id: ctx.workspaceId,
      lote_id: null,
      tipo: 'puntual',
      tipo_persona: c.tipo_persona,
      nombre_consultado: c.nombre,
      documento_tipo: c.documento_tipo,
      documento_numero: c.documento_numero,
      titulo_lote: null,
      // El barrido no tiene usuario: lo hizo el motor, y firmarlo con el oficial
      // sería atribuirle un acto que no ejecutó.
      created_by: null,
      // Hereda el segmento de la consulta que revalida. Cambiarlo silenciosamente
      // movería a la contraparte de universo sin que nadie lo decidiera.
      segmento_id: c.ultima.segmento_id,
      dual_id: consulta.data.dual_id ?? null,
      severidad: total > 0 ? 'alto' : 'sin_hallazgo',
      total_matches: total,
      matches,
      ...clasificacion,
      ...vigencia,
    })
    .select('id')
    .single();

  const delta = compararConsultas(
    fotoDe(c.ultima.total_matches ?? 0, c.ultima.matches, c.ultima.tier_maximo),
    fotoDe(total, matches, clasificacion.tier_maximo),
  );
  const efecto = efectoDeDelta(c.etiqueta, delta);

  // Se notifica ANTES de escribir el item, para que la fila diga si la campanita
  // efectivamente sonó. Al reves, un insert de notificacion que falla quedaria
  // registrado como aviso entregado, que es la mentira mas cara de todo el modulo.
  let notificada = false;
  if (efecto.notifica && ctx.oficiales.length > 0) {
    notificada = await notificarOficiales(
      svc, ctx.workspaceId, ctx.oficiales, c, delta, efecto.premisa_cambiada,
    );
  }

  await svc.from('compliance_barrido_items').insert({
    ...base,
    consulta_nueva_id: filaNueva?.id ?? null,
    matches_ahora: total,
    fuentes_nuevas: delta.fuentes_nuevas.length > 0 ? delta.fuentes_nuevas : null,
    delta: delta.hay,
    notificada,
    habilita_reevaluacion: efecto.habilita_reevaluacion,
    // Hubo delta que exigia avisar y no habia a quien: el workspace no tiene
    // oficial con rol. Se dice, no se calla.
    error_mensaje: efecto.notifica && ctx.oficiales.length === 0
      ? 'sin_oficial_a_quien_notificar'
      : null,
  });

  return { fallo: false, delta: delta.hay, notificada };
}

function fotoDe(total: number, matchesRaw: unknown, tier: string | null): FotoConsulta {
  const matches = (Array.isArray(matchesRaw) ? matchesRaw : []) as InformaMatch[];
  return {
    total_matches: total,
    fuentes: matches.map((m) => m?.lista ?? m?.detalle?.lista ?? null),
    tier_maximo: (tier as TierResuelto | null) ?? null,
  };
}

// ─── Campanita ─────────────────────────────────────────────────────────────

async function notificarOficiales(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  oficiales: { id: string }[],
  c: Contraparte,
  delta: ReturnType<typeof compararConsultas>,
  premisaCambiada: boolean,
): Promise<boolean> {
  const quien = c.nombre?.trim() || `${c.documento_tipo} ${c.documento_numero}`;
  const contenido = premisaCambiada
    ? `${quien} cambió después de que la liberaras: pasó de ${delta.matches_antes} a ${delta.matches_ahora} reporte(s). La decisión que tomaste cubría los ${delta.matches_antes} anteriores.`
    : `${quien} aparece reportada: ${delta.matches_ahora} reporte(s) donde antes no había ninguno.`;

  const filas = oficiales.map((o) => ({
    workspace_id: workspaceId,
    destinatario_id: o.id,
    tipo: 'compliance_delta_contraparte',
    estado: 'pendiente',
    contenido,
    entidad_tipo: null,
    entidad_id: null,
    deep_link: '/compliance/liberaciones',
    metadata: {
      documento_tipo: c.documento_tipo,
      documento_numero: c.documento_numero,
      etiqueta: c.etiqueta,
      matches_antes: delta.matches_antes,
      matches_ahora: delta.matches_ahora,
      fuentes_nuevas: delta.fuentes_nuevas,
      premisa_cambiada: premisaCambiada,
    },
  }));

  const { error } = await svc.from('notificaciones').insert(filas);
  return !error;
}

// ─── Acceso a datos ────────────────────────────────────────────────────────

export async function cargarConfigMonitoreo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
): Promise<ConfigMonitoreo> {
  const { data } = await svc
    .from('compliance_monitoreo_config')
    .select('cupo_periodo, horizonte_rechazadas_meses')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  return {
    cupo_periodo: typeof data?.cupo_periodo === 'number' ? data.cupo_periodo : null,
    horizonte_rechazadas_meses:
      typeof data?.horizonte_rechazadas_meses === 'number'
        ? data.horizonte_rechazadas_meses
        : DEFAULT_HORIZONTE_RECHAZADAS_MESES,
  };
}

/**
 * Lo que el MOTOR lleva gastado en el periodo, no lo que gastó el workspace.
 *
 * Topar el gasto total haría que el cron se apagara porque el equipo trabajó,
 * que es el fallo al revés: la consulta que una persona dispara es deliberada y
 * alguien la está mirando. Lo que nadie mira es el barrido automático, y es lo
 * que este tope contiene.
 */
async function consumidasEnPeriodo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  hoyISO: string,
): Promise<number> {
  const { data } = await svc
    .from('compliance_barridos')
    .select('ejecutadas')
    .eq('workspace_id', workspaceId)
    .gte('dia', inicioDePeriodo(hoyISO))
    .lte('dia', hoyISO);

  return ((data ?? []) as { ejecutadas: number | null }[])
    .reduce((acc, f) => acc + (f.ejecutadas ?? 0), 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function slugDeWorkspace(svc: any, workspaceId: string): Promise<string | null> {
  const { data } = await svc.from('workspaces').select('slug').eq('id', workspaceId).maybeSingle();
  return data?.slug ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function oficialesDelWorkspace(svc: any, workspaceId: string): Promise<{ id: string }[]> {
  const { data } = await svc
    .from('profiles')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('role', ['owner', 'admin']);
  return (data ?? []) as { id: string }[];
}

// ─── La fuente ─────────────────────────────────────────────────────────────

type RespuestaValida = { dual_id?: string; total_matches?: number; matches?: InformaMatch[] };

/**
 * Misma ruta y mismo contrato que `consultaDual()`, con el slug por parámetro.
 *
 * No se reutiliza aquella porque resuelve el workspace desde la sesión, y el
 * cron no tiene sesión. Envolverla habría exigido exportar desde un archivo
 * `'use server'` una función que recibe workspace por parámetro: un endpoint
 * público sin dueño.
 */
async function consultarValida(
  slug: string,
  input: { tipo: 'natural' | 'juridica'; identificacion: string },
): Promise<{ ok: true; data: RespuestaValida } | { ok: false; error: string }> {
  const key = process.env.VALIDA_API_KEY;
  if (!key) return { ok: false, error: 'VALIDA_API_KEY no esta configurada' };

  try {
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/compliance/dual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        workspace_origen: slug,
        tipo: input.tipo,
        identificacion: input.identificacion,
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const texto = await res.text().catch(() => '');
      return { ok: false, error: `valida_${res.status}: ${texto.slice(0, 200)}` };
    }
    return { ok: true, data: (await res.json()) as RespuestaValida };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' };
  }
}
