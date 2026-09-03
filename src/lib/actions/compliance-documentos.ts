'use server';

/**
 * Índice de documentos del expediente de cumplimiento.
 *
 * ONE no guarda los archivos: guarda el inventario y la vigencia. El archivo
 * sigue viviendo en el Drive del cliente, que es donde el cliente ya sabe
 * manejarlo. Lo que la plataforma aporta es que el auditor entre a un solo
 * lugar, vea que no falta nada y desde ahí abra cada pieza.
 *
 * Lo que se afirma y lo que no: que una pieza sea obligatoria lo declara el
 * obligado, no MéTRIK. El régimen que aplica a ALMA sigue sin verificarse y
 * ninguna pantalla puede presentar el catálogo como exigencia normativa.
 *
 * NINGUNA función de este archivo llama a Informa ni a Valida.
 */

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getCachedUser } from '@/lib/supabase/auth-user';
import { getWorkspace } from './get-workspace';
import { puedeLiberarContrapartes } from '@/lib/compliance/liberaciones';
import { todayBogotaISO } from '@/lib/dates/bogota';
import {
  CATALOGO_SUGERIDO,
  advertenciaEnlace,
  esTipoDocumento,
  estadoDocumento,
  extraerDriveFileId,
  fechaVencimiento,
  validarCodigo,
  validarFechaISO,
  validarNombre,
  validarPeriodicidad,
  validarUrlVersion,
  validarVersion,
  type EstadoDocumento,
  type TipoDocumento,
} from '@/lib/compliance/documentos';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * El expediente es documentación de gobierno: la administra el oficial de
 * cumplimiento, igual que la periodicidad y las liberaciones. Un operador que
 * consulta listas no declara qué piezas componen el expediente de la compañía.
 */
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

// ─── Lectura ───────────────────────────────────────────────────────────────

export type VersionDocumento = {
  id: string;
  version: string;
  url: string;
  fecha_aprobacion: string | null;
  aprobado_por: string | null;
  aprobacion_referencia: string | null;
  vigente_desde: string;
  vigente_hasta: string | null;
  url_estado: string | null;
  url_verificada_at: string | null;
  notas: string | null;
};

export type FilaExpediente = {
  id: string;
  codigo: string;
  tipo: TipoDocumento;
  nombre: string;
  descripcion: string | null;
  obligatorio: boolean;
  periodicidad_meses: number | null;
  responsable_cargo_id: string | null;
  responsable_cargo_nombre: string | null;
  activo: boolean;
  /** La versión abierta hoy. null si nunca se registró ninguna. */
  vigente: VersionDocumento | null;
  /** Todas las versiones, de la más reciente a la más antigua. */
  versiones: VersionDocumento[];
  estado: EstadoDocumento | null;
  /** Cuándo hay que renovar. null si la pieza no vence por calendario. */
  vence_el: string | null;
  advertencia: string | null;
};

const COLS_VERSION =
  'id, documento_id, version, url, fecha_aprobacion, aprobado_por, aprobacion_referencia, vigente_desde, vigente_hasta, url_estado, url_verificada_at, notas';

/**
 * El expediente completo, con el estado ya resuelto.
 *
 * Se trae todo de una vez y se arma en memoria en vez de pedir las versiones
 * documento por documento: son decenas de filas, no miles, y así la pantalla no
 * puede quedar mostrando un estado calculado sobre datos de dos momentos
 * distintos.
 */
