/**
 * Responsable por control + aceptación de responsabilidades (R2).
 *
 * Tipos y reglas puras, compartidos entre server actions, PDF y cliente. Vive
 * fuera de los archivos `'use server'` porque esos solo pueden exportar
 * funciones async.
 *
 * Qué resuelve: un control sin responsable identificado no es un control ante un
 * auditor. Pero "responsable" son tres cosas distintas que la norma trata por
 * separado, y meterlas en un solo campo es lo que rompe el modelo:
 *
 *   NOMINAR  → qué CARGO responde (`cargo_responsable_id`). Responde un cargo,
 *              no una persona ni una cuenta: quien lo ocupe cambia y la
 *              responsabilidad se queda donde está.
 *   EJECUTAR → quién lo OPERA (`responsable_id`, usuario de ONE). Opcional,
 *              porque casi ningún control se ejecuta dentro de la plataforma.
 *   ACEPTAR  → el acto por el que la persona reconoce que responde
 *              (`compliance_aceptaciones`). Es la evidencia.
 *
 * Hermano de `liberaciones.ts` (R4) y con la misma forma: la regla que decide
 * vive aquí, pura y con el reloj por parámetro, para poder probarla rompiéndola.
 */

import { ROLES_OFICIAL_CUMPLIMIENTO } from './segmentos';

export { ROLES_OFICIAL_CUMPLIMIENTO };

// ─── Permisos ──────────────────────────────────────────────────────────────

/**
 * Quién nomina cargos y registra aceptaciones: el oficial de cumplimiento
 * (owner/admin), el mismo criterio de R1 (catálogo de segmentos) y R4
 * (liberaciones).
 *
 * No es solo "configuración": la pantalla lista nombres y documentos de
 * identidad de los responsables, que no tiene por qué circular por el workspace.
 */
export function puedeGestionarResponsables(role: string | null | undefined): boolean {
  return !!role && ROLES_OFICIAL_CUMPLIMIENTO.includes(role);
}

/**
 * ¿Este operador puede ver este control?
 *
 * DECISIÓN, y es la que evita una regresión silenciosa. El rol `operator` (y
 * `contador`) solo ve los controles donde figura como responsable, y "figura
 * como responsable" sigue significando `responsable_id = su usuario`, NO el
 * cargo nominado. Razones:
 *
 *   1. Es lo que dice el dictamen: ver y operar un control dentro de ONE es
 *      EJECUTAR, y ejecutar es lo único que justifica una cuenta. Nominar un
 *      cargo no reparte accesos.
 *   2. Derivar el acceso del cargo obligaría a saber qué cargo ocupa cada
 *      usuario, o sea a montar el vínculo persona↔cargo que el dictamen descarta
 *      precisamente para no darle cuenta a cada responsable.
 *   3. `cargo_responsable_id` puede quedar nominado a un cargo que ninguna
 *      persona con cuenta ocupa — que es el caso normal aquí.
 *
 * El riesgo de esta decisión es que el oficial nomine el cargo y dé por hecho
 * que el operador ya lo ve. Se ataca en la pantalla, no en la regla: el
 * formulario pide cargo y usuario en la MISMA fila y en el mismo guardado, así
 * que asignar los dos es una sola acción.
 *
 * Existe como función y no como un `.eq()` suelto porque la regla estaba escrita
 * dos veces (el listado la filtraba en la consulta y el detalle la comprobaba en
 * memoria). Dos copias de un control de acceso se desincronizan, y el síntoma
 * sería que un operador entra por URL a un control que la lista no le muestra.
 */
export function operadorVeControl(
  control: { responsable_id?: string | null },
  userId: string | null | undefined,
): boolean {
  return !!userId && control.responsable_id === userId;
}

/** El nombre de la columna por la que se filtra en la consulta del listado. */
export const COLUMNA_VISIBILIDAD_OPERADOR = 'responsable_id' as const;

// ─── Cargos ────────────────────────────────────────────────────────────────

export type ComplianceCargo = {
  id: string;
  nombre: string;
  activo: boolean;
  orden: number;
};

export const CARGO_NOMBRE_MAX = 120;

/**
 * Clave de comparación de nombres de cargo: sin tildes, sin mayúsculas, sin
 * espacios de más.
 *
 * Es el espejo en TypeScript del índice único de la migración. Dos cargos con el
 * mismo nombre escrito distinto ("Coordinador COMPLIANCE" / "Coordinador
 * Compliance") partirían la cobertura en dos: la mitad de los controles colgaría
 * de un cargo que nunca firmó, y el indicador lo reportaría como si faltara la
 * aceptación. La base lo impide; esto lo detecta ANTES de mandar el insert, para
 * poder decir cuál es el duplicado en vez de mostrar un error de constraint.
 */
