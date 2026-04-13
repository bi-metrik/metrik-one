'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import * as XLSX from 'xlsx'

// ── Types ──────────────────────────────────────────────────

export type Riesgo = {
  id: string
  workspace_id: string
  codigo: string | null
  categoria: 'LA' | 'FT' | 'FPADM' | 'PTEE'
  descripcion: string
  factor_riesgo: string
  probabilidad: number
  impacto: number
  nivel_riesgo: string
  estado: string
  responsable_id: string | null
  fuente_identificacion: string | null
  fecha_identificacion: string | null
  fecha_evaluacion: string | null
  evaluado_por: string | null
  evidencias: unknown[]
  notas: string | null
  created_at: string
  updated_at: string
  // joined fields
  responsable_nombre?: string | null
}

// ── List riesgos ───────────────────────────────────────────

export async function getRiesgos(filters?: {
  categoria?: string
  nivel_riesgo?: string
  estado?: string
  factor_riesgo?: string
}) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return []
  if (!getRolePermissions(role ?? 'read_only').canViewRiesgos) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('riesgos')
    .select('*, responsable:profiles!responsable_id(full_name)')
    .eq('workspace_id', workspaceId)

  if (filters?.categoria && filters.categoria !== 'todos') {
    query = query.eq('categoria', filters.categoria)
  }
  if (filters?.nivel_riesgo && filters.nivel_riesgo !== 'todos') {
    query = query.eq('nivel_riesgo', filters.nivel_riesgo)
  }
  if (filters?.estado && filters.estado !== 'todos') {
    query = query.eq('estado', filters.estado)
  }
  if (filters?.factor_riesgo && filters.factor_riesgo !== 'todos') {
    query = query.eq('factor_riesgo', filters.factor_riesgo)
  }

  // Order: CRITICO first, then ALTO, MEDIO, BAJO
  query = query.order('created_at', { ascending: false })

  const { data } = await query

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const riesgos = (data ?? []).map((r: any) => ({
    ...r,
    responsable_nombre: r.responsable?.full_name ?? null,
  }))

  // Sort by nivel: CRITICO > ALTO > MEDIO > BAJO
  const nivelOrder: Record<string, number> = { CRITICO: 0, ALTO: 1, MEDIO: 2, BAJO: 3 }
  riesgos.sort((a: Riesgo, b: Riesgo) => (nivelOrder[a.nivel_riesgo] ?? 4) - (nivelOrder[b.nivel_riesgo] ?? 4))

  return riesgos as Riesgo[]
}

// ── Get single riesgo ──────────────────────────────────────

export async function getRiesgo(id: string) {
  const { supabase, role, error } = await getWorkspace()
  if (error) return null
  if (!getRolePermissions(role ?? 'read_only').canViewRiesgos) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('riesgos')
    .select('*, responsable:profiles!responsable_id(full_name)')
    .eq('id', id)
    .single()

  if (!data) return null

  return {
    ...data,
    responsable_nombre: data.responsable?.full_name ?? null,
  } as Riesgo
}

// ── Create riesgo ──────────────────────────────────────────

