/**
 * Qué se copia de un workspace a su espacio de pruebas, y qué no, con el motivo.
 *
 * Lo usa `scripts/clonar-config-workspace.ts` (brief de Max del 2026-10-13, workspace de
 * prueba de Trappvel). Es PURO: no lee la base. La lista vive aquí y no en el script para
 * que la prueba la recorra entera.
 *
 * ## La regla
 *
 * Se copia la CONFIGURACIÓN: lo que hace que el flujo de un negocio y su cotización funcionen
 * igual (líneas, etapas, bloques, campos, etiquetas, servicios). No se copia nada que sea
 * DATO (negocios, cotizaciones, personas, documentos, avisos, cifras) ni nada que conecte el
 * workspace con afuera (credenciales y canales: Siigo, WhatsApp, Resend, Bold, Drive, Meta).
 *
 * Una tabla que no está en ninguna de las dos listas es «sin clasificar»: no se copia, el
 * simulacro la nombra, y `--apply` se niega mientras haya alguna con filas. Así una tabla de
 * configuración nueva no se queda afuera en silencio, y una de datos no entra por descuido.
 */

type AccionTabla = 'copia' | 'excluye'

export interface ReglaTabla {
  /** Nombre exacto o prefijo terminado en `*` (`backup_*`). */
  patron: string
  accion: AccionTabla
  motivo: string
}

const DATOS = 'Dato de negocios, no configuración'
const PERSONAS = 'Personas o sus datos (el acceso de prueba se crea aparte)'
const DOCUMENTOS = 'Documentos y archivos de la cliente'
const AVISOS = 'Avisos y mensajes ya enviados o por enviar'
const CANALES = 'Canal con afuera o su credencial (WhatsApp, Meta, Drive, Siigo, correo)'
const COBRO_METRIK = 'Contrato y cobro de MéTRIK a la cliente'
const FINANZAS = 'Cifras financieras de la cliente'
const OTRO_PRODUCTO = 'Otro producto de ONE, ajeno al flujo de viaje'
const HISTORIAL = 'Historial o bitácora, no configuración'

/**
 * Las tablas que se COPIAN, en el orden en que se insertan (padres antes que hijos). El
 * filtro de cada una lo arma `filtroDeCopia` del plan; aquí solo el qué y el porqué.
 */
export const TABLAS_QUE_SE_COPIAN: readonly ReglaTabla[] = [
  { patron: 'lineas_negocio', accion: 'copia', motivo: 'Las líneas activas: el flujo de viaje y su config (margen, plantilla del texto, aprobaciones)' },
  { patron: 'etapas_negocio', accion: 'copia', motivo: 'Las etapas de esas líneas, con sus gates' },
  { patron: 'bloque_configs', accion: 'copia', motivo: 'Los bloques de esas etapas: quiénes viajan (lineasPorTipo), cotización, gates' },
  { patron: 'custom_fields', accion: 'copia', motivo: 'Campos propios del workspace' },
  { patron: 'custom_field_mappings', accion: 'copia', motivo: 'Herencia de esos campos entre entidades' },
  { patron: 'labels', accion: 'copia', motivo: 'Etiquetas (sin sus asignaciones)' },
  { patron: 'workspace_features', accion: 'copia', motivo: 'Funciones encendidas del workspace' },
  { patron: 'servicios', accion: 'copia', motivo: 'Catálogo de servicios de las líneas copiadas' },
  { patron: 'fiscal_profiles', accion: 'copia', motivo: 'Solo el régimen (IVA, declarante, ICA) sobre la fila que crea la base: NIT y razón social inventados' },
]

const LA_BASE_LAS_SIEMBRA = 'La base las siembra sola al crear el workspace (trigger); copiarlas las duplica'

