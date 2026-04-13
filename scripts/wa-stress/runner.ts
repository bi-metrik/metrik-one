#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// ============================================================
// wa-stress runner — ejecuta el golden set contra wa-parse-test
//
// Uso:
//   export WA_PARSE_TEST_URL="https://yfjqscvvxetobiidnepa.supabase.co/functions/v1/wa-parse-test"
//   export WA_STRESS_TOKEN="..."
//   deno run --allow-net --allow-env --allow-read runner.ts
//
// Opciones:
//   --corpus path/to.jsonl        default: corpus/golden.jsonl
//   --concurrency N               default: 3
//   --output results.jsonl        default: results/<timestamp>.jsonl
//   --only <intent>               correr solo casos de un intent (debug)
// ============================================================

interface Case {
  id: string;
  text: string;
  intent: string;
  expect: Record<string, unknown>;
}

interface Telemetry {
  parser_source: 'fast_path' | 'gemini' | 'regex';
  gemini_model?: string;
  gemini_input_tokens?: number;
  gemini_output_tokens?: number;
  gemini_latency_ms?: number;
  confidence: number;
}

interface ParseResponse {
  intent: string;
  confidence: number;
  fields: Record<string, unknown>;
  telemetry: Telemetry;
  total_latency_ms: number;
}

interface Result {
  case: Case;
  response?: ParseResponse;
  error?: string;
  intent_ok: boolean;
  fields_ok: boolean;
  fields_missing: string[];
  fields_mismatch: string[];
}

// ------------------------------------------------------------
// CLI args
// ------------------------------------------------------------
const args = parseArgs(Deno.args);
const CORPUS = args.corpus || 'corpus/golden.jsonl';
const CONCURRENCY = parseInt(args.concurrency || '3', 10);
const ONLY = args.only;
const OUTPUT = args.output || `results/${timestamp()}.jsonl`;

const URL = Deno.env.get('WA_PARSE_TEST_URL');
const TOKEN = Deno.env.get('WA_STRESS_TOKEN');
if (!URL || !TOKEN) {
  console.error('Missing env: WA_PARSE_TEST_URL or WA_STRESS_TOKEN');
  Deno.exit(1);
}

// ------------------------------------------------------------
// Load corpus
// ------------------------------------------------------------
const scriptDir = new URL('.', import.meta.url).pathname;
const corpusPath = CORPUS.startsWith('/') ? CORPUS : `${scriptDir}${CORPUS}`;
const corpusText = await Deno.readTextFile(corpusPath);
const allCases: Case[] = corpusText
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('//'))
  .map((l) => JSON.parse(l));
const cases = ONLY ? allCases.filter((c) => c.intent === ONLY) : allCases;

console.log(`Loaded ${cases.length} cases from ${corpusPath}`);
console.log(`Target: ${URL}`);
console.log(`Concurrency: ${CONCURRENCY}\n`);

// ------------------------------------------------------------
// Run with bounded concurrency
// ------------------------------------------------------------
const results: Result[] = [];
const queue = [...cases];
const t0 = Date.now();

async function worker(): Promise<void> {
  while (queue.length > 0) {
    const c = queue.shift();
    if (!c) break;
    const result = await runCase(c);
    results.push(result);
    const icon = result.intent_ok && result.fields_ok ? '✓' : result.intent_ok ? '~' : '✗';
    const src = result.response?.telemetry.parser_source || 'err';
    const model = result.response?.telemetry.gemini_model || '';
    console.log(
      `  ${icon} ${c.id.padEnd(12)} → ${(result.response?.intent || 'ERR').padEnd(20)} [${src}${model ? ' ' + model : ''}]`
    );
  }
}

async function runCase(c: Case): Promise<Result> {
  try {
    const res = await fetch(URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ text: c.text, bucket_key: c.id }),
    });
    if (!res.ok) {
      return {
        case: c,
        error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
        intent_ok: false,
        fields_ok: false,
        fields_missing: [],
        fields_mismatch: [],
      };
    }
    const response: ParseResponse = await res.json();
    const intent_ok = response.intent === c.intent;
    const { fields_ok, fields_missing, fields_mismatch } = compareFields(c.expect, response.fields);
    return { case: c, response, intent_ok, fields_ok, fields_missing, fields_mismatch };
  } catch (err) {
    return {
      case: c,
      error: String(err),
      intent_ok: false,
      fields_ok: false,
      fields_missing: [],
      fields_mismatch: [],
    };
  }
}

