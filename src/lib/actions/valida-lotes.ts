'use server';

import * as XLSX from 'xlsx';
import { textoLatinoProfundo } from '@/lib/texto/texto-latino';
import { createServiceClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/supabase/auth-user';
import { accesoValida } from '@/lib/valida/acceso-servidor';
import { credencialValida, leerSaldoValida, VALIDA_API_BASE } from '@/lib/valida/credencial-servidor';
import type { MotivoCorte } from '@/lib/valida/corte-bolsa';
import {
  CONSULTAS_POR_PDF,
  FILAS_PARA_AVISO_CORREO,
  TOPE_FILAS_LOTE,
  autorizadoHasta,
  filaConsume,
  filasDesdeXlsx,
  loteActivo,
  partesDelPdf,
  recortarAlSaldo,
  textoPausa,
  type EstadoLote,
  type FilaXLSX,
} from '@/lib/valida/lote';
import { despertarTrabajador, pausarLote } from '@/lib/valida/lote-servidor';

/**
 * El cargue masivo de Valida, del lado de la pantalla (2026-10-15). El archivo se sube UNA vez: aquí
 * se valida, se compara contra la bolsa y se guarda como lote; las filas las procesa el trabajador del
 * servidor (`@/lib/valida/lote-servidor`) aunque la pestaña se cierre. La pantalla solo pregunta el
 * progreso.
 *
 * Toda acción pasa por `accesoValida` (la misma puerta de la consulta puntual). Crear, reanudar y
 * preguntar el progreso de un lote activo exigen la de CONSULTA NUEVA, y cada vez que pasa renueva la
 * autorización del lote; si no pasa, el lote se pausa.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any;

export type LoteVista = {
  id: string;
  titulo: string | null;
  estado: EstadoLote;
  motivoPausa: string | null;
  textoPausa: string | null;
  total: number;
  omitidas: number;
  procesadas: number;
  severidades: Record<string, number>;
  /** Cuántos PDF salen del lote (500 consultas por PDF). */
  partesPdf: number;
  /** El lote avisa por correo al terminar o detenerse. */
  avisaPorCorreo: boolean;
  creadoEn: string;
};

type Resultado<T> = ({ ok: true } & T) | { ok: false; error: string };

const CAMPOS_LOTE =
  'id, workspace_id, titulo, estado, motivo_pausa, detalle_pausa, total, omitidas, procesadas, severidades, created_at, turno_hasta, despertado_at';

type FilaLoteDb = {
  id: string;
  workspace_id: string;
  titulo: string | null;
  estado: EstadoLote;
  motivo_pausa: string | null;
  detalle_pausa: string | null;
  total: number;
  omitidas: number;
  procesadas: number;
  severidades: Record<string, number> | null;
  created_at: string;
  turno_hasta: string | null;
  despertado_at: string | null;
};

const MENSAJE_LOTE_EN_CURSO = 'Ya hay un cargue en curso en tu espacio. Espera a que termine o cancélalo para empezar otro.';

async function vista(svc: Svc, l: FilaLoteDb): Promise<LoteVista> {
  let partesPdf = 0;
  if (!loteActivo(l.estado) && l.estado !== 'preparando') {
    const { count } = await svc
      .from('valida_lote_filas')
      .select('id', { count: 'exact', head: true })
      .eq('lote_id', l.id)
      .not('valida_consulta_id', 'is', null);
    partesPdf = partesDelPdf(count ?? 0);
  }
  return {
    id: l.id,
    titulo: l.titulo,
    estado: l.estado,
    motivoPausa: l.estado === 'pausado' ? l.motivo_pausa : null,
    textoPausa: l.estado === 'pausado' ? textoPausa(l.motivo_pausa, l.detalle_pausa) : null,
    total: l.total,
    omitidas: l.omitidas,
    procesadas: l.procesadas,
    severidades: l.severidades ?? {},
    partesPdf,
    avisaPorCorreo: l.total >= FILAS_PARA_AVISO_CORREO,
    creadoEn: l.created_at,
  };
}

