// ============================================================
// Arnés del núcleo conversacional — la corrida (Deno)
// ------------------------------------------------------------
// Uso (la llave llega por GEMINI_API_KEY; nunca se imprime):
//   deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/correr.ts --salida <dir> [--conjunto 1|2|todo]
//     [--solo id1,id2] [--temperatura 0] [--seco] [--humo]
// --seco   sin red: modelo falso (prueba de cañería, no mide nada).
// --humo   UNA llamada mínima a gemini-3.8-flash y sale. Si da 429 o cuota, se para ahí.
// La base es la de memoria (`PuertoMemoria`); su estado final es la verdad (§3.8). Sin datos reales.
// Los precios para el gasto son los de la página oficial de Google leídos por Yuto el 2026-10-06 (§3.12 del diseño):
// se pasan aquí, no viven en el código del núcleo.
// ============================================================

import { CONFIG_POR_DEFECTO } from '../config.ts';
import { escenario } from '../escenario.ts';
import type { Escenario } from '../escenario.ts';
import { modeloGemini } from '../modelo-gemini.ts';
import { modeloGuionado } from '../modelo-guionado.ts';
import type { Modelo, PedidoModelo, Salida, UsoLlamado } from '../tipos.ts';
import type { PrecioModelo } from '../uso.ts';
import { sumarUso } from '../uso.ts';
import { calificar, tabla } from './calificar.ts';
import type { ResultadoCaso } from './calificar.ts';
import { CONJUNTO_1, CONJUNTO_2 } from './conjuntos.ts';
import type { CasoArnes } from './conjuntos.ts';
import { promptSimulador, simular, transcripcionParaSimulador } from './simulador.ts';

export const PRECIOS_312: PrecioModelo[] = [
  // ai.google.dev/gemini-api/docs/pricing, leída el 2026-10-06 (diseño §3.12). Caché sin dato: se cobra como entrada.
  { modelo: 'gemini-3.8-flash', entrada: 0.75, salida: 3.75, cache: null },
  { modelo: 'gemini-3.5-flash-lite', entrada: 0.30, salida: 2.50, cache: null },
];

const args = Deno.args;
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const seco = args.includes('--seco');
const LLAVE = Deno.env.get('GEMINI_API_KEY') ?? '';
const MODELO_SIMULADOR = { modelo: 'gemini-3.5-flash-lite', razonamiento: 'MINIMAL' };

async function humo(): Promise<void> {
  const t0 = performance.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG_POR_DEFECTO.principal.modelo}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': LLAVE },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responde solo: ok' }] }], generationConfig: { maxOutputTokens: 64, thinkingConfig: { thinkingLevel: 'LOW' } } }),
  });
  const cuerpo = await res.text();
  let uso = '';
  try { const u = JSON.parse(cuerpo).usageMetadata ?? {}; uso = `entrada ${u.promptTokenCount ?? 0}, salida ${u.candidatesTokenCount ?? 0}, razonamiento ${u.thoughtsTokenCount ?? 0}`; } catch { /* sin json */ }
  console.log(JSON.stringify({ humo: res.status, ms: Math.round(performance.now() - t0), uso, cuota: res.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(cuerpo) }));
  if (res.status !== 200) Deno.exit(3);
}

function modeloParaCaso(): Modelo {
  if (!seco) {
    const t = arg('--temperatura');
    const principal = t !== undefined ? { ...CONFIG_POR_DEFECTO.principal, temperatura: Number(t) } : CONFIG_POR_DEFECTO.principal;
    return modeloGemini({ llave: LLAVE, principal, respaldo: CONFIG_POR_DEFECTO.respaldo, corteMs: CONFIG_POR_DEFECTO.corteMs });
  }
  // Seco: contesta siempre algo corto, sin datos (prueba que la cañería corre de punta a punta).
  return modeloGuionado(Array.from({ length: 200 }, () => (_p: PedidoModelo) => ({ name: 'responder', args: { tema: 'solicitud', texto: '¿Me cuentas más?' } })));
}

function verSalida(s: Salida): string {
  const ops = 'opciones' in s ? ` ${s.opciones.map((o) => `[${o.titulo}]`).join(' ')}` : '';
  return `${s.texto}${ops}`;
}

/** Toca por título; si el bot no mostró esa opción, la persona contesta escribiendo «sí» (y queda dicho). */
async function tocarOEscribir(e: Escenario, titulo: string): Promise<string> {
  try {
    await e.toca(titulo);
    return `[toque: ${titulo}]`;
  } catch {
    await e.escribe('sí');
    return `«sí» (no había botón «${titulo}»)`;
  }
}

