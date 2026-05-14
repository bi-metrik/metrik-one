import { createServiceClient } from '@/lib/supabase/server';
import {
  type ConfigPersistida,
  type SeveridadValida,
  PRESETS,
  SCORE_CALIDAD_VERIFICADO,
  SCORE_CRITICIDAD_CARGO,
  SCORE_ENDEUDAMIENTO,
  SCORE_FORMA_OPERACION,
  SCORE_TIPO_CONTRATO,
  UMBRALES_DEFAULT,
  frecuenciaMesesDesdeNivel,
  nivelDesdePuntaje,
  scorePEPListasDesdeValida,
} from '@/lib/valida/segmentacion-presets';

/**
 * Cálculo de score de segmentación SARLAFT por negocio.
 * Combina la configuración activa del workspace + datos SARLAFT del negocio +
 * última consulta Valida. Spec autorizada por Lucia.
 */

export type FactoresAplicados = {
  pais?: { score: number; peso: number; aporte: number; valor: string | null };
  municipio?: { score: number; peso: number; aporte: number; valor: string | null };
  ciiu?: { score: number; peso: number; aporte: number; valor: string | null };
  calidad_verificado?: { score: number; peso: number; aporte: number; valor: string | null };
  forma_operacion?: { score: number; peso: number; aporte: number; valor: string | null };
  tipo_contrato?: { score: number; peso: number; aporte: number; valor: string | null };
  criticidad_cargo?: { score: number; peso: number; aporte: number; valor: string | null };
  endeudamiento?: { score: number; peso: number; aporte: number; valor: string | null };
  pep_listas: { score: number; peso: number; aporte: number; severidad: SeveridadValida | null; bandera: string | null };
};

export type ResultadoScore = {
  puntaje: number;
  nivel: 'alto' | 'medio' | 'bajo';
  frecuencia_meses: number;
  proxima_revision: string; // ISO date
  factores_aplicados: FactoresAplicados;
  valida_consulta_id_ultima: string | null;
};

type DatosSarlaft = {
  universo: 'contraparte' | 'empleado';
  pais_codigo_iso: string | null;
  municipio_divipola: string | null;
  ciiu_codigo: string | null;
  calidad_verificado: string | null;
  forma_operacion: string | null;
  tipo_contrato: string | null;
  criticidad_cargo: string | null;
  endeudamiento: string | null;
};

