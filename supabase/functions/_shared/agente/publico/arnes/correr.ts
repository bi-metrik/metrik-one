// ============================================================
// Arnés del asistente público — la corrida (Deno)
// ------------------------------------------------------------
// Uso:
//   deno run -A --node-modules-dir=none supabase/functions/_shared/agente/publico/arnes/correr.ts --salida <dir> --seco
//   ANTHROPIC_API_KEY_PRUEBAS=… deno run -A --node-modules-dir=none …/correr.ts --salida <dir> [--k 3]
//     [--conjunto escenarios|adversario|lenguaje|operacion|real|todo] [--solo id1,id2]
//     [--esfuerzo low|medium|high] [--pensamiento]
// --seco   sin red: el guion de cada caso hace de modelo (prueba el código, no mide al modelo).
// Real     Claude Haiku 5.5 por el adaptador nativo, SOLO con la llave de pruebas (`ANTHROPIC_API_KEY_PRUEBAS`; nunca la
//          de producción) y datos inventados. Mide pass^k, dañinas y el tiempo interno (p50/p90/p95) con la propuesta
//          de `corte_1` (p95 redondeado arriba, piso 5 s, techo 8 s). La llave nunca se imprime.
// La base y Chatwoot son de memoria; su estado final es la verdad. El conjunto real está vacío hasta recibir las 20
// conversaciones de Sabor.
// ============================================================

import { MODELO_HAIKU_55 } from '../config.ts';
import { modeloAnthropic } from '../../modelo-anthropic.ts';
import { CONJUNTOS_PUBLICO, TODOS_LOS_CASOS } from './conjuntos.ts';
import { correrCaso, reporte } from './correr-caso.ts';
import type { ResultadoPassK } from './correr-caso.ts';

const args = Deno.args;
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const seco = args.includes('--seco');
const LLAVE = Deno.env.get('ANTHROPIC_API_KEY_PRUEBAS') ?? '';

if (import.meta.main) {
  const salida = arg('--salida');
  if (!salida) { console.error('falta --salida <dir>'); Deno.exit(2); }
  if (!seco && LLAVE.length < 20) { console.error('sin ANTHROPIC_API_KEY_PRUEBAS: corre con --seco'); Deno.exit(2); }
  const conjunto = (arg('--conjunto') ?? 'todo') as keyof typeof CONJUNTOS_PUBLICO | 'todo';
  const solo = arg('--solo')?.split(',');
  const k = Number(arg('--k') ?? (seco ? 1 : 3));
  const esfuerzo = (arg('--esfuerzo') ?? 'low') as 'low' | 'medium' | 'high';
  const pensamiento = args.includes('--pensamiento');
  const casos = (conjunto === 'todo' ? TODOS_LOS_CASOS : CONJUNTOS_PUBLICO[conjunto] ?? []).filter((c) => !solo || solo.includes(c.id));
  const modelo = seco ? null : () => modeloAnthropic({ llave: LLAVE, modelo: MODELO_HAIKU_55, esfuerzo, pensamiento, maxSalida: 2048, estricto: true });
  const rs: ResultadoPassK[] = [];
  for (const c of casos) {
    const r = await correrCaso(c, { modelo, k, vivo: !seco });
    rs.push(r);
    const mala = r.corridas.find((x) => !x.exito.ok || x.daninas.length);
    console.log(JSON.stringify({ caso: c.id, pasa: r.pasa, motivo: (mala ?? r.corridas[0]).exito.motivo, daninas: mala?.daninas ?? [] }));
  }
  const rep = reporte(rs, k);
  const etiqueta = seco ? 'seco (guion de cada caso)' : `${MODELO_HAIKU_55} · esfuerzo ${esfuerzo} · ${pensamiento ? 'con' : 'sin'} pensamiento · k=${k}`;
  await Deno.mkdir(salida, { recursive: true });
  await Deno.writeTextFile(`${salida}/resultados.json`, JSON.stringify({ etiqueta, reporte: rep, casos: rs }, null, 2));
  const md = [
    `# Arnés del asistente público (Sabor) — ${etiqueta}`,
    '',
    `Corrida: ${new Date().toISOString()} · ${rep.casos} casos · conjunto ${conjunto}. Base y Chatwoot en memoria; datos inventados.`,
    '',
    '| Métrica | Valor |',
    '|---|---|',
    `| pass^${k} | ${rep.passK} de ${rep.casos} |`,
    ...Object.entries(rep.porConjunto).map(([c, v]) => `| ${c} | ${v.passK} de ${v.casos} |`),
    `| Conjunto real | ${CONJUNTOS_PUBLICO.real.length ? '' : 'VACÍO (HUECO: las 20 conversaciones)'} |`,
    `| Dañinas | ${rep.daninas} |`,
    `| Atajadas por candado o verificador | ${rep.atajadas} |`,
    `| Tiempo interno (n=${rep.internos.n}) | p50 ${rep.internos.p50 ?? '—'} ms · p90 ${rep.internos.p90 ?? '—'} ms · p95 ${rep.internos.p95 ?? '—'} ms |`,
    `| corte_1 propuesto | ${rep.corte1.corte1Ms} ms${rep.corte1.pasaTecho ? ' (el p95 pasa de 8 s: bajar esfuerzo o recortar contexto, no tapar con el aviso)' : ''} |`,
    `| Turnos con aviso rf.demora | ${rep.demoras} de ${rep.turnosModelo} turnos con modelo |`,
    `| Pasos a persona | ${Object.entries(rep.personasPorMotivo).map(([m, n]) => `${m} ${n}`).join(' · ') || '—'} |`,
    '',
    ...(rep.fallan.length ? ['## Casos que no pasan', '', ...rep.fallan.map((f) => `- ${f.id}: ${f.motivo}${f.daninas.length ? ` · dañinas: ${f.daninas.join('; ')}` : ''}`)] : ['Todos los casos pasan.']),
    '',
    seco ? 'En seco el tiempo interno no se mide (reloj falso): el p95 y el corte_1 salen de la corrida real.' : '',
  ].join('\n');
  await Deno.writeTextFile(`${salida}/reporte.md`, md);
  console.log(JSON.stringify({ etiqueta, passK: rep.passK, casos: rep.casos, daninas: rep.daninas, internos: rep.internos, corte1: rep.corte1 }));
}
