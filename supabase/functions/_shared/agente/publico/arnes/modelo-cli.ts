// ============================================================
// Arnés del asistente público — un `Modelo` que llama a Haiku por el CLI de Claude Code (`claude -p`)
// ------------------------------------------------------------
// SOLO para el arnés (Mauricio, 2026-10-21): la corrida real va por la suscripción de Claude Code, no por una llave de
// API; la llave de producción de Anthropic queda para el lanzamiento. Nunca se importa desde la edge function.
//
// Cómo: cada llamado del núcleo es un `claude -p` sin herramientas propias del CLI (`--tools ""`), sin sesión guardada,
// sin settings (`--setting-sources ""`), con el sistema del núcleo (`--system-prompt`) y la salida estructurada
// (`--output-format json` + `--json-schema`): el esquema obliga a devolver `{ llamadas: [{ name, args }] }` con una de
// las herramientas permitidas en ese llamado, y el código la convierte en `functionCall`. La conversación (incluidas las
// llamadas y resultados de herramientas del mismo turno) va como texto en el prompt.
// El entorno se pasa limpio: sin ANTHROPIC_API_KEY (si existiera, el CLI la usaría en vez de la suscripción), sin
// CLAUDE_CODE_SIMPLE (modo --bare, que solo acepta llave de API) ni CLAUDECODE (la marca de sesión anidada).
//
// Lo que esta vía NO ejercita del adaptador de producción (`../../modelo-anthropic.ts`) y no se simula: `output_config.
// effort` (el CLI tiene `--effort`, pero de la sesión del CLI, no del pedido de la API que arma el adaptador), los
// puntos de caché (`cache_control`), `strict: true` en las herramientas (aquí la estructura la da `--json-schema` del
// CLI, no el tool use nativo), `tool_choice`, `refusal` como `stop_reason` y el emparejado de `tool_use`/`tool_result`.
// Los tiempos incluyen el arranque del CLI: NO sirven para fijar `corte_1`.
// ============================================================

import type { DeclaracionHerramienta, Mensaje, Modelo, PedidoModelo, RespuestaModelo, UsoLlamado } from '../../tipos.ts';

/** El entorno del CLI: el del proceso menos lo que lo sacaría de la suscripción o lo marcaría como anidado. */
export function entornoCli(): Record<string, string> {
  const e = { ...Deno.env.toObject() };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_SIMPLE', 'CLAUDECODE']) delete e[k];
  return e;
}

/** El esquema de la salida: una o más llamadas a herramientas permitidas, cada una con sus argumentos. Pura. */
export function esquemaLlamadas(herramientas: DeclaracionHerramienta[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      llamadas: {
        type: 'array',
        minItems: 1,
        items: {
          anyOf: herramientas.map((h) => ({
            type: 'object',
            properties: { name: { type: 'string', const: h.name }, args: h.parameters },
            required: ['name', 'args'],
          })),
        },
      },
    },
    required: ['llamadas'],
  };
}

/** La conversación del turno como texto (lo del núcleo, las llamadas y los resultados de herramientas). Pura. */
export function promptDeMensajes(mensajes: Mensaje[], permitidas: string[]): string {
  const partes: string[] = [];
  for (const m of mensajes) {
    for (const p of m.parts) {
      if (p.thought) continue;
      if (p.text) partes.push(m.role === 'user' ? p.text : `[tú escribiste] ${p.text}`);
      if (p.functionCall) partes.push(`[tú llamaste] ${p.functionCall.name}(${JSON.stringify(p.functionCall.args ?? {})})`);
      if (p.functionResponse) partes.push(`[resultado de ${p.functionResponse.name}] ${JSON.stringify(p.functionResponse.response ?? {})}`);
    }
  }
  partes.push(`\nAhora decide tu siguiente llamado. Herramientas que puedes llamar en este llamado: ${permitidas.join(', ')}. Devuelve solo el JSON con \`llamadas\` (puedes pedir varias lecturas a la vez; una herramienta que cierra el turno va sola).`);
  return partes.join('\n');
}

