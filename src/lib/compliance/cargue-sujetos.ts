/**
 * Cargue masivo de la base de sujetos: proveedores, contratistas y empleados.
 *
 * ── Por qué una sola plantilla y no tres ──────────────────────────────────
 *
 * El tratamiento de debida diligencia no cambia entre un proveedor y un
 * contratista: `compliance_sujetos` los guarda en la misma tabla desde el
 * principio y los separa con una columna. Tres archivos con las mismas columnas
 * solo triplican los sitios donde un encabezado se puede desalinear, y obligan
 * a decidir en qué archivo va un tercero que es las dos cosas. Va una plantilla
 * con columna `tipo`.
 *
 * ── Por qué el mismo archivo sirve para las novedades ─────────────────────
 *
 * La novedad mensual —"estos ya no trabajan con nosotros"— es el mismo archivo
 * con `relacion_hasta` y `motivo` diligenciados. No hay un segundo formato de
 * bajas: quien mantiene la lista mantiene una sola.
 *
 * ── La regla que evita el desastre: el cargue NO reabre ───────────────────
 *
 * Una fila sin `relacion_hasta` para alguien que ya está cerrado NO lo reabre.
 * Si reabriera, volver a subir el archivo del mes pasado —el gesto más natural
 * del mundo cuando se mantiene una lista en Excel— resucitaría a todos los
 * desvinculados y el motor volvería a consultarlos y a cobrarlos, en silencio.
 * Reabrir es un acto deliberado, con motivo, uno por uno, desde la ficha.
 *
 * ── Todo pasa por una vista previa ────────────────────────────────────────
 *
 * `planearCargue` no escribe: dice qué pasaría. Existe separada de la escritura
 * porque un cargue de proveedores cierra relaciones y un cierre mal cargado
 * apaga el monitoreo de gente que sigue adentro. El plan se mira antes.
 *
 * Nada de este archivo toca la base ni llama a Valida: son reglas puras para
 * que se puedan probar sin base de datos.
 */

import { claveContraparte } from './liberaciones';
import { esTipoSujeto, normalizarDocumento, type TipoSujeto } from './sujetos';

/**
 * El contrato de la plantilla. Lo consumen las dos puntas —la que emite el
 * archivo y la que lo lee— para que no puedan divergir.
 */
export const HOJA_CARGUE = 'Sujetos';

export const COLUMNAS_CARGUE = [
  'tipo',
  'documento_tipo',
  'documento',
  'nombre',
  'relacion_desde',
  'relacion_hasta',
  'motivo',
] as const;

/** Techo de una corrida. Por encima, el archivo se procesa truncado y se avisa. */
export const LIMITE_FILAS_CARGUE = 3000;

export const FORMATO_FECHA_CARGUE = 'AAAA-MM-DD (por ejemplo 2026-09-10)';

export type FilaCargue = {
  /** Número de fila en la hoja, contando el encabezado. Es lo que el usuario ve. */
  fila: number;
  tipo: TipoSujeto;
  documento_tipo: string;
  documento_numero: string;
  nombre: string;
  relacion_desde: string | null;
  relacion_hasta: string | null;
  motivo: string | null;
  clave: string;
};

export type FilaInvalida = {
  fila: number;
  motivo: string;
  eco: string;
};

/** Lo que le pasaría a una fila si se aplicara el cargue. */
export type AccionCargue =
  | 'alta'
  | 'alta_cerrada'
  | 'actualizacion'
  | 'cierre'
  | 'sin_cambio';

export type ItemPlan = {
  fila: number;
  accion: AccionCargue;
  clave: string;
  documento_tipo: string;
  documento_numero: string;
  nombre: string;
  tipo: TipoSujeto;
  relacion_hasta: string | null;
  motivo: string | null;
  /** El id del sujeto que ya existe. NULL en las altas. */
  sujeto_id: string | null;
  /** Qué cambia, en palabras, para que la vista previa no obligue a adivinar. */
  detalle: string;
};

export type SujetoExistente = {
  id: string;
  tipo: string;
  documento_tipo: string;
  documento_numero: string;
  nombre: string;
  relacion_hasta: string | null;
};

export type PlanCargue = {
  items: ItemPlan[];
  invalidas: FilaInvalida[];
  resumen: Record<AccionCargue, number> & { invalidas: number };
  truncado: boolean;
};

// ─── Lectura de una fila ───────────────────────────────────────────────────

