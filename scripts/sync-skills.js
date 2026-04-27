#!/usr/bin/env node
/**
 * sync-skills.js
 * Lee todos los SKILL.md de .claude/skills/ y hace upsert a admin_skills en Supabase.
 * Uso: node scripts/sync-skills.js
 * Requiere: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.
 */

const fs = require('fs')
const path = require('path')

// ─── Config ──────────────────────────────────────────────────────────────────

const SKILLS_DIR = path.resolve(__dirname, '../../.claude/skills')
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan variables de entorno: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY')
  console.error('Ejemplo: NEXT_PUBLIC_SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=sbp_... node scripts/sync-skills.js')
  process.exit(1)
}

// ─── Frontmatter parser (sin dependencias externas) ──────────────────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return { meta: {}, body: content }

  const raw = match[1]
  const body = content.slice(match[0].length).trimStart()
  const meta = {}

  for (const line of raw.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim()
    if (!key) continue

    // Booleans
    if (val === 'true')  { meta[key] = true;  continue }
    if (val === 'false') { meta[key] = false; continue }

    // Numbers
    if (/^\d+$/.test(val)) { meta[key] = parseInt(val, 10); continue }

    // Quoted string
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      meta[key] = val.slice(1, -1)
      continue
    }

    // Array: [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      continue
    }

    meta[key] = val
  }

  return { meta, body }
}

// ─── Supabase fetch helper ────────────────────────────────────────────────────

async function supabaseUpsert(rows) {
  const url = `${SUPABASE_URL}/rest/v1/admin_skills?on_conflict=nombre`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Supabase error ${res.status}: ${txt}`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`No se encontró el directorio de skills: ${SKILLS_DIR}`)
    process.exit(1)
  }

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())

  const rows = []
  const skipped = []

  for (const entry of entries) {
    const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md')
    if (!fs.existsSync(skillPath)) {
      skipped.push(entry.name)
      continue
    }

    const raw = fs.readFileSync(skillPath, 'utf-8')
    const { meta, body } = parseFrontmatter(raw)

    const nombre = meta.name || entry.name

    rows.push({
      nombre,
      tipo:                     meta.tipo ?? null,
      descripcion:              meta.description ?? null,
      argument_hint:            meta['argument-hint'] ?? null,
      disable_model_invocation: meta['disable-model-invocation'] ?? false,
      allowed_tools:            Array.isArray(meta['allowed-tools'])
                                  ? meta['allowed-tools']
                                  : typeof meta['allowed-tools'] === 'string'
                                    ? meta['allowed-tools'].split(',').map(s => s.trim())
                                    : [],
      user_invocable:           meta['user-invocable'] !== false,
      effort:                   meta.effort ?? null,
      contenido:                raw,
      ultima_sync:              new Date().toISOString(),
    })
  }

  if (rows.length === 0) {
    console.log('No se encontraron SKILL.md en', SKILLS_DIR)
    return
  }

  console.log(`Sincronizando ${rows.length} skills → Supabase (admin_skills)...`)
  if (skipped.length) console.log(`  Carpetas sin SKILL.md (ignoradas): ${skipped.join(', ')}`)

  // Upsert en lotes de 50
  const BATCH = 50
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    await supabaseUpsert(batch)
    console.log(`  ✓ Batch ${Math.floor(i / BATCH) + 1}: ${batch.map(r => r.nombre).join(', ')}`)
  }

  console.log(`\n✓ Sync completo. ${rows.length} skills en admin_skills.`)
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
