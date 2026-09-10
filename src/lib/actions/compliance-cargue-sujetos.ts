'use server';

/**
 * Cargue masivo de la base de sujetos.
 *
 * Tres funciones y un orden que no se puede saltar: se baja la plantilla, se
 * sube el archivo y se MIRA el plan, y solo entonces se aplica. La aplicación
 * no recibe el archivo: recibe el plan que ya se vio, para que lo que se
 * escribe sea exactamente lo que se mostró.
 *
 * El archivo no se guarda. Es una lista de terceros con documentos de identidad
 * y lo único que tiene que quedar es el efecto en la base de sujetos, con su
 * bitácora fila por fila.
 *
 * Las reglas viven en `@/lib/compliance/cargue-sujetos`, sin base de datos,
 * porque decidir a quién se cierra es lo que hay que poder probar.
 */

import * as XLSX from 'xlsx';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getWorkspace } from './get-workspace';
import { todayBogotaISO } from '@/lib/dates/bogota';
import { puedeGestionarSujetos, TIPOS_SUJETO } from '@/lib/compliance/sujetos';
import {
  COLUMNAS_CARGUE,
  FORMATO_FECHA_CARGUE,
  HOJA_CARGUE,
  LIMITE_FILAS_CARGUE,
  parsearFilasCargue,
  planearCargue,
  type ItemPlan,
  type PlanCargue,
  type SujetoExistente,
} from '@/lib/compliance/cargue-sujetos';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const LIMITE_SUJETOS = 20000;

type Guard = { workspaceId: string; userId: string | null };

async function guardCargue(): Promise<Result<Guard>> {
  const { workspaceId, role, userId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  if (!puedeGestionarSujetos(role)) {
    return { ok: false, error: 'forbidden_sin_permiso_de_gestion' };
  }
  return { ok: true, data: { workspaceId, userId: userId ?? null } };
}

// ─── 1. La plantilla ───────────────────────────────────────────────────────

export async function generarPlantillaSujetos(): Promise<
  Result<{ base64: string; filename: string }>
> {
  const guard = await guardCargue();
  if (!guard.ok) return guard;

  const hojaDatos = XLSX.utils.aoa_to_sheet([
    [...COLUMNAS_CARGUE],
    ['proveedor', 'NIT', '900123456', 'FERRETERIA DEL NORTE SAS', '2025-03-01', '', ''],
    ['contratista', 'CC', '79123456', 'JUAN PEREZ EJEMPLO', '2026-01-15', '', ''],
    ['empleado', 'CC', '52987654', 'ANA GOMEZ EJEMPLO', '2024-08-01', '2026-08-31', 'renuncio'],
  ]);
  hojaDatos['!cols'] = [
    { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 38 },
    { wch: 16 }, { wch: 16 }, { wch: 34 },
  ];

  const instrucciones: string[][] = [
    ['Cómo llenar la plantilla'],
    [''],
    ['Una fila por tercero, en la hoja "' + HOJA_CARGUE + '". Hasta ' + LIMITE_FILAS_CARGUE + ' filas.'],
    ['No cambies los nombres de las columnas ni el orden de la primera fila.'],
    ['Borra las tres filas de ejemplo antes de subir el archivo.'],
    [''],
    ['Columna', 'Obligatoria', 'Qué va'],
    ['tipo', 'Sí', TIPOS_SUJETO.join(', ')],
    ['documento_tipo', 'Sí', 'NIT, CC, CE.'],
    ['documento', 'Sí', 'Cédula o NIT. Los puntos y guiones no importan.'],
    ['nombre', 'Sí', 'Razón social o nombre completo.'],
    ['relacion_desde', 'No', 'Desde cuándo trabaja con ustedes. ' + FORMATO_FECHA_CARGUE],
    ['relacion_hasta', 'Solo en bajas', 'Desde cuándo dejó de trabajar. ' + FORMATO_FECHA_CARGUE],
    ['motivo', 'Solo en bajas', 'Por qué salió. Obligatorio si pones relacion_hasta.'],
    [''],
    ['La misma plantilla sirve para las novedades del mes'],
    ['Para reportar quién salió, sube el archivo con relacion_hasta y motivo'],
    ['diligenciados en esas filas. No hay un segundo formato de bajas.'],
    ['Un tercero cerrado deja de consultarse en el monitoreo recurrente, y por'],
    ['lo tanto deja de generar consumo.'],
    [''],
    ['El cargue NO reabre a nadie'],
    ['Si vuelves a subir un archivo viejo, quien ya está cerrado se queda'],
    ['cerrado: una fila sin relacion_hasta no lo resucita. Reabrir es una'],
    ['decisión que se toma en la ficha del tercero, con su motivo.'],
    [''],
    ['Sobre las fechas'],
    ['Solo se acepta ' + FORMATO_FECHA_CARGUE + '. El formato 03/04/2026 no se'],
    ['adivina: leerlo como marzo o como abril cambia un mes de monitoreo, así'],
    ['que la fila se reporta con su número para que la corrijas.'],
    [''],
    ['Empleados'],
    ['El cargue no amarra al empleado con su ficha de personal: la nómina de ONE'],
    ['no guarda documento y no hay por dónde cruzarlos. Ese amarre se hace desde'],
    ['la ficha del sujeto, uno por uno, cuando haga falta.'],
    [''],
    ['Antes de escribir nada verás una vista previa fila por fila con lo que va'],
    ['a pasar. El archivo no se guarda en la plataforma.'],
  ];
  const hojaInstrucciones = XLSX.utils.aoa_to_sheet(instrucciones);
  hojaInstrucciones['!cols'] = [{ wch: 46 }, { wch: 16 }, { wch: 60 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaDatos, HOJA_CARGUE);
  XLSX.utils.book_append_sheet(wb, hojaInstrucciones, 'Instrucciones');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    ok: true,
    data: { base64: buf.toString('base64'), filename: 'plantilla-sujetos.xlsx' },
  };
}

// ─── 2. La vista previa ────────────────────────────────────────────────────

async function cargarExistentes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
): Promise<SujetoExistente[]> {
  const { data } = await svc
    .from('compliance_sujetos')
    .select('id, tipo, documento_tipo, documento_numero, nombre, relacion_hasta')
    .eq('workspace_id', workspaceId)
    .limit(LIMITE_SUJETOS);
  return (data ?? []) as SujetoExistente[];
}

