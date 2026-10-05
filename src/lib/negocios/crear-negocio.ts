import 'server-only'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { esOrigenNegocioValido, ORIGEN_ALIANZA } from '@/lib/catalogos/constants'
import { buscarContactoDuplicado } from '@/lib/contactos/dedup'
import { terminosInicialesDeCotizacion } from '@/lib/cotizaciones/terminos-al-crear'
import { bogotaYear } from '@/lib/dates/bogota'
import { visiblePuedeNacerCompleto } from '@/lib/negocios/bloque-visible-completo'
import { ensureNegocioDriveFolder } from '@/lib/negocios/ensure-drive-folder'
import { asignarResponsable } from '@/lib/negocios/responsable-rol'

/**
 * Crear un negocio, sin leer la sesión. Es el cuerpo de la acción `crearNegocio`
 * (`negocio-v2-actions.ts`), que ahora solo resuelve la sesión y el módulo Clarity y llama
 * aquí. Vive aparte para que un camino SIN sesión (el webhook de Wompi de Ferretería) cree el
 * negocio por la MISMA vía —contacto sin duplicar, etapa de entrada, carpeta de Drive,
 * bloques— y no por un insert propio.
 *
 * ⚠️ No es una acción de servidor (este archivo no es 'use server'): nadie la puede llamar
 * desde el navegador. Quien la llama responde por el contexto que le pasa: el workspace, el
 * cliente de base y que el módulo Clarity esté encendido.
 */

// Helper: cast Supabase client a untyped para tablas nuevas no en database.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

type SupabaseClient = Awaited<ReturnType<typeof import('@/lib/actions/get-workspace').getWorkspace>>['supabase']

/** Lo que la acción leía de la sesión. */
export interface ContextoCrearNegocio {
  supabase: SupabaseClient
  workspaceId: string
  /** profiles.id de quien crea; null sin sesión. */
  userId: string | null
  role: string | null
  /** staff.id de quien crea; null sin sesión o sin staff en el workspace. */
  staffId: string | null
}

export interface EntradaCrearNegocio {
  nombre: string
  linea_id?: string
  empresa_id?: string
  contacto_id?: string
  precio_estimado?: number
  // Creacion inline si no existe aun en DB
  contacto_nombre?: string
  contacto_telefono?: string
  empresa_nombre?: string
  empresa_sector?: string
  es_persona_natural?: boolean
  /** De dónde vino el negocio. Obligatorio (catálogo ORIGENES_NEGOCIO). */
  origen?: string
  /** Aliado que lo originó. Obligatorio si origen = 'alianza'; ignorado si no. */
  aliado_id?: string
  /**
   * El comercial ya vio los negocios que existen para este contacto y aun así
   * quiere crear otro. Sin esto, la creación se detiene y devuelve `duplicados`.
   */
  confirmar_duplicado?: boolean
}

export interface ResultadoCrearNegocio {
  negocio_id: string | null
  error: string | null
  /** Presente solo cuando la creación se detuvo esperando confirmación. */
  duplicados?: NegocioDelMismoContacto[]
  /**
   * Nombre del contacto que ya existia y se reuso en vez de crear uno nuevo.
   * La pantalla lo dice: el comercial tecleo un nombre y termino en OTRA ficha,
   * y callarlo lo dejaria creyendo que escribio mal.
   */
  contacto_reusado?: string | null
}

/**
 * Negocio que ya existe a nombre del mismo contacto.
 *
 * Se devuelve al intentar crear otro para que el comercial vea CUÁL es antes de
 * decidir. No es un error: un cliente puede comprar dos vehículos. Lo que no
 * puede es crearlo tres veces por equivocación sin que nada se lo advierta.
 */
export interface NegocioDelMismoContacto {
  id: string
  codigo: string | null
  nombre: string
  /** 'abierto' | 'completado' | 'perdido' | … */
  estado: string
  etapa_nombre: string | null
  created_at: string
}

