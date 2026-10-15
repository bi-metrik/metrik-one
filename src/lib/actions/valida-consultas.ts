'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { credencialValida, VALIDA_API_BASE } from '@/lib/valida/credencial-servidor';
import { motivoCorteDeError } from '@/lib/valida/corte-bolsa';
import { resolverNombresUsuarios } from './_usuarios';
import { accesoValida as accesoValidaBase } from '@/lib/valida/acceso-servidor';
import { llamarValida, persistirConsulta, recalcularScoreNegocio } from '@/lib/valida/consulta-servidor';
import * as XLSX from 'xlsx';
import { getCachedUser } from '@/lib/supabase/auth-user'

// ─── Types ────────────────────────────────────────────────────────────────

export type TipoPersona = 'natural' | 'juridica';
export type TipoDocumento = 'CC' | 'CE' | 'NIT' | 'PAS';
export type Severidad = 'alto' | 'medio' | 'bajo' | 'informativo' | 'sin_hallazgo' | 'error';
export type TierLista = '1_vinculante' | '2_obligatoria' | '3_referencia' | '4_kyc_nacional';

export type DatoCoincidencia = { tipo: string; numero: string; pais?: string | null };
export type DerivadoDe = { tipo: 'nombre' | 'documento'; valor: string; lista_nombre: string };

export type ValidaMatch = {
  lista: string;
  lista_nombre: string;
  tier: TierLista;
  vinculante_colombia: boolean;
  nombre_coincidencia: string;
  score: number;
  resultado: 'exacto' | 'posible';
  fundamento_legal: string | null;
  match_por?: string | null;
  // Dato complementario que aporta la coincidencia (el "dato faltante"), como dato DE LA
  // coincidencia — no identidad confirmada del consultado.
  documento_coincidencia?: DatoCoincidencia | null;
  // true si proviene del segundo pase (revalidación con el dato complementario hallado).
  derivado?: boolean;
  derivado_de?: DerivadoDe | null;
};

export type ValidaResultado = {
  consulta_id: string;
  severidad: Severidad;
  total_matches: number;
  matches: ValidaMatch[];
  hash_reporte: string;
  fecha_reporte: string;
  // Consulta con un solo dato identificador (solo nombre o solo documento) → cobertura parcial.
  consulta_parcial?: boolean;
};

export type ValidaConsultaInput = {
  tipo: TipoPersona;
  // nombre y documento son opcionales; se exige al menos uno (validado en el form y en Valida).
  nombre?: string;
  documento?: { tipo: TipoDocumento; numero: string };
};

export type ConsultaHistorialItem = {
  id: string;
  tipo: 'puntual' | 'masiva_item';
  tipo_persona: TipoPersona;
  nombre_consultado: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
  severidad: Severidad;
  total_matches: number;
  valida_consulta_id: string | null;
  hash_reporte: string | null;
  matches: ValidaMatch[] | null;
  created_at: string;
  created_by: string | null;
  consultado_por: string | null;
  negocio_id: string | null;
  negocio_codigo: string | null;
  negocio_nombre: string | null;
  lote_id: string | null;
};

export type FiltrosHistorial = {
  negocio_id?: string;
  severidad?: Severidad;
  tipo?: 'puntual' | 'masiva_item';
  fecha_desde?: string;
  fecha_hasta?: string;
  limite?: number;
};

export type NegocioBusqueda = {
  id: string;
  codigo: string;
  nombre: string;
  estado: string;
};