async function correrCaso(caso: CasoArnes): Promise<{ r: ResultadoCaso; usoSimulador: UsoLlamado[]; comercial: string[] }> {
  const e = await escenario({ modelo: modeloParaCaso(), contactos: caso.contactos, viajes: caso.viajes, reloj: () => performance.now() });
  if (caso.semilla) e.semilla(caso.semilla);
  const comercial: string[] = [];
  const usoSimulador: UsoLlamado[] = [];
  let error: string | undefined;
  try {
    if (caso.pasos) {
      for (const p of caso.pasos) {
        if (p.escribe !== undefined) { await e.escribe(p.escribe); comercial.push(p.escribe); }
        else if (p.reenvia !== undefined) { await e.reenvia(p.reenvia); comercial.push(`(reenvío) ${p.reenvia}`); }
        else if (p.toca !== undefined) comercial.push(await tocarOEscribir(e, p.toca));
      }
    } else {
      const pendientes = [...(caso.mensajesCliente ?? [])];
      const vistas: Array<{ quien: 'tu' | 'asistente' | 'reenvio'; texto: string; opciones?: string[] }> = [];
      for (let i = 0; i < 10; i++) {
        let a: { accion: string; texto: string };
        if (seco) {
          a = pendientes.length ? { accion: 'reenvia', texto: '' } : i < (caso.mensajesCliente?.length ?? 0) + 1 ? { accion: 'escribe', texto: 'listo' } : { accion: 'fin', texto: '' };
        } else {
          const s = await simular({
            llave: LLAVE, modelo: MODELO_SIMULADOR.modelo, razonamiento: MODELO_SIMULADOR.razonamiento,
            sistema: promptSimulador({ objetivo: caso.objetivo!, estilo: caso.estilo!, pendientes: pendientes.length }),
            transcripcion: transcripcionParaSimulador(vistas),
          });
          usoSimulador.push(s.uso);
          if (!s.ok) { error = `simulador: ${s.motivo}`; break; }
          a = s.accion;
        }
        if (a.accion === 'fin') break;
        let salidas: Salida[] = [];
        if (a.accion === 'reenvia') {
          const m = pendientes.shift();
          if (!m) { vistas.push({ quien: 'tu', texto: '(no te quedan mensajes para reenviar)' }); continue; }
          salidas = await e.reenvia(m);
          comercial.push(`(reenvío) ${m}`);
          vistas.push({ quien: 'reenvio', texto: m });
        } else if (a.accion === 'toca') {
          const antes = e.mensajero.enviados.length;
          comercial.push(await tocarOEscribir(e, a.texto));
          vistas.push({ quien: 'tu', texto: `[tocaste: ${a.texto}]` });
          salidas = e.mensajero.enviados.slice(antes).map((x) => x.salida);
        } else {
          salidas = await e.escribe(a.texto);
          comercial.push(a.texto);
          vistas.push({ quien: 'tu', texto: a.texto });
        }
        for (const s of salidas) vistas.push({ quien: 'asistente', texto: s.texto, opciones: 'opciones' in s ? s.opciones.map((o) => o.titulo) : undefined });
      }
    }
  } catch (err) {
    error = String(err).slice(0, 300);
  }
  const r = calificar(caso, e.pasos, e.puerto, e.almacen.trazas(), PRECIOS_312, error);
  return { r, usoSimulador, comercial };
}

function transcripcion(caso: CasoArnes, r: ResultadoCaso, comercial: string[]): string {
  const filas: string[] = [];
  const conHoy = caso.conjunto === 1;
  filas.push(conHoy ? '| # | Comercial | Bot nuevo (núcleo) | Bot de hoy (la conversación real) |' : '| # | Comercial (simulado) | Bot nuevo (núcleo) |');
  filas.push(conHoy ? '|---|---|---|---|' : '|---|---|---|');
  const celda = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  r.pasos.forEach((p, i) => {
    const t = p.trazas.at(-1);
    const nota = t ? ` <sub>${t.tipo === 'modelo' ? `${t.llamados} llamado(s) · ${(t.herramientas ?? []).map((h) => h.nombre).join(', ') || 'sin herramientas'}` : t.tipo}${p.ms !== null ? ` · ${p.ms} ms` : ''}${t.candados?.length ? ` · candado: ${t.candados.map((c) => c.candado).join(', ')}` : ''}${t.verificador?.length ? ` · verificador: ${t.verificador.length}` : ''}${t.uso?.some((u) => u.modelo.includes('lite')) ? ' · respaldo lite' : ''}</sub>` : '';
    const bot = p.salidas.length ? p.salidas.map(verSalida).join('<br>—<br>') : '(no contesta)';
    const quien = comercial[i] ?? (p.clase === 'toque' ? `[toque: ${p.texto}]` : p.texto);
    filas.push(conHoy ? `| ${i + 1} | ${celda(quien)} | ${celda(bot)}${nota} | ${celda(caso.botDeHoy?.[i] ?? '')} |` : `| ${i + 1} | ${celda(quien)} | ${celda(bot)}${nota} |`);
  });
  return [
    `### ${caso.id} · ${caso.titulo}`,
    '',
    `**Éxito de la tarea:** ${r.exito.ok ? 'sí' : 'NO'} — ${r.exito.motivo}. **Dañinas:** ${r.daninas.length ? r.daninas.join('; ') : '0'}. **Atajadas:** ${r.atajadas.length ? r.atajadas.join('; ') : '0'}.${r.error ? ` **Error del arnés:** ${r.error}` : ''}`,
    '',
    ...filas,
    '',
  ].join('\n');
}

