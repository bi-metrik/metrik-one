#!/usr/bin/env node
// ============================================================
// El texto de la autorización de datos (formato de Emilio) → INSERT en autorizacion_datos_textos
// ------------------------------------------------------------
// Uso:
//   node scripts/autorizacion-datos-texto-sql.mjs <documento.md> \
//     --workspace <uuid> --version trappvel-autorizacion-cliente-v1.0 --mayor 1 --menor 0 \
//     --encargado "Nombre del Encargado" --canal "correo@de-datos" [--responsable "RAZON, NIT …"] \
//     [--publicado "2026-10-15T00:00:00-05:00"] > texto.sql
//
// Lee del documento:
//   · Pieza 1 (bloque de cita): el título (la línea `## …`), el cuerpo y las cuatro casillas
//     (`☐ **Casilla N (…):** texto`). Se omiten el botón `[ Autorizo ]` y la línea `<small>` de la
//     versión: los pinta la página.
//   · Pieza 1b (bloque de cita): el detalle completo.
//   · Pieza 3: asunto y cuerpo del correo (3a) y el WhatsApp para reenviar (3b), y la instrucción
//     del bot a la comercial.
// Solo imprime SQL: NO escribe en ninguna base. La huella (`plantilla_sha256`) la calcula la base.
// Un texto publicado no se edita: para cambiarlo se publica otra versión.
// ============================================================

import { readFileSync } from 'node:fs'

function args(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++ } else out._.push(a)
  }
  return out
}

/** Las líneas de cita (`> `) de una sección, sin el prefijo. */
function citas(seccion) {
  return seccion.split('\n').filter(l => l.startsWith('>')).map(l => l.replace(/^> ?/, ''))
}

function seccion(md, titulo) {
  const i = md.indexOf(`\n# ${titulo}`)
  if (i < 0) throw new Error(`no encontré la sección «# ${titulo}»`)
  const j = md.indexOf('\n# ', i + 3)
  return md.slice(i, j < 0 ? undefined : j)
}

const CLAVE_POR_NUMERO = { 1: 'generales', 2: 'sensibles', 3: 'menores', 4: 'ofertas' }

export function parsear(md) {
  const p1 = citas(seccion(md, 'Pieza 1.'))
  const titulo = (p1.find(l => /^#{1,3} /.test(l)) ?? '').replace(/^#{1,3} /, '').trim()
  const casillas = []
  const cuerpo = []
  for (const l of p1) {
    if (/^#{1,3} /.test(l) && l.includes(titulo)) continue
    const c = /^☐ \*\*Casilla (\d)[^*]*\*\*\s*(.+)$/.exec(l.trim())
    if (c) { casillas.push({ clave: CLAVE_POR_NUMERO[c[1]], texto: c[2].trim() }); continue }
    if (/^\*\*\[ .* \]\*\*$/.test(l.trim()) || l.trim().startsWith('<small>')) continue
    cuerpo.push(l)
  }
  const detalle = citas(seccion(md, 'Pieza 1b.')).join('\n')
  const p3 = seccion(md, 'Pieza 3.')
  const asunto = /\*\*Asunto:\*\*\s*(.+)/.exec(p3)?.[1]?.trim() ?? null
  const correo = citas(p3.slice(p3.indexOf('## 3a'), p3.indexOf('## 3b')))
    .map(l => l.replace(/\*\*\[ .* \]\*\*\s*→\s*/, '')).join('\n')
  const whatsapp = citas(p3.slice(p3.indexOf('## 3b'), p3.indexOf('**Instrucción del bot'))).join('\n')
  const instruccion = /\*\*Instrucción del bot[^*]*\*\*\s*«([^»]+)»/.exec(p3)?.[1]?.trim() ?? null
  const limpio = s => s.replace(/\n{3,}/g, '\n\n').trim()
  return {
    titulo,
    cuerpo_md: limpio(cuerpo.join('\n')),
    detalle_md: limpio(detalle),
    casillas,
    mensajes: {
      ...(asunto ? { correo_asunto: asunto } : {}),
      ...(correo.trim() ? { correo_cuerpo: limpio(correo) } : {}),
      ...(whatsapp.trim() ? { whatsapp: limpio(whatsapp) } : {}),
      ...(instruccion ? { instruccion_comercial: instruccion } : {}),
    },
  }
}

const dolar = (s, tag = 'txt') => {
  if (s.includes(`$${tag}$`)) throw new Error(`el texto contiene $${tag}$`)
  return `$${tag}$${s}$${tag}$`
}

function main() {
  const a = args(process.argv.slice(2))
  const [archivo] = a._
  for (const k of ['workspace', 'version', 'mayor', 'encargado', 'canal']) {
    if (!a[k]) { console.error(`falta --${k}`); process.exit(2) }
  }
  if (!archivo) { console.error('falta el documento .md'); process.exit(2) }
  const t = parsear(readFileSync(archivo, 'utf8'))
  if (!t.casillas.some(c => c.clave === 'generales')) { console.error('no encontré la casilla 1 (generales)'); process.exit(1) }
  const variables = { encargado: a.encargado, canal_datos: a.canal, ...(a.responsable ? { responsable: a.responsable } : {}) }
  console.log(`-- Texto de la autorización de datos ${a.version} (generado desde ${archivo}).
-- Revisar ANTES de aplicar: un texto publicado no se edita. Si quedan ⟦…⟧ o marcadores sin valor,
-- la página lo muestra pero NO deja autorizar.
insert into public.autorizacion_datos_textos
  (workspace_id, version, mayor, menor, titulo, cuerpo_md, detalle_md, casillas, variables, mensajes${a.publicado ? ', publicado_at' : ''})
values (
  '${a.workspace}',
  ${dolar(a.version)},
  ${Number(a.mayor)}, ${Number(a.menor ?? 0)},
  ${dolar(t.titulo)},
  ${dolar(t.cuerpo_md)},
  ${t.detalle_md ? dolar(t.detalle_md) : 'null'},
  ${dolar(JSON.stringify(t.casillas))}::jsonb,
  ${dolar(JSON.stringify(variables))}::jsonb,
  ${dolar(JSON.stringify(t.mensajes))}::jsonb${a.publicado ? `,\n  '${a.publicado}'::timestamptz` : ''}
)
returning id, version, plantilla_sha256;`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
