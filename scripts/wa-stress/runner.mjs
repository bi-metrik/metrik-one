#!/usr/bin/env node
// ============================================================
// wa-stress runner (Node.js version — no deps)
//
// Uso:
//   export WA_PARSE_TEST_URL="https://yfjqscvvxetobiidnepa.supabase.co/functions/v1/wa-parse-test"
//   export WA_STRESS_TOKEN="..."
//   node scripts/wa-stress/runner.mjs
//
// Opciones:
//   --corpus path/to.jsonl        default: corpus/golden.jsonl
//   --concurrency N               default: 3
//   --output results.jsonl        default: results/<timestamp>.jsonl
//   --only <intent>               correr solo casos de un intent (debug)
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------
// CLI args
// ------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
const CORPUS = args.corpus || 'corpus/golden.jsonl';
const CONCURRENCY = parseInt(args.concurrency || '3', 10);
const ONLY = args.only;
const OUTPUT = args.output || `results/${timestamp()}.jsonl`;

const URL = process.env.WA_PARSE_TEST_URL;
const TOKEN = process.env.WA_STRESS_TOKEN;
if (!URL || !TOKEN) {
  console.error('Missing env: WA_PARSE_TEST_URL or WA_STRESS_TOKEN');
  process.exit(1);
}

// ------------------------------------------------------------
// Load corpus
// ------------------------------------------------------------
const corpusPath = isAbsolute(CORPUS) ? CORPUS : join(__dirname, CORPUS);
const corpusText = await readFile(corpusPath, 'utf-8');
const allCases = corpusText
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
const results = [];
const queue = [...cases];
const t0 = Date.now();

async function worker() {
  while (queue.length > 0) {
    const c = queue.shift();
    if (!c) break;
    const result = await runCase(c);
    results.push(result);
    const icon = result.intent_ok && result.fields_ok ? '✓' : result.intent_ok ? '~' : '✗';
    const src = result.response?.telemetry?.parser_source || 'err';
    const model = result.response?.telemetry?.gemini_model || '';
    console.log(
      `  ${icon} ${c.id.padEnd(12)} → ${(result.response?.intent || 'ERR').padEnd(20)} [${src}${model ? ' ' + model : ''}]`
    );
  }
}

async function runCase(c) {
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        text: c.text,
        bucket_key: c.id,
        ...(c.last_context ? { last_context: c.last_context } : {}),
      }),
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
    const response = await res.json();
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

function compareFields(expect, actual) {
  const missing = [];
  const mismatch = [];
  for (const [k, v] of Object.entries(expect)) {
    if (actual[k] === undefined || actual[k] === null) {
      missing.push(k);
      continue;
    }
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
const bySource = {};
for (const r of results) {
  if (!r.response) continue;
  const src = r.response.telemetry?.parser_source || 'unknown';
  if (!bySource[src]) bySource[src] = { count: 0, ok: 0, tokens_in: 0, tokens_out: 0, latency: 0 };
  bySource[src].count++;
  if (r.intent_ok) bySource[src].ok++;
  bySource[src].tokens_in += r.response.telemetry?.gemini_input_tokens || 0;
  bySource[src].tokens_out += r.response.telemetry?.gemini_output_tokens || 0;
  bySource[src].latency += r.response.telemetry?.gemini_latency_ms || r.response.total_latency_ms || 0;
}

console.log('\nPor parser source:');
console.log('  source        count  intent_ok  avg_in  avg_out  avg_lat_ms');
for (const [src, stats] of Object.entries(bySource)) {
  console.log(
    `  ${src.padEnd(12)} ${String(stats.count).padStart(5)}  ${String(stats.ok).padStart(9)}  ${String(
      Math.round(stats.tokens_in / stats.count) || 0
    ).padStart(6)}  ${String(Math.round(stats.tokens_out / stats.count) || 0).padStart(7)}  ${String(
      Math.round(stats.latency / stats.count)
    ).padStart(10)}`
  );
}

// By intent (only failures)
const byIntent = {};
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
const outputPath = isAbsolute(OUTPUT) ? OUTPUT : join(__dirname, OUTPUT);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, results.map((r) => JSON.stringify(r)).join('\n'));
console.log(`\nResultados en: ${outputPath}`);

process.exit(failures.length > 0 ? 1 : 0);

// ------------------------------------------------------------
// Utils
// ------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1] || '';
      i++;
    }
  }
  return out;
}

function pct(n, total) {
  return total === 0 ? '0.0%' : `${((n / total) * 100).toFixed(1)}%`;
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}
