'use server';

/**
 * R5 — Auditoría por cruce con la base de compras (control correctivo).
 *
 * El oficial sube la base de contrataciones del periodo y ONE le dice cuáles se
 * celebraron con una contraparte que tenía alerta y no estaba liberada EN ESA
 * FECHA. Es el cierre del ciclo para todo cliente sin integración al ERP, que
 * serán la mayoría: ONE no es dueño de la orden de compra y no puede impedirla,
 * pero sí puede probar que el procedimiento se saltó.
 *
 * NINGUNA función de este archivo llama a Informa ni a Valida. Todo sale de lo
 * ya guardado: auditar el pasado no necesita volver a preguntarle a la fuente, y
 * cada consulta es facturable contra la cuenta del cliente.
 *
 * NO se guarda la base de compras. Es información financiera de otro sistema, y
 * abrir esa superficie de datos personales sin el concepto de Emilio sobre
 * tratamiento sería adelantarse a una decisión que no es de producto. El cruce
 * corre en memoria y lo que queda es el informe.
 */

import * as XLSX from 'xlsx';
import { createServiceClient } from '@/lib/supabase/server';
import { getWorkspace } from './get-workspace';
import { resolverNombresUsuarios } from './_usuarios';
import {
  claveContraparte,
  puedeLiberarContrapartes,
  type ComplianceLiberacion,
} from '@/lib/compliance/liberaciones';
import {
  auditarCompra,
  ordenarResultados,
  parsearFechaCompra,
  resumirAuditoria,
  FORMATO_FECHA_ESPERADO,
  type ConsultaParaAuditoria,
  type FilaCompra,
  type ResultadoCompra,
  type ResumenAuditoria,
} from '@/lib/compliance/auditoria-compras';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Contrato de la plantilla. Lo consumen las dos puntas, la que emite el archivo
 * y la que lo parsea, para que no puedan divergir.
 */
const HOJA_DATOS = 'Compras';
const COLUMNAS_PLANTILLA = [
  'documento_tipo',
  'documento',
  'nombre',
  'fecha',
  'referencia',
  'comprador',
  'valor',
] as const;

const LIMITE_FILAS = 5000;
const LIMITE_BITACORA = 2000;
const LIMITE_CONSULTAS = 20000;

const COLUMNAS_LIBERACION =
  'id, consulta_id, documento_tipo, documento_numero, nombre, decision, justificacion, vigente_desde, vigente_hasta, control_id, liberada_por, created_at';

// ─── Guard ─────────────────────────────────────────────────────────────────

/**
 * La auditoría es del oficial de cumplimiento, igual que la liberación. El
 * informe nombra a quién compró y a quién liberó: no es una pantalla que se
 * reparta al resto de la organización.
 */
async function guardOficial(): Promise<
  { ok: true; workspaceId: string } | { ok: false; error: string }
> {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };
  if (!puedeLiberarContrapartes(role)) {
    return { ok: false, error: 'forbidden_solo_oficial_cumplimiento' };
  }
  return { ok: true, workspaceId };
}

// ─── Plantilla ─────────────────────────────────────────────────────────────

export async function generarPlantillaAuditoriaCompras(): Promise<
  Result<{ base64: string; filename: string }>
