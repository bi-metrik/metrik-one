// Sonda del CLI de Claude Code para el arnés (no se despliega): una llamada mínima con salida estructurada y el entorno
// sin ANTHROPIC_API_KEY (la cuenta es la suscripción). Imprime la forma de la respuesta, nunca credenciales.
// Uso: deno run -A --node-modules-dir=none supabase/functions/_shared/agente/publico/arnes/sonda-cli.ts [modelo]
import { entornoCli } from './modelo-cli.ts';

const modelo = Deno.args[0] ?? 'claude-haiku-5-5';
const t0 = performance.now();
const out = await new Deno.Command('claude', {
  args: ['-p', '--model', modelo, '--output-format', 'json', '--tools', '', '--no-session-persistence', '--setting-sources', '',
    '--system-prompt', 'Responde solo con el JSON pedido.', '--json-schema', JSON.stringify({ type: 'object', properties: { ok: { type: 'string' } }, required: ['ok'] })],
  env: entornoCli(), clearEnv: true, stdin: 'piped', stdout: 'piped', stderr: 'piped',
}).spawn();
const w = out.stdin.getWriter();
await w.write(new TextEncoder().encode('di ok'));
await w.close();
const r = await out.output();
const txt = new TextDecoder().decode(r.stdout);
console.log(JSON.stringify({ code: r.code, ms: Math.round(performance.now() - t0), stderr: new TextDecoder().decode(r.stderr).slice(0, 300) }));
try {
  const d = JSON.parse(txt);
  console.log(JSON.stringify({ llaves: Object.keys(d), structured_output: d.structured_output, result: String(d.result ?? '').slice(0, 200), modelUsage: Object.keys(d.modelUsage ?? {}), apiKeySource: d.apiKeySource, is_error: d.is_error, duration_ms: d.duration_ms, duration_api_ms: d.duration_api_ms, usage: d.usage }));
} catch {
  console.log(txt.slice(0, 800));
}