function texto(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * Solo AAAA-MM-DD, y validando que el día exista.
 *
 * No se acepta el formato colombiano ni se intenta adivinar: en esta plantilla
 * la fecha decide desde cuándo se deja de vigilar a alguien, y leer 03/04/2026
 * como abril o como marzo cambia un mes entero de monitoreo. Una fecha ilegible
 * se rechaza con el número de fila para que se corrija, que es más barato que
 * una baja aplicada un mes antes de tiempo.
 */
export function parsearFechaCargue(v: unknown): string | null {
  const s = texto(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [a, m, d] = s.split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  if (
    fecha.getUTCFullYear() !== a ||
    fecha.getUTCMonth() !== m - 1 ||
    fecha.getUTCDate() !== d
  ) {
    return null;
  }
  return s;
}

export const MOTIVO_CARGUE_MAX = 300;

/**
 * Convierte las filas crudas del XLSX en filas útiles y en filas rechazadas.
 *
 * Una fila rechazada nunca se descarta callada: sale con su número y con un eco
 * de lo que traía, porque el usuario tiene que poder encontrarla en su archivo.
 *
 * El documento repetido DENTRO del archivo también es un rechazo, no un
 * "último gana": dos filas del mismo NIT con fechas distintas son un error de
 * quien armó la lista, y elegir una por él es decidir a ciegas cuál de las dos
 * versiones de la verdad vale.
 */
export function parsearFilasCargue(
  rows: readonly Record<string, unknown>[],
): { validas: FilaCargue[]; invalidas: FilaInvalida[] } {
  const validas: FilaCargue[] = [];
  const invalidas: FilaInvalida[] = [];
  const vistas = new Map<string, number>();

  rows.forEach((row, i) => {
    // +2: la fila 1 es el encabezado y las hojas se cuentan desde 1.
    const fila = i + 2;
    const eco = [texto(row.documento), texto(row.nombre)].filter(Boolean).join(' — ') || '(vacía)';

    const tipoCrudo = texto(row.tipo).toLowerCase();
    const documentoTipo = texto(row.documento_tipo).toUpperCase();
    const documentoNumero = normalizarDocumento(texto(row.documento));
    const nombre = texto(row.nombre);
    const hasta = texto(row.relacion_hasta);
    const desde = texto(row.relacion_desde);
    const motivo = texto(row.motivo);

    // Una fila enteramente en blanco es basura de Excel, no un error del
    // usuario: se salta sin reportarla para no llenar la vista previa de ruido.
    if (!tipoCrudo && !documentoTipo && !documentoNumero && !nombre && !hasta && !desde) {
      return;
    }

    if (!esTipoSujeto(tipoCrudo)) {
      invalidas.push({ fila, motivo: 'tipo_no_valido', eco });
      return;
    }
    if (!documentoTipo) {
      invalidas.push({ fila, motivo: 'falta_documento_tipo', eco });
      return;
    }
    if (!documentoNumero) {
      invalidas.push({ fila, motivo: 'falta_documento', eco });
      return;
    }
    if (documentoNumero.length > 30) {
      invalidas.push({ fila, motivo: 'documento_muy_largo', eco });
      return;
    }
    if (nombre.length < 2) {
      invalidas.push({ fila, motivo: 'falta_nombre', eco });
      return;
    }

    const relacionDesde = desde ? parsearFechaCargue(desde) : null;
    if (desde && !relacionDesde) {
      invalidas.push({ fila, motivo: 'relacion_desde_ilegible', eco });
      return;
    }

    const relacionHasta = hasta ? parsearFechaCargue(hasta) : null;
    if (hasta && !relacionHasta) {
      invalidas.push({ fila, motivo: 'relacion_hasta_ilegible', eco });
      return;
    }

    // El motivo es obligatorio cuando hay cierre, igual que en la ficha y que
    // en el constraint de la tabla. Cerrar sin decir por qué deja el tablero
    // limpio y la auditoría ciega.
    if (relacionHasta && !motivo) {
      invalidas.push({ fila, motivo: 'cierre_sin_motivo', eco });
      return;
    }
    if (motivo.length > MOTIVO_CARGUE_MAX) {
      invalidas.push({ fila, motivo: 'motivo_muy_largo', eco });
      return;
    }
    if (relacionHasta && relacionDesde && relacionHasta < relacionDesde) {
      invalidas.push({ fila, motivo: 'cierre_antes_del_inicio', eco });
      return;
    }

    const clave = claveContraparte(documentoTipo, documentoNumero);
    if (!clave) {
      invalidas.push({ fila, motivo: 'falta_documento', eco });
      return;
    }

    const anterior = vistas.get(clave);
    if (anterior !== undefined) {
      invalidas.push({ fila, motivo: `documento_repetido_fila_${anterior}`, eco });
      return;
    }
    vistas.set(clave, fila);

    validas.push({
      fila,
      tipo: tipoCrudo as TipoSujeto,
      documento_tipo: documentoTipo,
      documento_numero: documentoNumero,
      nombre,
      relacion_desde: relacionDesde,
      relacion_hasta: relacionHasta,
      motivo: motivo || null,
      clave,
    });
  });

  return { validas, invalidas };
}

// ─── El plan ───────────────────────────────────────────────────────────────

const ACCIONES_VACIAS: Record<AccionCargue, number> = {
  alta: 0,
  alta_cerrada: 0,
  actualizacion: 0,
  cierre: 0,
  sin_cambio: 0,
};

/**
 * Qué pasaría con cada fila, contra lo que ya hay en la base.
 *
 * `hoyISO` se recibe y no se calcula: la fecha civil de Bogotá la resuelve el
 * llamador, porque Vercel corre en UTC.
 */
export function planearCargue(
  filas: readonly FilaCargue[],
  existentes: readonly SujetoExistente[],
  invalidas: readonly FilaInvalida[] = [],
  truncado = false,
): PlanCargue {
  const porClave = new Map<string, SujetoExistente>();
  for (const s of existentes) {
    const clave = claveContraparte(s.documento_tipo, s.documento_numero);
    if (clave) porClave.set(clave, s);
  }

  const items: ItemPlan[] = [];
  const resumen = { ...ACCIONES_VACIAS, invalidas: invalidas.length };

  for (const f of filas) {
    const ya = porClave.get(f.clave);
    const base = {
      fila: f.fila,
      clave: f.clave,
      documento_tipo: f.documento_tipo,
      documento_numero: f.documento_numero,
      nombre: f.nombre,
      tipo: f.tipo,
      relacion_hasta: f.relacion_hasta,
      motivo: f.motivo,
    };

    if (!ya) {
      const accion: AccionCargue = f.relacion_hasta ? 'alta_cerrada' : 'alta';
      items.push({
        ...base,
        accion,
        sujeto_id: null,
        detalle:
          accion === 'alta'
            ? `Se crea como ${f.tipo}.`
            : `Se crea como ${f.tipo} y queda cerrado el ${f.relacion_hasta}.`,
      });
      resumen[accion] += 1;
      continue;
    }

    // Ya está cerrado. Una fila sin `relacion_hasta` NO lo reabre: ver el
    // encabezado. Se reporta como sin cambio y se dice por qué.
    if (ya.relacion_hasta) {
      items.push({
        ...base,
        accion: 'sin_cambio',
        sujeto_id: ya.id,
        detalle: `Ya está cerrado desde el ${ya.relacion_hasta}. El cargue no reabre: hazlo desde la ficha.`,
      });
      resumen.sin_cambio += 1;
      continue;
    }

    if (f.relacion_hasta) {
      items.push({
        ...base,
        accion: 'cierre',
        sujeto_id: ya.id,
        detalle: `Se cierra el ${f.relacion_hasta}. Deja de consultarse en el monitoreo.`,
      });
      resumen.cierre += 1;
      continue;
    }

    const cambios: string[] = [];
    if (ya.nombre.trim() !== f.nombre) cambios.push(`nombre: "${ya.nombre.trim()}" → "${f.nombre}"`);
    if (ya.tipo !== f.tipo) cambios.push(`tipo: ${ya.tipo} → ${f.tipo}`);

    if (cambios.length === 0) {
      items.push({
        ...base,
        accion: 'sin_cambio',
        sujeto_id: ya.id,
        detalle: 'Ya está en la base, igual.',
      });
      resumen.sin_cambio += 1;
      continue;
    }

    items.push({
      ...base,
      accion: 'actualizacion',
      sujeto_id: ya.id,
      detalle: cambios.join('; '),
    });
    resumen.actualizacion += 1;
  }

  return { items, invalidas: [...invalidas], resumen, truncado };
}

/** Lo que el plan va a escribir. Sirve para no ofrecer un botón que no hace nada. */
export function planTieneEfecto(plan: PlanCargue): boolean {
  return plan.items.some((i) => i.accion !== 'sin_cambio');
}

/** Los motivos de rechazo, en el idioma de quien mira la pantalla. */
export function explicarInvalida(motivo: string): string {
  if (motivo.startsWith('documento_repetido_fila_')) {
    const fila = motivo.replace('documento_repetido_fila_', '');
    return `Ese documento ya venía en la fila ${fila} del mismo archivo. Deja una sola.`;
  }
  const mapa: Record<string, string> = {
    tipo_no_valido: 'El tipo tiene que ser empleado, proveedor, contratista, cliente, socio u otro.',
    falta_documento_tipo: 'Falta el tipo de documento (NIT, CC, CE).',
    falta_documento: 'Falta el número de documento.',
    documento_muy_largo: 'El número de documento es demasiado largo.',
    falta_nombre: 'Falta el nombre o la razón social.',
    relacion_desde_ilegible: `La fecha de inicio no se entiende. Usa ${FORMATO_FECHA_CARGUE}.`,
    relacion_hasta_ilegible: `La fecha de salida no se entiende. Usa ${FORMATO_FECHA_CARGUE}.`,
    cierre_sin_motivo: 'Si pones fecha de salida, escribe también el motivo. Queda en la bitácora.',
    motivo_muy_largo: `El motivo no puede pasar de ${MOTIVO_CARGUE_MAX} caracteres.`,
    cierre_antes_del_inicio: 'La fecha de salida es anterior a la de inicio.',
  };
  return mapa[motivo] ?? motivo;
}
