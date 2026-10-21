// ============================================================
// Arnés del asistente público — la corrida (Deno)
// ------------------------------------------------------------
// Uso:
//   deno run -A --node-modules-dir=none supabase/functions/_shared/agente/publico/arnes/correr.ts --salida <dir> --seco
//   deno run -A --node-modules-dir=none …/correr.ts --salida <dir> --cli [--k 3] [--paralelo 4] [--modelo claude-haiku-5-5]
//   ANTHROPIC_API_KEY_PRUEBAS=… deno run -A --node-modules-dir=none …/correr.ts --salida <dir> [--k 3]
//   Comunes: [--conjunto escenarios|adversario|lenguaje|operacion|real|todo] [--solo id1,id2]
// --seco   sin red: el guion de cada caso hace de modelo (prueba el código, no mide al modelo).
// --cli    Haiku por el CLI de Claude Code con la SUSCRIPCIÓN (Mauricio, 2026-10-21): `modelo-cli.ts`. Los cortes se
//          agrandan (el arranque del CLI cuesta segundos) y los tiempos medidos NO sirven para fijar `corte_1`.
// API      Haiku por el adaptador nativo, solo con la llave de PRUEBAS (`ANTHROPIC_API_KEY_PRUEBAS`; nunca la de
//          producción). Esta es la que mide el tiempo interno con el que se calibra `corte_1`.
// La base y Chatwoot son de memoria; su estado final es la verdad. Datos inventados. El conjunto real está vacío hasta
// recibir las 20 conversaciones de Sabor.
// ============================================================

import { MODELO_HAIKU_55 } from '../config.ts';
import { modeloAnthropic } from '../../modelo-anthropic.ts';
import { CONJUNTOS_PUBLICO, ESCALA, TODOS_LOS_CASOS } from './conjuntos.ts';
import { correrCaso, reporte } from './correr-caso.ts';
import type { OpcionesCorrida, ResultadoPassK } from './correr-caso.ts';
import { modeloCli } from './modelo-cli.ts';

const args = Deno.args;
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const seco = args.includes('--seco');
const cli = args.includes('--cli');
const LLAVE = Deno.env.get('ANTHROPIC_API_KEY_PRUEBAS') ?? '';
/** Escala de los casos que simulan demora en la corrida por CLI (un llamado tarda segundos, no milisegundos). */
const ESCALA_CLI = 40;

async function enPiscina<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => {
    while (i < xs.length) { const j = i++; out[j] = await f(xs[j]); }
  }));
  return out;
}

