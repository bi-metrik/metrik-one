// scripts/seed-demo.js
// Limpia y re-siembra el workspace demo de MéTRIK ONE
// Workspace: metrik (a21bfc88-1a60-48c3-afcd-144226aa2392)

const { createClient } = require('@supabase/supabase-js')
const path = require('path')
const fs = require('fs')

// ─── Cargar .env.local ────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local')
  const content = fs.readFileSync(envPath, 'utf8')
  content.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) return
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (key && !process.env[key]) process.env[key] = val
  })
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

// ─── Constantes ───────────────────────────────────────────────────────────────
const W              = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const STAFF_DIANA    = '23f6ac47-8811-4cd8-a5a6-e2ec4110828b'
const STAFF_MAURICIO = '392070b0-0015-4842-9ff6-b1413dbdd2de'
const PROFILE_MAURICIO = 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf'

// Empresas
const EMP_ANDINA   = 'aa000001-0000-4000-8000-000000000001'
const EMP_PALERMO  = 'aa000001-0000-4000-8000-000000000002'
const EMP_ARTEKANAL = 'aa000001-0000-4000-8000-000000000003'

// Contactos
const CONT_CATALINA  = 'bb000001-0000-4000-8000-000000000001'
const CONT_VALENTINA = 'bb000001-0000-4000-8000-000000000002'
const CONT_SEBASTIAN = 'bb000001-0000-4000-8000-000000000003'
const CONT_FELIPE    = 'bb000001-0000-4000-8000-000000000004'

// Oportunidades
const OPP_ANDINA_COMERCIAL = 'cc000001-0000-4000-8000-000000000001'
const OPP_PALERMO_GTO      = 'cc000001-0000-4000-8000-000000000002'
const OPP_ANDINA_COSTOS    = 'cc000001-0000-4000-8000-000000000003'
const OPP_ARTEKANAL_DIAG   = 'cc000001-0000-4000-8000-000000000004'
const OPP_ANDINA_CF        = 'cc000001-0000-4000-8000-000000000005'
const OPP_PALERMO_DASH     = 'cc000001-0000-4000-8000-000000000006'

// Cotizaciones
const COT_ANDINA_COMERCIAL = 'dd000001-0000-4000-8000-000000000001'
const COT_PALERMO_GTO      = 'dd000001-0000-4000-8000-000000000002'
const COT_ANDINA_COSTOS    = 'dd000001-0000-4000-8000-000000000003'
const COT_ARTEKANAL_DIAG   = 'dd000001-0000-4000-8000-000000000004'

// Proyectos
const PROJ_ANDINA_COMERCIAL = 'ee000001-0000-4000-8000-000000000001'
const PROJ_PALERMO_GTO      = 'ee000001-0000-4000-8000-000000000002'
const PROJ_ANDINA_COSTOS    = 'ee000001-0000-4000-8000-000000000003'
const PROJ_ARTEKANAL_DIAG   = 'ee000001-0000-4000-8000-000000000004'

// Proyecto Rubros
const RUB_COSTOS_HON = 'ff000001-0000-4000-8000-000000000001'
const RUB_COSTOS_SW  = 'ff000001-0000-4000-8000-000000000002'
const RUB_COSTOS_LOG = 'ff000001-0000-4000-8000-000000000003'
const RUB_DIAG_HON   = 'ff000001-0000-4000-8000-000000000004'
const RUB_DIAG_SW    = 'ff000001-0000-4000-8000-000000000005'
const RUB_DIAG_LOG   = 'ff000001-0000-4000-8000-000000000006'

// Facturas
const FAC_PALERMO   = 'fa000001-0000-4000-8000-000000000001'
const FAC_ANDINA_COM = 'fa000001-0000-4000-8000-000000000002'

// ─── Helper ───────────────────────────────────────────────────────────────────
async function del(table, filter) {
  const query = supabase.from(table).delete()
  const [col, val] = filter
  if (Array.isArray(val)) {
    const { error } = await query.in(col, val)
    if (error && error.code !== 'PGRST116') {
      console.error(`  ! Error deleting ${table} (in):`, error.message)
    } else {
      console.log(`  ✓ Deleted ${table}`)
    }
  } else {
    const { error } = await query.eq(col, val)
    if (error && error.code !== 'PGRST116') {
      console.error(`  ! Error deleting ${table}:`, error.message)
    } else {
      console.log(`  ✓ Deleted ${table}`)
    }
  }
}