if (import.meta.main) {
  if (args.includes('--humo')) { await humo(); Deno.exit(0); }
  if (!seco && LLAVE.length < 20) { console.error('sin llave'); Deno.exit(2); }
  const salida = arg('--salida');
  if (!salida) { console.error('falta --salida <dir>'); Deno.exit(2); }
  const conjunto = arg('--conjunto') ?? 'todo';
  const solo = arg('--solo')?.split(',');
  const casos = [...(conjunto === '2' ? [] : CONJUNTO_1), ...(conjunto === '1' ? [] : CONJUNTO_2)].filter((c) => !solo || solo.includes(c.id));
  const resultados: ResultadoCaso[] = [];
  const transcripciones: string[] = [];
  const usoSim: UsoLlamado[] = [];
  for (const c of casos) {
    const { r, usoSimulador, comercial } = await correrCaso(c);
    resultados.push(r);
    usoSim.push(...usoSimulador);
    transcripciones.push(transcripcion(c, r, comercial));
    console.log(JSON.stringify({ caso: c.id, exito: r.exito.ok, daninas: r.daninas.length, atajadas: r.atajadas.length, tokens: r.uso.entrada + r.uso.salida + r.uso.razonamiento, error: r.error ?? null }));
  }
  const t = tabla(resultados, PRECIOS_312);
  const sim = sumarUso([{ tipo: 'modelo', bot: 'simulador', uso: usoSim }], PRECIOS_312);
  const etiqueta = seco ? 'seco (modelo falso)' : `${CONFIG_POR_DEFECTO.principal.modelo} ${CONFIG_POR_DEFECTO.principal.razonamiento}, respaldo ${CONFIG_POR_DEFECTO.respaldo?.modelo} a los ${CONFIG_POR_DEFECTO.corteMs} ms${arg('--temperatura') !== undefined ? `, temperatura ${arg('--temperatura')}` : ', temperatura por defecto'}`;
  await Deno.mkdir(salida, { recursive: true });
  await Deno.writeTextFile(`${salida}/resultados.json`, JSON.stringify({ etiqueta, tabla: t, simulador: sim, resultados }, null, 2));
  const resumen = [
    `# Arnés del núcleo conversacional — ${etiqueta}`,
    '',
    `Corrida: ${new Date().toISOString()} · casos: ${t.casos} · conjunto ${conjunto}. Base en memoria; datos inventados.`,
    '',
    '| Métrica | Valor |',
    '|---|---|',
    `| Dañinas (llegaron) | ${t.daninas} |`,
    `| Atajadas por candado o verificador | ${t.atajadas} |`,
    `| Éxito de la tarea | ${t.exitos} de ${t.casos} |`,
    ...Object.entries(t.porTipo).map(([k, v]) => `| Turno ${k} (n=${v.n}) | p50 ${v.p50 ?? '—'} ms · p90 ${v.p90 ?? '—'} ms |`),
    `| Todos los turnos con modelo (n=${t.modelo.n}) | p50 ${t.modelo.p50 ?? '—'} ms · p90 ${t.modelo.p90 ?? '—'} ms |`,
    `| Tokens del agente | entrada ${t.uso.entrada} · salida ${t.uso.salida} · razonamiento ${t.uso.razonamiento} · caché ${t.uso.cache} · ${t.uso.llamados} llamados en ${t.uso.turnos} turnos |`,
    `| Gasto del agente | ${t.uso.costo_usd === null ? 'sin precio' : `${t.uso.costo_usd.toFixed(4)} USD`} |`,
    `| Tokens y gasto del simulador | entrada ${sim.entrada} · salida ${sim.salida + sim.razonamiento} · ${sim.costo_usd === null ? 'sin precio' : `${sim.costo_usd.toFixed(4)} USD`} |`,
    '',
    'Latencia: desde que la fila entra (el webhook) hasta el primer envío, con la base en memoria y sin el envío a Meta.',
    '',
    ...transcripciones,
  ].join('\n');
  await Deno.writeTextFile(`${salida}/transcripciones.md`, resumen);
  console.log(JSON.stringify({ tabla: t, simulador: { entrada: sim.entrada, salida: sim.salida, costo_usd: sim.costo_usd } }));
}