export async function listarExpediente(): Promise<Result<FilaExpediente[]>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  // `.eq('workspace_id')` no sobra: el service client bypasea RLS, así que el
  // aislamiento por workspace se pone a mano.
  const { data: docs, error: errDocs } = await svc
    .from('compliance_documentos')
    .select('id, codigo, tipo, nombre, descripcion, obligatorio, periodicidad_meses, responsable_cargo_id, activo')
    .eq('workspace_id', guard.workspaceId)
    .order('codigo');
  if (errDocs) return { ok: false, error: errDocs.message };

  const filas = (docs ?? []) as Array<Omit<FilaExpediente, 'vigente' | 'versiones' | 'estado' | 'vence_el' | 'advertencia' | 'responsable_cargo_nombre'>>;
  if (filas.length === 0) return { ok: true, data: [] };

  const [{ data: vers, error: errVers }, { data: cargos }] = await Promise.all([
    svc
      .from('compliance_documento_versiones')
      .select(COLS_VERSION)
      .eq('workspace_id', guard.workspaceId)
      .order('vigente_desde', { ascending: false }),
    svc.from('compliance_cargos').select('id, nombre').eq('workspace_id', guard.workspaceId),
  ]);
  if (errVers) return { ok: false, error: errVers.message };

  const porDoc = new Map<string, VersionDocumento[]>();
  for (const v of (vers ?? []) as Array<VersionDocumento & { documento_id: string }>) {
    const { documento_id, ...resto } = v;
    const lista = porDoc.get(documento_id);
    if (lista) lista.push(resto);
    else porDoc.set(documento_id, [resto]);
  }

  const nombreCargo = new Map<string, string>(
    ((cargos ?? []) as Array<{ id: string; nombre: string }>).map((c) => [c.id, c.nombre]),
  );

  const hoy = todayBogotaISO();

  return {
    ok: true,
    data: filas.map((d) => {
      const versiones = porDoc.get(d.id) ?? [];
      const vigente = versiones.find((v) => v.vigente_hasta === null) ?? null;
      return {
        ...d,
        responsable_cargo_nombre: d.responsable_cargo_id
          ? nombreCargo.get(d.responsable_cargo_id) ?? null
          : null,
        vigente,
        versiones,
        estado: estadoDocumento(d, vigente, hoy),
        vence_el: vigente ? fechaVencimiento(d, vigente) : null,
        advertencia: vigente ? advertenciaEnlace(vigente.url) : null,
      };
    }),
  };
}

/** Los cargos activos, para elegir quién responde por mantener la pieza vigente. */
export async function listarCargosParaDocumentos(): Promise<
  Result<Array<{ id: string; nombre: string }>>
> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('compliance_cargos')
    .select('id, nombre')
    .eq('workspace_id', guard.workspaceId)
    .eq('activo', true)
    .order('nombre');
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as Array<{ id: string; nombre: string }> };
}

// ─── Escritura del catálogo ────────────────────────────────────────────────

export async function crearDocumento(input: {
  codigo: string;
  tipo: string;
  nombre: string;
  descripcion?: string | null;
  obligatorio?: boolean;
  periodicidad_meses?: unknown;
  responsable_cargo_id?: string | null;
}): Promise<Result<{ id: string }>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  const codigo = typeof input.codigo === 'string' ? input.codigo.trim().toUpperCase() : '';
  for (const err of [validarCodigo(codigo), validarNombre(input.nombre), validarPeriodicidad(input.periodicidad_meses)]) {
    if (err) return { ok: false, error: err };
  }
  if (!esTipoDocumento(input.tipo)) return { ok: false, error: 'tipo_invalido' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('compliance_documentos')
    .insert({
      workspace_id: guard.workspaceId,
      codigo,
      tipo: input.tipo,
      nombre: input.nombre.trim(),
      descripcion: input.descripcion?.trim() || null,
      obligatorio: input.obligatorio ?? true,
      periodicidad_meses: normalizarPeriodicidad(input.periodicidad_meses),
      responsable_cargo_id: input.responsable_cargo_id || null,
    })
    .select('id')
    .single();

  // 23505 = unique_violation. El código es la llave del expediente y decirlo por
  // su nombre le ahorra al oficial descifrar un mensaje de Postgres.
  if (error) {
    return { ok: false, error: error.code === '23505' ? `codigo_duplicado (${codigo})` : error.message };
  }
  revalidatePath('/compliance/documentos');
  return { ok: true, data: data as { id: string } };
}