export async function previsualizarCargueSujetos(
  formData: FormData,
): Promise<Result<PlanCargue>> {
  const guard = await guardCargue();
  if (!guard.ok) return guard;

  const file = formData.get('archivo');
  if (!(file instanceof File)) return { ok: false, error: 'archivo_requerido' };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'archivo_muy_grande' };

  const buffer = Buffer.from(await file.arrayBuffer());

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return { ok: false, error: 'xlsx_invalido' };
  }

  const sheetName = workbook.SheetNames.includes(HOJA_CARGUE)
    ? HOJA_CARGUE
    : workbook.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'xlsx_sin_hojas' };

  // `raw: false` para que una cédula formateada como número no llegue en
  // notación científica, que es como se pierden documentos largos en silencio.
  const todas = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: null,
    raw: false,
  });
  if (todas.length === 0) return { ok: false, error: 'xlsx_vacio' };

  const truncado = todas.length > LIMITE_FILAS_CARGUE;
  const rows = truncado ? todas.slice(0, LIMITE_FILAS_CARGUE) : todas;

  const { validas, invalidas } = parsearFilasCargue(rows);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const existentes = await cargarExistentes(svc, guard.data.workspaceId);

  return { ok: true, data: planearCargue(validas, existentes, invalidas, truncado) };
}

// ─── 3. La aplicación ──────────────────────────────────────────────────────

export type ResultadoCargue = {
  altas: number;
  cierres: number;
  actualizaciones: number;
  omitidas: number;
  fallidas: Array<{ fila: number; error: string }>;
};

/**
 * Aplica el plan que el usuario ya vio.
 *
 * Recibe los items y no el archivo, a propósito: volver a parsear acá abriría
 * la puerta a que se escriba algo distinto de lo que se mostró.
 *
 * No hay transacción única y es deliberado: son escrituras fila por fila con su
 * evento de bitácora, y si la número 400 falla, las 399 anteriores son trabajo
 * bueno que no tiene por qué perderse. Lo que falla se devuelve con su número
 * de fila para que se reintente solo eso.
 *
 * `sin_cambio` no se escribe. Ni siquiera se toca la fila: un `update` que deja
 * todo igual ensucia la bitácora con eventos que no pasaron.
 */
