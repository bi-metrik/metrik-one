/**
 * Modelo roles · areas · stages — Funcion central canEditBloque
 * Fase 2 (2026-05-20)
 *
 * Reemplaza el switch de Tier 1/2/3 anterior. Calcula permisos en base a:
 *   - rol global del staff (owner/admin/supervisor/operator/contador/read_only)
 *   - area(s) del staff (comercial / operaciones / financiera / direccion)
 *   - stage del bloque (derivado de etapa -> negocios.stage_actual)
 *   - responsabilidad: el staff debe estar en negocio_responsables del negocio
 *
 * Fuentes canonicas:
 *   - cerebro/conceptos/modelo-roles-areas-stages.md
 *   - cerebro/reglas/permisos-negocios.md
 *
 * Diseno funcional puro: todo input se pasa explicitamente. No hace IO,
 * no consulta BD. Los callers en server actions resuelven user.areas
 * y negocioResponsables antes de invocar estas funciones.
 */

import { puedeCorregirDocumentos } from '@/lib/roles'

// ── Tipos ────────────────────────────────────────────────────────────

export type Role =
  | 'owner'
  | 'admin'
  | 'supervisor'
  | 'operator'
  | 'contador'
  | 'read_only'

export type Area = 'comercial' | 'operaciones' | 'financiera' | 'direccion'

export type Stage = 'venta' | 'ejecucion' | 'cobro' | 'cerrado'

export type UserContext = {
  /** profile.id (o staff.id segun caller). Usado para chequeo de responsable. */
  id: string
  role: Role
  /** Areas asignadas en staff_areas. Puede ser vacio para admin/owner/contador/read_only. */
  areas: Area[]
}

export type BloqueContext = {
  /** Stage al que pertenece la etapa donde vive el bloque. */
  stage: Stage
  /**
   * Áreas que ADEMÁS de la dueña del stage pueden editar este bloque
   * (`config_extra.areas_editoras`, opt-in por bloque).
   *
   * Existe porque el área dueña se deriva del stage de la etapa, y hay bloques
   * cuyo trabajo real es de otra área. Caso que lo motivó (SOENA, Notificación):
   * la etapa es de venta, pero cuando la DIAN abre agenda para un caso radicado
   * por PQRS, quien consigue la cita es OPERACIONES — y tenía que pedirle al
   * comercial que la registrara.
   *
   * Amplía, nunca restringe: sin el campo, el criterio es idéntico al anterior.
   * Y NO toca `canAdvanceStage`: poder registrar un dato en un bloque no es
   * poder mover el negocio de etapa.
   */
  areasExtra?: Area[]
  /**
   * El bloque vive en una etapa que el negocio YA SUPERÓ (misma señal que
   * `esPostAvance` de `lib/correcciones/registrar.ts`). Escribir ahí no es trabajar
   * la etapa: es corregir hacia atrás, y entonces el área deja de cortar para los
   * roles de corrección (ver `corrigeHaciaAtrasSinArea`).
   *
   * Sin la marca el criterio es idéntico al anterior: `canAdvanceStage` no la pasa
   * nunca, porque avanzar un negocio no es corregir un dato.
   */
  esPostAvance?: boolean
}

/** Stage -> area duena del stage. cerrado no tiene area (read-only). */
export const STAGE_TO_AREA: Record<Stage, Area | null> = {
  venta: 'comercial',
  ejecucion: 'operaciones',
  cobro: 'financiera',
  cerrado: null,
} as const

// ── Helper: areas efectivas ──────────────────────────────────────────

/**
 * Calcula el conjunto de areas efectivas de un staff.
 * Si el staff tiene 'direccion', se le suman las 3 areas operativas
 * (comercial + operaciones + financiera).
 */
export function getAreasEfectivas(user: UserContext): Set<Area> {
  const areas = new Set<Area>(user.areas)
  if (areas.has('direccion')) {
    areas.add('comercial')
    areas.add('operaciones')
    areas.add('financiera')
  }
  return areas
}

