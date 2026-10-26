// ============================================================
// El perfil del contacto (`contacto_perfil_hechos`) — el vocabulario y las invariantes, puro
// ------------------------------------------------------------
// Diseño: proyectos/trappvel/clarity/docs/diseno/motor-perfil-cliente.md §4 (hechos, no un blob) y §11 (captura de baja
// fricción); brief a Max del 2026-10-12 (perfil por el bot, corte 1).
//
// Un hecho por fila, con su dimensión (vocabulario cerrado), su texto, su estado (sugerido / confirmado / descartado) y
// su origen. Lo usan el bot (edge functions) y la app (Next importa este archivo con su `.ts`): por eso no toca `Deno`.
//
// El SIGNIFICADO lo decide el modelo (Mauricio, 2026-10-07: «el modelo interpreta y clasifica; el código solo protege
// invariantes»). El modelo dice de cada hecho:
//   · `clase`: `dato` (va al perfil), `sensible` (salud, creencias, vida íntima: la casilla 2 del texto dice «solo para
//     mi viaje», así que no va al perfil) o `juicio` (una opinión sobre la persona: no se vuelve campo);
//   · `nombra_menores`: si el texto nombra a un menor (decisión del 2026-09-12: de los menores solo el patrón, cuántos y
//     de qué edades, sin nombres).
// Aquí no hay listas de palabras ni regex sobre el texto: el código solo obedece esas marcas y revisa la forma (la
// dimensión existe, el texto cabe, la frase que lo sostiene está escrita).
// ============================================================

export const DIMENSIONES_PERFIL = [
  'nucleo_viaje',
  'preferencias',
  'frecuencia',
  'capacidad_pago',
  'documentos',
  'identidad',
  'otro',
] as const;
export type DimensionPerfil = (typeof DIMENSIONES_PERFIL)[number];

/** Cómo se dice cada dimensión a una persona (en el resumen del bot y en la ficha). */
export const ETIQUETA_DIMENSION: Record<DimensionPerfil, string> = {
  nucleo_viaje: 'con quién viaja',
  preferencias: 'preferencias',
  frecuencia: 'frecuencia',
  capacidad_pago: 'capacidad de pago',
  documentos: 'documentos',
  identidad: 'identidad',
  otro: 'otro',
};

/** Lo que cada dimensión quiere decir, para el modelo (va en la declaración de la herramienta y en el prompt). */
export const AYUDA_DIMENSION: Record<DimensionPerfil, string> = {
  nucleo_viaje: 'con quién suele viajar (pareja, familia, amigos); de los menores solo cuántos y de qué edades',
  preferencias: 'gustos y preferencias: comida, tipo de destino, ritmo, hotel, aerolínea, necesidades ya vistas',
  frecuencia: 'cada cuánto o en qué temporada suele viajar',
  capacidad_pago: 'cómo suele pagar o en qué rango de gasto se mueve, si lo dicen',
  documentos: 'pasaporte, visa y sus vencimientos',
  identidad: 'ciudad, ocupación, fecha de cumpleaños',
  otro: 'algo de la persona que no cabe en las demás',
};

export const ESTADOS_PERFIL = ['sugerido', 'confirmado', 'descartado'] as const;
export type EstadoPerfil = (typeof ESTADOS_PERFIL)[number];

/** De dónde salió un hecho: el comercial se lo pidió al bot, el bot lo separó de una solicitud, o una persona en ONE. */
export const ORIGENES_PERFIL = ['bot_explicito', 'bot_conversacion', 'manual'] as const;
export type OrigenPerfil = (typeof ORIGENES_PERFIL)[number];

export const CLASES_HECHO = ['dato', 'sensible', 'juicio'] as const;
export type ClaseHecho = (typeof CLASES_HECHO)[number];

/** El largo máximo del texto de un hecho (el mismo CHECK de la tabla). */
export const MAX_TEXTO_PERFIL = 280;