export async function aplicarCargueSujetos(
  items: ItemPlan[],
): Promise<Result<ResultadoCargue>> {
  const guard = await guardCargue();
  if (!guard.ok) return guard;

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'plan_vacio' };
  }
  if (items.length > LIMITE_FILAS_CARGUE) {
    return { ok: false, error: 'plan_muy_grande' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const hoy = todayBogotaISO();
  const { workspaceId, userId } = guard.data;

  const res: ResultadoCargue = {
    altas: 0,
    cierres: 0,
    actualizaciones: 0,
    omitidas: 0,
    fallidas: [],
  };

  for (const it of items) {
    if (it.accion === 'sin_cambio') {
      res.omitidas += 1;
      continue;
    }

    try {
      if (it.accion === 'alta' || it.accion === 'alta_cerrada') {
        const { data, error } = await svc
          .from('compliance_sujetos')
          .insert({
            workspace_id: workspaceId,
            tipo: it.tipo,
            documento_tipo: it.documento_tipo,
            documento_numero: it.documento_numero,
            nombre: it.nombre,
            relacion_desde: hoy,
            relacion_hasta: it.accion === 'alta_cerrada' ? it.relacion_hasta : null,
            motivo_cierre: it.accion === 'alta_cerrada' ? it.motivo : null,
            cerrado_por: it.accion === 'alta_cerrada' ? userId : null,
            cerrado_at: it.accion === 'alta_cerrada' ? new Date().toISOString() : null,
            responsable_profile_id: userId,
            created_by: userId,
          })
          .select('id')
          .single();

        if (error) {
          res.fallidas.push({ fila: it.fila, error: error.message });
          continue;
        }

        await registrarEvento(svc, workspaceId, data.id, 'alta', `${it.nombre} (${it.documento_tipo} ${it.documento_numero}) — cargue masivo`, null, userId);
        res.altas += 1;
        if (it.accion === 'alta_cerrada') res.cierres += 1;
        continue;
      }

      if (it.accion === 'cierre') {
        if (!it.sujeto_id) {
          res.fallidas.push({ fila: it.fila, error: 'sin_sujeto' });
          continue;
        }
        const { error } = await svc.rpc('compliance_cerrar_relacion_sujeto', {
          p_workspace_id: workspaceId,
          p_sujeto_id: it.sujeto_id,
          p_fecha: it.relacion_hasta ?? hoy,
          p_motivo: (it.motivo ?? '').trim() || 'cargue masivo',
          p_actor: userId,
        });
        if (error) {
          res.fallidas.push({ fila: it.fila, error: error.message });
          continue;
        }
        res.cierres += 1;
        continue;
      }

      // actualizacion
      if (!it.sujeto_id) {
        res.fallidas.push({ fila: it.fila, error: 'sin_sujeto' });
        continue;
      }
      const { error } = await svc
        .from('compliance_sujetos')
        .update({ tipo: it.tipo, nombre: it.nombre })
        .eq('id', it.sujeto_id)
        .eq('workspace_id', workspaceId);
      if (error) {
        res.fallidas.push({ fila: it.fila, error: error.message });
        continue;
      }
      await registrarEvento(svc, workspaceId, it.sujeto_id, 'cambio_datos', `${it.detalle} — cargue masivo`, null, userId);
      res.actualizaciones += 1;
    } catch (e) {
      res.fallidas.push({ fila: it.fila, error: e instanceof Error ? e.message : 'error' });
    }
  }

  revalidatePath('/compliance/sujetos');
  return { ok: true, data: res };
}

async function registrarEvento(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  sujetoId: string,
  evento: string,
  detalle: string,
  motivo: string | null,
  actor: string | null,
): Promise<void> {
  await svc.rpc('compliance_registrar_evento_sujeto', {
    p_workspace_id: workspaceId,
    p_sujeto_id: sujetoId,
    p_evento: evento,
    p_detalle: detalle,
    p_motivo: motivo,
    p_actor: actor,
  });
}