async function ins(table, rows) {
  const data = Array.isArray(rows) ? rows : [rows]
  const { error } = await supabase.from(table).insert(data)
  if (error) {
    console.error(`  ! Error inserting ${table}:`, error.message)
    throw error
  } else {
    console.log(`  ✓ Inserted ${data.length} row(s) in ${table}`)
  }
}

// ─── Delete (FK-safe order) ───────────────────────────────────────────────────
async function deleteWorkspaceData() {
  console.log('\n[1/2] Deleting existing workspace data...')

  // timer_activo
  await del('timer_activo', ['workspace_id', W])

  // horas
  await del('horas', ['workspace_id', W])

  // cobros
  await del('cobros', ['workspace_id', W])

  // facturas
  await del('facturas', ['workspace_id', W])

  // gastos
  await del('gastos', ['workspace_id', W])

  // proyecto_rubros — no workspace_id, delete via proyecto_ids
  const proyectoIds = [
    PROJ_ANDINA_COMERCIAL,
    PROJ_PALERMO_GTO,
    PROJ_ANDINA_COSTOS,
    PROJ_ARTEKANAL_DIAG,
  ]
  await del('proyecto_rubros', ['proyecto_id', proyectoIds])

  // activity_log
  await del('activity_log', ['workspace_id', W])

  // proyectos primero (tiene FK → cotizaciones)
  await del('proyectos', ['workspace_id', W])

  // cotizaciones (tiene FK → oportunidades)
  await del('cotizaciones', ['workspace_id', W])

  // oportunidades (tiene FK → contactos, empresas)
  await del('oportunidades', ['workspace_id', W])

  // empresas primero (tiene FK → contactos via contacto_id)
  await del('empresas', ['workspace_id', W])

  // contactos
  await del('contactos', ['workspace_id', W])

  console.log('  Deletion complete.\n')
}