// ── corrigeHaciaAtrasSinArea ─────────────────────────────────────────

/**
 * ¿Esta escritura es una CORRECCIÓN HACIA ATRÁS que el área no puede cortar?
 *
 * El área dueña de un bloque se deriva del stage de su etapa, y eso es correcto
 * mientras la etapa se está trabajando: cada área hace lo suyo. Pero corregir un dato
 * de una etapa YA SUPERADA no es trabajar esa etapa — es reparar el expediente, y el
 * expediente es uno solo. Quien detecta el documento mal cargado suele ser de otra
 * área que la que lo cargó, y hasta hoy su única salida era devolverlo.
 *
 * Caso que lo motivó (SOENA, 2026-09-17): la supervisora de `operaciones` necesita
 * corregir campos y reemplazar documentos de etapas ya superadas — 68 de los 113
 * bloques `datos`/`documento` de la línea viven en stages `venta` o `cobro`, así que
 * estaban cerrados para ella aunque el bloque declarara el opt-in.
 *
 * Lo que este helper omite es EXACTAMENTE el chequeo de área, nada más. Siguen
 * cortando, y ninguno pasa por aquí:
 *   - el negocio cerrado y el gate de módulo (`guardEditarBloque`);
 *   - `read_only` y `contador`, fuera del modelo;
 *   - `operator`, que no está en `ROLES_CORRECCION_DOCUMENTOS`: esto NO le abre nada
 *     a un ejecutor, que sigue con el criterio de siempre (área + responsable);
 *   - el opt-in `corregir_campos_gerencial` del bloque, que es la válvula real y lo
 *     exige `actualizarBloqueData`: sin él no hay corrección hacia atrás;
 *   - la causa obligatoria y el registro de autoría.
 *
 * Y NO toca `canAdvanceStage`: corregir un dato de una etapa pasada no es mover el
 * negocio (esa función nunca pasa `esPostAvance`).
 *
 * Fuente ÚNICA del criterio: lo consumen el guard del servidor (`guardEditarBloque`)
 * y la pantalla (`_areaReadonly`, resuelto por bloque en `getNegocioDetalleCompleto`).
 * Escrito dos veces, la pantalla ofrecería algo que el servidor rechaza — que es
 * exactamente la contradicción que este frente vino a cerrar.
 */
export function corrigeHaciaAtrasSinArea(
  user: UserContext,
  contexto: { esPostAvance?: boolean },
): boolean {
  if (contexto.esPostAvance !== true) return false
  return puedeCorregirDocumentos(user.role)
}

/**
 * Señal compartida: ¿el bloque vive en una etapa de orden MENOR que la actual del
 * negocio? Es lo que separa "trabajar la etapa" de "corregir hacia atrás".
 *
 * Vive aquí, y no en cada consumidor, porque la usan el guard de permisos y el
 * contexto de corrección (`lib/correcciones/registrar.ts`). Dos copias de esta
 * comparación se separan en cuanto alguien toque una, y el síntoma sería el peor
 * posible: la pantalla dejando corregir algo que el registro no considera corrección.
 */
export function esEtapaSuperada(
  ordenBloque: number | null | undefined,
  ordenEtapaActual: number | null | undefined,
): boolean {
  return (
    typeof ordenBloque === 'number'
    && typeof ordenEtapaActual === 'number'
    && ordenBloque < ordenEtapaActual
  )
}

// ── canEditBloque ────────────────────────────────────────────────────