export async function actualizarDocumento(input: {
  id: string;
  nombre?: string;
  descripcion?: string | null;
  obligatorio?: boolean;
  periodicidad_meses?: unknown;
  responsable_cargo_id?: string | null;
  activo?: boolean;
}): Promise<Result<null>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  const patch: Record<string, unknown> = {};
  if (input.nombre !== undefined) {
    const err = validarNombre(input.nombre);
    if (err) return { ok: false, error: err };
    patch.nombre = input.nombre.trim();
  }
  if (input.periodicidad_meses !== undefined) {
    const err = validarPeriodicidad(input.periodicidad_meses);
    if (err) return { ok: false, error: err };
    patch.periodicidad_meses = normalizarPeriodicidad(input.periodicidad_meses);
  }
  if (input.descripcion !== undefined) patch.descripcion = input.descripcion?.trim() || null;
  if (input.obligatorio !== undefined) patch.obligatorio = input.obligatorio;
  if (input.responsable_cargo_id !== undefined) patch.responsable_cargo_id = input.responsable_cargo_id || null;
  if (input.activo !== undefined) patch.activo = input.activo;
  if (Object.keys(patch).length === 0) return { ok: true, data: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { error } = await svc
    .from('compliance_documentos')
    .update(patch)
    .eq('id', input.id)
    .eq('workspace_id', guard.workspaceId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/compliance/documentos');
  return { ok: true, data: null };
}

/**
 * Siembra las piezas sugeridas que el workspace todavía no tiene.
 *
 * Es explícito y no automático: sembrarlo al abrir la pantalla pondría a la
 * plataforma a declarar de oficio qué compone el expediente de un obligado cuyo
 * régimen no hemos verificado. El oficial adopta el catálogo, y desde ese
 * momento las filas son suyas.
 *
 * No toca las piezas que ya existen, ni siquiera para corregirlas: si el
 * oficial cambió un nombre o apagó una obligatoriedad, esa es su decisión.
 */
export async function sembrarCatalogoSugerido(): Promise<Result<{ creados: number; existentes: number }>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data: previos, error: errPrevios } = await svc
    .from('compliance_documentos')
    .select('codigo')
    .eq('workspace_id', guard.workspaceId);
  if (errPrevios) return { ok: false, error: errPrevios.message };

  const yaEstan = new Set(((previos ?? []) as Array<{ codigo: string }>).map((d) => d.codigo));
  const faltantes = CATALOGO_SUGERIDO.filter((p) => !yaEstan.has(p.codigo));
  if (faltantes.length === 0) return { ok: true, data: { creados: 0, existentes: yaEstan.size } };

  const { error } = await svc.from('compliance_documentos').insert(
    faltantes.map((p) => ({
      workspace_id: guard.workspaceId,
      codigo: p.codigo,
      tipo: p.tipo,
      nombre: p.nombre,
      descripcion: p.descripcion,
      obligatorio: true,
      periodicidad_meses: p.periodicidad_meses,
    })),
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/compliance/documentos');
  return { ok: true, data: { creados: faltantes.length, existentes: yaEstan.size } };
}

// ─── Publicar una versión ──────────────────────────────────────────────────

/**
 * Registra una versión y cierra la anterior, en una sola operación.
 *
 * Las dos escrituras van en una función de base de datos y no acá: hechas por
 * separado, un fallo entre ambas dejaría el documento sin versión abierta y la
 * pantalla diría "falta" sobre un manual que sí existe.
 */
export async function registrarVersion(input: {
  documento_id: string;
  version: string;
  url: string;
  vigente_desde: string;
  fecha_aprobacion?: string | null;
  aprobado_por?: string | null;
  aprobacion_referencia?: string | null;
  hash_sha256?: string | null;
  notas?: string | null;
}): Promise<Result<{ id: string; advertencia: string | null }>> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  for (const err of [
    validarVersion(input.version),
    validarUrlVersion(input.url),
    validarFechaISO(input.vigente_desde),
  ]) {
    if (err) return { ok: false, error: err };
  }
  if (input.fecha_aprobacion) {
    const err = validarFechaISO(input.fecha_aprobacion);
    if (err) return { ok: false, error: 'fecha_aprobacion_invalida' };
  }
  const hash = input.hash_sha256?.trim().toLowerCase() || null;
  if (hash && !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, error: 'hash_invalido' };

  const url = input.url.trim();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc.rpc('compliance_registrar_version_documento', {
    p_documento_id: input.documento_id,
    p_workspace_id: guard.workspaceId,
    p_version: input.version.trim(),
    p_url: url,
    p_vigente_desde: input.vigente_desde,
    p_drive_file_id: extraerDriveFileId(url),
    p_fecha_aprobacion: input.fecha_aprobacion || null,
    p_aprobado_por: input.aprobado_por?.trim() || null,
    p_aprobacion_referencia: input.aprobacion_referencia?.trim() || null,
    p_hash_sha256: hash,
    p_notas: input.notas?.trim() || null,
    p_cargado_por: guard.userId,
  });

  if (error) return { ok: false, error: traducirErrorVersion(error.message) };

  revalidatePath('/compliance/documentos');
  return { ok: true, data: { id: data as string, advertencia: advertenciaEnlace(url) } };
}