async function leerLote(svc: Svc, workspaceId: string, loteId: string): Promise<FilaLoteDb | null> {
  const { data } = await svc
    .from('valida_lotes')
    .select(CAMPOS_LOTE)
    .eq('id', loteId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return (data as FilaLoteDb | null) ?? null;
}

/** Lo que la sesión deja al autorizar: el plazo y la huella de los contratos (ver `verificarAccesoDelLote`). */
async function autorizacion(svc: Svc, workspaceId: string): Promise<{ autorizado_hasta: string; huella_acceso: string } | null> {
  const { data, error } = await svc.rpc('valida_lote_huella_acceso', { p_workspace: workspaceId });
  if (error) return null;
  return { autorizado_hasta: autorizadoHasta(new Date()).toISOString(), huella_acceso: (data as string | null) ?? '' };
}

/**
 * Despierta un trabajador si el lote está activo y nadie lo tiene, a lo sumo una vez por minuto por
 * lote (el reclamo es el UPDATE condicionado). El cron de cada minuto lo haría igual; esto es para que
 * la pantalla abierta no espere.
 */
async function despertarSiQuieto(svc: Svc, l: FilaLoteDb): Promise<void> {
  if (!loteActivo(l.estado)) return;
  const ahora = Date.now();
  if (l.turno_hasta && Date.parse(l.turno_hasta) > ahora) return;
  const hace = new Date(ahora - 60_000).toISOString();
  const { data } = await svc
    .from('valida_lotes')
    .update({ despertado_at: new Date(ahora).toISOString() })
    .eq('id', l.id)
    .or(`despertado_at.is.null,despertado_at.lt.${hace}`)
    .select('id');
  if (Array.isArray(data) && data.length > 0) despertarTrabajador();
}

// ─── Crear ──────────────────────────────────────────────────────────────────────

export type ErrorCrearLote =
  | { ok: false; error: string }
  /** La bolsa no alcanza: `alcanzan` de `consultables` filas. Con `limite` se procesan las primeras. */
  | { ok: false; error: 'saldo_insuficiente'; alcanzan: number; consultables: number; total: number }
  | { ok: false; error: MotivoCorte; corte: true };

async function negociosPorCodigo(svc: Svc, workspaceId: string, codigos: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  // En tandas: un `.in()` muy largo rompe la URL de PostgREST.
  for (let i = 0; i < codigos.length; i += 150) {
    const { data } = await svc
      .from('negocios')
      .select('id, codigo')
      .eq('workspace_id', workspaceId)
      .in('codigo', codigos.slice(i, i + 150));
    for (const n of (data ?? []) as Array<{ id: string; codigo: string }>) mapa.set(n.codigo, n.id);
  }
  return mapa;
}

export async function crearLoteValida(
  fd: FormData,
  opts: { negocio_id_lote?: string | null; titulo?: string | null; limite?: number | null } = {},
): Promise<{ ok: true; lote: LoteVista } | ErrorCrearLote> {
  const acceso = await accesoValida({ consultaNueva: true });
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const workspaceId = acceso.workspaceId;
  const { user } = await getCachedUser();

  const file = fd.get('archivo');
  if (!(file instanceof File)) return { ok: false, error: 'archivo_no_provisto' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'archivo_excede_5mb' };

  let rows: FilaXLSX[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { ok: false, error: 'archivo_sin_hojas' };
    rows = textoLatinoProfundo(XLSX.utils.sheet_to_json<FilaXLSX>(sheet, { defval: '' }));
  } catch {
    return { ok: false, error: 'archivo_no_legible' };
  }
  if (rows.length === 0) return { ok: false, error: 'archivo_vacio' };
  if (rows.length > TOPE_FILAS_LOTE) {
    return { ok: false, error: `El archivo tiene ${rows.length} filas; el máximo por cargue es ${TOPE_FILAS_LOTE.toLocaleString('es-CO')}. Divídelo en varios.` };
  }

  const svc: Svc = createServiceClient();

  // El negocio del lote entero llega del navegador: ajeno o inexistente, el lote no se crea (cada fila
  // sin codigo propio heredaria ese id).
  const negocioLote = opts.negocio_id_lote ?? null;
  if (negocioLote) {
    const { data } = await svc.from('negocios').select('id').eq('id', negocioLote).eq('workspace_id', workspaceId).maybeSingle();
    if (!data) return { ok: false, error: 'negocio_no_encontrado' };
  }

  const codigos = Array.from(new Set(rows.map((r) => String(r.negocio_codigo ?? '').trim()).filter((c) => c.length > 0)));
  const codigoToId = codigos.length > 0 ? await negociosPorCodigo(svc, workspaceId, codigos) : new Map<string, string>();
  let filas = filasDesdeXlsx(rows, codigoToId, negocioLote);
  const totalArchivo = filas.length;

  const { data: activo } = await svc
    .from('valida_lotes')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('estado', ['en_cola', 'procesando'])
    .limit(1);
  if (Array.isArray(activo) && activo.length > 0) return { ok: false, error: MENSAJE_LOTE_EN_CURSO };

  const { llave } = await credencialValida(workspaceId);
  if (!llave) return { ok: false, error: 'valida_api_key_no_configurada' };

  // La bolsa ANTES de arrancar: un lote que no alcanza no empieza sin que la persona lo acepte. Sin
  // bolsa (plan mensual, licencia de los CDA) no hay contador que comparar: Valida nunca corta por
  // consumo. Sin poder leer el saldo, el lote arranca y el corte (si llega) lo detiene sin cobrar.
  const saldo = await leerSaldoValida(workspaceId);
  if (saldo?.bloqueada) return { ok: false, error: saldo.motivo ?? 'bolsa_agotada', corte: true };
  if (saldo) {
    const consultables = filas.filter((f) => filaConsume(f.input)).length;
    if (saldo.saldo < consultables) {
      const limite = opts.limite ?? null;
      if (!limite || !Number.isInteger(limite) || limite < 1 || limite > saldo.saldo) {
        return { ok: false, error: 'saldo_insuficiente', alcanzan: saldo.saldo, consultables, total: totalArchivo };
      }
      filas = recortarAlSaldo(filas, limite);
    }
  }

  const auth = await autorizacion(svc, workspaceId);
  if (!auth) return { ok: false, error: 'No se pudo verificar el acceso de tu espacio. Intenta de nuevo en un momento.' };

  const titulo = (opts.titulo ?? '').trim().slice(0, 200) || null;
  const { data: lote, error: errLote } = await svc
    .from('valida_lotes')
    .insert({
      workspace_id: workspaceId,
      created_by: user?.id ?? null,
      titulo,
      negocio_id: negocioLote,
      estado: 'preparando',
      total: filas.length,
      omitidas: totalArchivo - filas.length,
      ...auth,
    })
    .select('id')
    .single();
  if (errLote || !lote) return { ok: false, error: errLote?.message ?? 'lote_no_creado' };
  const loteId = (lote as { id: string }).id;

  const deshacer = async (error: string) => {
    await svc.from('valida_lotes').delete().eq('id', loteId);
    return { ok: false as const, error };
  };

  for (let i = 0; i < filas.length; i += 1000) {
    const tanda = filas.slice(i, i + 1000).map((f) => ({
      lote_id: loteId,
      workspace_id: workspaceId,
      posicion: f.posicion,
      entrada: f.input,
      negocio_id: f.negocio_id,
      error_parseo: f.error,
    }));
    const { error } = await svc.from('valida_lote_filas').insert(tanda);
    if (error) return deshacer(error.message);
  }

  const { data: listo, error: errCola } = await svc
    .from('valida_lotes')
    .update({ estado: 'en_cola', updated_at: new Date().toISOString(), despertado_at: new Date().toISOString() })
    .eq('id', loteId)
    .eq('estado', 'preparando')
    .select(CAMPOS_LOTE)
    .single();
  if (errCola || !listo) return deshacer(errCola?.code === '23505' ? MENSAJE_LOTE_EN_CURSO : errCola?.message ?? 'lote_no_encolado');

  despertarTrabajador();
  return { ok: true, lote: await vista(svc, listo as FilaLoteDb) };
}

// ─── Progreso ───────────────────────────────────────────────────────────────────

/**
 * El progreso de un lote. Con el lote activo, pasa la puerta de CONSULTA NUEVA y renueva su
 * autorización; si la puerta dice que no (términos, mora, módulo), el lote se pausa ahí mismo.
 */
export async function progresoLoteValida(loteId: string): Promise<Resultado<{ lote: LoteVista }>> {
  const acceso = await accesoValida({ consultaNueva: true });
  const svc: Svc = createServiceClient();
  if (!acceso.ok) {
    if (acceso.workspaceId) {
      const l = await leerLote(svc, acceso.workspaceId, loteId);
      if (l && loteActivo(l.estado)) await pausarLote(svc, l.id, 'acceso', acceso.error);
    }
    return { ok: false, error: acceso.error };
  }

  const l = await leerLote(svc, acceso.workspaceId, loteId);
  if (!l) return { ok: false, error: 'lote_no_encontrado' };
  if (loteActivo(l.estado)) {
    const auth = await autorizacion(svc, acceso.workspaceId);
    if (auth) await svc.from('valida_lotes').update(auth).eq('id', l.id).in('estado', ['en_cola', 'procesando']);
    await despertarSiQuieto(svc, l);
  }
  return { ok: true, lote: await vista(svc, l) };
}

/** El lote que la pantalla retoma al volver: el pedido (enlace del correo) o el último sin terminar. */
export async function loteVigenteValida(loteId?: string | null): Promise<Resultado<{ lote: LoteVista | null }>> {
  const acceso = await accesoValida();
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const svc: Svc = createServiceClient();
  if (loteId) {
    const l = await leerLote(svc, acceso.workspaceId, loteId);
    return { ok: true, lote: l ? await vista(svc, l) : null };
  }
  const { data } = await svc
    .from('valida_lotes')
    .select(CAMPOS_LOTE)
    .eq('workspace_id', acceso.workspaceId)
    .in('estado', ['en_cola', 'procesando', 'pausado'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { ok: true, lote: data ? await vista(svc, data as FilaLoteDb) : null };
}

// ─── Reanudar y cancelar ────────────────────────────────────────────────────────

export async function reanudarLoteValida(
  loteId: string,
): Promise<{ ok: true; lote: LoteVista } | { ok: false; error: string; corte?: boolean }> {
  const acceso = await accesoValida({ consultaNueva: true });
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const svc: Svc = createServiceClient();
  const l = await leerLote(svc, acceso.workspaceId, loteId);
  if (!l) return { ok: false, error: 'lote_no_encontrado' };
  if (l.estado !== 'pausado') return { ok: true, lote: await vista(svc, l) };

  const saldo = await leerSaldoValida(acceso.workspaceId);
  if (saldo?.bloqueada) return { ok: false, error: saldo.motivo ?? 'bolsa_agotada', corte: true };

  const auth = await autorizacion(svc, acceso.workspaceId);
  if (!auth) return { ok: false, error: 'No se pudo verificar el acceso de tu espacio. Intenta de nuevo en un momento.' };

  const { data, error } = await svc
    .from('valida_lotes')
    .update({
      ...auth,
      estado: 'en_cola',
      motivo_pausa: null,
      detalle_pausa: null,
      aviso_enviado_at: null,
      despertado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', l.id)
    .eq('estado', 'pausado')
    .select(CAMPOS_LOTE)
    .maybeSingle();
  if (error) return { ok: false, error: error.code === '23505' ? MENSAJE_LOTE_EN_CURSO : error.message };
  despertarTrabajador();
  return { ok: true, lote: await vista(svc, (data as FilaLoteDb | null) ?? l) };
}

/** Las filas que no arrancaron no se consultan ni se cobran; las que estaban en vuelo terminan. */
export async function cancelarLoteValida(loteId: string): Promise<Resultado<{ lote: LoteVista }>> {
  const acceso = await accesoValida();
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const svc: Svc = createServiceClient();
  await svc
    .from('valida_lotes')
    .update({ estado: 'cancelado', trabajador: null, turno_hasta: null, terminado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', loteId)
    .eq('workspace_id', acceso.workspaceId)
    .in('estado', ['preparando', 'en_cola', 'procesando', 'pausado']);
  const l = await leerLote(svc, acceso.workspaceId, loteId);
  if (!l) return { ok: false, error: 'lote_no_encontrado' };
  return { ok: true, lote: await vista(svc, l) };
}

// ─── Descargas ──────────────────────────────────────────────────────────────────

/**
 * Una parte del PDF del lote (500 consultas, el tope de `POST /reporte-lote`), en el ORDEN DEL
 * ARCHIVO: las filas tienen su posición, ya no se ordena por la hora de la consulta.
 */
export async function pdfLoteValida(
  loteId: string,
  parte = 0,
): Promise<{ ok: true; data: { base64: string; filename: string } } | { ok: false; error: string }> {
  const acceso = await accesoValida();
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const svc: Svc = createServiceClient();
  const l = await leerLote(svc, acceso.workspaceId, loteId);
  if (!l) return { ok: false, error: 'lote_no_encontrado' };

  const { llave } = await credencialValida(acceso.workspaceId);
  if (!llave) return { ok: false, error: 'valida_api_key_no_configurada' };

  const desde = Math.max(0, Math.floor(parte)) * CONSULTAS_POR_PDF;
  const [{ data: filas, error }, { count }] = await Promise.all([
    svc
      .from('valida_lote_filas')
      .select('valida_consulta_id')
      .eq('lote_id', l.id)
      .not('valida_consulta_id', 'is', null)
      .order('posicion', { ascending: true })
      .range(desde, desde + CONSULTAS_POR_PDF - 1),
    svc
      .from('valida_lote_filas')
      .select('id', { count: 'exact', head: true })
      .eq('lote_id', l.id)
      .not('valida_consulta_id', 'is', null),
  ]);
  if (error) return { ok: false, error: error.message };
  const ids = ((filas ?? []) as Array<{ valida_consulta_id: string | null }>)
    .map((f) => f.valida_consulta_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return { ok: false, error: 'lote_sin_consultas_validas' };

  const partes = partesDelPdf(count ?? ids.length);
  const numero = Math.floor(desde / CONSULTAS_POR_PDF) + 1;
  const titulo = partes > 1 ? `${l.titulo ?? 'Cargue'} · parte ${numero} de ${partes}` : l.titulo;

  try {
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/reporte-lote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llave}` },
      body: JSON.stringify({ consulta_ids: ids, titulo: titulo ?? null }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const sufijo = partes > 1 ? `-parte-${numero}` : '';
    return { ok: true, data: { base64: buf.toString('base64'), filename: `valida-cargue-${l.id.slice(0, 8)}${sufijo}.pdf` } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_pdf_lote' };
  }
}

const SEVERIDAD_TEXTO: Record<string, string> = {
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
  informativo: 'Informativo',
  sin_hallazgo: 'Sin hallazgo',
  error: 'Error',
};

/** Los resultados del lote en un XLSX, una fila por fila del archivo, en su orden. */
export async function resultadosLoteValida(
  loteId: string,
): Promise<{ ok: true; data: { base64: string; filename: string } } | { ok: false; error: string }> {
  const acceso = await accesoValida();
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const svc: Svc = createServiceClient();
  const l = await leerLote(svc, acceso.workspaceId, loteId);
  if (!l) return { ok: false, error: 'lote_no_encontrado' };

  type Fila = {
    posicion: number;
    entrada: { tipo?: string; nombre?: string; documento?: { tipo?: string; numero?: string } } | null;
    estado: string;
    severidad: string | null;
    total_matches: number | null;
    valida_consulta_id: string | null;
    resultado_error: string | null;
    error_parseo: string | null;
  };
  const filas: Fila[] = [];
  // PostgREST entrega a lo sumo 1.000 filas por consulta.
  for (let desde = 0; desde < l.total + 1000; desde += 1000) {
    const { data, error } = await svc
      .from('valida_lote_filas')
      .select('posicion, entrada, estado, severidad, total_matches, valida_consulta_id, resultado_error, error_parseo')
      .eq('lote_id', l.id)
      .order('posicion', { ascending: true })
      .range(desde, desde + 999);
    if (error) return { ok: false, error: error.message };
    filas.push(...((data ?? []) as Fila[]));
    if (!data || data.length < 1000) break;
  }

  const hoja = XLSX.utils.aoa_to_sheet([
    ['fila', 'tipo_persona', 'nombre', 'tipo_documento', 'numero_documento', 'severidad', 'coincidencias', 'consulta_valida', 'observacion'],
    ...filas.map((f) => [
      f.posicion + 1, // la fila del XLSX, contando el encabezado
      f.entrada?.tipo ?? '',
      f.entrada?.nombre ?? '',
      f.entrada?.documento?.tipo ?? '',
      f.entrada?.documento?.numero ?? '',
      f.estado === 'pendiente' || f.estado === 'en_curso' ? 'Sin consultar' : SEVERIDAD_TEXTO[f.severidad ?? ''] ?? f.severidad ?? '',
      f.total_matches ?? '',
      f.valida_consulta_id ?? '',
      f.error_parseo ?? f.resultado_error ?? '',
    ]),
  ]);
  hoja['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 36 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 38 }, { wch: 40 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Resultados');
  const buf = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { ok: true, data: { base64: buf.toString('base64'), filename: `valida-cargue-${l.id.slice(0, 8)}-resultados.xlsx` } };
}
