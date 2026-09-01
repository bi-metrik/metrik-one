// ============================================================
// wa-plantillas — que plantilla de Meta le corresponde a cada aviso
// ------------------------------------------------------------
// Detonante (2026-09-01): las tres alertas W25 de ese dia salieron como texto libre y
// Meta las rechazo con `131047 Re-engagement message`. Fuera de la ventana de 24 h Meta
// SOLO entrega plantillas aprobadas, y un cron que dispara a las 8 a.m. casi siempre
// encuentra la ventana cerrada: la alerta no se atrasa, no llega nunca.
//
// Por que el registro es DATO y no codigo: los nombres de plantilla los crea y los hace
// aprobar Yuto en Meta, y ese tramite no tiene la misma cadencia que un deploy. El mapa
// vive en el secreto `WA_ALERT_TEMPLATES` y se puede cambiar sin tocar una linea. Mismo
// criterio que la config del bono: la politica es dato.
//
// Este modulo es PURO a proposito — no lee `Deno.env` ni habla con Meta. Recibe el crudo
// del secreto como parametro para poder probarse, que es lo unico que separa un mapa de
// plantillas correcto de uno que manda el aviso equivocado a un cliente.
// ============================================================

/** Una plantilla aprobada, ya validada. `params` son los nombres de las variables del
 *  cuerpo EN EL ORDEN en que Meta las espera ({{1}}, {{2}}, ...). */
export interface PlantillaAviso {
  name: string;
  lang: string;
  params: string[];
}

export type RegistroPlantillas = Record<string, PlantillaAviso>;

/** Lo que se le devuelve a quien envia: la plantilla, o la razon por la que no hay. */
export type ResolucionPlantilla =
  | { modo: 'plantilla'; plantilla: PlantillaAviso; componentes: ComponenteBody[] }
  | { modo: 'texto'; motivo: 'sin_registro' | 'intent_sin_plantilla' | 'variable_faltante'; detalle?: string };

export interface ComponenteBody {
  type: 'body';
  parameters: Array<{ type: 'text'; text: string }>;
}

/**
 * Lee el registro del secreto. NUNCA lanza: un JSON malformado no puede tumbar el cron
 * de alertas — degrada a texto libre, que es lo que hace hoy, y deja el motivo en consola.
 * Devuelve `{}` en ese caso, y el que envia decide.
 */
export function leerRegistro(crudo: string | undefined | null): RegistroPlantillas {
  if (!crudo || !crudo.trim()) return {};
  let parseado: unknown;
  try {
    parseado = JSON.parse(crudo);
  } catch (err) {
    console.error('[wa-plantillas] WA_ALERT_TEMPLATES no es JSON valido, se ignora:', err);
    return {};
  }
  if (!parseado || typeof parseado !== 'object' || Array.isArray(parseado)) {
    console.error('[wa-plantillas] WA_ALERT_TEMPLATES debe ser un objeto {intent: {...}}, se ignora');
    return {};
  }

  const registro: RegistroPlantillas = {};
  for (const [intent, valor] of Object.entries(parseado as Record<string, unknown>)) {
    const v = valor as Partial<PlantillaAviso> | null;
    const name = typeof v?.name === 'string' ? v.name.trim() : '';
    const lang = typeof v?.lang === 'string' ? v.lang.trim() : '';
    // Una entrada a medias se descarta ENTERA en vez de completarse con defaults: adivinar
    // el idioma manda una plantilla que Meta rechaza, y el aviso se pierde igual pero con
    // un error mas dificil de leer que "esta plantilla no esta declarada".
    if (!name || !lang) {
      console.error(`[wa-plantillas] entrada "${intent}" sin name o lang, se ignora`);
      continue;
    }
    const params = Array.isArray(v?.params)
      ? v.params.filter((p): p is string => typeof p === 'string')
      : [];
    registro[intent] = { name, lang, params };
  }
  return registro;
}

/**
 * Resuelve que mandar para un intent dado.
 *
 * ⚠️ Una variable declarada que llega vacia NO se rellena con cadena vacia: Meta rechaza
 * el parametro vacio, y aunque no lo hiciera el cliente recibiria un aviso con un hueco.
 * Se cae a texto libre y se dice cual falto — dentro de la ventana de 24 h ese texto SI
 * llega, asi que degradar es mejor que no mandar nada.
 */
export function resolverAviso(
  registro: RegistroPlantillas,
  intent: string,
  variables: Record<string, string | number | null | undefined> = {},
): ResolucionPlantilla {
  if (Object.keys(registro).length === 0) return { modo: 'texto', motivo: 'sin_registro' };

  const plantilla = registro[intent];
  if (!plantilla) return { modo: 'texto', motivo: 'intent_sin_plantilla', detalle: intent };

  const valores: Array<{ type: 'text'; text: string }> = [];
  for (const nombre of plantilla.params) {
    const bruto = variables[nombre];
    const texto = bruto === null || bruto === undefined ? '' : String(bruto).trim();
    if (!texto) {
      return { modo: 'texto', motivo: 'variable_faltante', detalle: `${intent}.${nombre}` };
    }
    // Meta rechaza saltos de linea y tabs dentro de un parametro de cuerpo.
    valores.push({ type: 'text', text: texto.replace(/\s*[\n\r\t]+\s*/g, ' ') });
  }

  const componentes: ComponenteBody[] = valores.length ? [{ type: 'body', parameters: valores }] : [];
  return { modo: 'plantilla', plantilla, componentes };
}
