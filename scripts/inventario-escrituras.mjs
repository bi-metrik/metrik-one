#!/usr/bin/env node
// Inventario de TODO lo que escribe: server actions, rutas /api (crons y webhooks incluidos)
// y su clasificación por riesgo de repetición. Lo pidió el brief del doble guardado
// (2026-10-06): Chromium repite un POST cortado, Vercel puede entregar un cron dos veces y
// un proveedor reenvía su webhook. Lo que importa es qué pasa si algo llega DOS veces.
//
//   node scripts/inventario-escrituras.mjs            -> markdown en stdout
//   node scripts/inventario-escrituras.mjs --json     -> JSON (para cruzar con otras cosas)
//
// Clases (una acción puede tener varias):
//   a  fija un valor (update/upsert sin más): repetir deja lo mismo
//   b  crea filas (insert): repetir duplica
//   c  alterna o incrementa (`!x`, `+ 1`, rpc de incremento): repetir deshace o suma de más
//   d  efecto externo (correo, WhatsApp, Siigo, ePayco/Bold/Wompi, Drive, IA con costo)
//
// Es ESTÁTICO y aproximado: sigue las llamadas por nombre a través de los imports del
// propio repo (hasta 6 niveles). Un efecto que viaja por un trigger de la base (pg_net a
// `notificar-etapa`, por ejemplo) no se ve desde aquí: esos van anotados a mano en
// `docs/idempotencia/inventario.md`.

import ts from 'typescript'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(RAIZ, 'src')

function archivos(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...archivos(p))
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) && !n.endsWith('.d.ts')) out.push(p)
  }
  return out
}

// ── Señales directas ──────────────────────────────────────────────────────────────────
const EXTERNOS = [
  ['correo', /resend|api\.resend\.com|enviarCorreo|sendEmail|emails\.send/i],
  ['whatsapp', /whatsapp|graph\.facebook\.com|funnelchat|sendTextMessage|sendTemplate|wa-notify/i],
  ['siigo', /siigo/i],
  ['pasarela', /epayco|bold\.co|api\.bold|wompi/i],
  ['drive', /googleapis\.com\/drive|google-drive|drive\.files|subirADrive|crearCarpeta|ensureDriveFolder|pushDocumentoDrive/i],
  ['ia', /gemini|generativelanguage|anthropic|openai|generateObject|generateText|ai-gateway|embeddings/i],
  ['edge', /functions\.invoke|\/functions\/v1\//i],
]

const funciones = new Map() // archivo -> Map(nombre -> info)
const importsDe = new Map() // archivo -> Map(nombreLocal -> {archivo, nombre})

function resolverModulo(desde, spec) {
  let base
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(desde), spec)
  else return null
  for (const c of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c)) return c
  }
  return null
}

function analizarCuerpo(cuerpo, sf) {
  const info = { insert: false, update: false, upsert: false, delete: false, rpc: [], toggle: false, externos: new Set(), llamadas: new Set(), revalidate: false }
  const txt = cuerpo.getText(sf)
  // Protegida con clave de intención (ver src/lib/idempotencia/accion.ts).
  info.conClave = /accionIdempotente\s*[<(]/.test(txt)
  for (const [k, re] of EXTERNOS) if (re.test(txt)) info.externos.add(k)
  const visitar = (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression
      if (ts.isPropertyAccessExpression(e)) {
        const m = e.name.text
        if (m === 'insert') info.insert = true
        else if (m === 'update') {
          info.update = true
          // Alterna (`campo: !actual`) o suma sobre lo leído (`campo: x + 1`): repetir deshace o suma.
          const arg = n.arguments[0]?.getText(sf) ?? ''
          if (/:\s*!\s*[\w(]/.test(arg) || /:\s*\(?[\w.?]+(\s*\?\?\s*0)?\)?\s*[+-]\s*1\b/.test(arg)) info.toggle = true
        }
        else if (m === 'upsert') info.upsert = true
        else if (m === 'delete') info.delete = true
        else if (m === 'rpc') {
          const a = n.arguments[0]
          if (a && ts.isStringLiteralLike(a)) info.rpc.push(a.text)
        }
        info.llamadas.add(m)
      } else if (ts.isIdentifier(e)) {
        if (e.text === 'revalidatePath') info.revalidate = true
        info.llamadas.add(e.text)
      }
    }
    ts.forEachChild(n, visitar)
  }
  visitar(cuerpo)
  return info
}

for (const f of archivos(SRC)) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true)
  const mapa = new Map()
  const imps = new Map()
  const usaServer = sf.statements[0] && ts.isExpressionStatement(sf.statements[0]) && /^['"]use server['"]$/.test(sf.statements[0].expression.getText(sf))
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause && ts.isStringLiteral(st.moduleSpecifier)) {
      const destino = resolverModulo(f, st.moduleSpecifier.text)
      const nb = st.importClause.namedBindings
      if (destino && nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) imps.set(el.name.text, { archivo: destino, nombre: (el.propertyName ?? el.name).text })
      }
    }
    const exportado = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
    if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      mapa.set(st.name.text, { ...analizarCuerpo(st.body, sf), exportado, async: !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword), linea: sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1 })
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          mapa.set(d.name.text, { ...analizarCuerpo(d.initializer.body, sf), exportado, async: true, linea: sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1 })
        }
      }
    }
  }
  funciones.set(f, { mapa, usaServer })
  importsDe.set(f, imps)
}