export type FilaLotePreparada = {
  posicion: number;
  input: ValidaConsultaInput;
  negocio_id: string | null;
  error: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * La puerta de todo el módulo (ver `@/lib/valida/acceso-servidor`). Aquí el «no» viaja al navegador
 * tal cual, sin el `workspaceId` que la puerta trae para el cargue masivo.
 */
async function accesoValida(
  opts: { consultaNueva?: boolean } = {},
): Promise<{ ok: true; workspaceId: string } | { ok: false; error: string }> {
  const r = await accesoValidaBase(opts);
  return r.ok ? r : { ok: false, error: r.error };
}

async function getWorkspaceValidaApiKey(workspaceId: string): Promise<string | null> {
  return (await credencialValida(workspaceId)).llave;
}

/**
 * En el REINTENTO de una fila del cargue masivo: ¿el primer intento ya alcanzo a guardar esta
 * misma consulta con resultado? Un `Load failed` en el navegador no dice si el server action
 * corrio; si corrio, la consulta ya se cobro y se guardo, y volver a llamar a Valida la
 * cobraria dos veces y la duplicaria en el reporte del lote.
 *
 * Se compara por lote + persona consultada. Limite conocido: si el XLSX trae a la MISMA
 * persona dos veces y la segunda fila cae en reintento, devuelve el resultado de la primera
 * (mismo resultado, una fila menos en el reporte). Solo ocurre en reintentos.
 */
async function consultaYaGuardadaEnLote(
  workspaceId: string,
  loteId: string,
  input: ValidaConsultaInput,
): Promise<{ id: string; data: ValidaResultado } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('valida_consultas')
    .select('id, valida_consulta_id, severidad, total_matches, matches, hash_reporte, created_at, nombre_consultado, documento_tipo, documento_numero')
    .eq('workspace_id', workspaceId)
    .eq('lote_id', loteId)
    .eq('tipo_persona', input.tipo)
    .not('valida_consulta_id', 'is', null);
  if (error || !Array.isArray(data)) return null;

  const nombre = input.nombre || null;
  const docTipo = input.documento?.tipo ?? null;
  const docNumero = input.documento?.numero ?? null;
  const fila = (data as Array<Record<string, unknown>>).find(
    r =>
      typeof r.valida_consulta_id === 'string' &&
      (r.nombre_consultado ?? null) === nombre &&
      (r.documento_tipo ?? null) === docTipo &&
      (r.documento_numero ?? null) === docNumero,
  );
  if (!fila) return null;
  return {
    id: fila.id as string,
    data: {
      consulta_id: fila.valida_consulta_id as string,
      severidad: fila.severidad as Severidad,
      total_matches: (fila.total_matches as number) ?? 0,
      matches: (fila.matches as ValidaMatch[]) ?? [],
      hash_reporte: (fila.hash_reporte as string) ?? '',
      fecha_reporte: (fila.created_at as string) ?? '',
    },
  };
}

/**
 * El negocio existe y pertenece al workspace de la sesion. No se exporta: en un archivo
 * `'use server'` todo export es un endpoint.
 *
 * Todo lo de este archivo lee y escribe con el cliente de servicio, asi que un
 * `negocio_id` que llega del navegador no lo filtra nadie mas: sin esta comprobacion, con
 * el id de un negocio ajeno la consulta quedaba atada a el, se le recalculaba y persistia
 * el score SARLAFT (el mismo hueco que el #752 cerro en `valida-score.ts`, por otra
 * puerta) y el historial devolvia su codigo y su nombre.
 */
async function negocioEsDelWorkspace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  negocioId: string,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await svc
    .from('negocios')
    .select('id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return Boolean(data);
}

// ─── Consulta puntual + items de lote ─────────────────────────────────────

export async function consultarValida(
  input: ValidaConsultaInput,
  // `reintento`: lo manda el cargue masivo cuando repite una fila que fallo por red (ver
  // `consultaYaGuardadaEnLote`). Solo tiene efecto con `lote_id`.
  opts: { negocio_id?: string | null; lote_id?: string | null; reintento?: boolean } = {}
): Promise<
  | { ok: true; data: ValidaResultado; consulta_local_id: string }
  | { ok: false; error: string }
> {
  const acceso = await accesoValida({ consultaNueva: true });
  if (!acceso.ok) return acceso;
  const workspaceId = acceso.workspaceId;

  const { user } = await getCachedUser();

  // Antes de gastar la consulta: un negocio ajeno se trata igual que uno inexistente, y
  // no se llama a Valida (cada consulta se cobra) ni se persiste nada.
  if (opts.negocio_id && !(await negocioEsDelWorkspace(createServiceClient(), opts.negocio_id, workspaceId))) {
    return { ok: false, error: 'negocio_no_encontrado' };
  }

  const { llave: apiKey, prueba } = await credencialValida(workspaceId);
  if (!apiKey) return { ok: false, error: 'valida_api_key_no_configurada' };

  if (opts.reintento && opts.lote_id) {
    const previa = await consultaYaGuardadaEnLote(workspaceId, opts.lote_id, input);
    if (previa) return { ok: true, data: previa.data, consulta_local_id: previa.id };
  }

  const resultado = await llamarValida(apiKey, input);

  // Corte de la bolsa (agotada, vencida, o la llave de prueba que venció con ella): Valida no
  // registró ni cobró la consulta, así que tampoco se guarda aquí. Guardarla como error llenaba el
  // historial con una fila por cada intento después del corte. La pantalla lo convierte en
  // «Activa tu plan» (ver `@/lib/valida/corte-bolsa`).
  if (!resultado.ok) {
    const corte = motivoCorteDeError(resultado.error, prueba);
    if (corte) return { ok: false, error: corte };
  }

  const persisted = await persistirConsulta({
    workspaceId,
    userId: user?.id ?? null,
    negocioId: opts.negocio_id ?? null,
    loteId: opts.lote_id ?? null,
    tipo: opts.lote_id ? 'masiva_item' : 'puntual',
    input,
    resultado,
  });

  if (!resultado.ok) return { ok: false, error: resultado.error };
  if (!persisted.ok) return { ok: false, error: persisted.error };

  // Recalcular score SARLAFT del negocio si tiene datos configurados
  if (opts.negocio_id) await recalcularScoreNegocio(workspaceId, opts.negocio_id);

  return { ok: true, data: resultado.data, consulta_local_id: persisted.id };
}