/**
 * Negocios que ya existen para un contacto, del más reciente al más viejo.
 *
 * Vive aparte porque los dos caminos de creación (formulario y conversión de un
 * lead de Meta) tienen que preguntar lo mismo, y el de Meta tiene que hacerlo
 * ANTES de crear la empresa jurídica: si preguntara después, cancelar dejaría
 * una empresa huérfana.
 */
export async function negociosDelContacto(
  supabase: unknown,
  workspaceId: string,
  contactoId: string,
): Promise<NegocioDelMismoContacto[]> {
  const { data } = await db(supabase)
    .from('negocios')
    .select('id, codigo, nombre, estado, created_at, etapas_negocio(nombre)')
    .eq('workspace_id', workspaceId)
    .eq('contacto_id', contactoId)
    .order('created_at', { ascending: false })
    .limit(10)

  return ((data ?? []) as Array<{
    id: string
    codigo: string | null
    nombre: string | null
    estado: string | null
    created_at: string
    etapas_negocio: { nombre: string | null } | null
  }>).map(n => ({
    id: n.id,
    codigo: n.codigo,
    nombre: n.nombre ?? 'Sin nombre',
    estado: n.estado ?? 'abierto',
    etapa_nombre: n.etapas_negocio?.nombre ?? null,
    created_at: n.created_at,
  }))
}

/** Compute initial data defaults from bloque_config config_extra.fields */
export function computeFieldDefaults(configExtra: Record<string, unknown> | null): Record<string, unknown> {
  const fields = ((configExtra?.fields ?? []) as Array<{ slug: string; tipo?: string; default?: unknown }>)
  const defaults: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.default !== undefined) {
      defaults[f.slug] = f.default
    }
  }
  return defaults
}

// Mantiene negocios.responsable_id (legacy/display) = responsable más antiguo
// restante, o null si no quedan. La fuente de verdad de permisos es la tabla N:M.
export async function sincronizarResponsablePrincipal(
  supabase: unknown,
  negocioId: string,
  workspaceId: string,
): Promise<void> {
  const { data } = await db(supabase)
    .from('negocio_responsables')
    .select('staff_id')
    .eq('negocio_id', negocioId)
    .order('assigned_at', { ascending: true })
    .limit(1)
  const principal = ((data ?? []) as { staff_id: string }[])[0]?.staff_id ?? null
  await db(supabase)
    .from('negocios')
    .update({ responsable_id: principal })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
}

// ── Auto-crear cotización al crear negocio ──────────────────────────────────
// Se llama internamente desde crearNegocio() si el bloque cotización tiene
// config_extra.auto_cotizacion configurado (ej: SOENA VE).

