/**
 * Ensayo del gate por módulo contra el uso de los últimos 90 días (spec de módulos y cobro, §2.3).
 *
 * Para cada workspace de producción: qué rutas del catálogo quedan bloqueadas con sus módulos de
 * hoy, y cuántos eventos de `activity_log` caen en esas rutas. Un workspace que trabaja hoy en una
 * ruta que el gate le cierra es una decisión pendiente (cortesía del módulo o aviso), no un error.
 *
 * NO escribe nada. Solo lee `workspaces` y `activity_log` con la service role.
 * El criterio es el del gate real (`src/lib/modulos/gate.ts`), no una copia.
 *
 * ⚠️ `activity_log` casi solo registra eventos de negocios: mide el uso de Clarity y del
 * directorio, no el de Valida, Llamadas o Sustenta. Ver `src/lib/modulos/ensayo-rutas.ts`.
 *
 * Uso:  npx tsx scripts/ensayo-rutas-bloqueadas.ts [dias=90]
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const dias = Number(process.argv[2] ?? 90)
if (!Number.isFinite(dias) || dias <= 0) {
  console.error('Uso: npx tsx scripts/ensayo-rutas-bloqueadas.ts [dias=90]')
  process.exit(1)
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { traerTodo } = await import('../src/lib/supabase/paginar')
  const { ensayarRutasBloqueadas } = await import('../src/lib/modulos/ensayo-rutas')

  const one = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: ws, error: errWs } = await one
    .from('workspaces')
    .select('id, slug, modules, modo_vitrina:config_extra->modo_vitrina')
    .order('slug')
  if (errWs) throw new Error(`No se pudieron leer los workspaces: ${errWs.message}`)

  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
  const eventos = await traerTodo<{ workspace_id: string; entidad_tipo: string; created_at: string }>(
    (d, h) =>
      one
        .from('activity_log')
        .select('workspace_id, entidad_tipo, created_at')
        .gte('created_at', desde)
        .order('id')
        .range(d, h),
    { etiqueta: 'activity_log del ensayo de rutas' },
  )

  const filas = ensayarRutasBloqueadas(
    (ws ?? []).map((w) => ({
      id: w.id as string,
      slug: w.slug as string,
      modules: (w.modules as Record<string, boolean> | null) ?? null,
      modoVitrina: w.modo_vitrina === true,
    })),
    eventos,
  )

  console.log(`\nEnsayo del gate por módulo — ${filas.length} workspaces, ${eventos.length} eventos desde ${desde.slice(0, 10)}\n`)
  let conUso = 0
  for (const f of filas) {
    const uso = f.usoBloqueado.map((u) => `${u.ruta} (${u.eventos} eventos, último ${u.ultimo.slice(0, 10)})`)
    if (uso.length > 0) conUso++
    console.log(`${f.slug}`)
    console.log(`  bloqueadas: ${f.rutasBloqueadas.join(' ') || '—'}`)
    console.log(`  USO EN RUTAS BLOQUEADAS: ${uso.join('; ') || 'ninguno'}`)
    if (f.entidadesSinRuta.length > 0) console.log(`  (eventos sin pantalla asociada: ${f.entidadesSinRuta.join(', ')})`)
  }
  console.log(`\n${conUso} workspace(s) con uso en rutas que el gate les cierra.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