// ── Cierre transitivo por nombre, siguiendo los imports ───────────────────────────────
function resolverLlamada(archivo, nombre) {
  const local = funciones.get(archivo)?.mapa.get(nombre)
  if (local) return { archivo, nombre }
  const imp = importsDe.get(archivo)?.get(nombre)
  if (imp && funciones.get(imp.archivo)?.mapa.has(imp.nombre)) return imp
  return null
}

const memo = new Map()
function efectos(archivo, nombre, prof = 0, pila = new Set()) {
  const k = archivo + '#' + nombre
  if (memo.has(k)) return memo.get(k)
  const fn = funciones.get(archivo)?.mapa.get(nombre)
  const out = { insert: false, update: false, upsert: false, delete: false, rpc: new Set(), toggle: false, externos: new Set(), via: new Set() }
  if (!fn || pila.has(k)) return out
  pila.add(k)
  Object.assign(out, { insert: fn.insert, update: fn.update, upsert: fn.upsert, delete: fn.delete, toggle: fn.toggle })
  fn.rpc.forEach((r) => out.rpc.add(r))
  fn.externos.forEach((e) => out.externos.add(e))
  if (prof < 6) {
    for (const ll of fn.llamadas) {
      const r = resolverLlamada(archivo, ll)
      if (!r) continue
      const sub = efectos(r.archivo, r.nombre, prof + 1, pila)
      for (const c of ['insert', 'update', 'upsert', 'delete', 'toggle']) out[c] = out[c] || sub[c]
      sub.rpc.forEach((x) => out.rpc.add(x))
      if (sub.externos.size) {
        sub.externos.forEach((x) => out.externos.add(x))
        out.via.add(r.nombre)
      }
    }
  }
  pila.delete(k)
  if (prof === 0) memo.set(k, out)
  return out
}

// RPC que escriben (las que leen se ignoran). Lista conservadora: el prefijo lo delata.
const RPC_ESCRIBE = /^(crear|registrar|marcar|aplicar|asignar|mover|cerrar|abrir|anular|confirmar|emitir|guardar|insertar|actualizar|borrar|eliminar|set_|upsert|liberar|tomar|reclamar|avanzar|retroceder|conciliar|abonar|inicializar|reabrir|cancelar|pausar|reanudar|sincronizar|incrementar|next_|siguiente|asentar|consumir|resolver|completar)/i

function clases(e) {
  const c = []
  const escribeRpc = [...e.rpc].filter((r) => RPC_ESCRIBE.test(r))
  if (e.update || e.upsert) c.push('a')
  if (e.insert || escribeRpc.some((r) => /^(crear|registrar|insertar|emitir|asentar)/i.test(r))) c.push('b')
  if (e.toggle || escribeRpc.some((r) => /increment|next_|siguiente|consumir/i.test(r))) c.push('c')
  if (e.externos.size) c.push('d')
  if (!c.length && (e.delete || escribeRpc.length)) c.push('a')
  return { c, escribeRpc }
}

const filas = []
for (const [archivo, { mapa, usaServer }] of funciones) {
  const rel = relative(RAIZ, archivo)
  const esRuta = /src\/app\/api\/.*\/route\.ts$/.test(archivo)
  for (const [nombre, fn] of mapa) {
    if (!fn.exportado) continue
    let tipo = null
    if (usaServer && fn.async) tipo = 'server action'
    else if (esRuta && /^(GET|POST|PUT|PATCH|DELETE)$/.test(nombre)) {
      tipo = rel.includes('/crons/') ? 'cron' : rel.includes('/webhooks/') || /wompi|epayco|bold/.test(rel) ? 'webhook' : 'ruta /api'
    }
    if (!tipo) continue
    const e = efectos(archivo, nombre)
    const { c, escribeRpc } = clases(e)
    if (!c.length) continue
    filas.push({ tipo, archivo: rel, linea: fn.linea, nombre, clases: c, conClave: !!fn.conClave, externos: [...e.externos], rpc: escribeRpc, via: [...e.via].slice(0, 4) })
  }
}

const orden = { cron: 0, webhook: 1, 'ruta /api': 2, 'server action': 3 }
filas.sort((x, y) => (orden[x.tipo] - orden[y.tipo]) || x.archivo.localeCompare(y.archivo) || x.linea - y.linea)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(filas, null, 2))
} else {
  const n = (k) => filas.filter((f) => f.clases.includes(k)).length
  console.log(`<!-- generado por scripts/inventario-escrituras.mjs; no editar a mano -->`)
  const conClave = filas.filter((f) => f.conClave).length
  console.log(`Total que escribe: ${filas.length} · a=${n('a')} · b=${n('b')} · c=${n('c')} · d=${n('d')} · con clave de intención: ${conClave}\n`)
  console.log('| Tipo | Acción | Archivo | Clases | Clave | Externo | Vía |')
  console.log('|---|---|---|---|---|---|---|')
  for (const f of filas) {
    console.log(`| ${f.tipo} | \`${f.nombre}\` | ${f.archivo}:${f.linea} | ${f.clases.join('')} | ${f.conClave ? '✔' : ''} | ${f.externos.join(', ')} | ${f.via.join(', ')} |`)
  }
}