export async function crearRiesgo(formData: FormData) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  if (!getRolePermissions(role ?? 'read_only').canEditRiesgos) {
    return { success: false, error: 'No tienes permisos para crear riesgos' }
  }

  const categoria = formData.get('categoria') as string
  const descripcion = (formData.get('descripcion') as string)?.trim()
  const factor_riesgo = formData.get('factor_riesgo') as string
  const probabilidad = parseInt(formData.get('probabilidad') as string)
  const impacto = parseInt(formData.get('impacto') as string)
  const fuente_identificacion = (formData.get('fuente_identificacion') as string) || null
  const notas = (formData.get('notas') as string)?.trim() || null

  if (!categoria || !descripcion || !factor_riesgo) {
    return { success: false, error: 'Campos requeridos: categoria, descripcion, factor de riesgo' }
  }
  if (isNaN(probabilidad) || probabilidad < 1 || probabilidad > 5) {
    return { success: false, error: 'Probabilidad debe estar entre 1 y 5' }
  }
  if (isNaN(impacto) || impacto < 1 || impacto > 5) {
    return { success: false, error: 'Impacto debe estar entre 1 y 5' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await (supabase as any)
    .from('riesgos')
    .insert({
      workspace_id: workspaceId,
      categoria,
      descripcion,
      factor_riesgo,
      probabilidad,
      impacto,
      fuente_identificacion,
      notas,
    })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/riesgos')
  revalidatePath('/matriz')
  redirect('/riesgos')
}

// ── Update riesgo ──────────────────────────────────────────

export async function actualizarRiesgo(id: string, formData: FormData) {
  const { supabase, role, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }
  if (!getRolePermissions(role ?? 'read_only').canEditRiesgos) {
    return { success: false, error: 'No tienes permisos para editar riesgos' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {}

  const fields = ['estado', 'notas', 'responsable_id', 'fuente_identificacion', 'categoria', 'descripcion', 'factor_riesgo'] as const
  for (const f of fields) {
    const v = formData.get(f) as string | null
    if (v !== null) updates[f] = v.trim() || null
  }

  // Numeric fields
  const prob = formData.get('probabilidad') as string | null
  if (prob !== null) {
    const val = parseInt(prob)
    if (!isNaN(val) && val >= 1 && val <= 5) updates.probabilidad = val
  }
  const imp = formData.get('impacto') as string | null
  if (imp !== null) {
    const val = parseInt(imp)
    if (!isNaN(val) && val >= 1 && val <= 5) updates.impacto = val
  }

  updates.updated_at = new Date().toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await (supabase as any)
    .from('riesgos')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/riesgos')
  revalidatePath(`/riesgos/${id}`)
  revalidatePath('/matriz')
  return { success: true }
}

// ── Delete riesgo ──────────────────────────────────────────

export async function eliminarRiesgo(id: string) {
  const { supabase, role, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }
  if (!getRolePermissions(role ?? 'read_only').canDeleteRiesgos) {
    return { success: false, error: 'No tienes permisos para eliminar riesgos' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await (supabase as any)
    .from('riesgos')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/riesgos')
  revalidatePath('/matriz')
  redirect('/riesgos')
}

// ── Get riesgos_controles for a riesgo ─────────────────────

export async function getControlesRiesgo(riesgoId: string) {
  const { supabase, role, error } = await getWorkspace()
  if (error) return []
  if (!getRolePermissions(role ?? 'read_only').canViewRiesgos) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('riesgos_controles')
    .select('*')
    .eq('riesgo_id', riesgoId)
    .order('created_at', { ascending: false })

  return data ?? []
}

// ── Get team members for responsable selector ──────────────

export async function getEquipoParaRiesgo() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('workspace_id', workspaceId)
    .order('full_name')

  return (data ?? []).map(p => ({
    id: p.id,
    full_name: p.full_name ?? 'Sin nombre',
    role: p.role,
  }))
}

// ── Excel: Constants ────────────────────────────────────────

const CATEGORIAS_VALIDAS = ['LA', 'FT', 'FPADM', 'PTEE'] as const
const FACTORES_VALIDOS = ['clientes', 'proveedores', 'empleados', 'canales', 'jurisdicciones', 'productos', 'operaciones'] as const
const FUENTES_VALIDAS = ['cliente_nuevo', 'transaccion_atipica', 'lista_internacional', 'reporte_interno', 'auditoria', 'otro'] as const

const FACTOR_DISPLAY_TO_DB: Record<string, string> = {
  'clientes': 'clientes',
  'proveedores': 'proveedores',
  'empleados': 'empleados',
  'canales': 'canales',
  'jurisdicciones': 'jurisdicciones',
  'productos': 'productos',
  'operaciones': 'operaciones',
}

const FUENTE_DISPLAY_TO_DB: Record<string, string> = {
  'cliente nuevo': 'cliente_nuevo',
  'transaccion atipica': 'transaccion_atipica',
  'transacción atípica': 'transaccion_atipica',
  'lista internacional': 'lista_internacional',
  'reporte interno': 'reporte_interno',
  'auditoria': 'auditoria',
  'auditoría': 'auditoria',
  'otro': 'otro',
}

const FACTOR_DB_TO_DISPLAY: Record<string, string> = {
  clientes: 'Clientes',
  proveedores: 'Proveedores',
  empleados: 'Empleados',
  canales: 'Canales',
  jurisdicciones: 'Jurisdicciones',
  productos: 'Productos',
  operaciones: 'Operaciones',
}

const FUENTE_DB_TO_DISPLAY: Record<string, string> = {
  cliente_nuevo: 'Cliente nuevo',
  transaccion_atipica: 'Transaccion atipica',
  lista_internacional: 'Lista internacional',
  reporte_interno: 'Reporte interno',
  auditoria: 'Auditoria',
  otro: 'Otro',
}

// ── Excel: Generar plantilla ────────────────────────────────

export async function generarPlantillaRiesgos(): Promise<{ data: string; filename: string }> {
  const { role, error } = await getWorkspace()
  if (error) throw new Error('No autenticado')
  if (!getRolePermissions(role ?? 'read_only').canExportRiesgos) {
    throw new Error('No tienes permisos para descargar la plantilla')
  }

  const wb = XLSX.utils.book_new()

  // -- Hoja "Riesgos" con headers + 2 filas de ejemplo --
  const headers = ['Categoria', 'Descripcion', 'Factor de riesgo', 'Probabilidad', 'Impacto', 'Fuente de identificacion', 'Notas']
  const ejemplos = [
    ['LA', 'Cliente con transacciones inusuales superiores a $500M mensuales sin justificacion economica aparente', 'Clientes', 3, 4, 'Transaccion atipica', 'Revisar historial de transacciones ultimos 6 meses'],
    ['FT', 'Proveedor ubicado en jurisdiccion de alto riesgo segun lista GAFI', 'Jurisdicciones', 2, 5, 'Lista internacional', 'Verificar contra listas actualizadas'],
  ]

  const riesgosData = [headers, ...ejemplos]
  const wsRiesgos = XLSX.utils.aoa_to_sheet(riesgosData)

  // Column widths
  wsRiesgos['!cols'] = [
    { wch: 12 },  // Categoria
    { wch: 60 },  // Descripcion
    { wch: 18 },  // Factor
    { wch: 14 },  // Probabilidad
    { wch: 10 },  // Impacto
    { wch: 25 },  // Fuente
    { wch: 40 },  // Notas
  ]

  // Data validation — Categoria dropdown (rows 2-100)
  wsRiesgos['!dataValidation'] = [
    {
      sqref: 'A2:A100',
      type: 'list',
      formula1: '"LA,FT,FPADM,PTEE"',
      showErrorMessage: true,
      errorTitle: 'Categoria invalida',
      error: 'Valores validos: LA, FT, FPADM, PTEE',
    },
    {
      sqref: 'C2:C100',
      type: 'list',
      formula1: '"Clientes,Proveedores,Empleados,Canales,Jurisdicciones,Productos,Operaciones"',
      showErrorMessage: true,
      errorTitle: 'Factor invalido',
      error: 'Seleccione un factor de riesgo valido',
    },
    {
      sqref: 'D2:D100',
      type: 'whole',
      operator: 'between',
      formula1: '1',
      formula2: '5',
      showErrorMessage: true,
      errorTitle: 'Probabilidad invalida',
      error: 'Debe ser un numero entre 1 y 5',
    },
    {
      sqref: 'E2:E100',
      type: 'whole',
      operator: 'between',
      formula1: '1',
      formula2: '5',
      showErrorMessage: true,
      errorTitle: 'Impacto invalido',
      error: 'Debe ser un numero entre 1 y 5',
    },
    {
      sqref: 'F2:F100',
      type: 'list',
      formula1: '"Cliente nuevo,Transaccion atipica,Lista internacional,Reporte interno,Auditoria,Otro"',
      showErrorMessage: true,
      errorTitle: 'Fuente invalida',
      error: 'Seleccione una fuente de identificacion valida',
    },
  ]

  XLSX.utils.book_append_sheet(wb, wsRiesgos, 'Riesgos')

  // -- Hoja "Instrucciones" --
  const instrucciones = [
    ['Plantilla de Riesgos SARLAFT \u2014 MeTRIK ONE'],
    [],
    ['CATEGORIAS DE RIESGO'],
    ['Codigo', 'Nombre completo'],
    ['LA', 'Lavado de Activos'],
    ['FT', 'Financiacion del Terrorismo'],
    ['FPADM', 'Financiacion de la Proliferacion de Armas de Destruccion Masiva'],
    ['PTEE', 'Personas Expuestas Politicamente (PEP) y Entidades Especiales'],
    [],
    ['FACTORES DE RIESGO'],
    ['Clientes', 'Proveedores', 'Empleados', 'Canales', 'Jurisdicciones', 'Productos', 'Operaciones'],
    [],
    ['ESCALA DE PROBABILIDAD'],
    ['Valor', 'Nivel', 'Descripcion'],
    ['1', 'Raro', 'El evento puede ocurrir solo en circunstancias excepcionales'],
    ['2', 'Improbable', 'El evento puede ocurrir en algun momento'],
    ['3', 'Posible', 'El evento podria ocurrir en algun momento'],
    ['4', 'Probable', 'El evento probablemente ocurrira en la mayoria de las circunstancias'],
    ['5', 'Casi seguro', 'Se espera que el evento ocurra en la mayoria de las circunstancias'],
    [],
    ['ESCALA DE IMPACTO'],
    ['Valor', 'Nivel', 'Descripcion'],
    ['1', 'Insignificante', 'Sin impacto material en la operacion'],
    ['2', 'Menor', 'Impacto leve, manejable con controles existentes'],
    ['3', 'Moderado', 'Impacto significativo, requiere atencion de la gerencia'],
    ['4', 'Mayor', 'Impacto grave, puede afectar la continuidad del negocio'],
    ['5', 'Catastrofico', 'Impacto critico, amenaza la existencia de la organizacion'],
    [],
    ['NIVELES DE RIESGO (Probabilidad x Impacto)'],
    ['Rango', 'Nivel', 'Accion requerida'],
    ['1-5', 'BAJO', 'Monitoreo periodico, controles estandar'],
    ['6-11', 'MEDIO', 'Plan de mitigacion, controles reforzados'],
    ['12-19', 'ALTO', 'Atencion prioritaria, controles especificos, reporte a gerencia'],
    ['20-25', 'CRITICO', 'Accion inmediata, reporte a UIAF si aplica, controles extraordinarios'],
    [],
    ['FUENTES DE IDENTIFICACION'],
    ['Cliente nuevo', 'Identificado durante proceso de vinculacion de cliente'],
    ['Transaccion atipica', 'Detectado por monitoreo de transacciones inusuales'],
    ['Lista internacional', 'Coincidencia con listas restrictivas (ONU, OFAC, UE, GAFI)'],
    ['Reporte interno', 'Reportado por empleado o area interna'],
    ['Auditoria', 'Identificado durante proceso de auditoria interna o externa'],
    ['Otro', 'Otra fuente de identificacion'],
    [],
    ['INSTRUCCIONES DE USO'],
    ['1. Complete los datos en la hoja "Riesgos"'],
    ['2. No modifique los encabezados de columna'],
    ['3. Use los valores exactos de las listas desplegables'],
    ['4. Las filas de ejemplo pueden eliminarse o sobrescribirse'],
    ['5. Importe el archivo desde la pagina de Riesgos en MeTRIK ONE'],
  ]

  const wsInstrucciones = XLSX.utils.aoa_to_sheet(instrucciones)
  wsInstrucciones['!cols'] = [
    { wch: 25 },
    { wch: 30 },
    { wch: 60 },
  ]

  XLSX.utils.book_append_sheet(wb, wsInstrucciones, 'Instrucciones')

  // Generate as base64
  const buffer = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })

  return {
    data: buffer,
    filename: `plantilla_riesgos_sarlaft_${new Date().toISOString().slice(0, 10)}.xlsx`,
  }
}

// ── Excel: Importar riesgos ─────────────────────────────────

export async function importarRiesgosExcel(base64: string): Promise<{
  success: boolean
  imported: number
  errors: { fila: number; error: string }[]
}> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, imported: 0, errors: [{ fila: 0, error: 'No autenticado' }] }
  if (!getRolePermissions(role ?? 'read_only').canImportRiesgos) {
    return { success: false, imported: 0, errors: [{ fila: 0, error: 'No tienes permisos para importar riesgos' }] }
  }

  let wb: XLSX.WorkBook
  try {
    const buffer = Buffer.from(base64, 'base64')
    wb = XLSX.read(buffer, { type: 'buffer' })
  } catch {
    return { success: false, imported: 0, errors: [{ fila: 0, error: 'No se pudo leer el archivo Excel' }] }
  }

  // Read first sheet or "Riesgos" sheet
  const sheetName = wb.SheetNames.includes('Riesgos') ? 'Riesgos' : wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  if (!ws) {
    return { success: false, imported: 0, errors: [{ fila: 0, error: 'No se encontro hoja de datos' }] }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })

  // Skip header row
  const dataRows = rows.slice(1)
  const errors: { fila: number; error: string }[] = []
  const toInsert: {
    workspace_id: string
    categoria: string
    descripcion: string
    factor_riesgo: string
    probabilidad: number
    impacto: number
    fuente_identificacion: string | null
    notas: string | null
  }[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const filaExcel = i + 2 // +1 for header, +1 for 1-based

    // Skip completely empty rows
    if (!row || row.length === 0 || row.every(cell => cell === null || cell === undefined || String(cell).trim() === '')) {
      continue
    }

    const categoriaRaw = String(row[0] ?? '').trim().toUpperCase()
    const descripcion = String(row[1] ?? '').trim()
    const factorRaw = String(row[2] ?? '').trim()
    const probRaw = row[3]
    const impRaw = row[4]
    const fuenteRaw = String(row[5] ?? '').trim()
    const notas = String(row[6] ?? '').trim() || null

    // Validate categoria
    if (!CATEGORIAS_VALIDAS.includes(categoriaRaw as typeof CATEGORIAS_VALIDAS[number])) {
      errors.push({ fila: filaExcel, error: `Categoria "${categoriaRaw}" invalida. Valores: ${CATEGORIAS_VALIDAS.join(', ')}` })
      continue
    }

    // Validate descripcion
    if (!descripcion) {
      errors.push({ fila: filaExcel, error: 'Descripcion no puede estar vacia' })
      continue
    }

    // Validate factor_riesgo (case insensitive)
    const factorLower = factorRaw.toLowerCase()
    const factorDb = FACTOR_DISPLAY_TO_DB[factorLower] ?? (FACTORES_VALIDOS.includes(factorLower as typeof FACTORES_VALIDOS[number]) ? factorLower : null)
    if (!factorDb) {
      errors.push({ fila: filaExcel, error: `Factor de riesgo "${factorRaw}" invalido` })
      continue
    }

    // Validate probabilidad
    const prob = typeof probRaw === 'number' ? Math.round(probRaw) : parseInt(String(probRaw))
    if (isNaN(prob) || prob < 1 || prob > 5) {
      errors.push({ fila: filaExcel, error: `Probabilidad "${probRaw}" invalida. Debe ser 1-5` })
      continue
    }

    // Validate impacto
    const imp = typeof impRaw === 'number' ? Math.round(impRaw) : parseInt(String(impRaw))
    if (isNaN(imp) || imp < 1 || imp > 5) {
      errors.push({ fila: filaExcel, error: `Impacto "${impRaw}" invalido. Debe ser 1-5` })
      continue
    }

    // Validate fuente (optional, but if present must be valid)
    let fuenteDb: string | null = null
    if (fuenteRaw) {
      const fuenteLower = fuenteRaw.toLowerCase()
      fuenteDb = FUENTE_DISPLAY_TO_DB[fuenteLower] ?? (FUENTES_VALIDAS.includes(fuenteLower as typeof FUENTES_VALIDAS[number]) ? fuenteLower : null)
      if (!fuenteDb) {
        errors.push({ fila: filaExcel, error: `Fuente "${fuenteRaw}" invalida` })
        continue
      }
    }

    toInsert.push({
      workspace_id: workspaceId,
      categoria: categoriaRaw,
      descripcion,
      factor_riesgo: factorDb,
      probabilidad: prob,
      impacto: imp,
      fuente_identificacion: fuenteDb,
      notas,
    })
  }

  if (toInsert.length === 0) {
    return {
      success: errors.length === 0,
      imported: 0,
      errors: errors.length > 0 ? errors : [{ fila: 0, error: 'No se encontraron filas validas para importar' }],
    }
  }

  // Insert all valid rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await (supabase as any)
    .from('riesgos')
    .insert(toInsert)

  if (dbError) {
    return { success: false, imported: 0, errors: [{ fila: 0, error: `Error de base de datos: ${dbError.message}` }] }
  }

  revalidatePath('/riesgos')
  revalidatePath('/matriz')

  return {
    success: true,
    imported: toInsert.length,
    errors,
  }
}

