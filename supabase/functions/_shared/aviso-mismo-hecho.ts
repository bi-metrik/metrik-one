// ============================================================
// Un aviso automático al cliente sale UNA sola vez por el mismo hecho.
//
// ── Por qué existe (SOE-008 y SOE-009, 2026-10-09) ─────────────────────────
//
// `notificar-etapa` avisa al cliente cuando el caso ENTRA a una etapa (o llega el
// documento de un bloque). Un reproceso devuelve el caso a una etapa anterior y lo
// vuelve a hacer pasar por las mismas: cada entrada volvía a disparar el aviso. Medido
// en SOENA: V0457 recibió dos veces «Tu cita con la DIAN quedó agendada» (21 y 22 de
// septiembre) con la MISMA cita, 24-sep 9:30, tras un reproceso por la UPME. Deisy:
// «los clientes lo ven como FRAUDE».
//
// La guarda de la etapa (`omitir_si_bloque_completo`) no alcanzaba: el reproceso
// archiva y VACÍA los bloques de las etapas que se repiten, incluido el que dice
// «ya le avisé al cliente», así que en la segunda pasada el bloque estaba incompleto.
//
// ── La regla ───────────────────────────────────────────────────────────────
//
// El HECHO de un aviso es lo que le cuenta al cliente: el dato que su copy cita.
//   · `{fecha_cita}` → la cita (día y hora, tal como quedó en el bloque).
//   · `{link}`       → el documento (la referencia guardada, NO la URL firmada, que
//                      cambia en cada envío).
//   · `{recibos}`    → los números de los recibos del último pago.
//   · nada de eso    → el hecho es «el caso llegó a esta etapa»: una vez basta.
//
// Antes de mandar, por canal, se busca un aviso previo del MISMO origen (misma etapa,
// o mismo bloque) que haya salido (`enviado` / `disparado`) con la misma huella. Si
// existe, no se manda (`omitido` con motivo `duplicado`).
//
// ⚠️ REPROGRAMACIÓN = HECHO NUEVO. Si la cita cambió de verdad (otro día u otra hora),
// la huella es distinta y el aviso SÍ sale: eso es lo que el cliente necesita saber.
// Lo mismo con un certificado reemitido (otro documento) o un pago nuevo. La guarda
// solo calla la repetición de lo que el cliente ya sabe.
//
// ⚠️ Una cita que ya pasó no se avisa (SOE-009): desde hoy la operación puede
// registrar una cita con fecha anterior (la que ya ocurrió) y decirle al cliente «tu
// cita quedó agendada» para una fecha vencida es justo lo que pasó con V0171.
//
// ── Avisos viejos sin huella ───────────────────────────────────────────────
//
// La columna `avisos_cliente.huella` nace con esta regla: las filas anteriores no la
// tienen. Para ellas la huella se RECONSTRUYE del historial del bloque: el reproceso
// guarda cada versión en `data._ciclos` con su `archivado_at`, así que el valor vigente
// en el instante del aviso es el del primer ciclo archivado DESPUÉS de ese instante, o
// el actual si ninguno lo fue. Si no se puede reconstruir (el valor de ese momento está
// vacío), el aviso viejo no cuenta como igual y el nuevo sale: ante la duda se prefiere
// el comportamiento de siempre a callar una reprogramación real.
//
// Módulo PURO: sin red, sin Deno, sin base. Lo prueba `aviso-mismo-hecho.test.ts`.
// ============================================================

import { recibosDelUltimoPago } from './recibos-del-aviso.ts';

/** Los datos que un copy puede citar y que definen el hecho. */
export type DatoDelHecho = 'fecha_cita' | 'link' | 'recibos';

const DATOS: readonly DatoDelHecho[] = ['fecha_cita', 'link', 'recibos'];

/** Estados de `avisos_cliente` que significan «al cliente le salió». */
export const ESTADOS_QUE_SALIERON: readonly string[] = ['enviado', 'disparado'];