// ─── Plantilla XLSX ───────────────────────────────────────────────────────

export async function descargarPlantillaValida(
  opts: { sinNegocio?: boolean } = {},
): Promise<
  { ok: true; data: { base64: string; filename: string } } | { ok: false; error: string }
> {
  try {
    // En modo vitrina (workspaces Valida-only) la columna `negocio_codigo` no
    // aplica — no hay negocios a los que atar consultas. Se omite del template.
    const sinNegocio = opts.sinNegocio === true;
    const wb = XLSX.utils.book_new();
    const headers = sinNegocio
      ? [
          ['tipo_persona', 'nombre_completo', 'tipo_documento', 'numero_documento'],
          ['natural', 'Juan Perez Gomez', 'CC', '1077089147'],
          ['juridica', 'Acme Trading SAS', 'NIT', '900123456'],
          ['natural', 'Maria Rodriguez', '', ''],
        ]
      : [
          ['tipo_persona', 'nombre_completo', 'tipo_documento', 'numero_documento', 'negocio_codigo'],
          ['natural', 'Juan Perez Gomez', 'CC', '1077089147', ''],
          ['juridica', 'Acme Trading SAS', 'NIT', '900123456', 'C1 26 1'],
          ['natural', 'Maria Rodriguez', '', '', ''],
        ];
    const ws = XLSX.utils.aoa_to_sheet(headers);
    ws['!cols'] = sinNegocio
      ? [{ wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 18 }]
      : [{ wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Consultas');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return {
      ok: true,
      data: {
        base64: buf.toString('base64'),
        filename: 'valida_plantilla_masiva.xlsx',
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_plantilla' };
  }
}

// ─── Descargar PDF reporte individual ─────────────────────────────────────

export async function descargarPDFConsultaValida(
  validaConsultaId: string
): Promise<
  { ok: true; data: { base64: string; filename: string } } | { ok: false; error: string }
> {
  const acceso = await accesoValida();
  if (!acceso.ok) return acceso;
  const workspaceId = acceso.workspaceId;

  const apiKey = await getWorkspaceValidaApiKey(workspaceId);
  if (!apiKey) return { ok: false, error: 'valida_api_key_no_configurada' };

  try {
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/reporte/${validaConsultaId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      ok: true,
      data: {
        base64: buf.toString('base64'),
        filename: `valida-reporte-${validaConsultaId.slice(0, 8)}.pdf`,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_pdf' };
  }
}

// ─── Generar PDF de lote completo ─────────────────────────────────────────

export async function generarPDFLoteValida(
  loteId: string,
  titulo?: string | null
): Promise<
  { ok: true; data: { base64: string; filename: string } } | { ok: false; error: string }
> {
  const acceso = await accesoValida();
  if (!acceso.ok) return acceso;
  const workspaceId = acceso.workspaceId;

  const apiKey = await getWorkspaceValidaApiKey(workspaceId);
  if (!apiKey) return { ok: false, error: 'valida_api_key_no_configurada' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data: rows, error } = await svc
    .from('valida_consultas')
    .select('valida_consulta_id, created_at')
    .eq('workspace_id', workspaceId)
    .eq('lote_id', loteId)
    .not('valida_consulta_id', 'is', null)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: error.message };

  const consultaIds = (rows ?? [])
    .map((r: { valida_consulta_id: string | null }) => r.valida_consulta_id)
    .filter((id: string | null): id is string => typeof id === 'string' && id.length > 0);

  if (consultaIds.length === 0) {
    return { ok: false, error: 'lote_sin_consultas_validas' };
  }

  try {
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/reporte-lote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        consulta_ids: consultaIds,
        titulo: titulo ?? null,
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      ok: true,
      data: {
        base64: buf.toString('base64'),
        filename: `valida-cargue-${loteId.slice(0, 8)}.pdf`,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_pdf_lote' };
  }
}

// ─── Historial ────────────────────────────────────────────────────────────

export async function listarConsultasValida(
  filtros: FiltrosHistorial = {}
): Promise<{ ok: true; consultas: ConsultaHistorialItem[] } | { ok: false; error: string }> {
  const acceso = await accesoValida();
  if (!acceso.ok) return acceso;
  const workspaceId = acceso.workspaceId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  let q = svc
    .from('valida_consultas')
    .select('id, tipo, tipo_persona, nombre_consultado, documento_tipo, documento_numero, severidad, total_matches, valida_consulta_id, hash_reporte, matches, created_at, created_by, negocio_id, lote_id')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(filtros.limite ?? 200);

  if (filtros.negocio_id) q = q.eq('negocio_id', filtros.negocio_id);
  if (filtros.severidad) q = q.eq('severidad', filtros.severidad);
  if (filtros.tipo) q = q.eq('tipo', filtros.tipo);
  if (filtros.fecha_desde) q = q.gte('created_at', filtros.fecha_desde);
  if (filtros.fecha_hasta) q = q.lte('created_at', filtros.fecha_hasta);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  // Resolver datos de negocios
  const negocioIds = Array.from(
    new Set((data ?? []).map((r: { negocio_id: string | null }) => r.negocio_id).filter(Boolean))
  ) as string[];
  const negocioMap = new Map<string, { codigo: string; nombre: string }>();
  if (negocioIds.length > 0) {
    // Con el workspace: una fila vieja atada a un negocio ajeno (antes de la guarda de
    // `consultarValida`) sale sin codigo ni nombre en vez de mostrar los del otro.
    const { data: negs } = await svc.from('negocios')
      .select('id, codigo, nombre')
      .eq('workspace_id', workspaceId)
      .in('id', negocioIds);
    for (const n of (negs ?? []) as Array<{ id: string; codigo: string; nombre: string }>) {
      negocioMap.set(n.id, { codigo: n.codigo, nombre: n.nombre });
    }
  }

  // Resolver usuario que realizo cada consulta (trazabilidad)
  const userMap = await resolverNombresUsuarios(svc, (data ?? []).map((r: { created_by: string | null }) => r.created_by));

  const items: ConsultaHistorialItem[] = (data ?? []).map((r: Record<string, unknown>) => {
    const negId = r.negocio_id as string | null;
    const neg = negId ? negocioMap.get(negId) : null;
    return {
      id: r.id as string,
      tipo: r.tipo as 'puntual' | 'masiva_item',
      tipo_persona: r.tipo_persona as TipoPersona,
      nombre_consultado: r.nombre_consultado as string | null,
      documento_tipo: r.documento_tipo as string | null,
      documento_numero: r.documento_numero as string | null,
      severidad: r.severidad as Severidad,
      total_matches: r.total_matches as number,
      valida_consulta_id: r.valida_consulta_id as string | null,
      hash_reporte: r.hash_reporte as string | null,
      matches: r.matches as ValidaMatch[] | null,
      created_at: r.created_at as string,
      created_by: r.created_by as string | null,
      consultado_por: r.created_by ? (userMap.get(r.created_by as string) ?? null) : null,
      negocio_id: negId,
      negocio_codigo: neg?.codigo ?? null,
      negocio_nombre: neg?.nombre ?? null,
      lote_id: r.lote_id as string | null,
    };
  });

  return { ok: true, consultas: items };
}

export async function listarConsultasPorNegocio(
  negocioId: string
): Promise<{ ok: true; consultas: ConsultaHistorialItem[] } | { ok: false; error: string }> {
  return listarConsultasValida({ negocio_id: negocioId, limite: 100 });
}

// ─── Buscador de negocios para dropdown (incluye cerrados) ────────────────

export async function buscarNegociosParaValida(
  query: string
): Promise<{ ok: true; negocios: NegocioBusqueda[] } | { ok: false; error: string }> {
  const acceso = await accesoValida();
  if (!acceso.ok) return acceso;
  const workspaceId = acceso.workspaceId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const trimmed = query.trim();

  let q = svc
    .from('negocios')
    .select('id, codigo, nombre, estado')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (trimmed.length > 0) {
    q = q.or(`codigo.ilike.%${trimmed}%,nombre.ilike.%${trimmed}%`);
  }

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    negocios: (data ?? []) as NegocioBusqueda[],
  };
}