// ── Excel: Exportar riesgos existentes ──────────────────────

export async function exportarRiesgosExcel(): Promise<{ data: string; filename: string }> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) {
    throw new Error('No autenticado')
  }
  if (!getRolePermissions(role ?? 'read_only').canExportRiesgos) {
    throw new Error('No tienes permisos para exportar riesgos')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: riesgos } = await (supabase as any)
    .from('riesgos')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  const wb = XLSX.utils.book_new()

  const headers = ['Codigo', 'Categoria', 'Descripcion', 'Factor de riesgo', 'Probabilidad', 'Impacto', 'Nivel de riesgo', 'Estado', 'Fuente de identificacion', 'Notas', 'Fecha creacion']

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (riesgos ?? []).map((r: any) => [
    r.codigo ?? '',
    r.categoria,
    r.descripcion,
    FACTOR_DB_TO_DISPLAY[r.factor_riesgo] ?? r.factor_riesgo,
    r.probabilidad,
    r.impacto,
    r.nivel_riesgo,
    r.estado,
    FUENTE_DB_TO_DISPLAY[r.fuente_identificacion] ?? r.fuente_identificacion ?? '',
    r.notas ?? '',
    r.created_at ? new Date(r.created_at).toLocaleDateString('es-CO') : '',
  ])

  const wsData = XLSX.utils.aoa_to_sheet([headers, ...rows])
  wsData['!cols'] = [
    { wch: 10 },  // Codigo
    { wch: 12 },  // Categoria
    { wch: 60 },  // Descripcion
    { wch: 18 },  // Factor
    { wch: 14 },  // Probabilidad
    { wch: 10 },  // Impacto
    { wch: 14 },  // Nivel
    { wch: 16 },  // Estado
    { wch: 25 },  // Fuente
    { wch: 40 },  // Notas
    { wch: 16 },  // Fecha
  ]

  XLSX.utils.book_append_sheet(wb, wsData, 'Riesgos')

  const buffer = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })

  return {
    data: buffer,
    filename: `riesgos_sarlaft_${new Date().toISOString().slice(0, 10)}.xlsx`,
  }
}