async function crearCotizacionAutomatica(
  supabase: SupabaseClient,
  workspaceId: string,
  negocioId: string,
  lookup: { servicio_id?: string; servicio_nombre?: string },
  precioEstimado: number
) {
  // 1. Obtener consecutivo
  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const consecutivo = consecutivoRaw ?? `COT-${bogotaYear()}-${Date.now()}`

  // Mismos términos de nacimiento que la cotización creada a mano (C5): solo con la
  // plantilla de Trappvel y un texto base en la línea; en cualquier otro caso, nada.
  const terminos = await terminosInicialesDeCotizacion(supabase, { workspaceId, negocioId })

  // 2. Crear cotización detallada en borrador
  const { data: cotData, error: cotErr } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      consecutivo,
      codigo: '',
      modo: 'detallada',
      valor_total: precioEstimado,
      estado: 'borrador',
      ...(terminos ? { terminos_condiciones: terminos } : {}),
    })
    .select('id')
    .single()

  if (cotErr || !cotData) return

  const cotizacionId = cotData.id

  // 3. Buscar servicio por ID (preferido) o por nombre (legacy)
  let servicioQuery = supabase
    .from('servicios')
    .select('id, nombre, precio_estandar, rubros_template')
    .eq('workspace_id', workspaceId)
    .eq('activo', true)
    .limit(1)
  if (lookup.servicio_id) {
    servicioQuery = servicioQuery.eq('id', lookup.servicio_id)
  } else if (lookup.servicio_nombre) {
    servicioQuery = servicioQuery.ilike('nombre', lookup.servicio_nombre)
  } else {
    return
  }
  const { data: servicio } = await servicioQuery.single()

  if (!servicio) return

  // 4. Crear item desde el servicio
  const rubrosTemplate = servicio.rubros_template as Array<{
    tipo: string; descripcion?: string; cantidad: number; unidad: string; valor_unitario: number
  }> | null

  const subtotal = rubrosTemplate && rubrosTemplate.length > 0
    ? rubrosTemplate.reduce((sum: number, r: { cantidad: number; valor_unitario: number }) => sum + (r.cantidad * r.valor_unitario), 0)
    : (servicio.precio_estandar ?? 0)

  const { data: newItem } = await supabase
    .from('items')
    .insert({
      cotizacion_id: cotizacionId,
      nombre: servicio.nombre,
      subtotal,
      orden: 1,
      servicio_origen_id: servicio.id,
    })
    .select('id')
    .single()

  // 5. Deep copy rubros del template
  if (rubrosTemplate && rubrosTemplate.length > 0 && newItem) {
    const rubrosToInsert = rubrosTemplate.map((r: { tipo: string; descripcion?: string; cantidad: number; unidad: string; valor_unitario: number }) => ({
      item_id: newItem.id,
      tipo: r.tipo,
      descripcion: r.descripcion || null,
      cantidad: r.cantidad,
      unidad: r.unidad,
      valor_unitario: r.valor_unitario,
    }))
    await supabase.from('rubros').insert(rubrosToInsert)
  }

  // 6. Si precio_estimado > 0, ya se puso como valor_total arriba.
  //    Si es 0, usar precio_estandar del servicio.
  if (precioEstimado === 0 && (servicio.precio_estandar ?? 0) > 0) {
    await supabase
      .from('cotizaciones')
      .update({ valor_total: servicio.precio_estandar ?? 0 })
      .eq('id', cotizacionId)
  }
}

