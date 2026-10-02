// ============================================================
// La solicitud de viaje sin formulario — las reglas puras
// ------------------------------------------------------------
// Diseño: `proyectos/trappvel/clarity/docs/diseno/noor-solicitud-sin-formulario-2026-10-02.md`.
//
// En la web, el comercial pega o escribe lo que le contó el cliente y el MISMO motor del bot lo
// entiende (`solicitud-texto.ts`). Aquí vive lo que se decide sin base ni modelo:
//   · `partirPegado`: un chat copiado se parte en mensajes por sus marcas (el guardián de quién
//     habla mira mensaje por mensaje); un correo o unas notas son un solo mensaje;
//   · `filasDelResumen`: el resumen para confirmar, fila por fila y, en un negocio que ya existe,
//     en grupos (nuevo, choca con lo que hay, ya estaba);
//   · los textos de la pantalla que salen del motor (cruce, nada nuevo, dos viajes).
// ============================================================

import { valorLegible, type Actualizado, type Conflicto, type Cruce } from './wa-carga-reglas.ts';
import { lineaSolicitudes, type Solicitud } from './wa-guardianes.ts';
import type { CampoEntendible, SalidaEntendida, Sugerido } from './wa-entendimiento-reglas.ts';

/** Quién escribió lo pegado: el cliente (correo, chat copiado) o el comercial (notas de la llamada). */
export type QuienEscribio = 'cliente' | 'notas';

/** Un mensaje de lo pegado, listo para la bandeja. */
export interface MensajePegado {
  cuerpo: string;
  /** «El cliente» = `true`, como un reenvío; «Son mis notas» = `false`, como un escrito del comercial (N3, N7). */
  reenviado: boolean;
}

/** Lo más largo que se acepta pegar: un hilo de correo largo cabe; un libro no. */
export const MAX_LARGO_PEGADO = 20_000;

/**
 * La marca con la que empieza cada mensaje de un chat de WhatsApp copiado:
 *   · WhatsApp Web / escritorio: «[2/10/26, 10:32] Lucía: …» o «[10:32, 2/10/2026] Lucía: …»;
 *   · chat exportado: «2/10/26, 10:32 - Lucía: …» (con «a. m.»/«p. m.» o sin ellos).
 * Lo que queda después de la marca es «Nombre: texto»: el nombre se conserva para que el modelo
 * sepa quién habla (la agencia o el cliente).
 */