/** Los textos del aviso tal como los declara la etapa o el bloque. */
export type CopyDelAviso = {
  titulo?: string;
  mensaje?: string;
  mensaje_email?: string;
  mensaje_whatsapp?: string;
};

/**
 * Qué datos cita el aviso, mirando TODOS sus copys. Un canal puede no nombrar la cita
 * (el WhatsApp de SOENA remite al correo) y aun así ser el aviso de la cita: el hecho
 * es uno solo por aviso, no uno por canal.
 */
export function datosQueCitaElAviso(cfg: CopyDelAviso): DatoDelHecho[] {
  const textos = [cfg.titulo, cfg.mensaje, cfg.mensaje_email, cfg.mensaje_whatsapp]
    .filter((t): t is string => typeof t === 'string');
  return DATOS.filter((d) => textos.some((t) => t.includes(`{${d}}`)));
}

/** Los valores crudos del hecho. `null` = ese dato no está. */
export type ValoresDelHecho = Partial<Record<DatoDelHecho, string | null>>;

/**
 * La huella: los valores del hecho, en orden fijo, como texto. `{}` cuando el aviso no
 * cita ningún dato (el hecho es la llegada a la etapa).
 */
export function huellaDelHecho(valores: ValoresDelHecho): string {
  const orden: Record<string, string | null> = {};
  for (const d of DATOS) if (d in valores) orden[d] = valores[d] ?? null;
  return JSON.stringify(orden);
}

/** Lo que trae un bloque en `data`: los campos y, si hubo reproceso, sus versiones. */
type DataDeBloque = Record<string, unknown> & {
  _ciclos?: Array<{ data?: Record<string, unknown>; archivado_at?: string }>;
};