/** El texto como se compara para no repetir un hecho (mayúsculas, tildes, espacios). No interpreta. Pura. */
export function textoComparable(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[“”«»"'.,;:!?¡¿()]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function esDimension(v: unknown): v is DimensionPerfil {
  return typeof v === 'string' && (DIMENSIONES_PERFIL as readonly string[]).includes(v);
}

/** Un hecho como lo devuelve el modelo (en `proponer` o en la extracción). */
export interface HechoDelModelo {
  dimension?: unknown;
  texto?: unknown;
  frase?: unknown;
  clase?: unknown;
  nombra_menores?: unknown;
}

/** Un hecho que pasó las invariantes y se puede guardar. `frase`: las palabras de la conversación que lo sostienen. */
export interface HechoPerfil {
  dimension: DimensionPerfil;
  texto: string;
  frase: string;
}

/** Por qué un hecho no entra al perfil. Lo decide la marca del modelo o la forma, nunca una lectura del texto. */
export type MotivoFuera = 'sensible' | 'juicio' | 'nombra_menores' | 'sin_respaldo' | 'forma';

export interface HechoFuera { texto: string; motivo: MotivoFuera; detalle?: string }

/**
 * Separa lo que el modelo devolvió en lo que va al perfil y lo que no, y por qué. `respaldo`: la frase tiene que estar
 * escrita (comparada sin tildes ni mayúsculas) en alguno de estos textos: el modelo no puede poner en el perfil algo que
 * nadie dijo. Pura.
 */
export function separarHechos(raw: unknown, respaldo: ReadonlyArray<string>): { guardables: HechoPerfil[]; fuera: HechoFuera[] } {
  const guardables: HechoPerfil[] = [];
  const fuera: HechoFuera[] = [];
  const fuentes = respaldo.map(textoComparable).filter(Boolean);
  for (const x of (Array.isArray(raw) ? raw : []) as HechoDelModelo[]) {
    if (!x || typeof x !== 'object') continue;
    const texto = typeof x.texto === 'string' ? x.texto.replace(/\s+/g, ' ').trim() : '';
    const frase = typeof x.frase === 'string' ? x.frase.replace(/\s+/g, ' ').trim() : '';
    if (!texto) continue;
    // Las marcas del modelo mandan: un sensible o un juicio no entra aunque venga bien escrito.
    if (x.clase === 'sensible') { fuera.push({ texto, motivo: 'sensible' }); continue; }
    if (x.clase === 'juicio') { fuera.push({ texto, motivo: 'juicio' }); continue; }
    if (x.nombra_menores === true) { fuera.push({ texto, motivo: 'nombra_menores' }); continue; }
    if (x.clase !== 'dato') { fuera.push({ texto, motivo: 'forma', detalle: `clase desconocida: ${String(x.clase)}` }); continue; }
    if (!esDimension(x.dimension)) { fuera.push({ texto, motivo: 'forma', detalle: `dimensión desconocida: ${String(x.dimension)}` }); continue; }
    if ([...texto].length > MAX_TEXTO_PERFIL) { fuera.push({ texto, motivo: 'forma', detalle: `más de ${MAX_TEXTO_PERFIL} caracteres` }); continue; }
    const f = textoComparable(frase);
    if (!f || !fuentes.some((t) => t.includes(f))) { fuera.push({ texto, motivo: 'sin_respaldo' }); continue; }
    if (guardables.some((g) => textoComparable(g.texto) === textoComparable(texto))) continue;
    guardables.push({ dimension: x.dimension, texto, frase });
  }
  return { guardables, fuera };
}

/** Un hecho que ya está en el perfil (para no repetirlo ni volver a sugerir lo que alguien descartó). */
export interface HechoExistente { id: string; texto: string; estado: EstadoPerfil }

/**
 * Lo que pasa con cada hecho nuevo frente a los que ya están: igual a un confirmado → ya estaba; igual a un sugerido →
 * confirmar ESE (si el nuevo es confirmado) o nada (si también es sugerido); igual a un descartado → un sugerido no vuelve
 * (motor §4.1, regla 2; una persona sí lo puede confirmar de nuevo); si no, se inserta. Igual = mismo texto comparable,
 * no «mismo significado». Pura.
 */
export function planGuardado<T extends { texto: string }>(
  nuevos: ReadonlyArray<T>,
  existentes: ReadonlyArray<HechoExistente>,
  estado: 'sugerido' | 'confirmado',
): { insertar: T[]; confirmar: Array<{ id: string; hecho: T }>; yaEstaban: T[] } {
  const out = { insertar: [] as T[], confirmar: [] as Array<{ id: string; hecho: T }>, yaEstaban: [] as T[] };
  for (const h of nuevos) {
    const k = textoComparable(h.texto);
    const iguales = existentes.filter((e) => textoComparable(e.texto) === k);
    if (iguales.some((e) => e.estado === 'confirmado')) { out.yaEstaban.push(h); continue; }
    const sugerido = iguales.find((e) => e.estado === 'sugerido');
    if (sugerido) {
      if (estado === 'confirmado') out.confirmar.push({ id: sugerido.id, hecho: h });
      else out.yaEstaban.push(h);
      continue;
    }
    if (estado === 'sugerido' && iguales.some((e) => e.estado === 'descartado')) { out.yaEstaban.push(h); continue; }
    out.insertar.push(h);
  }
  return out;
}

/** «le gusta la comida italiana (preferencias)». Pura. */
export function lineaHecho(h: Pick<HechoPerfil, 'dimension' | 'texto'>): string {
  return `${h.texto} (${ETIQUETA_DIMENSION[h.dimension]})`;
}

/** La forma del hecho para el `responseSchema` / la declaración de la herramienta. */
export function esquemaHecho(o: { conMenores?: boolean } = {}): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      dimension: { type: 'string', enum: [...DIMENSIONES_PERFIL] },
      texto: { type: 'string', description: 'Cómo queda en el perfil: corto, en tercera persona («le gusta la comida italiana»).' },
      frase: { type: 'string', description: 'Las palabras EXACTAS del mensaje de donde sale.' },
      clase: { type: 'string', enum: [...CLASES_HECHO], description: 'dato = va al perfil; sensible = salud, creencias o vida íntima; juicio = una opinión sobre la persona o su carácter.' },
      ...(o.conMenores === false ? {} : { nombra_menores: { type: 'boolean', description: 'true si el texto dice el nombre de un menor.' } }),
    },
    required: ['dimension', 'texto', 'frase', 'clase'],
  };
}