function traducirErrorVersion(mensaje: string): string {
  if (mensaje.includes('vigencia_anterior_a_la_version_abierta')) {
    return 'La fecha de inicio tiene que ser posterior a la de la versión que está vigente.';
  }
  if (mensaje.includes('documento_no_pertenece_al_workspace')) return 'documento_no_encontrado';
  if (mensaje.includes('duplicate key') || mensaje.includes('23505')) {
    return 'Ya existe una versión con ese número en este documento.';
  }
  return mensaje;
}

// ─── Verificación de enlaces ───────────────────────────────────────────────

/**
 * Comprueba que los enlaces de las versiones vigentes respondan.
 *
 * Por qué existe: un enlace roto no es evidencia parcial, es evidencia
 * ausente, y se rompe en silencio (alguien mueve la carpeta, cambia los
 * permisos, borra el archivo). Sin esto el expediente se ve completo hasta el
 * día de la auditoría.
 *
 * Límite conocido: Google responde 200 con una página de ingreso cuando el
 * archivo existe pero el visitante no tiene acceso, así que un `ok` prueba que
 * el enlace vive, no que el auditor vaya a poder abrirlo. La redirección a
 * `accounts.google.com` sí se detecta y se marca `sin_permiso`.
 */
export async function verificarEnlacesExpediente(): Promise<
  Result<{ revisados: number; ok: number; rotos: number; sin_permiso: number }>
> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data, error } = await svc
    .from('compliance_documento_versiones')
    .select('id, url')
    .eq('workspace_id', guard.workspaceId)
    .is('vigente_hasta', null);
  if (error) return { ok: false, error: error.message };

  const filas = (data ?? []) as Array<{ id: string; url: string }>;
  const resultados = await Promise.all(filas.map((f) => comprobarUrl(f.url).then((estado) => ({ id: f.id, estado }))));

  const verificadaAt = new Date().toISOString();
  await Promise.all(
    resultados.map((r) =>
      svc
        .from('compliance_documento_versiones')
        .update({ url_estado: r.estado, url_verificada_at: verificadaAt })
        .eq('id', r.id)
        .eq('workspace_id', guard.workspaceId),
    ),
  );

  revalidatePath('/compliance/documentos');
  return {
    ok: true,
    data: {
      revisados: resultados.length,
      ok: resultados.filter((r) => r.estado === 'ok').length,
      rotos: resultados.filter((r) => r.estado === 'rota').length,
      sin_permiso: resultados.filter((r) => r.estado === 'sin_permiso').length,
    },
  };
}

async function comprobarUrl(url: string): Promise<'ok' | 'rota' | 'sin_permiso'> {
  try {
    // 10 s: si el enlace tarda más que eso, el auditor tampoco lo va a abrir.
    const señal = AbortSignal.timeout(10_000);
    // GET y no HEAD: Drive responde 405 a HEAD en varias rutas, y eso marcaría
    // como roto un archivo que está perfectamente.
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: señal });
    if (res.url.includes('accounts.google.com')) return 'sin_permiso';
    if (res.status === 401 || res.status === 403) return 'sin_permiso';
    return res.ok ? 'ok' : 'rota';
  } catch {
    return 'rota';
  }
}

function normalizarPeriodicidad(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'string' ? Number(valor.trim()) : Number(valor);
  return Number.isFinite(n) ? n : null;
}