function textoNoVacio(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Los datos del bloque tal como estaban en `instante`. Sin `instante`, los actuales.
 *
 * El reproceso archiva la versión vigente en `_ciclos` (con `archivado_at`) y vacía el
 * bloque. La vigente en `instante` es la del primer ciclo archivado después de él; si
 * ninguno se archivó después, es la actual.
 */
export function dataEnElMomento(data: unknown, instante?: string): Record<string, unknown> {
  const d = (data ?? {}) as DataDeBloque;
  if (!instante) return d;
  const t = Date.parse(instante);
  const ciclos = (Array.isArray(d._ciclos) ? d._ciclos : [])
    .filter((c) => typeof c?.archivado_at === 'string' && Date.parse(c.archivado_at) > t)
    .sort((a, b) => Date.parse(a.archivado_at!) - Date.parse(b.archivado_at!));
  return ciclos.length > 0 ? (ciclos[0].data ?? {}) : d;
}

/** Los bloques de donde salen los datos del hecho. */
export type BloquesDelHecho = {
  /** `data` del bloque `fecha_cita_dian`. */
  cita?: unknown;
  /** `data` del bloque que declara `link_bloque_slug` (documento y recibos). */
  documento?: unknown;
};

/**
 * Los valores del hecho para los datos citados, leídos de los bloques (en `instante`,
 * o ahora). Se guarda el valor CRUDO, no el texto que se le muestra al cliente: la
 * referencia del documento y no su URL firmada, que cambia en cada envío.
 */
export function valoresDelHecho(
  citados: readonly DatoDelHecho[],
  bloques: BloquesDelHecho,
  instante?: string,
): ValoresDelHecho {
  const out: ValoresDelHecho = {};
  const cita = dataEnElMomento(bloques.cita, instante);
  const doc = dataEnElMomento(bloques.documento, instante);
  for (const d of citados) {
    if (d === 'fecha_cita') out.fecha_cita = textoNoVacio(cita.fecha_cita_dian);
    if (d === 'link') out.link = textoNoVacio(doc.drive_url);
    if (d === 'recibos') {
      const numeros = recibosDelUltimoPago(doc.recibos).map((r) => r.numero).sort();
      out.recibos = numeros.length > 0 ? numeros.join(',') : null;
    }
  }
  return out;
}

/** Instante actual como cadena civil de Bogotá: 'YYYY-MM-DDTHH:mm'. */
export function ahoraBogotaCivil(d: Date = new Date()): string {
  const m: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)) {
    if (p.type !== 'literal') m[p.type] = p.value;
  }
  return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}`;
}

/**
 * ¿La cita ya pasó? Se compara como cadena civil de Bogotá (la del bloque no lleva
 * zona). Una cita de solo día cuenta como pasada desde el día SIGUIENTE: el mismo día
 * todavía puede no haber ocurrido. Un valor que no es fecha no se declara pasado.
 *
 * Misma regla que `esFechaHoraPasada` (src/lib/negocios/fecha-hora-campo.ts) para el
 * valor con hora.
 */
export function citaYaPaso(valor: unknown, ahora: Date = new Date()): boolean {
  if (typeof valor !== 'string') return false;
  const v = valor.trim();
  const civil = ahoraBogotaCivil(ahora);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v < civil.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) return v.slice(0, 16) < civil;
  return false;
}

/** Una fila previa de `avisos_cliente` del mismo origen. */
export type AvisoPrevio = {
  canal: string;
  estado: string;
  huella: string | null;
  created_at: string;
};

/**
 * El aviso previo, por este canal, que ya le contó al cliente este mismo hecho, o null.
 *
 * @param huellaDeLaFilaVieja reconstruye la huella de una fila anterior a la columna
 *   (`huella` null). Si devuelve null no se pudo saber, y esa fila no cuenta.
 */
export function avisoPrevioDelMismoHecho(
  previos: readonly AvisoPrevio[],
  canal: string,
  huella: string,
  huellaDeLaFilaVieja: (previo: AvisoPrevio) => string | null,
): AvisoPrevio | null {
  for (const p of previos) {
    if (p.canal !== canal || !ESTADOS_QUE_SALIERON.includes(p.estado)) continue;
    const suya = p.huella ?? huellaDeLaFilaVieja(p);
    if (suya !== null && suya === huella) return p;
  }
  return null;
}

/**
 * La huella de una fila vieja, reconstruida del historial de los bloques. Null si en
 * ese instante algún dato citado estaba vacío: con un dato vacío el aviso no habría
 * salido, así que la reconstrucción no es confiable.
 */
export function huellaReconstruida(
  citados: readonly DatoDelHecho[],
  bloques: BloquesDelHecho,
  instante: string,
): string | null {
  const v = valoresDelHecho(citados, bloques, instante);
  if (citados.some((d) => !v[d])) return null;
  return huellaDelHecho(v);
}

/** Qué decide la guarda para UN canal. */
export type Decision = { huella: string; valores: ValoresDelHecho } & (
  | { omitir: false }
  | { omitir: true; motivo: 'cita_pasada' }
  | { omitir: true; motivo: 'duplicado'; previo: AvisoPrevio }
);

/**
 * La guarda completa para un canal.
 *
 *   1. La cita ya pasó → no sale (`cita_pasada`), sin importar si es la primera vez.
 *   2. Ya salió un aviso por este canal con la misma huella → no sale (`duplicado`).
 *   3. Si no, sale. Incluye la REPROGRAMACIÓN: otra cita es otra huella.
 */
export function decidirAvisoAlCliente(p: {
  canal: string;
  citados: readonly DatoDelHecho[];
  bloques: BloquesDelHecho;
  previos: readonly AvisoPrevio[];
  ahora?: Date;
}): Decision {
  const actuales = valoresDelHecho(p.citados, p.bloques);
  const huella = huellaDelHecho(actuales);
  const base = { huella, valores: actuales };
  if (p.citados.includes('fecha_cita') && citaYaPaso(actuales.fecha_cita, p.ahora)) {
    return { ...base, omitir: true, motivo: 'cita_pasada' };
  }
  const previo = avisoPrevioDelMismoHecho(
    p.previos,
    p.canal,
    huella,
    (v) => huellaReconstruida(p.citados, p.bloques, v.created_at),
  );
  return previo ? { ...base, omitir: true, motivo: 'duplicado', previo } : { ...base, omitir: false };
}