> {
  const guard = await guardOficial();
  if (!guard.ok) return guard;

  const hojaDatos = XLSX.utils.aoa_to_sheet([[...COLUMNAS_PLANTILLA]]);
  hojaDatos['!cols'] = [
    { wch: 16 }, { wch: 18 }, { wch: 38 }, { wch: 14 },
    { wch: 20 }, { wch: 26 }, { wch: 16 },
  ];

  const instrucciones: string[][] = [
    ['Cómo llenar la plantilla'],
    [''],
    ['Exporta de tu sistema de compras las contrataciones del periodo que quieres auditar'],
    ['y pégalas en la hoja "Compras". Una fila por contratación. Hasta ' + LIMITE_FILAS + ' filas.'],
    ['No cambies los nombres de las columnas ni el orden de la primera fila.'],
    [''],
    ['Columna', 'Obligatoria', 'Qué va'],
    ['documento_tipo', 'Sí', 'NIT, CC, CE. El mismo tipo con el que se consultó.'],
    ['documento', 'Sí', 'Cédula o NIT. Los puntos y guiones no importan.'],
    ['nombre', 'No', 'Razón social o nombre. Solo para leer el informe.'],
    ['fecha', 'Sí', 'Fecha en que se celebró la contratación. ' + FORMATO_FECHA_ESPERADO],
    ['referencia', 'No', 'Número de orden de compra o de contrato.'],
    ['comprador', 'No', 'Quién hizo la compra. Aparece en el informe.'],
    ['valor', 'No', 'Solo números.'],
    [''],
    ['Sobre la fecha'],
    ['El cruce se hace contra lo que el oficial sabía Y había decidido ESE DÍA.'],
    ['Una liberación firmada después de la compra no la justifica.'],
    ['Por eso la fecha no se adivina: una fila con la fecha ilegible se reporta'],
    ['como fila inválida, con su número, para que la corrijas. El formato'],
    ['DD/MM/AAAA se lee a la colombiana: 03/04/2026 es el 3 de abril.'],
    [''],
    ['Qué NO hace esta auditoría'],
    ['Es correctiva, no preventiva: la contratación ya ocurrió. Lo que produce'],
    ['es la evidencia de que el procedimiento se saltó, con nombre y fecha.'],
    [''],
    ['Este archivo no se guarda en la plataforma. El cruce corre y queda el informe.'],
  ];
  const hojaInstrucciones = XLSX.utils.aoa_to_sheet(instrucciones);
  hojaInstrucciones['!cols'] = [{ wch: 44 }, { wch: 24 }, { wch: 56 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaDatos, HOJA_DATOS);
  XLSX.utils.book_append_sheet(wb, hojaInstrucciones, 'Instrucciones');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return {
    ok: true,
    data: {
      base64: buf.toString('base64'),
      filename: 'plantilla-auditoria-compras.xlsx',
    },
  };
}

// ─── Parseo ────────────────────────────────────────────────────────────────

/** Fila que no se pudo leer. Se reporta con su número: nunca se descarta callado. */
export type FilaInvalida = {
  posicion: number;
  motivo: string;
  /** Lo que venía en la fila, para que el oficial la ubique en su archivo. */
  eco: string;
};

function asStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function leerColumna(row: Record<string, unknown>, nombre: string): unknown {
  // `sheet_to_json` usa el header tal cual: se aceptan las tres escrituras
  // habituales para que copiar y pegar de otro sistema no rompa el cargue.
  return (
    row[nombre]
    ?? row[nombre.toUpperCase()]
    ?? row[nombre.charAt(0).toUpperCase() + nombre.slice(1)]
  );
}

function parsearFilas(rows: Record<string, unknown>[]): {
  compras: FilaCompra[];
  invalidas: FilaInvalida[];
} {
  const compras: FilaCompra[] = [];
  const invalidas: FilaInvalida[] = [];

  rows.forEach((row, i) => {
    const posicion = i + 2; // fila 1 = encabezado
    const documentoTipo = asStr(leerColumna(row, 'documento_tipo'));
    const documentoNumero = asStr(leerColumna(row, 'documento'));
    const nombre = asStr(leerColumna(row, 'nombre'));
    const fechaCruda = leerColumna(row, 'fecha');
    const eco = [nombre, documentoNumero, asStr(fechaCruda)].filter(Boolean).join(' · ') || '(fila vacía)';

    if (!documentoTipo || !documentoNumero) {
      invalidas.push({ posicion, motivo: 'fila_sin_documento', eco });
      return;
    }
    if (!claveContraparte(documentoTipo, documentoNumero)) {
      invalidas.push({ posicion, motivo: 'documento_ilegible', eco });
      return;
    }

    const fecha = parsearFechaCompra(fechaCruda);
    if (!fecha) {
      invalidas.push({
        posicion,
        motivo: `fecha_ilegible (esperado ${FORMATO_FECHA_ESPERADO})`,
        eco,
      });
      return;
    }

    const valorCrudo = asStr(leerColumna(row, 'valor')).replace(/[$\s.]/g, '').replace(',', '.');
    const valor = valorCrudo && !Number.isNaN(Number(valorCrudo)) ? Number(valorCrudo) : null;

    compras.push({
      posicion,
      documento_tipo: documentoTipo,
      documento_numero: documentoNumero,
      nombre: nombre || null,
      fecha,
      referencia: asStr(leerColumna(row, 'referencia')) || null,
      comprador: asStr(leerColumna(row, 'comprador')) || null,
      valor,
    });
  });

  return { compras, invalidas };
}

// ─── El cruce ──────────────────────────────────────────────────────────────

/** Una fila del informe, con los nombres ya resueltos para mostrarla. */
export type FilaInforme = ResultadoCompra & {
  consulto: string | null;
  libero: string | null;
  liberacion_vigente_hasta: string | null;
};

export type InformeAuditoria = {
  resumen: ResumenAuditoria;
  filas: FilaInforme[];
  invalidas: FilaInvalida[];
  /** El archivo traía más filas de las que se pueden auditar de una pasada. */
  truncado: boolean;
};

/**
 * Cruza la base de compras contra las consultas y las liberaciones del
 * workspace, evaluando cada contratación contra lo que se sabía ESE DÍA.
 *
 * Se leen TODAS las consultas del workspace, no solo las de la contraparte: el
 * cruce necesita saber si hubo consulta y cuándo, y una contraparte que no
 * aparece en la base de consultas es precisamente el hallazgo `sin_consulta`.
 */
export async function auditarBaseDeCompras(
  formData: FormData,
): Promise<Result<InformeAuditoria>> {
  const guard = await guardOficial();
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

  const sheetName = workbook.SheetNames.includes(HOJA_DATOS)
    ? HOJA_DATOS
    : workbook.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'xlsx_sin_hojas' };

  const todasLasFilas = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[sheetName],
    { defval: null, raw: false },
  );
  if (todasLasFilas.length === 0) return { ok: false, error: 'xlsx_vacio' };

  const truncado = todasLasFilas.length > LIMITE_FILAS;
  const rows = truncado ? todasLasFilas.slice(0, LIMITE_FILAS) : todasLasFilas;

  const { compras, invalidas } = parsearFilas(rows);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const { data: consultasRaw, error: errConsultas } = await svc
    .from('consultas_listas_dual')
    .select('id, documento_tipo, documento_numero, severidad, total_matches, created_at, created_by')
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

  const consultasPorClave = new Map<string, ConsultaParaAuditoria[]>();
  for (const c of (consultasRaw ?? []) as ConsultaParaAuditoria[]) {
    const clave = claveContraparte(c.documento_tipo, c.documento_numero);
    if (!clave) continue;
    const acc = consultasPorClave.get(clave);
    if (acc) acc.push(c);
    else consultasPorClave.set(clave, [c]);
  }

  const liberacionesPorClave = new Map<string, ComplianceLiberacion[]>();
  for (const l of (liberacionesRaw ?? []) as ComplianceLiberacion[]) {
    const clave = claveContraparte(l.documento_tipo, l.documento_numero);
    if (!clave) continue;
    const acc = liberacionesPorClave.get(clave);
    if (acc) acc.push(l);
    else liberacionesPorClave.set(clave, [l]);
  }

  const resultados = compras.map((compra) => {
    const clave = claveContraparte(compra.documento_tipo, compra.documento_numero) ?? '';
    return auditarCompra(
      compra,
      consultasPorClave.get(clave) ?? [],
      liberacionesPorClave.get(clave) ?? [],
    );
  });

  const ordenados = ordenarResultados(resultados);
  const userMap = await resolverNombresUsuarios(svc, [
    ...ordenados.map((r) => r.consulta_previa?.created_by),
    ...ordenados.map((r) => r.cobertura_a_la_fecha.liberacion?.liberada_por),
  ]);

  const filas: FilaInforme[] = ordenados.map((r) => {
    const lib = r.cobertura_a_la_fecha.liberacion;
    return {
      ...r,
      consulto: r.consulta_previa?.created_by
        ? (userMap.get(r.consulta_previa.created_by) ?? null)
        : null,
      libero: lib?.liberada_por ? (userMap.get(lib.liberada_por) ?? null) : null,
      liberacion_vigente_hasta: lib?.vigente_hasta ?? null,
    };
  });

  return {
    ok: true,
    data: {
      resumen: resumirAuditoria(resultados, invalidas.length),
      filas,
      invalidas,
      truncado,
    },
  };
}
