// ============================================================
// Núcleo conversacional — «la conversación da la intención; la verdad la da la base» (Mauricio, 2026-10-21)
// ------------------------------------------------------------
// Caso real (metrik, 21-oct, dos veces el mismo día): se borraron los gastos de prueba de Impervium y el bot insistió
// «G1 $27.000, G2 $6.880 y G3 $20.389 ya están registrados, no los toco», sacado del historial. Lo que hace el núcleo,
// para TODO dominio que declare `registros` (ONE: los gastos; la bandeja: los viajes que abrió):
//   1. en cada turno, el Estado lleva una foto FRESCA de la base de lo que se registró en la conversación (vigente o ya
//      no existe), con sus alias (G1, M1 26 9…) resueltos contra la base;
//   2. en la conversación, el mensaje del bot que dijo «registrado» de algo que ya no existe lleva la nota del sistema;
//   3. el verificador no deja salir «G1 ya está registrado» (ni la cifra de un registro borrado con «registrado») si la
//      base dice que no existe;
//   4. `proponer` sobre un registro borrado (corregirlo, adjuntarle soporte) no llega al dominio: candado.
// Cada dominio solo pone el puerto que consulta su tabla. Puro (el dominio hace la consulta).
// ============================================================

import { normal } from './verificador.ts';
import type { FilaConversacion, RegistroConversacion } from './tipos.ts';

const PESOS = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/** Las líneas del Estado: lo vigente y lo que ya no existe, dicho explícito. `'error'`: no se pudo revisar. Pura. */
export function lineasRegistros(regs: RegistroConversacion[] | 'error' | null): string[] {
  if (regs === null) return [];
  if (regs === 'error') {
    return ['Registros hechos en esta conversación: no pude revisar la base ahora. No afirmes que algo está registrado ni propongas cambios sobre registros anteriores: di que no pudiste revisar.'];
  }
  if (!regs.length) return [];
  const vigentes = regs.filter((r) => r.estado === 'vigente');
  const borrados = regs.filter((r) => r.estado === 'borrado');
  return [
    `Registros hechos en esta conversación, revisados en la base en este turno (el historial NO prueba que algo exista; esto sí): ${vigentes.length ? vigentes.map((r) => `${r.alias} · ${r.que}`).join(' | ') : 'ninguno sigue en la base'}.`,
    ...(borrados.length ? [
      `YA NO EXISTEN en la base (los borraron después): ${borrados.map((r) => `${r.alias} (${r.que})`).join(', ')}. Aunque la conversación diga que quedaron registrados, no existen: no digas que están registrados, no los corrijas ni les adjuntes nada. Si te piden registrarlos otra vez, propónlos como registros NUEVOS (con lo que traigan sus soportes).`,
    ] : []),
  ];
}

const VERBO_REGISTRO = /\b(registrad[oa]s?|qued[óo]|quedaron|ya est[áa]n?|cargad[oa]s?|anotad[oa]s?|guardad[oa]s?|existen?)\b/iu;
// La negación que cuenta es la de la existencia («ya no está», «no existe», «lo borraron»), no cualquier «no» («ya están
// registrados, no los toco» fue justo la frase del caso real).
const NEGACION = /\b(ya no (esta|estan|existe|existen|aparece|aparecen|hay)|no (esta|estan|existe|existen|aparece|aparecen) (en|registrad)|no (existe|existen)\b|borrad[oa]s?|borraron|eliminad[oa]s?|eliminaron)/u;

/**
 * ¿El texto afirma que un registro borrado existe? Por frase: un verbo de «registrado / ya está» junto a su alias o a una
 * cifra que solo tiene un registro borrado, sin negación en la misma frase. Devuelve los motivos para el verificador. Pura.
 */
export function afirmaRegistroBorrado(texto: string, regs: RegistroConversacion[] | 'error' | null): string[] {
  if (!regs || regs === 'error') return [];
  const borrados = regs.filter((r) => r.estado === 'borrado');
  if (!borrados.length) return [];
  const montosVigentes = new Set(regs.filter((r) => r.estado === 'vigente').flatMap((r) => r.montos ?? []));
  const motivos: string[] = [];
  for (const frase of texto.split(/(?<=[.!?\n])\s+/u)) {
    if (!VERBO_REGISTRO.test(frase) || NEGACION.test(normal(frase))) continue;
    for (const r of borrados) {
      const porAlias = new RegExp(`(^|[^\\p{L}\\p{N}])${r.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}($|[^\\p{L}\\p{N}])`, 'iu').test(frase);
      const porMonto = (r.montos ?? []).some((m) => !montosVigentes.has(m) && frase.replace(/\s/g, '').includes(PESOS.format(m)));
      if (porAlias || porMonto) motivos.push(`dice que ${r.alias} está registrado, pero ya no existe en la base (lo borraron): dilo así o propón registrarlo de nuevo`);
    }
  }
  return [...new Set(motivos)];
}

/** ¿Los datos de `proponer` nombran un registro borrado (su alias o su id)? Devuelve ese registro. Pura. */
export function propuestaSobreBorrado(datos: Record<string, unknown>, regs: RegistroConversacion[] | 'error' | null): RegistroConversacion | null {
  if (!regs || regs === 'error') return null;
  const valores = Object.values(datos).filter((v): v is string => typeof v === 'string').map((v) => v.trim().toLowerCase().replace(/\s+/g, ' '));
  return regs.find((r) => r.estado === 'borrado' && valores.some((v) => v === r.alias.toLowerCase().replace(/\s+/g, ' ') || v === r.id.toLowerCase())) ?? null;
}

/**
 * La conversación que ve el modelo, con la nota del sistema en los mensajes del bot que confirmaron un registro que ya no
 * existe (los del turno cuya ejecución lo escribió). No cambia la base ni las filas originales. Pura.
 */
export function anotarRegistrosBorrados(filas: FilaConversacion[], regs: RegistroConversacion[] | 'error' | null): FilaConversacion[] {
  if (!regs || regs === 'error') return filas;
  const borrados = regs.filter((r) => r.estado === 'borrado');
  if (!borrados.length) return filas;
  const turnos = new Map<string, string[]>();
  for (const f of filas) {
    const e = f.traza?.ejecucion;
    if (e?.resultado !== 'ejecutada' || !f.turno_id) continue;
    const ids = new Set((e.escrituras ?? []).flatMap((w) => [w.id, w.gasto, w.viajeId].filter((x): x is string => typeof x === 'string')));
    const cuales = borrados.filter((r) => ids.has(r.id)).map((r) => r.alias);
    if (cuales.length) turnos.set(f.turno_id, [...(turnos.get(f.turno_id) ?? []), ...cuales]);
  }
  if (!turnos.size) return filas;
  return filas.map((f) => {
    const cuales = f.direccion === 'saliente' && f.turno_id ? turnos.get(f.turno_id) : undefined;
    return cuales ? { ...f, texto: `${f.texto ?? ''} [nota del sistema: ${cuales.join(', ')} ya no existe en la base]` } : f;
  });
}