type ConsultaUltima = {
  id: string;
  severidad: SeveridadValida;
} | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getConfig(svc: any, workspaceId: string): Promise<ConfigPersistida> {
  const { data } = await svc
    .from('valida_segmentacion_config')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!data) {
    const base = PRESETS.sector_real_general;
    return {
      preset: base.preset,
      pesos_contrapartes: base.pesos_contrapartes,
      pesos_empleados: base.pesos_empleados,
      umbrales_contrapartes: UMBRALES_DEFAULT,
      umbrales_empleados: UMBRALES_DEFAULT,
      disclaimer_aceptado: false,
      version: 0,
      aplicada_at: null,
      aplicada_por: null,
    };
  }

  const umbralesC = (data.umbrales_contrapartes && Object.keys(data.umbrales_contrapartes).length > 0)
    ? data.umbrales_contrapartes
    : UMBRALES_DEFAULT;
  const umbralesE = (data.umbrales_empleados && Object.keys(data.umbrales_empleados).length > 0)
    ? data.umbrales_empleados
    : UMBRALES_DEFAULT;

  return {
    preset: data.preset,
    pesos_contrapartes: data.pesos_contrapartes,
    pesos_empleados: data.pesos_empleados,
    umbrales_contrapartes: umbralesC,
    umbrales_empleados: umbralesE,
    disclaimer_aceptado: data.disclaimer_aceptado,
    version: data.version,
    aplicada_at: data.aplicada_at,
    aplicada_por: data.aplicada_por,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDatos(svc: any, negocioId: string): Promise<DatosSarlaft | null> {
  const { data } = await svc
    .from('valida_sarlaft_datos_negocio')
    .select('universo, pais_codigo_iso, municipio_divipola, ciiu_codigo, calidad_verificado, forma_operacion, tipo_contrato, criticidad_cargo, endeudamiento')
    .eq('negocio_id', negocioId)
    .maybeSingle();
  return (data ?? null) as DatosSarlaft | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getUltimaConsulta(svc: any, workspaceId: string, negocioId: string): Promise<ConsultaUltima> {
  const { data } = await svc
    .from('valida_consultas')
    .select('id, valida_consulta_id, severidad')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.valida_consulta_id ?? data.id,
    severidad: data.severidad as SeveridadValida,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scorePais(svc: any, codigoIso: string | null): Promise<{ score: number; nombre: string | null }> {
  if (!codigoIso) return { score: 1, nombre: null };
  const { data } = await svc.from('valida_dict_paises').select('score, nombre').eq('codigo_iso', codigoIso).maybeSingle();
  if (!data) return { score: 1, nombre: codigoIso };
  return { score: data.score, nombre: data.nombre };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scoreMunicipio(svc: any, divipola: string | null): Promise<{ score: number; nombre: string | null }> {
  if (!divipola) return { score: 1, nombre: null };
  const { data } = await svc.from('valida_dict_municipios').select('score, municipio').eq('divipola', divipola).maybeSingle();
  if (!data) return { score: 1, nombre: divipola };
  return { score: data.score, nombre: data.municipio };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scoreCIIU(svc: any, workspaceId: string, codigo: string | null): Promise<{ score: number; descripcion: string | null }> {
  if (!codigo) return { score: 1, descripcion: null };
  // Override local primero
  const { data: override } = await svc
    .from('valida_segmentacion_ciiu_override')
    .select('score')
    .eq('workspace_id', workspaceId)
    .eq('codigo_ciiu', codigo)
    .maybeSingle();
  if (override) {
    return { score: override.score, descripcion: codigo };
  }
  const { data } = await svc.from('valida_dict_ciiu').select('score, descripcion').eq('codigo', codigo).maybeSingle();
  if (!data) return { score: 1, descripcion: codigo };
  return { score: data.score, descripcion: data.descripcion };
}

// ─── Función principal ───────────────────────────────────────────────────

export async function calcularScoreNegocio(input: {
  workspaceId: string;
  negocioId: string;
}): Promise<{ ok: true; resultado: ResultadoScore } | { ok: false; error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const datos = await getDatos(svc, input.negocioId);
  if (!datos) {
    return { ok: false, error: 'datos_sarlaft_no_configurados' };
  }

  const config = await getConfig(svc, input.workspaceId);
  const consulta = await getUltimaConsulta(svc, input.workspaceId, input.negocioId);

  const universo = datos.universo;
  const pesos = universo === 'contraparte' ? config.pesos_contrapartes : config.pesos_empleados;
  const umbrales = universo === 'contraparte' ? config.umbrales_contrapartes : config.umbrales_empleados;

  // Score Valida
  const pepValida = consulta ? scorePEPListasDesdeValida(consulta.severidad) : { score: 1, bandera: null, reintentar: false };
  const aportePep = pepValida.score * pesos.pep_listas;

  const factores: FactoresAplicados = {
    pep_listas: {
      score: pepValida.score,
      peso: pesos.pep_listas,
      aporte: aportePep,
      severidad: consulta?.severidad ?? null,
      bandera: pepValida.bandera,
    },
  };

  let puntaje = aportePep;

  if (universo === 'contraparte') {
    const pesoContraparte = pesos as typeof config.pesos_contrapartes;

    const sPais = await scorePais(svc, datos.pais_codigo_iso);
    factores.pais = { score: sPais.score, peso: pesoContraparte.pais, aporte: sPais.score * pesoContraparte.pais, valor: sPais.nombre };
    puntaje += factores.pais.aporte;

    const sCiiu = await scoreCIIU(svc, input.workspaceId, datos.ciiu_codigo);
    factores.ciiu = { score: sCiiu.score, peso: pesoContraparte.ciiu, aporte: sCiiu.score * pesoContraparte.ciiu, valor: sCiiu.descripcion };
    puntaje += factores.ciiu.aporte;

    const sCalidad = datos.calidad_verificado ? (SCORE_CALIDAD_VERIFICADO[datos.calidad_verificado] ?? 1) : 1;
    factores.calidad_verificado = { score: sCalidad, peso: pesoContraparte.calidad_verificado, aporte: sCalidad * pesoContraparte.calidad_verificado, valor: datos.calidad_verificado };
    puntaje += factores.calidad_verificado.aporte;

    const sForma = datos.forma_operacion ? (SCORE_FORMA_OPERACION[datos.forma_operacion] ?? 1) : 1;
    factores.forma_operacion = { score: sForma, peso: pesoContraparte.forma_operacion, aporte: sForma * pesoContraparte.forma_operacion, valor: datos.forma_operacion };
    puntaje += factores.forma_operacion.aporte;
  } else {
    const pesoEmpleado = pesos as typeof config.pesos_empleados;

    const sMun = await scoreMunicipio(svc, datos.municipio_divipola);
    factores.municipio = { score: sMun.score, peso: pesoEmpleado.ubicacion, aporte: sMun.score * pesoEmpleado.ubicacion, valor: sMun.nombre };
    puntaje += factores.municipio.aporte;

    const sCont = datos.tipo_contrato ? (SCORE_TIPO_CONTRATO[datos.tipo_contrato] ?? 1) : 1;
    factores.tipo_contrato = { score: sCont, peso: pesoEmpleado.tipo_contrato, aporte: sCont * pesoEmpleado.tipo_contrato, valor: datos.tipo_contrato };
    puntaje += factores.tipo_contrato.aporte;

    const sCrit = datos.criticidad_cargo ? (SCORE_CRITICIDAD_CARGO[datos.criticidad_cargo] ?? 1) : 1;
    factores.criticidad_cargo = { score: sCrit, peso: pesoEmpleado.criticidad_cargo, aporte: sCrit * pesoEmpleado.criticidad_cargo, valor: datos.criticidad_cargo };
    puntaje += factores.criticidad_cargo.aporte;

    const sEnd = datos.endeudamiento ? (SCORE_ENDEUDAMIENTO[datos.endeudamiento] ?? 1) : 1;
    factores.endeudamiento = { score: sEnd, peso: pesoEmpleado.endeudamiento, aporte: sEnd * pesoEmpleado.endeudamiento, valor: datos.endeudamiento };
    puntaje += factores.endeudamiento.aporte;
  }

  const nivel = nivelDesdePuntaje(puntaje, umbrales);
  const frecMeses = frecuenciaMesesDesdeNivel(nivel, umbrales);
  const proxima = new Date();
  proxima.setMonth(proxima.getMonth() + frecMeses);

  return {
    ok: true,
    resultado: {
      puntaje: Number(puntaje.toFixed(2)),
      nivel,
      frecuencia_meses: frecMeses,
      proxima_revision: proxima.toISOString().slice(0, 10),
      factores_aplicados: factores,
      valida_consulta_id_ultima: consulta?.id ?? null,
    },
  };
}

export async function persistirScore(input: {
  workspaceId: string;
  negocioId: string;
  universo: 'contraparte' | 'empleado';
  resultado: ResultadoScore;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { error } = await svc.from('valida_score_negocio').upsert(
    {
      negocio_id: input.negocioId,
      workspace_id: input.workspaceId,
      universo: input.universo,
      puntaje: input.resultado.puntaje,
      nivel: input.resultado.nivel,
      factores_aplicados: input.resultado.factores_aplicados,
      valida_consulta_id_ultima: input.resultado.valida_consulta_id_ultima,
      proxima_revision: input.resultado.proxima_revision,
      actualizado_at: new Date().toISOString(),
    },
    { onConflict: 'negocio_id' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