/** Las que NO se copian, a propósito. Primera regla que coincide gana. */
const TABLAS_QUE_SE_EXCLUYEN: readonly ReglaTabla[] = [
  // Respaldos
  { patron: 'backup_*', accion: 'excluye', motivo: 'Respaldo de una corrección vieja' },
  // Las que siembra la base al crear el workspace
  ...['expense_categories', 'workspace_stages'].map(patron => ({ patron, accion: 'excluye' as const, motivo: LA_BASE_LAS_SIEMBRA })),
  { patron: 'stage_transition_rules', accion: 'excluye', motivo: 'Cuelgan de workspace_stages (pipeline viejo); el flujo de negocios no las usa' },
  { patron: 'servicio_tarifas_versiones', accion: 'excluye', motivo: 'Inmutable (trigger): una copia no se puede borrar después; tarifas por plan de SOENA' },
  // Datos de negocios
  ...[
    'negocios', 'negocio_*', 'cotizaciones', 'cotizacion_*', 'items', 'rubros', 'item_adicionales',
    'itinerario_opciones', 'decisiones_combinacion', 'cobros', 'gastos', 'facturas', 'invoices', 'payments',
    'expenses', 'quotes', 'quote_items', 'oportunidades', 'opportunities', 'opportunity_stage_history',
    'proyectos', 'proyecto_rubros', 'projects', 'horas', 'time_entries', 'timer_activo', 'notes',
    'oportunidad_notas', 'proyecto_notas', 'bloque_correcciones', 'bloque_locks', 'bloque_items',
    'reproceso_eventos', 'devolucion_eventos', 'devoluciones_dinero', 'cronograma_versiones',
    'aprobaciones_excepcion', 'contacto_interacciones', 'entity_labels', 'servicios_contratados*',
    'servicio_contratado_beneficiarios', 'claves_idempotencia', 'generaciones_log',
  ].map(patron => ({ patron, accion: 'excluye' as const, motivo: DATOS })),
  // Personas
  ...[
    'contactos', 'contacto_documentos', 'contacts', 'clients', 'empresas', 'aliados', 'promoters', 'referrals',
    'staff', 'staff_areas', 'profiles', 'team_invitations', 'workspace_default_responsables',
    'metas_vendedor', 'metas_comerciales', 'config_bono_*', 'planillas_pila_periodo', 'tutorial_progress',
  ].map(patron => ({ patron, accion: 'excluye' as const, motivo: PERSONAS })),
  // Documentos
  ...['documentos_contractuales_versiones', 'formulario_versiones', 'actas_generadas', 'archivos_one']
    .map(patron => ({ patron, accion: 'excluye' as const, motivo: DOCUMENTOS })),
  // Avisos
  ...['avisos_cliente', 'avisos_modificacion_vistos', 'notificaciones', 'notifications', 'recordatorios_log', 'alertas_plazo_log']
    .map(patron => ({ patron, accion: 'excluye' as const, motivo: AVISOS })),
  // Canales y credenciales
  ...['wa_*', 'bot_*', 'funnelchat_*', 'meta_leads_*', 'campana_insights', 'cs_*', 've_*', 'cardumen_*', 'drive_health_log']
    .map(patron => ({ patron, accion: 'excluye' as const, motivo: CANALES })),
  // Contrato y cobro de MéTRIK
  ...[
    'suscripciones', 'subscriptions', 'planes_cobro', 'plan_cobro_cuotas', 'cuentas_cobro_emitidas',
    'workspace_modulos', 'servicio_cobro_enrolamiento', 'aceptaciones_terminos*', 'documentos_aceptaciones_usuario',
    'autorizacion_datos_*', 'planes_anuales_cda', 'autorizaciones_mencion_cda',
  ].map(patron => ({ patron, accion: 'excluye' as const, motivo: COBRO_METRIK })),
  // Finanzas
  ...[
    'bank_accounts', 'bank_balances', 'saldos_banco', 'movimientos_rechazados', 'fixed_expenses', 'gastos_fijos_*',
    'gastos_recurrentes_map', 'config_financiera', 'config_metas', 'monthly_targets', 'health_scores', 'streaks',
    'ventas_hechos', 'costos_referencia',
  ].map(patron => ({ patron, accion: 'excluye' as const, motivo: FINANZAS })),
  // Otros productos
  ...[
    'compliance_*', 'riesgo*', 'kyc_*', 'consultas_listas_dual', 'valida_*', 'calidad_*', 'radar_*', 'secop_*',
    'ferreteria_*', 'cert_*', 'testimonials',
  ].map(patron => ({ patron, accion: 'excluye' as const, motivo: OTRO_PRODUCTO })),
  // Historial
  ...['activity_log', 'activity_menciones', 'audit_log', 'etapa_historial', 'etapa_sla_log', 'etapas_nombres_anteriores',
    'proceso_snapshots', 'purga_*']
    .map(patron => ({ patron, accion: 'excluye' as const, motivo: HISTORIAL })),
]

function coincide(patron: string, tabla: string): boolean {
  return patron.endsWith('*') ? tabla.startsWith(patron.slice(0, -1)) : tabla === patron
}

export type Clasificacion =
  | { accion: AccionTabla; motivo: string }
  | { accion: 'sin_clasificar'; motivo: string }