function sistemaConHerramientas(p: PedidoModelo, permitidas: DeclaracionHerramienta[]): string {
  return [
    p.sistema,
    '',
    '<declaraciones_de_herramientas>',
    ...permitidas.map((h) => `- ${h.name}: ${h.description}\n  argumentos (JSON Schema): ${JSON.stringify(h.parameters)}`),
    '</declaraciones_de_herramientas>',
  ].join('\n');
}

export interface OpcionesCli {
  modelo: string;
  /** Llamados del CLI a la vez en todo el proceso (la suscripción tiene límites). */
  concurrencia?: number;
  binario?: string;
}

let enCurso = 0;
const espera: Array<() => void> = [];
async function turno(max: number): Promise<() => void> {
  if (enCurso >= max) await new Promise<void>((r) => espera.push(r));
  enCurso++;
  return () => { enCurso--; espera.shift()?.(); };
}

export function modeloCli(o: OpcionesCli): Modelo {
  return {
    async llamar(p: PedidoModelo): Promise<RespuestaModelo> {
      const permitidas = p.herramientas.filter((h) => p.permitidas.includes(h.name));
      const soltar = await turno(o.concurrencia ?? 4);
      const t0 = performance.now();
      const uso = (ok: boolean, extra: Partial<UsoLlamado> = {}): UsoLlamado => ({ modelo: o.modelo, entrada: 0, salida: 0, razonamiento: 0, cache: 0, ms: Math.round(performance.now() - t0), ok, ...extra });
      try {
        const hijo = new Deno.Command(o.binario ?? 'claude', {
          args: ['-p', '--model', o.modelo, '--output-format', 'json', '--tools', '', '--no-session-persistence', '--setting-sources', '',
            '--system-prompt', sistemaConHerramientas(p, permitidas), '--json-schema', JSON.stringify(esquemaLlamadas(permitidas))],
          env: entornoCli(), clearEnv: true, stdin: 'piped', stdout: 'piped', stderr: 'piped',
        }).spawn();
        const w = hijo.stdin.getWriter();
        await w.write(new TextEncoder().encode(promptDeMensajes(p.mensajes, permitidas.map((h) => h.name))));
        await w.close();
        // Sin corte propio: el corte lo pone el turno (`corte_total`). El CLI que pierde la carrera termina solo.
        const r = await hijo.output();
        const txt = new TextDecoder().decode(r.stdout);
        let d: Record<string, unknown>;
        try { d = JSON.parse(txt); } catch { return { ok: false, motivo: `cli: salida que no es JSON (código ${r.code})`, usos: [uso(false, { motivo: new TextDecoder().decode(r.stderr).slice(0, 200) })] }; }
        const u = (d.usage ?? {}) as Record<string, number>;
        const tokens = { entrada: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), salida: u.output_tokens ?? 0, cache: u.cache_read_input_tokens ?? 0 };
        const so = d.structured_output as { llamadas?: Array<{ name?: string; args?: Record<string, unknown> }> } | undefined;
        const llamadas = (so?.llamadas ?? []).filter((l) => l.name && permitidas.some((h) => h.name === l.name));
        if (d.is_error || !llamadas.length) {
          const motivo = `cli: ${d.is_error ? String(d.subtype ?? 'error') : 'sin llamada'}`;
          return { ok: false, motivo, usos: [uso(false, { ...tokens, motivo: `${motivo} ${String(d.result ?? '').slice(0, 120)}` })] };
        }
        return {
          ok: true,
          mensaje: { role: 'model', modelo: o.modelo, parts: llamadas.map((l, i) => ({ functionCall: { name: l.name!, args: l.args ?? {}, id: `cli_${Date.now()}_${i}` } })) },
          usos: [uso(true, tokens)],
        };
      } catch (e) {
        return { ok: false, motivo: `cli: ${String(e).slice(0, 100)}`, usos: [uso(false)] };
      } finally {
        soltar();
      }
    },
  };
}