function compareFields(
  expect: Record<string, unknown>,
  actual: Record<string, unknown>,
): { fields_ok: boolean; fields_missing: string[]; fields_mismatch: string[] } {
  const missing: string[] = [];
  const mismatch: string[] = [];
  for (const [k, v] of Object.entries(expect)) {
    if (actual[k] === undefined || actual[k] === null) {
      missing.push(k);
      continue;
    }
    // Loose comparison for strings (case-insensitive), strict for numbers
    if (typeof v === 'number') {
      if (actual[k] !== v) mismatch.push(`${k}: expected ${v}, got ${actual[k]}`);
    } else if (typeof v === 'string') {
      if (String(actual[k]).toLowerCase() !== v.toLowerCase()) {
        mismatch.push(`${k}: expected "${v}", got "${actual[k]}"`);
      }
    }
  }
  return {
    fields_ok: missing.length === 0 && mismatch.length === 0,
    fields_missing: missing,
    fields_mismatch: mismatch,
  };
}

// Run workers in parallel
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const totalMs = Date.now() - t0;

// ------------------------------------------------------------
// Report
// ------------------------------------------------------------
console.log('\n' + '='.repeat(70));
console.log('RESUMEN');
console.log('='.repeat(70));

const total = results.length;
const intentOk = results.filter((r) => r.intent_ok).length;
const fieldsOk = results.filter((r) => r.intent_ok && r.fields_ok).length;
const errors = results.filter((r) => r.error).length;

console.log(`Total:         ${total}`);
console.log(`Intent OK:     ${intentOk}/${total} (${pct(intentOk, total)})`);
console.log(`Fields OK:     ${fieldsOk}/${total} (${pct(fieldsOk, total)})`);
console.log(`Errores HTTP:  ${errors}`);
console.log(`Tiempo total:  ${totalMs}ms (${(totalMs / total).toFixed(0)}ms/caso avg)`);

// By parser source
const bySource: Record<string, { count: number; ok: number; tokens_in: number; tokens_out: number; latency: number }> = {};
for (const r of results) {
  if (!r.response) continue;
  const src = r.response.telemetry.parser_source;
  if (!bySource[src]) bySource[src] = { count: 0, ok: 0, tokens_in: 0, tokens_out: 0, latency: 0 };
  bySource[src].count++;
  if (r.intent_ok) bySource[src].ok++;
  bySource[src].tokens_in += r.response.telemetry.gemini_input_tokens || 0;
  bySource[src].tokens_out += r.response.telemetry.gemini_output_tokens || 0;
  bySource[src].latency += r.response.telemetry.gemini_latency_ms || r.response.total_latency_ms;
}

console.log('\nPor parser source:');
console.log('  source        count  intent_ok  avg_in  avg_out  avg_lat_ms');
for (const [src, stats] of Object.entries(bySource)) {
  console.log(
    `  ${src.padEnd(12)} ${String(stats.count).padStart(5)}  ${String(stats.ok).padStart(9)}  ${String(Math.round(stats.tokens_in / stats.count) || 0).padStart(6)}  ${String(Math.round(stats.tokens_out / stats.count) || 0).padStart(7)}  ${String(Math.round(stats.latency / stats.count)).padStart(10)}`
  );
}

// By intent (only failures)
const byIntent: Record<string, { total: number; ok: number }> = {};
for (const r of results) {
  const k = r.case.intent;
  if (!byIntent[k]) byIntent[k] = { total: 0, ok: 0 };
  byIntent[k].total++;
  if (r.intent_ok) byIntent[k].ok++;
}

const failingIntents = Object.entries(byIntent).filter(([, v]) => v.ok < v.total);
if (failingIntents.length > 0) {
  console.log('\nIntents con fallos:');
  for (const [intent, v] of failingIntents) {
    console.log(`  ${intent.padEnd(20)} ${v.ok}/${v.total}`);
  }
}

// Detailed failures
const failures = results.filter((r) => !r.intent_ok || !r.fields_ok);
if (failures.length > 0) {
  console.log('\nCasos fallidos:');
  for (const r of failures) {
    const got = r.response?.intent || 'ERR';
    console.log(`  ${r.case.id}: esperado=${r.case.intent}, obtenido=${got}`);
    console.log(`    texto: "${r.case.text}"`);
    if (r.error) console.log(`    error: ${r.error}`);
    if (r.fields_missing.length > 0) console.log(`    campos faltantes: ${r.fields_missing.join(', ')}`);
    if (r.fields_mismatch.length > 0) console.log(`    campos incorrectos: ${r.fields_mismatch.join('; ')}`);
  }
}

// Save raw results
const outputPath = OUTPUT.startsWith('/') ? OUTPUT : `${scriptDir}${OUTPUT}`;
await Deno.mkdir(outputPath.substring(0, outputPath.lastIndexOf('/')), { recursive: true });
await Deno.writeTextFile(outputPath, results.map((r) => JSON.stringify(r)).join('\n'));
console.log(`\nResultados en: ${outputPath}`);

// Exit code: 0 if all pass, 1 if any failure
Deno.exit(failures.length > 0 ? 1 : 0);

// ------------------------------------------------------------
// Utils
// ------------------------------------------------------------
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1] || '';
      i++;
    }
  }
  return out;
}

function pct(n: number, total: number): string {
  return total === 0 ? '0.0%' : `${((n / total) * 100).toFixed(1)}%`;
}

function timestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