if (import.meta.main) {
  const salida = arg('--salida');
  if (!salida) { console.error('falta --salida <dir>'); Deno.exit(2); }
  if (!seco && !cli && LLAVE.length < 20) { console.error('sin ANTHROPIC_API_KEY_PRUEBAS: corre con --seco o --cli'); Deno.exit(2); }
  const conjunto = (arg('--conjunto') ?? 'todo') as keyof typeof CONJUNTOS_PUBLICO | 'todo';
  const solo = arg('--solo')?.split(',');
  const k = Number(arg('--k') ?? (seco ? 1 : 3));
  const esfuerzo = (arg('--esfuerzo') ?? 'low') as 'low' | 'medium' | 'high';
  const pensamiento = args.includes('--pensamiento');
  const nombreModelo = arg('--modelo') ?? MODELO_HAIKU_55;
  const paralelo = Number(arg('--paralelo') ?? (cli ? 4 : 1));
  const casos = (conjunto === 'todo' ? TODOS_LOS_CASOS : CONJUNTOS_PUBLICO[conjunto] ?? []).filter((c) => !solo || solo.includes(c.id));
  if (cli) ESCALA.x = ESCALA_CLI;
  const modelo: OpcionesCorrida['modelo'] = seco ? null
    : cli ? () => modeloCli({ modelo: nombreModelo, concurrencia: paralelo })
      : () => modeloAnthropic({ llave: LLAVE, modelo: nombreModelo, esfuerzo, pensamiento, maxSalida: 2048, estricto: true });
  const o: OpcionesCorrida = {
    modelo, k, vivo: !seco,
    ...(cli ? { configBase: { corte1Ms: 60_000, corteTotalMs: 180_000 }, escala: ESCALA_CLI } : {}),
  };
  const t0 = Date.now();
  const rs: ResultadoPassK[] = await enPiscina(casos, paralelo, async (c) => {
    const r = await correrCaso(c, o);
    const mala = r.corridas.find((x) => !x.exito.ok || x.daninas.length);
    console.log(JSON.stringify({ caso: c.id, pasa: r.pasa, motivo: (mala ?? r.corridas[0]).exito.motivo, daninas: mala?.daninas ?? [] }));
    return r;
  });
  const rep = reporte(rs, k);
  const etiqueta = seco ? 'seco (guion de cada caso)'
    : cli ? `${nombreModelo} por el CLI de Claude Code (suscripción) · k=${k}`
      : `${nombreModelo} por la API (llave de pruebas) · esfuerzo ${esfuerzo} · ${pensamiento ? 'con' : 'sin'} pensamiento · k=${k}`;
  await Deno.mkdir(salida, { recursive: true });
  await Deno.writeTextFile(`${salida}/resultados.json`, JSON.stringify({ etiqueta, reporte: rep, casos: rs }, null, 2));
  const md = [
    `# Arnés del asistente público (Sabor) — ${etiqueta}`,
    '',
    `Corrida: ${new Date().toISOString()} · ${Math.round((Date.now() - t0) / 60000)} min · ${rep.casos} casos · conjunto ${conjunto}. Base y Chatwoot en memoria; datos inventados.`,
    '',
    '| Conjunto | pass^' + k + ' | Dañinas |',
    '|---|---|---|',
    ...Object.entries(rep.porConjunto).map(([c, v]) => `| ${c} | ${v.passK} de ${v.casos} | ${v.daninas} |`),
    `| real | VACÍO (HUECO: las 20 conversaciones) | — |`,
    `| **Total** | **${rep.passK} de ${rep.casos}** | **${rep.daninas}** |`,
    '',
    '| Métrica | Valor |',
    '|---|---|',
    `| Atajadas por candado o verificador | ${rep.atajadas} |`,
    `| Tiempo interno (n=${rep.internos.n}) | p50 ${rep.internos.p50 ?? '—'} ms · p90 ${rep.internos.p90 ?? '—'} ms · p95 ${rep.internos.p95 ?? '—'} ms${cli ? ' — **NO apto para fijar corte_1** (incluye el arranque del CLI por llamado)' : ''} |`,
    cli ? '| corte_1 | se queda en 5 s; se recalibra con las trazas de producción |' : `| corte_1 propuesto | ${rep.corte1.corte1Ms} ms${rep.corte1.pasaTecho ? ' (el p95 pasa de 8 s)' : ''} |`,
    `| Turnos con aviso rf.demora | ${rep.demoras} de ${rep.turnosModelo} turnos con modelo |`,
    `| Pasos a persona | ${Object.entries(rep.personasPorMotivo).map(([m, n]) => `${m} ${n}`).join(' · ') || '—'} |`,
    '',
    ...(cli ? [
      'Por esta vía NO se ejercita (y no se simula) lo propio del adaptador de producción `modelo-anthropic.ts`: `output_config.effort`, los puntos de caché, `strict` en las herramientas, `tool_choice`, `refusal` como `stop_reason` ni el emparejado `tool_use`/`tool_result`. Las llamadas a herramientas salen de `--json-schema` del CLI. Los cortes de la corrida son 60 s / 180 s (base) y ×40 en los casos de demora simulada.',
      '',
    ] : []),
    ...(rep.fallan.length ? [
      '## Casos que no pasan',
      '',
      ...rep.fallan.flatMap((f) => [
        `### ${f.id} (${f.conjunto}) · ${f.titulo}`,
        '',
        `Corridas mal: ${f.corridasMal} de ${k}. Motivo: ${f.motivo}.${f.daninas.length ? ` Dañinas: ${f.daninas.join('; ')}.` : ''}`,
        '',
        '```',
        ...f.transcripcion,
        '```',
        '',
      ]),
    ] : ['Todos los casos pasan.']),
    seco ? 'En seco el tiempo interno no se mide (reloj falso).' : '',
  ].join('\n');
  await Deno.writeTextFile(`${salida}/reporte.md`, md);
  console.log(JSON.stringify({ etiqueta, passK: rep.passK, casos: rep.casos, daninas: rep.daninas, internos: rep.internos, porConjunto: rep.porConjunto }));
}