const HORA = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s?m\.?)?`;
const FECHA = String.raw`\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}`;
const RE_MARCA = new RegExp(
  String.raw`^\s*(?:\[(?:${FECHA},?\s*${HORA}|${HORA},?\s*${FECHA})\]\s*|${FECHA},?\s*${HORA}\s*-\s*)(?=[^:\n]{1,60}:)`,
  'i',
);

/** ¿La línea abre un mensaje de un chat copiado? */
export function esMarcaDeChat(linea: string): boolean {
  return RE_MARCA.test(linea);
}

/**
 * Parte lo pegado en mensajes. Con dos o más marcas de chat, cada marca abre un mensaje (las líneas
 * siguientes sin marca son del mismo mensaje) y se descarta lo que venga antes de la primera. Con
 * menos de dos, es un correo o unas notas: un solo mensaje. Nunca devuelve mensajes vacíos.
 */
export function partirPegado(texto: string, quien: QuienEscribio): MensajePegado[] {
  const reenviado = quien === 'cliente';
  const limpio = String(texto ?? '').replace(/\r\n?/g, '\n').replace(/[‎‏‪-‮]/g, '').trim();
  if (!limpio) return [];
  const lineas = limpio.split('\n');
  const marcas = lineas.filter(esMarcaDeChat).length;
  if (marcas < 2) return [{ cuerpo: limpio, reenviado }];

  const out: string[] = [];
  let actual: string[] | null = null;
  for (const l of lineas) {
    if (esMarcaDeChat(l)) {
      if (actual) out.push(actual.join('\n'));
      actual = [l.replace(RE_MARCA, '').trim()];
    } else if (actual) {
      actual.push(l);
    }
  }
  if (actual) out.push(actual.join('\n'));
  return out.map(c => c.trim()).filter(Boolean).map(cuerpo => ({ cuerpo, reenviado }));
}

// ── El resumen para confirmar ────────────────────────────────────────────────

/** En qué grupo va una fila del resumen. En un negocio nuevo todo es `nuevo`. */
export type GrupoFila = 'nuevo' | 'choca' | 'ya_estaba';

export interface FilaResumen {
  slug: string;
  label: string;
  /** Lo entendido, como se le dice a una persona («20 nov», «4 estrellas»). */
  legible: string;
  /** Las palabras del texto que lo sostienen (o la deducción). */
  frase: string;
  grupo: GrupoFila;
  /** Lo que el negocio ya tiene, si choca o si era un sugerido que esto reemplaza. */
  actual?: string;
}

/**
 * Las filas del resumen, en el orden de la config. `seco` es la carga en seco sobre el negocio
 * (`cargarEnExistente` sin escribir): sin él (negocio nuevo) todo lo sugerido es nuevo.
 */
export function filasDelResumen(
  fields: ReadonlyArray<CampoEntendible>,
  sugeridos: Record<string, Sugerido>,
  seco?: { escritos: string[]; actualizados: Actualizado[]; conflictos: Conflicto[]; iguales: string[] },
): FilaResumen[] {
  const out: FilaResumen[] = [];
  for (const f of fields) {
    const s = sugeridos[f.slug];
    if (!s) continue;
    const base = { slug: f.slug, label: f.label ?? f.slug, legible: valorLegible(f, s.valor), frase: s.frase || s.deduccion || '' };
    if (!seco) {
      out.push({ ...base, grupo: 'nuevo' });
      continue;
    }
    const act = seco.actualizados.find(a => a.slug === f.slug);
    const choque = seco.conflictos.find(c => c.slug === f.slug);
    if (seco.escritos.includes(f.slug)) out.push({ ...base, grupo: 'nuevo' });
    else if (act) out.push({ ...base, grupo: 'nuevo', actual: valorLegible(f, act.anterior) });
    else if (choque) out.push({ ...base, grupo: 'choca', actual: valorLegible(f, choque.actual) });
    else if (seco.iguales.includes(f.slug)) out.push({ ...base, grupo: 'ya_estaba' });
    // Lo demás (un número cuya frase no dice el número nuevo) no se carga: no se ofrece.
  }
  return out;
}

/** «Veo dos solicitudes distintas (Lisboa mar · Cancún dic). No las mezclo. Pega cada una por separado.» */
export function textoDosViajesWeb(ss: ReadonlyArray<Solicitud>): string {
  return `Veo dos solicitudes distintas (${lineaSolicitudes(ss)}). No las mezclo. Pega cada una por separado.`;
}

/** «Esto parece de otro viaje: aquí dice Cancún y este es LISBOA MAR.» */
export function textoCruceWeb(cruces: ReadonlyArray<Cruce>, nombreViaje: string): string {
  return `Esto parece de otro viaje: aquí dice ${cruces.map(c => c.enMensajes).join(' y ')} y este es ${nombreViaje}.`;
}

/** «No encontré datos nuevos para LISBOA MAR.» */
export function textoNadaNuevo(nombreViaje: string): string {
  return `No encontré datos nuevos para ${nombreViaje}.`;
}

/** «Cargué 4 datos. Faltan 3 para cotizar.» / «Cargué 1 dato. Lista para cotizar.» */
export function textoCargado(cargados: number, faltanMinimo: number): string {
  const c = cargados === 1 ? 'Cargué 1 dato.' : `Cargué ${cargados} datos.`;
  const f = faltanMinimo === 0 ? 'Lista para cotizar.' : `Faltan ${faltanMinimo} para cotizar.`;
  return `${c} ${f}`;
}

/** Una pregunta de un guardián, ligada al campo que no se cargó: va primero en «lo que falta». */
export interface PreguntaGuardian {
  slug: string;
  texto: string;
}

const RE_MES_SIN_DIA = /^un mes o una ventana no es una fecha: «(.+)» no nombra el d[ií]a/;

/**
 * Las preguntas en el acto de los guardianes, como las dice la pantalla: la de C9 tal cual, y la de
 * la fecha que no dice el día: «No cargué la fecha: «en marzo» no dice el día. ¿Qué día salen?».
 */
export function preguntasDeGuardianes(
  fields: ReadonlyArray<CampoEntendible>, descartados: SalidaEntendida['descartados'],
): PreguntaGuardian[] {
  const out = new Map<string, string>();
  for (const d of descartados) {
    if (out.has(d.slug)) continue;
    if (d.pregunta) {
      out.set(d.slug, d.pregunta);
      continue;
    }
    const m = RE_MES_SIN_DIA.exec(d.motivo);
    if (m) {
      const f = fields.find(x => x.slug === d.slug) as (CampoEntendible & { pregunta?: string }) | undefined;
      out.set(d.slug, `No cargué la fecha: «${m[1]}» no dice el día.${f?.pregunta ? ` ${f.pregunta}` : ''}`);
    }
  }
  return [...out].map(([slug, texto]) => ({ slug, texto }));
}