/**
 * Determina si un usuario puede editar un bloque dado.
 *
 * Reglas (cerebro/conceptos/modelo-roles-areas-stages.md):
 *   - read_only/contador: siempre false (fuera del modelo de areas)
 *   - La segmentacion por area se activa SOLO si el staff tiene area(s) en
 *     staff_areas. Sin area asignada: comportamiento por rol (owner/admin y
 *     supervisor pueden; operator requiere ser responsable).
 *   - Con area asignada: el staff (cualquier rol, incluido owner/admin) solo
 *     edita el stage cuya area_duena este en sus areas efectivas (direccion
 *     expande a las 3). Cambio 2026-06-04: owner/admin con area dejan de ser
 *     passthrough — se restringen como el resto.
 *   - cerrado (sin area_duena): solo owner/admin.
 *   - operator: ademas debe ser responsable del negocio.
 *   - `bloque.esPostAvance`: si el bloque es de una etapa YA SUPERADA y el rol
 *     corrige documentos (owner/admin/supervisor), el area deja de cortar. Ver
 *     `corrigeHaciaAtrasSinArea` — lo demas (opt-in del bloque, causa, registro,
 *     negocio cerrado, modulo) sigue igual y lo aplican otras capas.
 */
export function canEditBloque(
  user: UserContext,
  bloque: BloqueContext,
  negocioResponsables: string[]
): boolean {
  // read_only / contador: fuera del modelo
  if (user.role === 'read_only' || user.role === 'contador') return false

  const areaDuena = STAGE_TO_AREA[bloque.stage]
  const tieneAreas = user.areas.length > 0
  const areasEfectivas = getAreasEfectivas(user)
  // El bloque puede declarar áreas adicionales autorizadas a editarlo.
  const invitada = (bloque.areasExtra ?? []).some(a => areasEfectivas.has(a))
  // Corrección hacia atrás: el área deja de cortar. Lo que se omite es el chequeo de
  // ÁREA, no el de un stage que no tiene dueña (`cerrado`, reservado a owner/admin).
  //
  // ⚠️ El `areaDuena !== null` es HOY redundante —las dos ramas de abajo deciden el
  // caso null antes de mirar esto (`areaDuena === null ? true : …` y el `return false`
  // del supervisor)— y por eso mutarlo no tumba ninguna prueba. Se conserva a
  // propósito: es la única línea que dice que la excepción no puede convertir a un
  // supervisor en owner, y quedaría viva de inmediato si alguien reordena esas ramas.
  const correccionHaciaAtras = areaDuena !== null && corrigeHaciaAtrasSinArea(user, bloque)
  // Cubre el stage si no tiene areas (sin segmentacion), su area lo incluye, el
  // bloque invita explicitamente a su area, o esta corrigiendo hacia atras.
  const cubreStage =
    (areaDuena !== null && (!tieneAreas || areasEfectivas.has(areaDuena)))
    || invitada
    || correccionHaciaAtras

  // owner/admin: passthrough si no tienen area; con area, se restringen al stage.
  if (user.role === 'owner' || user.role === 'admin') {
    if (!tieneAreas) return true
    // Stage sin área dueña (cerrado): owner/admin conservan el paso, como antes.
    return areaDuena === null ? true : areasEfectivas.has(areaDuena) || invitada || correccionHaciaAtras
  }

  // Stage cerrado: solo owner/admin (ya retornaron arriba)
  if (areaDuena === null) return false

  // supervisor: cubre el stage (o no tiene areas asignadas)
  if (user.role === 'supervisor') {
    return cubreStage
  }

  // operator: cubre el stage + responsable explicito
  if (user.role === 'operator') {
    return cubreStage && negocioResponsables.includes(user.id)
  }

  return false
}

// ── canAdvanceStage ──────────────────────────────────────────────────

/**
 * ¿Puede el usuario avanzar/cambiar un negocio al stage destino? Mismo criterio
 * que editar un bloque de ese stage: su área debe cubrirlo (o sin área →
 * passthrough por rol); operator además debe ser responsable del negocio.
 *
 * ⚠️ NO pasa `esPostAvance`, y es deliberado: corregir un dato de una etapa pasada
 * no es mover el negocio. La excepción de `corrigeHaciaAtrasSinArea` abre la
 * ESCRITURA de un bloque superado, nunca el avance.
 */