// ─── Insert ───────────────────────────────────────────────────────────────────
async function insertData() {
  console.log('[2/2] Inserting demo data...')

  // ── Empresas ─────────────────────────────────────────────────────────────
  console.log('\n  Empresas:')
  await ins('empresas', [
    {
      id: EMP_ANDINA,
      workspace_id: W,
      codigo: 'CLI-001',
      nombre: 'Grupo Andina Industrial SAS',
      sector: 'manufactura',
      municipio: 'Bogotá',
      departamento: 'Cundinamarca',
    },
    {
      id: EMP_PALERMO,
      workspace_id: W,
      codigo: 'CLI-002',
      nombre: 'Distribuidora Palermo SAS',
      sector: 'comercio',
      municipio: 'Medellín',
      departamento: 'Antioquia',
    },
    {
      id: EMP_ARTEKANAL,
      workspace_id: W,
      codigo: 'CLI-003',
      nombre: 'Artekanal Comunicaciones SAS',
      sector: 'servicios',
      municipio: 'Bogotá',
      departamento: 'Cundinamarca',
    },
  ])

  // ── Contactos ─────────────────────────────────────────────────────────────
  console.log('\n  Contactos:')
  await ins('contactos', [
    {
      id: CONT_CATALINA,
      workspace_id: W,
      nombre: 'Catalina Reyes',
      email: 'catalina.reyes@grupoandina.co',
      rol: 'decisor',
      segmento: 'convertido',
    },
    {
      id: CONT_FELIPE,
      workspace_id: W,
      nombre: 'Felipe Mendoza',
      email: 'fmendoza@grupoandina.co',
      rol: 'decisor',
      segmento: 'convertido',
    },
    {
      id: CONT_VALENTINA,
      workspace_id: W,
      nombre: 'Valentina Torres',
      email: 'vtorres@palermo.com.co',
      rol: 'decisor',
      segmento: 'convertido',
    },
    {
      id: CONT_SEBASTIAN,
      workspace_id: W,
      nombre: 'Sebastián Ríos',
      email: 'sebastian@artekanal.com',
      rol: 'decisor',
      segmento: 'convertido',
    },
  ])

  // ── Oportunidades ─────────────────────────────────────────────────────────
  console.log('\n  Oportunidades:')
  await ins('oportunidades', [
    {
      id: OPP_ANDINA_COMERCIAL,
      workspace_id: W,
      codigo: 'N-001',
      descripcion: 'Clarity Express: Estructura Comercial',
      etapa: 'ganada',
      probabilidad: 100,
      valor_estimado: 4800000,
      empresa_id: EMP_ANDINA,
      contacto_id: CONT_CATALINA,
      responsable_id: STAFF_MAURICIO,
    },
    {
      id: OPP_PALERMO_GTO,
      workspace_id: W,
      codigo: 'N-002',
      descripcion: 'Clarity: Seguimiento al Gasto y Tesorería',
      etapa: 'ganada',
      probabilidad: 100,
      valor_estimado: 8400000,
      empresa_id: EMP_PALERMO,
      contacto_id: CONT_VALENTINA,
      responsable_id: STAFF_MAURICIO,
    },
    {
      id: OPP_ANDINA_COSTOS,
      workspace_id: W,
      codigo: 'N-003',
      descripcion: 'Clarity Express: Estructura de Costos',
      etapa: 'ganada',
      probabilidad: 100,
      valor_estimado: 5500000,
      empresa_id: EMP_ANDINA,
      contacto_id: CONT_FELIPE,
      responsable_id: STAFF_MAURICIO,
    },
    {
      id: OPP_ARTEKANAL_DIAG,
      workspace_id: W,
      codigo: 'N-004',
      descripcion: 'Diagnóstico 360 + Tablero de KPIs',
      etapa: 'ganada',
      probabilidad: 100,
      valor_estimado: 14200000,
      empresa_id: EMP_ARTEKANAL,
      contacto_id: CONT_SEBASTIAN,
      responsable_id: STAFF_MAURICIO,
    },
    {
      id: OPP_ANDINA_CF,
      workspace_id: W,
      codigo: 'N-005',
      descripcion: 'Clarity Financiero: Rotación de Cartera y CXC',
      etapa: 'propuesta_enviada',
      probabilidad: 60,
      valor_estimado: 9500000,
      empresa_id: EMP_ANDINA,
      contacto_id: CONT_CATALINA,
      responsable_id: STAFF_MAURICIO,
      fecha_cierre_estimada: '2026-04-30',
    },
    {
      id: OPP_PALERMO_DASH,
      workspace_id: W,
      codigo: 'N-006',
      descripcion: 'Dashboard de Control de Inventario y Ventas',
      etapa: 'propuesta_enviada',
      probabilidad: 45,
      valor_estimado: 6800000,
      empresa_id: EMP_PALERMO,
      contacto_id: CONT_VALENTINA,
      responsable_id: STAFF_MAURICIO,
      fecha_cierre_estimada: '2026-05-15',
    },
  ])

  // ── Cotizaciones ──────────────────────────────────────────────────────────
  // Valid estados: borrador | enviada | aceptada | rechazada | vencida
  // Valid modos:   flash | detallada
  console.log('\n  Cotizaciones:')
  await ins('cotizaciones', [
    {
      id: COT_ANDINA_COMERCIAL,
      workspace_id: W,
      oportunidad_id: OPP_ANDINA_COMERCIAL,
      consecutivo: 'COT-001',
      codigo: 'COT-001',
      modo: 'detallada',
      descripcion: 'Clarity Express: Estructura Comercial',
      valor_total: 4800000,
      estado: 'aceptada',
    },
    {
      id: COT_PALERMO_GTO,
      workspace_id: W,
      oportunidad_id: OPP_PALERMO_GTO,
      consecutivo: 'COT-002',
      codigo: 'COT-002',
      modo: 'detallada',
      descripcion: 'Clarity: Seguimiento al Gasto',
      valor_total: 8400000,
      estado: 'aceptada',
    },
    {
      id: COT_ANDINA_COSTOS,
      workspace_id: W,
      oportunidad_id: OPP_ANDINA_COSTOS,
      consecutivo: 'COT-003',
      codigo: 'COT-003',
      modo: 'detallada',
      descripcion: 'Clarity Express: Estructura de Costos',
      valor_total: 5500000,
      estado: 'aceptada',
    },
    {
      id: COT_ARTEKANAL_DIAG,
      workspace_id: W,
      oportunidad_id: OPP_ARTEKANAL_DIAG,
      consecutivo: 'COT-004',
      codigo: 'COT-004',
      modo: 'detallada',
      descripcion: 'Diagnóstico 360 + Tablero de KPIs',
      valor_total: 14200000,
      estado: 'aceptada',
    },
  ])

  // ── Proyectos ─────────────────────────────────────────────────────────────
  // Valid estados: en_ejecucion | pausado | completado | rework | cancelado | cerrado | entregado
  console.log('\n  Proyectos:')
  await ins('proyectos', [
    {
      id: PROJ_ANDINA_COMERCIAL,
      workspace_id: W,
      codigo: 1,
      nombre: 'Clarity Express: Estructura Comercial',
      estado: 'cerrado',
      tipo: 'cliente',
      oportunidad_id: OPP_ANDINA_COMERCIAL,
      cotizacion_id: COT_ANDINA_COMERCIAL,
      empresa_id: EMP_ANDINA,
      contacto_id: CONT_CATALINA,
      responsable_id: STAFF_MAURICIO,
      presupuesto_total: 4800000,
      fecha_inicio: '2025-10-01',
      fecha_fin_estimada: '2025-12-15',
      fecha_cierre: '2025-12-20',
    },
    {
      id: PROJ_PALERMO_GTO,
      workspace_id: W,
      codigo: 2,
      nombre: 'Clarity: Seguimiento al Gasto y Tesorería',
      estado: 'entregado',
      tipo: 'cliente',
      oportunidad_id: OPP_PALERMO_GTO,
      cotizacion_id: COT_PALERMO_GTO,
      empresa_id: EMP_PALERMO,
      contacto_id: CONT_VALENTINA,
      responsable_id: STAFF_MAURICIO,
      presupuesto_total: 8400000,
      fecha_inicio: '2026-01-10',
      fecha_fin_estimada: '2026-03-10',
    },
    {
      id: PROJ_ANDINA_COSTOS,
      workspace_id: W,
      codigo: 3,
      nombre: 'Clarity Express: Estructura de Costos',
      estado: 'en_ejecucion',
      tipo: 'cliente',
      oportunidad_id: OPP_ANDINA_COSTOS,
      cotizacion_id: COT_ANDINA_COSTOS,
      empresa_id: EMP_ANDINA,
      contacto_id: CONT_FELIPE,
      responsable_id: STAFF_DIANA,
      responsable_comercial_id: STAFF_MAURICIO,
      presupuesto_total: 5500000,
      fecha_inicio: '2026-02-15',
      fecha_fin_estimada: '2026-04-30',
    },
    {
      id: PROJ_ARTEKANAL_DIAG,
      workspace_id: W,
      codigo: 4,
      nombre: 'Diagnóstico 360 + Tablero de KPIs',
      estado: 'en_ejecucion',
      tipo: 'cliente',
      oportunidad_id: OPP_ARTEKANAL_DIAG,
      cotizacion_id: COT_ARTEKANAL_DIAG,
      empresa_id: EMP_ARTEKANAL,
      contacto_id: CONT_SEBASTIAN,
      responsable_id: STAFF_DIANA,
      responsable_comercial_id: STAFF_MAURICIO,
      presupuesto_total: 14200000,
      fecha_inicio: '2026-02-01',
      fecha_fin_estimada: '2026-05-30',
    },
  ])

  // ── Proyecto Rubros ───────────────────────────────────────────────────────
  // Valid tipos: mo_propia | mo_terceros | materiales | viaticos | software | servicios_prof | general
  console.log('\n  Proyecto Rubros:')
  await ins('proyecto_rubros', [
    // PROJ_ANDINA_COSTOS
    { id: RUB_COSTOS_HON, proyecto_id: PROJ_ANDINA_COSTOS, nombre: 'Honorarios Consultoría',    tipo: 'servicios_prof', presupuestado: 4200000 },
    { id: RUB_COSTOS_SW,  proyecto_id: PROJ_ANDINA_COSTOS, nombre: 'Licencias y Software',      tipo: 'software',       presupuestado:  800000 },
    { id: RUB_COSTOS_LOG, proyecto_id: PROJ_ANDINA_COSTOS, nombre: 'Logística y Viáticos',      tipo: 'viaticos',       presupuestado:  500000 },
    // PROJ_ARTEKANAL_DIAG
    { id: RUB_DIAG_HON,   proyecto_id: PROJ_ARTEKANAL_DIAG, nombre: 'Honorarios Consultoría',   tipo: 'servicios_prof', presupuestado: 9500000 },
    { id: RUB_DIAG_SW,    proyecto_id: PROJ_ARTEKANAL_DIAG, nombre: 'Software y Herramientas',  tipo: 'software',       presupuestado: 2200000 },
    { id: RUB_DIAG_LOG,   proyecto_id: PROJ_ARTEKANAL_DIAG, nombre: 'Logística y Desplazamiento', tipo: 'viaticos',     presupuestado: 2500000 },
  ])

  // ── Gastos ────────────────────────────────────────────────────────────────
  // Valid categorias: materiales | transporte | alimentacion | servicios_profesionales |
  //                   software | arriendo | marketing | capacitacion | otros
  // Valid estado_causacion: PENDIENTE | APROBADO | CAUSADO | RECHAZADO
  console.log('\n  Gastos:')

  // PROJ_ANDINA_COSTOS (~60% ejecutado)
  await ins('gastos', [
    {
      workspace_id: W,
      proyecto_id: PROJ_ANDINA_COSTOS,
      rubro_id: RUB_COSTOS_HON,
      fecha: '2026-02-20',
      monto: 2800000,
      categoria: 'servicios_profesionales',
      descripcion: 'Honorarios Diana Sierra - Febrero',
      estado_causacion: 'CAUSADO',
      created_by: PROFILE_MAURICIO,
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ANDINA_COSTOS,
      rubro_id: RUB_COSTOS_LOG,
      fecha: '2026-03-05',
      monto: 180000,
      categoria: 'transporte',
      descripcion: 'Desplazamiento reuniones cliente',
      estado_causacion: 'APROBADO',
      created_by: PROFILE_MAURICIO,
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ANDINA_COSTOS,
      rubro_id: RUB_COSTOS_SW,
      fecha: '2026-03-12',
      monto: 350000,
      categoria: 'materiales',
      descripcion: 'Insumos taller de validación',
      estado_causacion: 'APROBADO',
      created_by: PROFILE_MAURICIO,
    },
  ])

  // PROJ_ARTEKANAL_DIAG (~30% ejecutado)
  await ins('gastos', [
    {
      workspace_id: W,
      proyecto_id: PROJ_ARTEKANAL_DIAG,
      rubro_id: RUB_DIAG_HON,
      fecha: '2026-02-10',
      monto: 3200000,
      categoria: 'servicios_profesionales',
      descripcion: 'Honorarios consultoría - Fase 1',
      estado_causacion: 'CAUSADO',
      created_by: PROFILE_MAURICIO,
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ARTEKANAL_DIAG,
      rubro_id: RUB_DIAG_SW,
      fecha: '2026-02-25',
      monto: 550000,
      categoria: 'software',
      descripcion: 'Licencias Power BI Pro (3 meses)',
      estado_causacion: 'CAUSADO',
      created_by: PROFILE_MAURICIO,
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ARTEKANAL_DIAG,
      rubro_id: RUB_DIAG_LOG,
      fecha: '2026-03-08',
      monto: 280000,
      categoria: 'transporte',
      descripcion: 'Viáticos desplazamiento sesiones',
      estado_causacion: 'APROBADO',
      created_by: PROFILE_MAURICIO,
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ARTEKANAL_DIAG,
      rubro_id: RUB_DIAG_SW,
      fecha: '2026-03-15',
      monto: 150000,
      categoria: 'materiales',
      descripcion: 'Materiales diagnóstico',
      estado_causacion: 'PENDIENTE',
      created_by: PROFILE_MAURICIO,
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ARTEKANAL_DIAG,
      rubro_id: RUB_DIAG_LOG,
      fecha: '2026-03-20',
      monto: 80000,
      categoria: 'alimentacion',
      descripcion: 'Refrigerios taller de KPIs',
      estado_causacion: 'PENDIENTE',
      created_by: PROFILE_MAURICIO,
    },
  ])

  // PROJ_PALERMO_GTO (entregado - todo ejecutado)
  await ins('gastos', [
    {
      workspace_id: W,
      proyecto_id: PROJ_PALERMO_GTO,
      fecha: '2026-01-20',
      monto: 5500000,
      categoria: 'servicios_profesionales',
      descripcion: 'Honorarios consultoría completo',
      estado_causacion: 'CAUSADO',
      created_by: PROFILE_MAURICIO,
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_PALERMO_GTO,
      fecha: '2026-02-05',
      monto: 800000,
      categoria: 'software',
      descripcion: 'Herramientas analíticas',
      estado_causacion: 'CAUSADO',
      created_by: PROFILE_MAURICIO,
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_PALERMO_GTO,
      fecha: '2026-02-18',
      monto: 320000,
      categoria: 'transporte',
      descripcion: 'Viáticos desplazamiento Medellín',
      estado_causacion: 'CAUSADO',
      created_by: PROFILE_MAURICIO,
    },
  ])

  // PROJ_ANDINA_COMERCIAL (cerrado)
  await ins('gastos', [
    {
      workspace_id: W,
      proyecto_id: PROJ_ANDINA_COMERCIAL,
      fecha: '2025-11-10',
      monto: 3800000,
      categoria: 'servicios_profesionales',
      descripcion: 'Honorarios ejecución',
      estado_causacion: 'CAUSADO',
      created_by: PROFILE_MAURICIO,
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ANDINA_COMERCIAL,
      fecha: '2025-12-05',
      monto: 200000,
      categoria: 'transporte',
      descripcion: 'Desplazamiento cierre',
      estado_causacion: 'CAUSADO',
      created_by: PROFILE_MAURICIO,
    },
  ])

  // ── Horas ─────────────────────────────────────────────────────────────────
  // horas.created_by references auth.users(id) — PROFILE_MAURICIO = auth.users.id
  // Valid estado_aprobacion: PENDIENTE | APROBADO | RECHAZADO
  console.log('\n  Horas:')
  await ins('horas', [
    // PROJ_ANDINA_COSTOS
    {
      workspace_id: W,
      proyecto_id: PROJ_ANDINA_COSTOS,
      staff_id: STAFF_DIANA,
      created_by: PROFILE_MAURICIO,
      fecha: '2026-02-18',
      horas: 6,
      descripcion: 'Levantamiento de información estructura de costos',
      estado_aprobacion: 'APROBADO',
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ANDINA_COSTOS,
      staff_id: STAFF_DIANA,
      created_by: PROFILE_MAURICIO,
      fecha: '2026-03-03',
      horas: 4,
      descripcion: 'Construcción modelo en Power BI',
      estado_aprobacion: 'APROBADO',
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ANDINA_COSTOS,
      staff_id: STAFF_MAURICIO,
      created_by: PROFILE_MAURICIO,
      fecha: '2026-03-10',
      horas: 3,
      descripcion: 'Revisión y ajuste modelo con cliente',
      estado_aprobacion: 'APROBADO',
    },
    // PROJ_ARTEKANAL_DIAG
    {
      workspace_id: W,
      proyecto_id: PROJ_ARTEKANAL_DIAG,
      staff_id: STAFF_DIANA,
      created_by: PROFILE_MAURICIO,
      fecha: '2026-02-05',
      horas: 8,
      descripcion: 'Diagnóstico inicial - entrevistas equipo',
      estado_aprobacion: 'APROBADO',
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ARTEKANAL_DIAG,
      staff_id: STAFF_DIANA,
      created_by: PROFILE_MAURICIO,
      fecha: '2026-02-19',
      horas: 6,
      descripcion: 'Análisis de datos y modelado',
      estado_aprobacion: 'APROBADO',
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ARTEKANAL_DIAG,
      staff_id: STAFF_MAURICIO,
      created_by: PROFILE_MAURICIO,
      fecha: '2026-03-04',
      horas: 4,
      descripcion: 'Diseño tablero KPIs',
      estado_aprobacion: 'APROBADO',
    },
    {
      workspace_id: W,
      proyecto_id: PROJ_ARTEKANAL_DIAG,
      staff_id: STAFF_DIANA,
      created_by: PROFILE_MAURICIO,
      fecha: '2026-03-18',
      horas: 5,
      descripcion: 'Iteraciones y ajustes dashboard',
      estado_aprobacion: 'PENDIENTE',
    },
  ])

  // ── Facturas ──────────────────────────────────────────────────────────────
  // Insertar antes de cobros (FK)
  console.log('\n  Facturas:')
  await ins('facturas', [
    {
      id: FAC_PALERMO,
      workspace_id: W,
      proyecto_id: PROJ_PALERMO_GTO,
      numero_factura: 'FAC-002',
      monto: 8400000,
      fecha_emision: '2026-03-15',
      notas: 'Factura por entrega completa proyecto Clarity',
    },
    {
      id: FAC_ANDINA_COM,
      workspace_id: W,
      proyecto_id: PROJ_ANDINA_COMERCIAL,
      numero_factura: 'FAC-001',
      monto: 4800000,
      fecha_emision: '2025-12-22',
      notas: 'Factura proyecto cerrado',
    },
  ])

  // ── Cobros ────────────────────────────────────────────────────────────────
  console.log('\n  Cobros:')
  await ins('cobros', [
    {
      workspace_id: W,
      factura_id: FAC_PALERMO,
      proyecto_id: PROJ_PALERMO_GTO,
      monto: 4200000,
      fecha: '2026-03-20',
      created_by: PROFILE_MAURICIO,
      notas: 'Anticipo 50%',
      estado_causacion: 'CAUSADO',
    },
    {
      workspace_id: W,
      factura_id: FAC_ANDINA_COM,
      proyecto_id: PROJ_ANDINA_COMERCIAL,
      monto: 4800000,
      fecha: '2026-01-05',
      created_by: PROFILE_MAURICIO,
      notas: 'Cobro total',
      estado_causacion: 'CAUSADO',
    },
  ])

  // ── Activity Log ──────────────────────────────────────────────────────────
  // entidad_tipo CHECK: 'oportunidad' | 'proyecto'
  // tipo CHECK: 'comentario' | 'cambio' | 'sistema'
  console.log('\n  Activity Log:')
  await ins('activity_log', [
    {
      workspace_id: W,
      entidad_tipo: 'proyecto',
      entidad_id: PROJ_ANDINA_COSTOS,
      tipo: 'comentario',
      autor_id: STAFF_DIANA,
      contenido: 'Reunión con Felipe Mendoza confirmada para el jueves. Se validó la estructura de costos fase 1. Cliente satisfecho con el avance.',
      created_at: '2026-03-12T10:30:00Z',
    },
    {
      workspace_id: W,
      entidad_tipo: 'proyecto',
      entidad_id: PROJ_ANDINA_COSTOS,
      tipo: 'comentario',
      autor_id: STAFF_MAURICIO,
      contenido: 'Ajustes al modelo de clasificación aprobados. Pendiente entrega del tablero final la semana del 21 de abril.',
      created_at: '2026-03-18T16:15:00Z',
    },
    {
      workspace_id: W,
      entidad_tipo: 'proyecto',
      entidad_id: PROJ_ARTEKANAL_DIAG,
      tipo: 'comentario',
      autor_id: STAFF_DIANA,
      contenido: 'Completadas las 3 sesiones de diagnóstico con el equipo. Procesando datos para el modelo de KPIs.',
      created_at: '2026-02-28T09:00:00Z',
    },
    {
      workspace_id: W,
      entidad_tipo: 'oportunidad',
      entidad_id: OPP_PALERMO_GTO,
      tipo: 'comentario',
      autor_id: STAFF_MAURICIO,
      contenido: 'Propuesta enviada a Valentina. Reunión de cierre el 28 de enero.',
      created_at: '2026-01-15T11:00:00Z',
    },
    {
      workspace_id: W,
      entidad_tipo: 'oportunidad',
      entidad_id: OPP_ANDINA_CF,
      tipo: 'comentario',
      autor_id: STAFF_MAURICIO,
      contenido: 'Primera reunión realizada. Catalina confirmó interés en Clarity Financiero. Enviando propuesta esta semana.',
      created_at: '2026-03-25T14:30:00Z',
    },
  ])

  console.log('\n  All data inserted successfully.')
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== MéTRIK ONE — Demo Seed ===')
  console.log(`Workspace: metrik (${W})\n`)

  await deleteWorkspaceData()
  await insertData()

  console.log('\n=== Demo seed complete! ===')
  console.log('\nSummary:')
  console.log('  3 empresas  · 4 contactos  · 6 oportunidades')
  console.log('  4 cotizaciones  · 4 proyectos  · 6 rubros')
  console.log('  13 gastos  · 7 horas  · 2 facturas  · 2 cobros  · 5 activity_log')
}

main().catch(err => {
  console.error('\nFatal error:', err.message || err)
  process.exit(1)
})