/** Qué pasa con una tabla. La lista de copia manda sobre la de exclusión (`cotizacion_*` no tapa nada de la de copia). */
export function clasificarTabla(tabla: string): Clasificacion {
  const copia = TABLAS_QUE_SE_COPIAN.find(r => coincide(r.patron, tabla))
  if (copia) return { accion: 'copia', motivo: copia.motivo }
  const excluye = TABLAS_QUE_SE_EXCLUYEN.find(r => coincide(r.patron, tabla))
  if (excluye) return { accion: 'excluye', motivo: excluye.motivo }
  return { accion: 'sin_clasificar', motivo: 'Nadie decidió si es configuración o dato: no se copia' }
}

// ── workspaces.config_extra y workspaces.modules ─────────────────────────────

/**
 * Las llaves de `workspaces.config_extra` que se copian. Es lista BLANCA a propósito: una
 * llave de canal copiada a otro workspace no es inocua. Ejemplo medido en el código:
 * `wa_customer_bot.trigger` lo resuelve el webhook recorriendo TODOS los workspaces, así que
 * dos con el mismo disparador se roban las conversaciones de la cliente.
 *
 * Una llave que no está aquí sale en el simulacro como «no se copia» y se agrega, si hace
 * falta, con `--incluir-clave`.
 */
export const CLAVES_WORKSPACE_QUE_SE_COPIAN: Readonly<Record<string, string>> = {
  iva_cotizacion: 'Cómo va el IVA en la cotización (#830)',
  documento_viaje: 'Pie y firma del documento del cliente',
  medios_pago_proveedor: 'Medios de pago a proveedores',
  cuentas_recaudo: 'Cuentas que ve el viajero para pagar',
  negocio_codigo_format: 'Folio y nombre automático por línea',
  entrada_manual_orden: 'Etapa en la que nace un negocio manual',
  nombre_automatico: 'Nombre automático del negocio',
  omitir_gate: 'Quién puede omitir un gate con motivo',
  autorizacion_datos: 'Autorización de datos del viajero',
  tarifa_confirmacion: 'Confirmación de tarifa',
  correccion_precio: 'Corrección de precio',
  negocio_card: 'Qué muestra la tarjeta del negocio',
}

/** Las que se descartan siempre, con el motivo, para que el simulacro lo diga. */
export const CLAVES_WORKSPACE_QUE_SE_DESCARTAN: Readonly<Record<string, string>> = {
  storage_provider: 'Almacenamiento propio de la cliente (su proyecto de Supabase)',
  storage_supabase_url: 'Almacenamiento propio de la cliente',
  siigo: 'Credencial de facturación',
  bot_conversacional: 'Bot de WhatsApp',
  aviso_datos_bot: 'Bot de WhatsApp',
  wa_customer_bot: 'Bot de WhatsApp: el disparador se resuelve entre TODOS los workspaces',
  bandeja_solicitudes: 'Bandeja de WhatsApp',
  meta_leads: 'Leads de Meta',
  funnelchat: 'Canal FunnelChat',
  alertas_plazo: 'Alertas por WhatsApp',
  muro_publico: 'Muro público',
  muro_token: 'Muro público',
  grupo: 'Se reemplaza: el espacio de pruebas va en el grupo «demo»',
  cotizacion_por_pasos: 'Se reemplaza: encendido solo aquí',
  modo_vitrina: 'Recorta el menú',
  espacio_de_pruebas: 'Se reemplaza',
  clon_de: 'Se reemplaza',
}

/** Módulos que no se encienden en el espacio de pruebas aunque la cliente los tenga. */
const MODULOS_DE_CANAL = /(wa|whatsapp|bandeja|bot|siigo|meta|funnel|drive|bold|wompi|epayco|resend|correo|email|valida|radar|secop|calidad|cobro)/i

export function modulosParaPruebas(modulos: unknown): { copiados: Record<string, unknown>; apagados: string[] } {
  const copiados: Record<string, unknown> = {}
  const apagados: string[] = []
  if (modulos && typeof modulos === 'object' && !Array.isArray(modulos)) {
    for (const [k, v] of Object.entries(modulos as Record<string, unknown>)) {
      if (MODULOS_DE_CANAL.test(k)) apagados.push(k)
      else copiados[k] = v
    }
  }
  return { copiados, apagados }
}

// ── config_extra de líneas, etapas y bloques ─────────────────────────────────

/**
 * Llaves que se quitan a cualquier profundidad del `config_extra` de líneas, etapas, bloques
 * y demás tablas copiadas. Son credenciales, carpetas o conexiones con afuera; `facturacion`
 * va también porque emite en Siigo.
 */
export const LLAVE_DE_CREDENCIAL =
  /(token|secret|password|contrasen|api_?key|llave|webhook|client_id|refresh|drive|folder_id|storage_|phone_number_id|waba|siigo|resend|bold|wompi|epayco|smtp|^facturacion$)/i