export async function crearNegocioEnWorkspace(
  ctx: ContextoCrearNegocio,
  input: EntradaCrearNegocio,
): Promise<ResultadoCrearNegocio> {
  const { supabase, workspaceId, userId, role, staffId } = ctx
  // ── Origen: validación server-side (la del formulario es solo UX) ──
  // Se exige AL CREAR y no después: un origen que se pide "más tarde" no se
  // registra nunca. El catálogo vive en src/lib/catalogos/constants.ts.
  const origen = input.origen?.trim() ?? ''
  if (!origen) return { negocio_id: null, error: 'Falta el origen del negocio' }
  if (!esOrigenNegocioValido(origen)) {
    return { negocio_id: null, error: `Origen no válido: ${origen}` }
  }
  // Solo 'alianza' guarda aliado; en cualquier otro origen se descarta (evita
  // que un cambio de origen en el formulario deje un aliado colgado).
  let aliadoId: string | null = null
  if (origen === ORIGEN_ALIANZA) {
    const candidato = input.aliado_id?.trim()
    if (!candidato) {
      return { negocio_id: null, error: 'Un negocio de alianza necesita el aliado' }
    }
    // El id debe ser un aliado real de ESTE workspace (barrera cross-tenant).
    const { data: aliadoRow } = await db(supabase)
      .from('aliados')
      .select('id')
      .eq('id', candidato)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!aliadoRow) return { negocio_id: null, error: 'Aliado no encontrado' }
    aliadoId = candidato
  }

  // Get workspace config: stages_activos + linea_activa_id + config_extra
  const { data: wsConfig } = await db(supabase)
    .from('workspaces')
    .select('stages_activos, linea_activa_id, config_extra')
    .eq('id', workspaceId)
    .single()

  // Use linea_activa_id if no linea provided
  const lineaId = input.linea_id ?? (wsConfig as { stages_activos: string[]; linea_activa_id: string | null } | null)?.linea_activa_id
  if (!lineaId) return { negocio_id: null, error: 'No hay línea de negocio configurada' }

  // Crear contacto inline si no existe.
  //
  // ⚠️ Esta es la puerta por la que mas duplicados entraban: crear el negocio y
  // el contacto de un tiron es lo que hace el comercial con el cliente al
  // telefono, y no pasaba por el directorio, asi que nunca veia que esa persona
  // ya estaba. Ahora comprueba contra el mismo guardian que el directorio y,
  // si el telefono ya es de alguien, NO crea una segunda ficha: **reusa la que
  // existe**. Frenar aqui seria peor que el duplicado, porque el comercial
  // perderia el negocio que estaba creando; reusar lo ata a la historia real.
  let contactoId = input.contacto_id
  let contactoReusado: string | null = null
  if (!contactoId && input.contacto_nombre?.trim()) {
    const telefonoInline = input.contacto_telefono?.trim() || null
    const yaExiste = await buscarContactoDuplicado(supabase, workspaceId, { telefono: telefonoInline })
    if (yaExiste) {
      contactoId = yaExiste.id
      contactoReusado = yaExiste.nombre
    } else {
      const { data: newContact, error: errContacto } = await supabase
        .from('contactos')
        .insert({
          workspace_id: workspaceId,
          // MAYUSCULAS, homogeneo con el resto del directorio: esta puerta era la
          // unica que guardaba el nombre como lo tecleaban.
          nombre: input.contacto_nombre.trim().toUpperCase(),
          telefono: telefonoInline,
        })
        .select('id')
        .single()
      // ⚠️ Este error se descartaba. Con el guardian del telefono (migracion
      // 20260902230000) eso pasa de raro a probable: quien escriba un usuario de
      // WhatsApp aqui veria el negocio creado SIN contacto y sin ningun aviso,
      // que es peor que no dejarlo crear. El mensaje de la base ya explica que
      // hacer, asi que se devuelve tal cual.
      if (errContacto) return { negocio_id: null, error: errContacto.message }
      contactoId = (newContact as { id: string } | null)?.id
    }
  }

  // ── Ya existe un negocio a nombre de este contacto ──
  //
  // Frena y devuelve cuáles son, para que el comercial lo vea ANTES de crear
  // otro. No bloquea: un cliente puede comprar un segundo vehículo, y ese caso
  // es real (hay negocios en producción nombrados "… NEGOCIO 2"). Lo que se
  // corrige es el otro: el mismo lead creado tres veces por equivocación.
  //
  // Solo aplica cuando el contacto YA existía: uno recién creado aquí arriba no
  // puede tener negocios previos, así que ni se consulta.
  // Se consulta tambien cuando el contacto se REUSO arriba: para el comercial ese
  // contacto era "nuevo", y es justo el caso en el que mas falta le hace ver que
  // esa persona ya tiene un negocio abierto. Un contacto recien insertado no
  // puede tener negocios previos, asi que ese caso sigue sin consultar.
  if ((input.contacto_id || contactoReusado) && contactoId && !input.confirmar_duplicado) {
    const previos = await negociosDelContacto(supabase, workspaceId, contactoId)
    if (previos.length > 0) {
      return { negocio_id: null, error: null, duplicados: previos, contacto_reusado: contactoReusado }
    }
  }

  // Persona natural: auto-crear empresa vinculada al contacto
  let empresaId = input.empresa_id
  if (input.es_persona_natural && contactoId) {
    // Buscar empresa ya vinculada a este contacto
    const { data: existingEmpresa } = await supabase
      .from('empresas')
      .select('id')
      .eq('contacto_id', contactoId)
      .maybeSingle()

    if (existingEmpresa) {
      empresaId = existingEmpresa.id
    } else {
      // Obtener nombre del contacto para la empresa
      let contactName = input.contacto_nombre?.trim() || 'Persona Natural'
      if (!input.contacto_nombre && contactoId) {
        const { data: c } = await supabase.from('contactos').select('nombre').eq('id', contactoId).single()
        if (c) contactName = c.nombre
      }
      const { data: newEmpresa } = await supabase
        .from('empresas')
        .insert({
          workspace_id: workspaceId,
          nombre: contactName,
          tipo_persona: 'natural',
          contacto_id: contactoId,
          tipo_documento: 'CC',
          codigo: '', // trigger auto-genera
        })
        .select('id')
        .single()
      if (newEmpresa) empresaId = newEmpresa.id
    }
  }

  // Crear empresa inline si no es persona natural y no existe
  if (!input.es_persona_natural && !empresaId && input.empresa_nombre?.trim()) {
    const { data: newEmpresa } = await db(supabase)
      .from('empresas')
      .insert({
        workspace_id: workspaceId,
        nombre: input.empresa_nombre.trim(),
        sector: input.empresa_sector?.trim() || null,
        tipo_persona: 'juridica',
      })
      .select('id')
      .single()
    empresaId = (newEmpresa as { id: string } | null)?.id
  }

  // Etapa de entrada del negocio MANUAL. Config-driven: si el workspace define
  // config_extra.entrada_manual_orden, el negocio nace en esa etapa (ej. SOENA:
  // Validación orden 1, saltándose el buzón de Recepción que es solo para leads
  // de Meta). Sin el config, cae a la 1ª etapa por orden (retrocompat).
  const stagesActivos = (wsConfig as { stages_activos: string[] } | null)?.stages_activos ?? ['venta', 'ejecucion', 'cobro']
  const entradaManualOrden = (wsConfig as { config_extra?: Record<string, unknown> } | null)
    ?.config_extra?.entrada_manual_orden as number | undefined
  const etapaEntradaQuery = db(supabase)
    .from('etapas_negocio')
    .select('id, stage')
    .eq('linea_id', lineaId)
    .in('stage', stagesActivos)
  const { data: primeraEtapaRaw } = typeof entradaManualOrden === 'number'
    ? await etapaEntradaQuery.eq('orden', entradaManualOrden).limit(1).single()
    : await etapaEntradaQuery.order('orden', { ascending: true }).limit(1).single()

  const primeraEtapa = primeraEtapaRaw as { id: string; stage: string } | null

  // Auto-nombre = contacto (config-driven POR LÍNEA). La regla vive en
  // config_extra.negocio_codigo_format[{linea_id, nombre_auto}] — la misma que
  // define el folio (ej. SOENA/VE → V0001 + nombre = cliente).
  let nombreNegocio = input.nombre
  const codigoFormat = (wsConfig as { config_extra?: Record<string, unknown> } | null)
    ?.config_extra?.negocio_codigo_format as Array<{ linea_id?: string; nombre_auto?: string }> | undefined
  const reglaLinea = Array.isArray(codigoFormat)
    ? codigoFormat.find(r => r.linea_id === lineaId)
    : undefined
  if (reglaLinea?.nombre_auto === 'contacto' && contactoId) {
    if (input.contacto_nombre?.trim()) {
      nombreNegocio = input.contacto_nombre.trim()
    } else {
      const { data: c } = await supabase.from('contactos').select('nombre').eq('id', contactoId).single()
      if (c?.nombre) nombreNegocio = c.nombre
    }
  }

  const { data: negocio, error: insertError } = await db(supabase)
    .from('negocios')
    .insert({
      workspace_id: workspaceId,
      nombre: nombreNegocio,
      linea_id: lineaId,
      empresa_id: empresaId ?? null,
      contacto_id: contactoId ?? null,
      precio_estimado: input.precio_estimado ?? null,
      etapa_actual_id: primeraEtapa?.id ?? null,
      stage_actual: primeraEtapa?.stage ?? null,
      estado: 'abierto',
      origen,
      aliado_id: aliadoId,
    })
    .select('id')
    .single()

  if (insertError || !negocio) {
    return { negocio_id: null, error: (insertError as { message: string })?.message ?? 'Error al crear negocio' }
  }

  const negocioData = negocio as { id: string }

  // Crear a sabiendas de que el contacto ya tenía negocio es una decisión, y por
  // eso queda escrita: es lo único que después distingue un segundo vehículo
  // legítimo de un duplicado que nadie quiso crear.
  if (input.confirmar_duplicado && input.contacto_id && staffId) {
    await registrarActividad(db(supabase), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioData.id,
      tipo: 'cambio_sistema',
      autor_id: staffId,
      contenido: 'Negocio creado con otro(s) ya existente(s) para el mismo contacto, confirmado por quien lo creó',
    }, 'crearNegocio')
  }

  // ── Auto-asignar al creador como responsable si es operator ──
  // Un operator solo ve los negocios donde es responsable (negocio_responsables N:M,
  // ver getNegociosV2). Sin esto, un operator comercial/operaciones que crea un
  // negocio lo perdería de vista al instante. Owner/admin/supervisor ven todos →
  // no necesitan auto-asignación. assigned_by = userId (FK a profiles).
  if (role === 'operator' && staffId) {
    try {
      // Vía `asignarResponsable` para que la fila nazca CON rol: sin él, el negocio que
      // el operator acaba de crear le avisa a su supervisor y no a él.
      await asignarResponsable(supabase, {
        negocioId: negocioData.id,
        staffId,
        assignedBy: userId ?? null,
      })
      await sincronizarResponsablePrincipal(supabase, negocioData.id, workspaceId)
    } catch (respErr) {
      // No bloquear la creación del negocio si la auto-asignación falla.
      console.error(
        `[crearNegocio] No se pudo auto-asignar responsable (negocio=${negocioData.id}, staff=${staffId}):`,
        respErr instanceof Error ? respErr.message : respErr,
      )
    }
  }

  // ── Auto-crear carpeta en Google Drive ──
  // La lógica vive en el helper idempotente compartido `ensureNegocioDriveFolder`
  // (una sola vía para formulario / webhook Meta / carga manual / backfill / cron).
  // Resuelve drive_folder_id (linea → fallback workspace), crea carpeta +
  // subcarpetas canónicas y setea carpeta_url. No bloquea la creación del negocio
  // si Drive falla (el error queda registrado en activity_log).
  //
  // Arranca AQUÍ y se espera al FINAL (2026-10-04): Drive no depende de los bloques ni
  // de la cotización, ni ellos de la carpeta, así que sus idas y vueltas corren
  // mientras se crean los bloques en vez de antes. Se espera antes de responder a
  // propósito y NO va a `after()`: la ficha que abre a continuación muestra
  // `carpeta_url`, y una carpeta a medio crear se cruzaría con el modo puntual del cron
  // `ensure-negocio-folders` (los dos buscarían la raíz y los dos la crearían).
  const carpetaDrive = ensureNegocioDriveFolder(supabase, workspaceId, negocioData.id)
    .catch((err: unknown) => {
      // El helper no lanza; esto es solo para que un fallo imprevisto no quede como
      // rechazo sin dueño mientras corre lo de abajo.
      console.error('[crearNegocio] carpeta de Drive:', err instanceof Error ? err.message : err)
    })

  // Derivar tipo_persona del solicitante desde la empresa del negocio (natural vs
  // jurídica). Se determina en la creación → ningún bloque manual lo pregunta; los
  // bloques cuyo `condition` mira `tipo_persona` lo leen del dato auto-poblado.
  let tipoPersonaDerivado = 'natural'
  if (empresaId) {
    const { data: empTipo } = await db(supabase)
      .from('empresas')
      .select('tipo_persona')
      .eq('id', empresaId)
      .single()
    if ((empTipo as { tipo_persona: string | null } | null)?.tipo_persona === 'juridica') {
      tipoPersonaDerivado = 'juridica'
    }
  }

  // Crear negocio_bloques para cada bloque_config de la primera etapa
  if (primeraEtapa?.id) {
    const { data: bloqueConfigs } = await db(supabase)
      .from('bloque_configs')
      .select('id, estado, es_gate, config_extra, bloque_definitions(tipo)')
      .eq('etapa_id', primeraEtapa.id)
      .eq('workspace_id', workspaceId)

    if (bloqueConfigs && (bloqueConfigs as Record<string, unknown>[]).length > 0) {
      const instancias = (bloqueConfigs as Record<string, unknown>[]).map(bc => {
        const defaults = computeFieldDefaults(bc.config_extra as Record<string, unknown> | null)
        // Auto-poblar tipo_persona (derivado de la empresa) en el bloque que lo declara
        // → sustituye el paso manual: el operador no elige natural/jurídica.
        const fields = ((bc.config_extra as { fields?: Array<{ slug: string }> } | null)?.fields ?? [])
        if (fields.some(f => f.slug === 'tipo_persona')) {
          defaults.tipo_persona = tipoPersonaDerivado
        }
        // Bloques de solo lectura (config estado 'visible') no requieren acción
        // del usuario → nacen completos, SALVO que sean GATE con campos `required`
        // que los defaults no alcancen a llenar (ver `visiblePuedeNacerCompleto`).
        const naceCompleto = bc.estado === 'visible'
          && visiblePuedeNacerCompleto(
            bc.config_extra as Record<string, unknown> | null,
            defaults,
            bc.es_gate === true,
          )
        return {
          negocio_id: negocioData.id,
          bloque_config_id: bc.id as string,
          estado: naceCompleto ? 'completo' : 'pendiente',
          data: Object.keys(defaults).length > 0 ? defaults : {},
          ...(naceCompleto ? { completado_at: new Date().toISOString() } : {}),
        }
      })

      await db(supabase).from('negocio_bloques').insert(instancias)

      // ── Auto-cotización: si algún bloque cotización tiene config auto_cotizacion ──
      // Prioridad de lookup: servicio_id (estable a renames) > servicio_nombre (legacy)
      for (const bc of bloqueConfigs as Array<{
        id: string
        config_extra: Record<string, unknown> | null
        bloque_definitions: { tipo: string } | null
      }>) {
        const tipoBd = bc.bloque_definitions?.tipo
        const autoCot = (bc.config_extra?.auto_cotizacion ?? null) as {
          servicio_id?: string
          servicio_nombre?: string
          usar_precio_estimado?: boolean
        } | null

        if (tipoBd === 'cotizacion' && autoCot && (autoCot.servicio_id || autoCot.servicio_nombre)) {
          await crearCotizacionAutomatica(
            supabase,
            workspaceId,
            negocioData.id,
            { servicio_id: autoCot.servicio_id, servicio_nombre: autoCot.servicio_nombre },
            autoCot.usar_precio_estimado ? (input.precio_estimado ?? 0) : 0
          )
        }

        // ── Auto-init propuesta_economica con precio base del servicio ──
        const autoProp = (bc.config_extra?.auto_propuesta ?? null) as {
          servicio_id?: string
        } | null
        if (tipoBd === 'propuesta_economica' && autoProp?.servicio_id) {
          try {
            const { data: instanciaRow } = await db(supabase)
              .from('negocio_bloques')
              .select('id')
              .eq('negocio_id', negocioData.id)
              .eq('bloque_config_id', bc.id)
              .single()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const inst = instanciaRow as any
            if (inst?.id) {
              const { crearV1Automatica } = await import('@/lib/propuesta/v1-automatica')
              await crearV1Automatica(inst.id, autoProp.servicio_id)
            }
          } catch (e) {
            console.error(
              `[crearNegocio] Error auto-init propuesta_economica (bloque_config=${bc.id}):`,
              e instanceof Error ? e.message : String(e),
            )
          }
        }
      }
    }
  }

  await carpetaDrive

  return { negocio_id: negocioData.id, error: null }
}