export function canAdvanceStage(
  user: UserContext,
  stageTo: Stage,
  negocioResponsables: string[],
  /**
   * Áreas que la ETAPA invita a avanzarla (`config_extra.areas_que_avanzan`),
   * aunque el stage sea de otra. Existe porque hay etapas cuyo trabajo que
   * DESBLOQUEA el avance lo hace otra área: en SOENA, Notificación es del
   * comercial (es quien habla con el cliente) pero es operaciones quien
   * consigue la fecha de la cita y necesita poder seguir.
   * Sin el campo, el criterio es el de siempre.
   */
  areasExtra?: Area[],
): boolean {
  return canEditBloque(user, { stage: stageTo, areasExtra }, negocioResponsables)
}

// ── canEditHeader ────────────────────────────────────────────────────

/**
 * Header del negocio (empresa + contacto): independiente del stage actual.
 * Editable por owner, admin o cualquier persona con 'comercial' en areas
 * efectivas (direccion tambien lo da, via expansion).
 */
export function canEditHeader(user: UserContext): boolean {
  if (user.role === 'owner' || user.role === 'admin') return true
  if (user.role === 'read_only' || user.role === 'contador') return false

  // supervisor u operator deben tener comercial (directo o via direccion)
  return getAreasEfectivas(user).has('comercial')
}

// ── puedeAutorizarCierreNoFacturable ─────────────────────────────────

/**
 * Cerrar un negocio SIN factura es una excepcion financiera, no un paso mas del
 * flujo: deja un caso entregado que nunca va a generar ingreso. La autoriza
 * administracion (owner/admin) o quien lleva el area financiera (directa o via
 * 'direccion', que expande a las 3 areas operativas).
 *
 * Fuente unica del criterio: lo consume el guard del servidor en
 * `completarNegocio` Y la pantalla que decide si mostrar la casilla. Copiar la
 * regla en cualquiera de los dos lados los desincroniza en silencio: la pantalla
 * ofreceria algo que el servidor rechaza (o al reves, lo escondería a quien sí
 * puede).
 *
 * Esto NO reemplaza la segmentacion por area del stage de cobro: es una
 * autorizacion ADICIONAL sobre ella.
 */
export function puedeAutorizarCierreNoFacturable(user: UserContext): boolean {
  if (user.role === 'owner' || user.role === 'admin') return true
  if (user.role === 'read_only' || user.role === 'contador') return false
  return getAreasEfectivas(user).has('financiera')
}

// ── puedeGestionarPagosExternos ──────────────────────────────────────

/**
 * Registrar, corregir o ANULAR un pago que no entro por la pasarela.
 *
 * Es plata que entra sin que ninguna pasarela la respalde: el unico respaldo es el
 * soporte que adjunta quien la registra. Y anular es tocar el saldo de un negocio
 * hacia abajo. Las dos cosas son del area financiera, o de administracion.
 *
 * Hermana de `puedeAutorizarCierreNoFacturable` y con el mismo criterio: owner/admin
 * siempre; read_only/contador nunca; el resto solo con 'financiera' en sus areas
 * efectivas ('direccion' la expande).
 *
 * Fuente UNICA: la consumen el guard del servidor (`ctxPagosExternos`) Y la pantalla,
 * que decide con ella si dibuja los botones de editar y anular. Copiar la regla en los
 * dos lados los desincroniza en silencio: la pantalla ofreceria algo que el servidor
 * rechaza, o se lo escondaria a quien si puede.
 */
export function puedeGestionarPagosExternos(user: UserContext): boolean {
  if (user.role === 'owner' || user.role === 'admin') return true
  if (user.role === 'read_only' || user.role === 'contador') return false
  return getAreasEfectivas(user).has('financiera')
}

// ── puedeDevolverCasoPorRuta ─────────────────────────────────────────

