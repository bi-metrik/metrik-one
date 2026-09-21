// ============================================================
// Los recibos que el aviso al cliente tiene que NOMBRAR.
//
// ── Por qué existe ─────────────────────────────────────────────────────────
//
// Un pago mixto produce DOS recibos de caja: uno por el honorario y otro por la plata
// que se recauda para un tercero (decisión de Mauricio del 2026-09-17, PR #795). El
// cliente hizo UN pago y recibe UN correo, y ese correo tiene que nombrar los dos
// documentos, cada uno con su número, su concepto y su valor (decisión del 2026-09-19).
//
// El copy de hoy solo sabe de un `{link}` y un `{recibo}`. Este módulo resuelve el
// `{recibos}`: un bloque de texto con una línea por documento.
//
// ── De dónde salen ─────────────────────────────────────────────────────────
//
// De `negocio_bloques.data.recibos`, la lista que `archivarPdfEnBloque` acumula al
// archivar cada PDF. Es la única fuente que existe: el aviso lo dispara
// `avisar_documento_al_cliente(negocio_id, bloque_config_id)`, que se identifica por un
// BLOQUE y no sabe de qué cobro se trata.
//
// ⚠️ **Por eso hay que elegir, y la regla es "el último pago".** El bloque acumula los
// recibos de TODOS los pagos del negocio, no los de este. Medido en producción el
// 2026-09-21 sobre las 7 filas con recibo del bloque `recibo_caja_upme` de SOENA: una
// (el negocio 6c0d155e) ya tiene dos entradas, de dos cobros distintos y de días
// distintos (RC-1-73 del 16 de septiembre y RC-1-79 del 17). Sin agrupar por `cobro_id`
// ese cliente recibiría, junto al recibo de su pago de hoy, el de un pago que ya le
// confirmamos ayer — que se lee como un cobro doble, que es justo el ruido que la
// decisión de "un solo correo" vino a quitar.
//
// Módulo PURO: sin red, sin Deno, sin base. Lo prueba `recibos-del-aviso.test.ts` desde
// vitest, que es lo único que puede ejercitar código de una edge function en CI.
// ============================================================

/** La marca del copy. Si no está, este módulo no hace nada y no se consulta nada. */
export const MARCA_RECIBOS = '{recibos}';

/** Cuántos días dura el enlace que se le manda al cliente. Es el mismo plazo que firma
 * `enlaceParaElCliente`; vive aquí porque el texto se lo dice al cliente y los dos
 * números tienen que ser el mismo. */
export const DIAS_ENLACE_CLIENTE = 7;

/** Una entrada de `data.recibos`, tal como quedó escrita. Todo es `unknown`: el jsonb lo
 * escribieron versiones distintas del código y las viejas no traen todas las claves. */
export interface EntradaRecibo {
  numero?: unknown;
  valor?: unknown;
  cobro_id?: unknown;
  at?: unknown;
  componente?: unknown;
  concepto?: unknown;
  ref?: unknown;
}

/** Un recibo ya normalizado, listo para nombrarlo en el correo. */
export interface ReciboDelAviso {
  numero: string;
  /** `null` cuando la entrada no lo trae: se nombra el documento sin decir cuánto. */
  valor: number | null;
  /**
   * Qué concepto acusa. Lo escribe la emisión desde la config de la línea.
   *
   * ⚠️ Las entradas anteriores al 2026-09-21 NO lo traen (medido: 7 de 7 en producción
   * solo tienen `at`, `valor`, `numero` y `cobro_id`). Sin él la línea nombra el número
   * y el valor, que es lo que el correo dice hoy.
   */
  concepto: string | null;
  /**
   * Referencia `one://` al PDF, la única forma de dárselo a alguien sin sesión.
   *
   * `null` en las entradas viejas: su PDF solo está en Drive y ahí nació CERRADO
   * (2026-09-16), así que no hay enlace que dar. La línea sale sin "Descargar" en vez de
   * prometer una descarga que devuelve 401 — que es exactamente el defecto que este
   * frente cierra.
   */
  ref: string | null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function numero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Los recibos del ÚLTIMO pago, en el orden en que se emitieron.
 *
 * "Último" es el `cobro_id` de la entrada más reciente por `at`, con el orden del
 * arreglo como desempate (es el orden de emisión: honorario y después pasante). Una
 * entrada sin `cobro_id` no se puede agrupar con nadie, así que si es la última sale
 * sola.
 *
 * Devuelve `[]` cuando no hay nada que nombrar, y quien llama OMITE el aviso: un correo
 * que dice "estos son los documentos de tu pago" y no lista ninguno es peor que no
 * mandarlo, y además en el log se ve como un éxito.
 */
export function recibosDelUltimoPago(lista: unknown): ReciboDelAviso[] {
  if (!Array.isArray(lista)) return [];

  const entradas = lista
    .map((e, i) => ({ e: (e ?? {}) as EntradaRecibo, i }))
    .filter(({ e }) => texto(e.numero) !== null);
  if (entradas.length === 0) return [];

  let ultima = entradas[0];
  for (const cand of entradas.slice(1)) {
    const a = texto(cand.e.at) ?? '';
    const b = texto(ultima.e.at) ?? '';
    // `>=` y no `>`: con el mismo `at` (o sin `at` en ninguna) gana la de más abajo en
    // el arreglo, que es la que se escribió después.
    if (a >= b) ultima = cand;
  }

  const cobro = texto(ultima.e.cobro_id);
  const delPago = cobro === null
    ? [ultima]
    : entradas.filter(({ e }) => texto(e.cobro_id) === cobro);

  return delPago.map(({ e }) => ({
    numero: texto(e.numero)!,
    valor: numero(e.valor),
    concepto: texto(e.concepto),
    ref: texto(e.ref),
  }));
}

/** `$701.812`. Mismo criterio que `formatCOP` de `wa-format.ts`. */
export function formatearPesos(valor: number): string {
  const abs = Math.abs(Math.round(valor)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return valor < 0 ? `-$${abs}` : `$${abs}`;
}

/** Un recibo con su enlace ya firmado, o sin él si no se pudo firmar. */
export interface ReciboConEnlace extends ReciboDelAviso {
  enlace: string | null;
}

/**
 * El bloque de texto que reemplaza a `{recibos}` en el copy.
 *
 * ⚠️ **Cada línea se basta sola, y eso es deliberado.** La invitación a descargar viaja
 * DENTRO de la línea del documento que sí tiene enlace, no en el texto fijo del copy.
 * Así un documento sin enlace (una entrada vieja, o un PDF que no se pudo archivar) sale
 * nombrado pero sin prometer una descarga. Si la promesa viviera en el texto fijo, el
 * correo la haría igual y el cliente volvería a encontrarse con nada — que es el
 * defecto del 2026-09-16 con otro disfraz.
 *
 * Texto plano, sin HTML: el mismo bloque puede acabar en un correo (donde los párrafos
 * se arman partiendo por línea en blanco) y en un texto libre de WhatsApp.
 */
export function textoDeRecibos(recibos: readonly ReciboConEnlace[]): string {
  return recibos
    .map((r) => {
      const partes = [r.numero];
      if (r.concepto) partes.push(r.concepto);
      if (r.valor !== null) partes.push(formatearPesos(r.valor));
      const cabeza = partes.join(' · ');
      if (!r.enlace) return cabeza;
      return `${cabeza}\nDescargar (el enlace funciona ${DIAS_ENLACE_CLIENTE} días): ${r.enlace}`;
    })
    .join('\n\n');
}