export function claveCargo(nombre: string | null | undefined): string {
  return (nombre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function validarCargo(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? '').trim();
  if (!limpio) return 'nombre_requerido';
  if (limpio.length > CARGO_NOMBRE_MAX) {
    return `nombre_muy_largo (máximo ${CARGO_NOMBRE_MAX} caracteres)`;
  }
  return null;
}

// ─── Medio de aceptación ───────────────────────────────────────────────────

export type MedioAceptacion = 'firma_one' | 'documento_cargado';

/**
 * ⚠️ LA FIRMA DENTRO DE ONE ESTÁ APAGADA A PROPÓSITO.
 *
 * La costura está construida (el tipo, el valor en el CHECK de la base, el
 * camino en la validación), pero el interruptor está en `false` y la pantalla no
 * la ofrece. El valor probatorio de una firma dentro de la aplicación frente a
 * un documento firmado lo tiene que resolver el CLO, y todavía no se pronunció.
 *
 * Construirla y dejarla apagada, en vez de no construirla, evita que el día que
 * haya dictamen alguien tenga que rediseñar el modelo de datos: la fila ya sabe
 * distinguir los dos medios y las aceptaciones viejas no cambian de forma.
 *
 * Encenderla es cambiar esta constante Y agregar la opción en el formulario. Lo
 * primero sin lo segundo no expone nada: `mediosDisponibles()` es lo que la
 * pantalla lee, y la validación rechaza el medio apagado aunque llegue por
 * fuera del formulario.
 */
export const FIRMA_ONE_HABILITADA = false;

export const MEDIOS_ACEPTACION: readonly MedioAceptacion[] = ['firma_one', 'documento_cargado'];

export function esMedioAceptacion(v: unknown): v is MedioAceptacion {
  return typeof v === 'string' && (MEDIOS_ACEPTACION as readonly string[]).includes(v);
}

/**
 * Medios que la pantalla puede ofrecer hoy.
 *
 * La vía operativa es `documento_cargado`: el oficial carga la carta firmada.
 */
export function mediosDisponibles(): MedioAceptacion[] {
  return MEDIOS_ACEPTACION.filter((m) => m !== 'firma_one' || FIRMA_ONE_HABILITADA);
}

export const MEDIO_LABEL: Record<MedioAceptacion, string> = {
  firma_one: 'Firma en la plataforma',
  documento_cargado: 'Documento firmado cargado',
};

/**
 * Bucket PRIVADO del soporte firmado.
 *
 * Vive en el módulo puro y no en las server actions por una razón mecánica: un
 * archivo `'use server'` solo puede exportar funciones async. Exportar una
 * constante desde ahí deja al módulo entero SIN exports en el grafo de SSR, y el
 * error que sale ("The module has no exports at all") no apunta a la constante.
 * `tsc` no lo ve; el build sí.
 */
export const BUCKET_SOPORTES = 'compliance-soportes';

// ─── Bitácora ──────────────────────────────────────────────────────────────

/**
 * Un control tal como quedó fotografiado en la aceptación.
 *
 * `updated_at` no es decorativo: es lo que permite saber después si el control
 * que la persona aceptó sigue siendo el que hoy dice la matriz.
 */
export type ControlAceptado = {
  id: string;
  referencia: string | null;
  nombre: string | null;
  updated_at: string;
};

/**
 * Fila de la bitácora. Append-only: corregir o revocar una aceptación es una
 * fila nueva, nunca un UPDATE (lo impide un trigger en la base).
 */
export type ComplianceAceptacion = {
  id: string;
  cargo_id: string;
  persona_nombre: string;
  persona_documento: string;
  aceptada_por: string | null;
  registrada_por: string | null;
  medio: MedioAceptacion;
  soporte_path: string | null;
  /** Fecha civil `YYYY-MM-DD`: el día que la persona firmó. */
  fecha_aceptacion: string;
  controles_snapshot: ControlAceptado[];
  created_at: string;
};

export type AceptacionConNombres = ComplianceAceptacion & {
  cargo_nombre: string | null;
  registrada_por_nombre: string | null;
};

// ─── La regla que de verdad importa ────────────────────────────────────────

export type MotivoAceptacion =
  /** El control no tiene cargo nominado: no hay a quién pedirle que acepte. */
  | 'sin_cargo'
  /** El cargo existe pero nunca aceptó nada. */
  | 'sin_aceptacion'
  /** El cargo aceptó, pero este control no estaba en esa carta. */
  | 'no_incluido'
  /** Estaba en la carta, y el control CAMBIÓ después de firmarla. */
  | 'desactualizada'
  /** Aceptado, y el control no ha cambiado desde entonces. */
  | 'vigente';

export type EstadoAceptacionControl = {
  cubierto: boolean;
  motivo: MotivoAceptacion;
  /** La aceptación que decidió — null si no hay ninguna del cargo. */
  aceptacion: ComplianceAceptacion | null;
  /** El `updated_at` que quedó fotografiado, cuando el control estaba en la carta. */
  updated_at_aceptado: string | null;
};

/** El mínimo del control que la regla necesita. Nada más entra a propósito. */
export type ControlParaCobertura = {
  id: string;
  cargo_responsable_id: string | null;
  updated_at: string | null;
};

/**
 * ¿Este control está cubierto por una aceptación vigente?
 *
 * La regla, y el motivo de que sea una función pura con pruebas propias:
 *
 *   1. Un control sin cargo nominado NO está cubierto: no hay a quién pedirle
 *      que acepte. Es el estado de arranque de los 18 controles de hoy.
 *   2. De las aceptaciones del CARGO se toma **la más reciente** por
 *      `created_at`. Solo esa decide; las anteriores son historia. Es el modelo
 *      de la carta de asignación: firmar una nueva reemplaza la anterior, no la
 *      complementa.
 *   3. Está cubierto si y solo si esa aceptación incluye al control **con el
 *      mismo `updated_at`**.
 *
 * De ahí salen gratis los dos comportamientos que hacen que esto funcione sin
 * mantenimiento:
 *   - si el control CAMBIA (le cambian el cargo, la actividad, la periodicidad),
 *     `updated_at` se mueve y la aceptación queda desactualizada sola, sin que
 *     ningún proceso tenga que pasar a marcarla;
 *   - si al cargo se le asigna un control DESPUÉS de firmar, ese control no está
 *     en la foto y se reporta como no incluido — la carta hay que volverla a
 *     emitir.
 *
 * ⚠️ Depende de que `riesgos_controles.updated_at` se mueva de verdad. La columna
 * existía sin trigger que la mantuviera (medido: los 18 controles con
 * `updated_at = created_at`); la migración `20260822000001` se lo agrega. Sin
 * eso esta regla sería inerte y diría "todo al día" para siempre.
 *
 * Un control con `updated_at` nulo se trata como NO cubierto aunque esté en la
 * foto: no se puede afirmar que no cambió si no se sabe cuándo cambió, y el lado
 * conservador de un control de cumplimiento es pedir de nuevo, nunca dar por
 * bueno.
 */
export function estadoAceptacionControl(
  control: ControlParaCobertura,
  aceptacionesDelCargo: readonly ComplianceAceptacion[],
): EstadoAceptacionControl {
  if (!control.cargo_responsable_id) {
    return { cubierto: false, motivo: 'sin_cargo', aceptacion: null, updated_at_aceptado: null };
  }

  const delCargo = aceptacionesDelCargo.filter((a) => a.cargo_id === control.cargo_responsable_id);
  if (delCargo.length === 0) {
    return { cubierto: false, motivo: 'sin_aceptacion', aceptacion: null, updated_at_aceptado: null };
  }

  const masReciente = aceptacionMasReciente(delCargo);

  const fotografiado = (masReciente.controles_snapshot ?? []).find((c) => c.id === control.id);
  if (!fotografiado) {
    return {
      cubierto: false,
      motivo: 'no_incluido',
      aceptacion: masReciente,
      updated_at_aceptado: null,
    };
  }

  if (!control.updated_at || fotografiado.updated_at !== control.updated_at) {
    return {
      cubierto: false,
      motivo: 'desactualizada',
      aceptacion: masReciente,
      updated_at_aceptado: fotografiado.updated_at,
    };
  }

  return {
    cubierto: true,
    motivo: 'vigente',
    aceptacion: masReciente,
    updated_at_aceptado: fotografiado.updated_at,
  };
}

/**
 * La más reciente por `created_at`.
 *
 * El desempate no puede quedar a merced del orden en que llegó el arreglo: si el
 * llamador cambia su ORDER BY, la respuesta de la regla no puede cambiar. Con
 * `created_at` idéntico (prácticamente inalcanzable: `timestamptz` tiene
 * microsegundos) desempata el `id`, que es estable.
 */
function aceptacionMasReciente(
  filas: readonly ComplianceAceptacion[],
): ComplianceAceptacion {
  return filas.reduce((mejor, fila) => {
    if (fila.created_at > mejor.created_at) return fila;
    if (fila.created_at === mejor.created_at && fila.id > mejor.id) return fila;
    return mejor;
  });
}

/**
 * Estado de muchos controles de una sola pasada.
 *
 * Las aceptaciones pueden venir en cualquier orden y de cualquier cargo: quién
 * es "la más reciente" lo decide la regla, no el ORDER BY de quien consultó.
 */
export function indexarEstadosAceptacion(
  controles: readonly ControlParaCobertura[],
  aceptaciones: readonly ComplianceAceptacion[],
): Map<string, EstadoAceptacionControl> {
  const porCargo = new Map<string, ComplianceAceptacion[]>();
  for (const a of aceptaciones) {
    const acc = porCargo.get(a.cargo_id);
    if (acc) acc.push(a);
    else porCargo.set(a.cargo_id, [a]);
  }

  const out = new Map<string, EstadoAceptacionControl>();
  for (const c of controles) {
    const grupo = c.cargo_responsable_id ? (porCargo.get(c.cargo_responsable_id) ?? []) : [];
    out.set(c.id, estadoAceptacionControl(c, grupo));
  }
  return out;
}

// ─── Indicadores del oficial ───────────────────────────────────────────────

export type IndicadoresResponsables = {
  total: number;
  con_cargo: number;
  /** % de controles con cargo nominado. `null` si no hay controles. */
  pct_nominados: number | null;
  vigentes: number;
  /** % de controles con aceptación vigente. `null` si no hay controles. */
  pct_aceptacion_vigente: number | null;
  /** El que más muerde en auditoría: el control cambió y nadie volvió a aceptar. */
  desactualizados: number;
  no_incluidos: number;
  sin_aceptacion: number;
  sin_cargo: number;
};

/**
 * Los tres indicadores del oficial, más el desglose que los explica.
 *
 * Los porcentajes son `null` sin controles, NUNCA 0 ni 100. Un workspace que no
 * ha cargado su matriz no está "0% nominado" ni "100% al día": no hay nada que
 * medir, y las dos cifras mienten en direcciones opuestas. Es la misma decisión
 * del tablero de bonos: un indicador sin datos vale `null`, no cero.
 */
export function indicadoresResponsables(
  estados: ReadonlyMap<string, EstadoAceptacionControl>,
): IndicadoresResponsables {
  let vigentes = 0;
  let desactualizados = 0;
  let noIncluidos = 0;
  let sinAceptacion = 0;
  let sinCargo = 0;

  for (const estado of estados.values()) {
    switch (estado.motivo) {
      case 'vigente':
        vigentes += 1;
        break;
      case 'desactualizada':
        desactualizados += 1;
        break;
      case 'no_incluido':
        noIncluidos += 1;
        break;
      case 'sin_aceptacion':
        sinAceptacion += 1;
        break;
      case 'sin_cargo':
        sinCargo += 1;
        break;
    }
  }

  const total = estados.size;
  const conCargo = total - sinCargo;

  return {
    total,
    con_cargo: conCargo,
    pct_nominados: total === 0 ? null : redondear((conCargo / total) * 100),
    vigentes,
    pct_aceptacion_vigente: total === 0 ? null : redondear((vigentes / total) * 100),
    desactualizados,
    no_incluidos: noIncluidos,
    sin_aceptacion: sinAceptacion,
    sin_cargo: sinCargo,
  };
}

function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Validación del formulario de aceptación ───────────────────────────────

export type AceptacionInput = {
  cargo_id: string;
  persona_nombre: string;
  persona_documento: string;
  medio: MedioAceptacion;
  /** Obligatorio cuando `medio='documento_cargado'`. */
  soporte_path?: string | null;
  /** `YYYY-MM-DD`. Por omisión, hoy. */
  fecha_aceptacion?: string | null;
};

export const PERSONA_NOMBRE_MAX = 160;
export const PERSONA_DOCUMENTO_MAX = 40;
export const FECHA_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida el input ANTES de tocar la base. Devuelve el código de error o null.
 *
 * `hoyISO` se recibe, no se calcula: la fecha civil de Bogotá la resuelve
 * `todayBogotaISO()` en el llamador (Vercel corre en UTC), y así los tests pueden
 * fijar el día sin tocar el reloj.
 *
 * La fecha SÍ puede ser pasada, al revés que la vigencia de una liberación: aquí
 * es un hecho que ocurrió (la persona firmó el martes y el oficial lo registra el
 * jueves) y no una ventana de permiso. Lo que no puede es estar en el futuro:
 * eso sería registrar una firma que todavía no existe.
 */
export function validarAceptacion(input: AceptacionInput, hoyISO: string): string | null {
  if (!input.cargo_id?.trim()) return 'cargo_requerido';

  const nombre = input.persona_nombre?.trim() ?? '';
  if (!nombre) return 'persona_nombre_requerido';
  if (nombre.length > PERSONA_NOMBRE_MAX) {
    return `persona_nombre_muy_largo (máximo ${PERSONA_NOMBRE_MAX} caracteres)`;
  }

  const documento = input.persona_documento?.trim() ?? '';
  if (!documento) {
    return 'persona_documento_requerido (la aceptación identifica a quien se comprometió, no solo al cargo)';
  }
  if (documento.length > PERSONA_DOCUMENTO_MAX) {
    return `persona_documento_muy_largo (máximo ${PERSONA_DOCUMENTO_MAX} caracteres)`;
  }

  if (!esMedioAceptacion(input.medio)) {
    return 'medio_invalido (esperado: documento_cargado)';
  }
  // El medio apagado se rechaza AQUÍ, no solo en la pantalla: una server action
  // exportada es un endpoint alcanzable aunque ninguna pantalla la invoque.
  if (input.medio === 'firma_one' && !FIRMA_ONE_HABILITADA) {
    return 'firma_one_no_habilitada (la vía operativa es cargar el documento firmado)';
  }

  if (input.medio === 'documento_cargado' && !input.soporte_path?.trim()) {
    return 'soporte_requerido (sin el documento firmado, la aceptación es la palabra del oficial)';
  }

  const fecha = input.fecha_aceptacion?.trim();
  if (fecha) {
    if (!FECHA_ISO_RE.test(fecha)) return 'fecha_formato_invalido (esperado: YYYY-MM-DD)';
    if (fecha > hoyISO) {
      return 'fecha_en_el_futuro (no se puede registrar una firma que todavía no ocurrió)';
    }
  }

  return null;
}

/**
 * Arma la foto de los controles que se van a aceptar.
 *
 * Se construye en el SERVIDOR desde lo que la base dice AHORA, nunca desde lo
 * que mandó el cliente: si el navegador pudiera dictar el `updated_at` de la
 * foto, podría declarar vigente una aceptación sobre un control que ya cambió, y
 * la bitácora se vería impecable.
 */
export function armarSnapshot(
  controles: readonly {
    id: string;
    referencia: string | null;
    nombre_control: string | null;
    updated_at: string | null;
  }[],
): ControlAceptado[] {
  return controles.map((c) => ({
    id: c.id,
    referencia: c.referencia,
    nombre: c.nombre_control,
    // `updated_at` nulo no debería existir (la columna tiene default), pero si
    // llegara, la cadena vacía no coincidirá con ningún valor real y el control
    // quedará como desactualizado — el lado conservador.
    updated_at: c.updated_at ?? '',
  }));
}

// ─── Etiquetas de pantalla ─────────────────────────────────────────────────

export const MOTIVO_ACEPTACION_LABEL: Record<MotivoAceptacion, string> = {
  sin_cargo: 'Sin cargo responsable',
  sin_aceptacion: 'Sin aceptación',
  no_incluido: 'Fuera de la última carta',
  desactualizada: 'Aceptación desactualizada',
  vigente: 'Aceptada',
};

/** Qué tiene que hacer el oficial con un control en cada estado. */
export const MOTIVO_ACEPTACION_ACCION: Record<MotivoAceptacion, string> = {
  sin_cargo: 'Nomina el cargo que responde por este control.',
  sin_aceptacion: 'Emite la carta del cargo y registra la aceptación firmada.',
  no_incluido: 'El control se asignó después de la última carta: vuelve a emitirla.',
  desactualizada: 'El control cambió después de la aceptación: emite una carta nueva.',
  vigente: '',
};
