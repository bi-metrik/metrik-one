// ============================================================
// El DOBLE del clonador del espacio de pruebas: un workspace de viajes INVENTADO con la forma
// que tiene el de Trappvel (línea de viaje activa y una copia inactiva, etapas 1-3, el bloque
// que declara quiénes viajan, el de cotización, aprobadores por staff) y, a propósito, todo
// lo que NO se puede copiar: credenciales, canales, almacenamiento propio, carpetas de Drive,
// negocios, contactos y una tabla que nadie clasificó.
//
// Ningún nombre, id, NIT ni teléfono es de la cliente: están escritos a mano. Lo usan la
// prueba (`src/lib/espacio-pruebas/plan.test.ts`) y el simulacro del script (`--doble`).
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { almacenEnMemoria, type Fila, type LlaveForanea } from '../src/lib/espacio-pruebas/almacen'
import type { EntradaCaso, EscrituraGrabada } from '../src/lib/espacio-pruebas/semillas'
import { tablasCasoSanAndres } from './caso-san-andres'

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`

export const ORIGEN = {
  ws: id(1),
  perfilDueno: id(2),
  perfilAsesora: id(3),
  staffDueno: id(4),
  staffAsesora: id(5),
  linea: id(10),
  lineaInactiva: id(11),
  etapa1: id(20),
  etapa2: id(21),
  etapa3: id(22),
  etapaInactiva: id(23),
  bloqueViaje: id(30),
  bloqueContacto: id(31),
  bloqueCotizacion: id(32),
  bloqueEtapa3: id(33),
  bloqueInactivo: id(34),
  defDatos: id(40),
  defCotizacion: id(41),
  campo: id(50),
  etiqueta: id(51),
  servicio: id(52),
  tarifa: id(53),
  negocio: id(60),
  contacto: id(61),
  cotizacion: id(62),
}

const CAMPOS_VIAJE = ['adultos', 'ninos', 'infantes', 'fecha_salida', 'fecha_regreso', 'destino', 'nivel_detalle'].map(slug => ({ slug }))

export function tablasDelDoble(): Record<string, Fila[]> {
  const o = ORIGEN
  return {
    workspaces: [{
      id: o.ws, slug: 'trappvel', name: 'Agencia Origen (inventada)', tipo: 'clarity', subscription_status: 'active',
      max_seats: 8, equipo_declarado: 4, color_primario: '#0E7490', color_secundario: '#F59E0B',
      cotizacion_template_slug: 'trappvel', stages_activos: ['venta', 'ejecucion', 'cobro'], linea_activa_id: o.linea,
      logo_url: 'https://inventado.example/logo.png', drive_folder_id: 'carpeta-drive-inventada',
      modules: { business: true, pausa_enabled: true, bandeja_solicitudes_wa: true, siigo_facturacion: true },
      config_extra: {
        grupo: 'clarity',
        iva_cotizacion: { base: 'ingreso_propio', precio: 'iva_incluido' },
        documento_viaje: { pie: 'Gracias por viajar con nosotros', firma: { nombre: 'Director Inventado', contacto: '+57 300 000 0000' } },
        medios_pago_proveedor: [{ id: 'tc-empresa', label: 'Tarjeta de la empresa', titular: 'empresa' }],
        negocio_codigo_format: [{ linea_id: o.linea, nombre_auto: 'contacto' }],
        storage_provider: 'supabase_externo',
        storage_supabase_url: 'https://inventado.supabase.co',
        wa_customer_bot: { trigger: 'hola agencia' },
        siigo: { usuario: 'inventado', access_key: 'no-es-una-llave' },
        bandeja_solicitudes: { linea_id: o.linea },
        llave_nueva_sin_clasificar: { algo: true },
      },
    }],
    profiles: [
      { id: o.perfilDueno, workspace_id: o.ws, full_name: 'Dueño Inventado', role: 'owner', platform_admin: false },
      { id: o.perfilAsesora, workspace_id: o.ws, full_name: 'Asesora Inventada', role: 'operator', platform_admin: false },
    ],
    staff: [
      { id: o.staffDueno, workspace_id: o.ws, profile_id: o.perfilDueno, full_name: 'Dueño Inventado', rol_plataforma: 'dueno' },
      { id: o.staffAsesora, workspace_id: o.ws, profile_id: o.perfilAsesora, full_name: 'Asesora Inventada', rol_plataforma: 'ejecutor' },
    ],
    staff_areas: [{ staff_id: o.staffAsesora, area: 'comercial' }],
    lineas_negocio: [
      {
        id: o.linea, workspace_id: o.ws, nombre: 'Viaje a medida', numero: 1, tipo: 'servicio', is_active: true,
        drive_folder_id: 'carpeta-linea-inventada',
        config_extra: {
          margen: { piso_pct: 5, aviso_pct: 10, convencion: 'sobre_venta', default_pct: 15 },
          aprobaciones: { staff_ids: [o.staffDueno] },
          responsables: { comercial: o.staffAsesora },
          drive_folder_id: 'otra-carpeta',
          siigo: { recibo_total_automatico: true },
          facturacion: { activo: false },
          terminos_base: 'Pagos a la cuenta 0000000000 del banco inventado.',
        },
      },
      { id: o.lineaInactiva, workspace_id: o.ws, nombre: 'Viaje a medida · prueba', numero: 2, tipo: 'servicio', is_active: false, config_extra: {} },
    ],
    etapas_negocio: [
      { id: o.etapa1, linea_id: o.linea, nombre: 'Solicitud', numero: 1, orden: 1, stage: 'venta', is_active: true, config_extra: {} },
      { id: o.etapa2, linea_id: o.linea, nombre: 'Cotización', numero: 2, orden: 2, stage: 'venta', is_active: true, config_extra: { gates: ['margen_sobre_piso'] } },
      { id: o.etapa3, linea_id: o.linea, nombre: 'Reserva', numero: 3, orden: 3, stage: 'ejecucion', is_active: true, config_extra: { avisar_a: [o.staffDueno] } },
      { id: o.etapaInactiva, linea_id: o.lineaInactiva, nombre: 'Solicitud', numero: 1, orden: 1, stage: 'venta', is_active: true, config_extra: {} },
    ],
    bloque_definitions: [
      { id: o.defDatos, tipo: 'datos', nombre: 'Datos' },
      { id: o.defCotizacion, tipo: 'cotizacion', nombre: 'Cotización' },
    ],
    bloque_configs: [
      { id: o.bloqueViaje, workspace_id: o.ws, etapa_id: o.etapa1, bloque_definition_id: o.defDatos, nombre: 'Condiciones del viaje', orden: 1, estado: 'editable', config_extra: { fields: CAMPOS_VIAJE } },
      { id: o.bloqueContacto, workspace_id: o.ws, etapa_id: o.etapa1, bloque_definition_id: o.defDatos, nombre: 'Contacto', orden: 2, estado: 'editable', config_extra: { fields: [{ slug: 'nombre' }, { slug: 'email' }], drive_subfolder: 'Contacto' } },
      { id: o.bloqueCotizacion, workspace_id: o.ws, etapa_id: o.etapa2, bloque_definition_id: o.defCotizacion, nombre: 'Cotización', orden: 1, estado: 'editable', config_extra: {} },
      { id: o.bloqueEtapa3, workspace_id: o.ws, etapa_id: o.etapa3, bloque_definition_id: o.defDatos, nombre: 'Reserva', orden: 1, estado: 'editable', config_extra: { notificar: { correo: 'director@inventado.example' } } },
      { id: o.bloqueInactivo, workspace_id: o.ws, etapa_id: o.etapaInactiva, bloque_definition_id: o.defDatos, nombre: 'Viaje', orden: 1, estado: 'editable', config_extra: { fields: CAMPOS_VIAJE } },
    ],
    custom_fields: [{ id: o.campo, workspace_id: o.ws, entidad: 'negocio', nombre: 'Canal', slug: 'canal', tipo: 'texto' }],
    labels: [{ id: o.etiqueta, workspace_id: o.ws, entidad: 'negocio', nombre: 'VIP', color: '#000000', created_by: o.perfilDueno }],
    servicios: [{ id: o.servicio, workspace_id: o.ws, linea_id: o.linea, nombre: 'Asesoría de viaje', activo: true }],
    fiscal_profiles: [{
      workspace_id: o.ws, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true, is_declarante: true,
      self_withholder: false, nit: '901000001', razon_social: 'AGENCIA ORIGEN INVENTADA S.A.S', direccion_fiscal: 'Calle Inventada 1',
      email_facturacion: 'facturas@inventado.example', is_complete: true,
    }],
    // Lo que no se copia: datos y canales.
    contactos: [{ id: o.contacto, workspace_id: o.ws, nombre: 'Viajera Inventada', email: 'viajera@inventado.example' }],
    negocios: [{ id: o.negocio, workspace_id: o.ws, nombre: 'Viaje inventado', linea_id: o.linea, contacto_id: o.contacto, etapa_actual_id: o.etapa2, metadata: {} }],
    cotizaciones: [{ id: o.cotizacion, workspace_id: o.ws, negocio_id: o.negocio, codigo: 'COT-2026-0001', consecutivo: 'COT-2026-0001', estado: 'borrador' }],
    wa_collaborators: [{ id: id(70), workspace_id: o.ws, phone: '+573000000001' }],
    activity_log: [{ id: id(71), workspace_id: o.ws, contenido: 'algo pasó' }],
    tabla_sin_clasificar: [{ id: id(72), workspace_id: o.ws }],
    servicio_tarifas_versiones: [{ id: o.tarifa, workspace_id: o.ws, servicio_id: o.servicio, version: 1, planes: [{ n: 1, valor: 100 }], creado_por: o.staffDueno }],
    // Tablas de configuración que este workspace no usa: existen, vacías.
    custom_field_mappings: [],
    workspace_stages: [{ id: id(74), workspace_id: o.ws, entidad: 'oportunidad', slug: 'lead_nuevo', es_sistema: true }],
    stage_transition_rules: [],
    expense_categories: [{ id: id(73), workspace_id: o.ws, name: 'Materiales' }],
    workspace_features: [],
    etapas_nombres_anteriores: [],
    negocio_bloques: [],
    negocio_responsables: [],
    items: [],
    rubros: [],
    cotizacion_itinerarios: [],
    itinerario_opciones: [],
  }
}

/** Las columnas de cada tabla del doble (lo que en la base da PostgREST). */
function esquemaDe(tablas: Record<string, Fila[]>): Record<string, string[]> {
  const extra: Record<string, string[]> = {
    negocio_bloques: ['id', 'negocio_id', 'bloque_config_id', 'estado', 'data', 'completado_at'],
    negocio_responsables: ['negocio_id', 'staff_id', 'rol'],
    items: ['id', 'cotizacion_id'],
    rubros: ['id', 'item_id', 'cantidad', 'valor_unitario', 'valor_total'],
    cotizacion_itinerarios: ['id', 'workspace_id', 'cotizacion_id'],
    itinerario_opciones: ['itinerario_id', 'item_id'],
    etapas_nombres_anteriores: ['id', 'linea_id', 'etapa_id', 'nombre', 'origen'],
    workspace_features: ['id', 'workspace_id', 'feature_key'],
    custom_field_mappings: ['id', 'workspace_id'],
    stage_transition_rules: ['id', 'workspace_id'],
    activity_log: ['id', 'workspace_id', 'entidad_id', 'entidad_tipo', 'contenido'],
  }
  const out: Record<string, string[]> = {}
  for (const [t, filas] of Object.entries(tablas)) out[t] = [...new Set([...(extra[t] ?? []), ...filas.flatMap(f => Object.keys(f))])]
  return out
}

/**
 * Las llaves foráneas de la base entre las tablas del doble, que el doble hace cumplir al
 * escribir y al borrar. Salen de `src/types/database.ts` (Relationships) más la acción al
 * borrar de su migración; la prueba `el doble declara todas las llaves de la base` falla si
 * aparece una en los tipos que aquí no está.
 */
export const LLAVES: LlaveForanea[] = [
  ['negocio_bloques', 'negocio_id', 'negocios'], ['negocio_bloques', 'bloque_config_id', 'bloque_configs'],
  ['negocio_bloques', 'completado_por', 'profiles'],
  ['negocio_responsables', 'negocio_id', 'negocios'], ['negocio_responsables', 'staff_id', 'staff'],
  ['negocio_responsables', 'assigned_by', 'profiles'],
  ['cotizaciones', 'negocio_id', 'negocios'], ['cotizaciones', 'duplicada_de', 'cotizaciones'],
  ['items', 'cotizacion_id', 'cotizaciones'], ['rubros', 'item_id', 'items'],
  ['cotizacion_itinerarios', 'cotizacion_id', 'cotizaciones'], ['itinerario_opciones', 'itinerario_id', 'cotizacion_itinerarios'],
  ['itinerario_opciones', 'item_id', 'items'], ['negocios', 'contacto_id', 'contactos'], ['negocios', 'linea_id', 'lineas_negocio'],
  ['negocios', 'etapa_actual_id', 'etapas_negocio'], ['negocios', 'responsable_id', 'staff'],
  ['negocios', 'cierre_no_facturable_por', 'staff'], ['negocios', 'paused_by', 'profiles'],
  ['contactos', 'fuente_promotor_id', 'contactos'], ['contactos', 'responsable_id', 'staff'],
  ['etapas_negocio', 'linea_id', 'lineas_negocio'],
  ['bloque_configs', 'etapa_id', 'etapas_negocio'], ['bloque_configs', 'bloque_definition_id', 'bloque_definitions'],
  ['staff', 'profile_id', 'profiles'], ['staff_areas', 'staff_id', 'staff'],
  ['servicio_tarifas_versiones', 'servicio_id', 'servicios'], ['servicio_tarifas_versiones', 'creado_por', 'staff'],
  ['servicios', 'linea_id', 'lineas_negocio'], ['labels', 'created_by', 'profiles'],
  ['profiles', 'home_workspace_id', 'workspaces'], ['activity_log', 'autor_id', 'staff'], ['activity_log', 'mencion_id', 'staff'],
  ['stage_transition_rules', 'desde_stage_id', 'workspace_stages'], ['stage_transition_rules', 'hasta_stage_id', 'workspace_stages'],
  ...['lineas_negocio', 'bloque_configs', 'custom_fields', 'custom_field_mappings', 'labels', 'servicios', 'servicio_tarifas_versiones',
    'fiscal_profiles', 'contactos', 'negocios', 'cotizaciones', 'staff', 'profiles', 'cotizacion_itinerarios', 'wa_collaborators',
    'activity_log', 'tabla_sin_clasificar', 'workspace_features', 'expense_categories', 'workspace_stages', 'stage_transition_rules'].map(t => [t, 'workspace_id', 'workspaces']),
].map(([tabla, columna, apunta]) => ({ tabla, columna, apunta }) as LlaveForanea).concat([
  // Las que no frenan el borrado (acción en su migración).
  { tabla: 'workspaces', columna: 'linea_activa_id', apunta: 'lineas_negocio', alBorrar: 'set null' }, // 20260409000001
  { tabla: 'cotizaciones', columna: 'tarifa_aceptada_id', apunta: 'cotizacion_itinerarios', alBorrar: 'set null' }, // 20260923200000
  { tabla: 'items', columna: 'opcion_de', apunta: 'items', alBorrar: 'cascade' }, // 20260914200000
])

/**
 * Los triggers de la base que el clonador tiene que respetar: al nacer un workspace la base le
 * crea su perfil fiscal (workspace_id UNIQUE), sus categorías de gasto y sus estados de sistema;
 * al borrar una etapa deja su nombre en `etapas_nombres_anteriores` (sin llave foránea).
 */
let secuenciaTrigger = 0
const DISPARADORES = {
  alInsertar(tabla: string, fila: Fila, estado: Record<string, Fila[]>) {
    if (tabla !== 'workspaces') return
    const ws = fila.id
    const nuevoId = () => `ffffffff-0000-4000-8000-${String(++secuenciaTrigger).padStart(12, '0')}`
    ;(estado.fiscal_profiles ??= []).push({ id: nuevoId(), workspace_id: ws })
    ;(estado.expense_categories ??= []).push({ id: nuevoId(), workspace_id: ws, name: 'Materiales' })
    ;(estado.workspace_stages ??= []).push({ id: nuevoId(), workspace_id: ws, entidad: 'oportunidad', slug: 'lead_nuevo', es_sistema: true })
  },
  alBorrar(tabla: string, fila: Fila, estado: Record<string, Fila[]>) {
    if (tabla !== 'etapas_negocio') return
    ;(estado.etapas_nombres_anteriores ??= []).push({ id: `nombre-${String(fila.id)}`, linea_id: fila.linea_id, etapa_id: null, nombre: fila.nombre, origen: 'eliminada' })
  },
}

/** Las tablas del doble y sus columnas (lo que la prueba cruza contra los tipos de la base). */
export function esquemaDelDoble(): Record<string, string[]> {
  return esquemaDe(tablasDelDoble())
}

/**
 * Las columnas `GENERATED ALWAYS` de la base entre las tablas del doble (medidas en producción
 * el 2026-10-14 sobre las tablas que escribe el clonador: solo esta). El doble las rechaza.
 */
export const GENERADAS: Record<string, string[]> = { rubros: ['valor_total'] }

export function crearAlmacenDoble(opts: { usuarios?: { id: string; correo: string }[]; archivos?: { bucket: string; ruta: string }[] } = {}) {
  const tablas = tablasDelDoble()
  return almacenEnMemoria({ tablas, esquema: esquemaDe(tablas), llaves: LLAVES, generadas: GENERADAS, usuarios: opts.usuarios, archivos: opts.archivos, disparadores: DISPARADORES })
}

/** El caso fijo de C0 y su recálculo grabado, como los recibe el plan. */
export function casoDeC0(raiz = process.cwd()): EntradaCaso {
  const fixture = JSON.parse(readFileSync(resolve(raiz, 'src/app/(app)/negocios/igualdad-servidor.fixture.json'), 'utf8')) as {
    salidas: Record<string, { recalculo: { escrituras: EscrituraGrabada[] } }>
  }
  return {
    tablas: { 'caso-fijo': tablasCasoSanAndres(), 'flujo-nuevo': tablasCasoSanAndres({ flujoNuevo: true }) },
    recalculo: {
      'caso-fijo': fixture.salidas['trappvel-caso-fijo'].recalculo.escrituras,
      'flujo-nuevo': fixture.salidas['trappvel-flujo-nuevo'].recalculo.escrituras,
    },
  }
}