/**
 * Decidir sobre una propuesta de REVERSA DE RUTA: devolver el caso a la primera
 * etapa que se salto, o descartar la propuesta.
 *
 * Es una decision con consecuencias de plata, no una correccion de dato: devolver
 * un caso reabre gates de saldo y puede dejar cobros y cuentas de cobro emitidas
 * en desacuerdo con la etapa en la que quedo. Por eso NO alcanza con poder
 * corregir el campo que la origino.
 *
 * Criterio: owner/admin siempre (mandan sobre el proceso completo); supervisor si,
 * porque es quien lleva el area y ve el caso entero; operator, contador y
 * read_only nunca. Mas amplio que `puedeAutorizarCierreNoFacturable` a proposito:
 * ahi se decide sobre facturar, que es del area financiera, y aqui sobre por donde
 * va el proceso, que es de quien lo supervisa.
 *
 * Fuente UNICA: la consumen el guard del servidor (`aplicarReversaDeRuta` /
 * `descartarReversaDeRuta`) Y la pantalla, que decide con ella si dibuja los
 * botones. Copiar la regla en los dos lados los desincroniza en silencio.
 */
export function puedeDevolverCasoPorRuta(user: UserContext): boolean {
  return user.role === 'owner' || user.role === 'admin' || user.role === 'supervisor'
}

// ── canGestionarAliados ──────────────────────────────────────────────

/**
 * Directorio de aliados (contrapartes comerciales con acuerdo): ¿puede el
 * usuario crear / editar / activar / desactivar?
 *
 * Regla (decisión de producto, Mauricio 2026-07-27):
 *   - owner: sí, siempre.
 *   - supervisor: sí, solo si su área efectiva incluye 'comercial'
 *     (directa o vía 'direccion', que expande a las 3 áreas operativas).
 *   - admin: NO. Aunque es rol alto, el directorio de aliados es del área
 *     comercial. Es exclusión explícita, por eso NO se reusa `canEditHeader`
 *     (que sí deja pasar a admin) ni ningún helper genérico de rol.
 *   - operator / contador / read_only: NO.
 *
 * LEER la lista no pasa por aquí: cualquier usuario autenticado del workspace
 * puede verla (la necesita para marcar negocios de tipo alianza).
 */
export function canGestionarAliados(user: UserContext): boolean {
  if (user.role === 'owner') return true
  if (user.role !== 'supervisor') return false
  return getAreasEfectivas(user).has('comercial')
}

// ── canViewNegocio ───────────────────────────────────────────────────

/**
 * Determina si el usuario puede ver el negocio en su lista / detalle.
 *
 *   - owner/admin/supervisor/read_only: ven todos los negocios del WS
 *   - operator: solo los negocios donde es responsable explicito
 *   - contador: NO ve negocios (esta fuera del modelo)
 */
export function canViewNegocio(
  user: UserContext,
  negocioResponsables: string[]
): boolean {
  if (user.role === 'contador') return false

  if (
    user.role === 'owner' ||
    user.role === 'admin' ||
    user.role === 'supervisor' ||
    user.role === 'read_only'
  ) {
    return true
  }

  // operator: solo si esta listado como responsable
  if (user.role === 'operator') {
    return negocioResponsables.includes(user.id)
  }

  return false
}

// ── canWriteActivityLog ──────────────────────────────────────────────

/**
 * Activity log: todos los que ven el negocio pueden escribir.
 * Por defecto = canViewNegocio. Es el hub de comunicacion del negocio.
 */
export function canWriteActivityLog(
  user: UserContext,
  negocioResponsables: string[]
): boolean {
  return canViewNegocio(user, negocioResponsables)
}

// ── Helper: filtrar negocios visibles para operator ──────────────────

/**
 * Util para queries: dado un usuario operator, retorna si debe filtrar
 * por responsable en la query.
 */
export function operatorShouldFilterByResponsable(role: Role): boolean {
  return role === 'operator'
}
