/**
 * Crea un ESPACIO DE PRUEBAS con la configuración de un workspace real, sin sus datos, para
 * encender ahí lo que todavía no se enciende en el real.
 *
 * Primer uso (brief de Max del 2026-10-13): `trappvel` → `trappvel-pruebas`, para las etapas
 * D (Vera) y E (Sofía) de la cotización por pasos, que en Trappvel sigue apagada.
 *
 * Qué hace (el detalle y los motivos viven en `src/lib/espacio-pruebas/`):
 *   1. Crea el workspace destino con `config_extra.espacio_de_pruebas = true` desde el primer
 *      insert, en el grupo «demo», con `cotizacion_por_pasos` encendido SOLO ahí.
 *   2. Copia la configuración: líneas activas, etapas, bloques, campos, etiquetas, estados,
 *      servicios y el régimen fiscal (con NIT y razón social inventados). Lista blanca para
 *      `workspaces.config_extra`; credenciales, canales y carpetas se quitan siempre.
 *   3. No copia negocios, cotizaciones, contactos, empresas, staff, documentos, archivos,
 *      avisos ni credenciales.
 *   4. Siembra el caso fijo de San Andrés de C0 (inventado) y un negocio por variante de Vera.
 *   5. Da acceso con dos alias del correo base: dueña (autoriza bajo el mínimo) y asesora.
 *
 * SIMULACRO POR DEFECTO: sin `--apply` no escribe nada e imprime cuántas filas escribiría por
 * tabla, qué dejó afuera y por qué.
 *
 * Uso:
 *   npx tsx scripts/clonar-config-workspace.ts <origen> <destino> [opciones]
 *
 * Opciones:
 *   --apply                  Escribe de verdad. Se niega si hay tablas sin clasificar con filas.
 *   --borrar                 Borra el espacio de pruebas entero (filas, archivos, alias, workspace).
 *                            Sin --apply, solo dice que lo haría.
 *   --resembrar              Borra los negocios sembrados y los vuelve a sembrar (con --apply).
 *   --nombre "<texto>"       Nombre visible. Default: «Viajes Prueba».
 *   --correo-base <correo>   De aquí salen los alias (<local>+<destino>-dueno@...).
 *                            Default: mauricio.moreno@metrik.com.co
 *   --incluir-clave a,b      Llaves de workspaces.config_extra que se copian además de la lista
 *                            blanca, después de revisarlas en el simulacro.
 *   --ignorar-sin-clasificar Aplica aunque haya tablas sin clasificar (no las copia).
 *   --doble                  Corre contra el doble en memoria (test/espacio-pruebas-doble.ts),
 *                            no contra la base. Para ver el simulacro sin tocar producción.
 *
 * Requiere en .env.local (salvo con --doble): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

import type { Almacen, Fila, Filtro } from '@/lib/espacio-pruebas/almacen'
import {
  contarPorTabla,
  crearUsuarios,
  deshacer,
  ejecutar,
  planificar,
  purgar,
  type InformeBorrado,
  type OpcionesPlan,
  type Plan,
} from '@/lib/espacio-pruebas/plan'

import { casoDeC0, crearAlmacenDoble } from '../test/espacio-pruebas-doble'

config({ path: resolve(process.cwd(), '.env.local') })

// ── Argumentos ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const tiene = (n: string) => argv.includes(`--${n}`)
function valor(n: string): string | undefined {
  const i = argv.indexOf(`--${n}`)
  if (i === -1) return undefined
  const v = argv[i + 1]
  if (!v || v.startsWith('--')) {
    console.error(`--${n} necesita un valor`)
    process.exit(1)
  }
  return v
}

const [origen, destino] = argv.filter((x, i) => !x.startsWith('--') && !argv[i - 1]?.match(/^--(nombre|correo-base|incluir-clave)$/))
if (!origen || !destino) {
  console.error('Uso: npx tsx scripts/clonar-config-workspace.ts <origen> <destino> [--apply] [--borrar] [--resembrar] [--doble]')
  process.exit(1)
}
const APPLY = tiene('apply')
const BORRAR = tiene('borrar')
const RESEMBRAR = tiene('resembrar')
const DOBLE = tiene('doble')
const correoBase = valor('correo-base') ?? 'mauricio.moreno@metrik.com.co'
const nombre = valor('nombre') ?? 'Viajes Prueba'
const incluirClaves = (valor('incluir-clave') ?? '').split(',').map(s => s.trim()).filter(Boolean)

// ── El almacén de verdad: Supabase con la llave de servicio ─────────────────

const TECHO = 1000
const TROZO = 150

function almacenSupabase(url: string, llave: string): Almacen {
  const sb: SupabaseClient = createClient(url, llave, { auth: { persistSession: false } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aplicar = (q: any, filtros: Filtro[]) => {
    for (const [col, op, v] of filtros) q = op === 'eq' ? q.eq(col, v) : q.in(col, v)
    return q
  }
  /** Un filtro `in` largo se parte: la URL de PostgREST tiene techo. */
  const trozos = (filtros: Filtro[]): Filtro[][] => {
    const i = filtros.findIndex(f => f[1] === 'in' && (f[2] as unknown[]).length > TROZO)
    if (i < 0) return [filtros]
    const lista = filtros[i][2] as unknown[]
    const out: Filtro[][] = []
    for (let k = 0; k < lista.length; k += TROZO) {
      const copia = [...filtros]
      copia[i] = [filtros[i][0], 'in', lista.slice(k, k + TROZO)]
      out.push(copia)
    }
    return out
  }

  return {
    async leer(tabla, filtros) {
      const out: Fila[] = []
      for (const f of trozos(filtros)) {
        for (let desde = 0; ; desde += TECHO) {
          const { data, error } = await aplicar(sb.from(tabla).select('*'), f).range(desde, desde + TECHO - 1)
          if (error) throw new Error(`leer ${tabla}: ${error.message}`)
          out.push(...((data ?? []) as Fila[]))
          if (!data || data.length < TECHO) break
        }
      }
      return out
    },
    async contar(tabla, filtros) {
      let n = 0
      for (const f of trozos(filtros)) {
        const { count, error } = await aplicar(sb.from(tabla).select('*', { count: 'exact', head: true }), f)
        if (error) throw new Error(`contar ${tabla}: ${error.message}`)
        n += count ?? 0
      }
      return n
    },
    async insertar(tabla, filas) {
      for (let k = 0; k < filas.length; k += TROZO) {
        const { error } = await sb.from(tabla).insert(filas.slice(k, k + TROZO))
        if (error) throw new Error(`insertar ${tabla}: ${error.message}`)
      }
    },
    async actualizar(tabla, id, patch) {
      const { error } = await sb.from(tabla).update(patch).eq('id', id)
      if (error) throw new Error(`actualizar ${tabla}: ${error.message}`)
    },
    async guardar(tabla, fila, conflicto = 'id') {
      const { error } = await sb.from(tabla).upsert(fila, { onConflict: conflicto })
      if (error) throw new Error(`guardar ${tabla}: ${error.message}`)
    },
    async borrar(tabla, filtros) {
      let borradas = 0
      for (const f of trozos(filtros)) {
        const { count, error } = await aplicar(sb.from(tabla).delete({ count: 'exact' }), f)
        if (error) return { borradas, error: { code: error.code, message: error.message } }
        borradas += count ?? 0
      }
      return { borradas, error: null }
    },
    async tablas() {
      // El OpenAPI de PostgREST: las tablas expuestas y sus columnas. Las vistas no aceptan DELETE.
      const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: llave, Authorization: `Bearer ${llave}`, Accept: 'application/openapi+json' } })
      if (!r.ok) throw new Error(`OpenAPI de PostgREST: ${r.status}`)
      const doc = (await r.json()) as { definitions?: Record<string, { properties?: Record<string, unknown> }>; paths?: Record<string, Record<string, unknown>> }
      const out = new Map<string, string[]>()
      for (const [t, d] of Object.entries(doc.definitions ?? {})) {
        if (!doc.paths?.[`/${t}`]?.delete) continue
        out.set(t, Object.keys(d.properties ?? {}))
      }
      return out
    },
    async buscarUsuario(correo) {
      // `auth.admin` no busca por correo: se recorren las páginas. Si el listado falla, se para
      // (crear a ciegas un usuario que ya existe deja un perfil sin dueño).
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw new Error(`Buscar ${correo} en auth.users: ${error.message}`)
        const u = data.users.find(x => (x.email ?? '').toLowerCase() === correo.toLowerCase())
        if (u) return u.id
        if (data.users.length < 1000) return null
      }
      throw new Error('auth.users tiene más de 50.000 usuarios: búsqueda cortada.')
    },
    async crearUsuario(correo, nombreCompleto) {
      const { data, error } = await sb.auth.admin.createUser({ email: correo, email_confirm: true, user_metadata: { full_name: nombreCompleto } })
      if (error || !data.user) throw new Error(`createUser ${correo}: ${error?.message ?? 'sin usuario'}`)
      return data.user.id
    },
    async borrarUsuario(id) {
      const { error } = await sb.auth.admin.deleteUser(id)
      if (error) throw new Error(`deleteUser ${id}: ${error.message}`)
    },
    async archivos(prefijo) {
      const { data: buckets, error } = await sb.storage.listBuckets()
      if (error) throw new Error(`listBuckets: ${error.message}`)
      const out: { bucket: string; ruta: string }[] = []
      for (const b of buckets ?? []) {
        const pendientes = [prefijo.replace(/\/$/, '')]
        while (pendientes.length) {
          const carpeta = pendientes.pop()!
          const { data } = await sb.storage.from(b.name).list(carpeta, { limit: 1000 })
          for (const o of data ?? []) {
            const ruta = `${carpeta}/${o.name}`
            if (o.id) out.push({ bucket: b.name, ruta })
            else pendientes.push(ruta)
          }
        }
      }
      return out
    },
    async borrarArchivos(lista) {
      const porBucket = new Map<string, string[]>()
      for (const o of lista) porBucket.set(o.bucket, [...(porBucket.get(o.bucket) ?? []), o.ruta])
      for (const [b, rutas] of porBucket) {
        const { error } = await sb.storage.from(b).remove(rutas)
        if (error) throw new Error(`Storage ${b}: ${error.message}`)
      }
    },
  }
}

// ── Informe ─────────────────────────────────────────────────────────────────

function imprimirPlan(plan: Plan, modo: string) {
  const i = plan.informe
  console.log(`\n${modo} · ${plan.origen.slug} → ${plan.destino.slug}${DOBLE ? '  [DOBLE en memoria, no la base]' : ''}\n`)
  console.log(plan.destino.existe
    ? `Workspace destino: ya existe (${plan.destino.id}).`
    : `Workspace destino: se crea «${nombre}» (${plan.destino.id}), grupo demo, espacio_de_pruebas = true, cotizacion_por_pasos encendido.`)

  console.log('\nFilas que escribiría, por tabla:')
  const conteo = contarPorTabla(plan.pasos)
  if (!conteo.size) console.log('  (ninguna: todo ya está)')
  for (const [t, n] of conteo) console.log(`  ${t.padEnd(32)} ${String(n).padStart(5)}`)

  console.log('\nAccesos:')
  for (const u of plan.usuarios) {
    console.log(`  ${u.role.padEnd(9)} ${u.correo}  ${u.id ? `(ya existe en Auth: ${u.id})` : '(se crea en Auth)'}${u.existe ? ' · staff ya creado' : ''}`)
  }

  if (!plan.destino.existe) {
    console.log(`\nworkspaces.config_extra · se copian: ${i.clavesCopiadas.join(', ') || '(ninguna)'}`)
    console.log('workspaces.config_extra · NO se copian:')
    for (const c of i.clavesDescartadas) console.log(`  ${c.clave.padEnd(28)} ${c.motivo}`)
    console.log(`Módulos que quedan apagados: ${i.modulosApagados.join(', ') || '(ninguno)'}`)
    console.log(`\nLlaves quitadas de la config copiada (credenciales, carpetas, Siigo, facturación): ${i.llavesQuitadas.length}`)
    for (const r of i.llavesQuitadas) console.log(`  ${r}`)
    console.log(`\nParece dato personal en la config copiada (REVISAR; no se imprime el valor): ${i.datosPersonales.length}`)
    for (const r of i.datosPersonales) console.log(`  ${r}`)
    console.log(`\nids que no son de la copia (REVISAR; pueden ser catálogo global): ${i.uuidsSueltos.length}`)
    for (const r of i.uuidsSueltos) console.log(`  ${r}`)
    console.log('\nTablas con filas de la cliente que NO se copian:')
    for (const e of i.excluidas) console.log(`  ${e.tabla.padEnd(32)} ${String(e.filas).padStart(6)}  ${e.motivo}`)
    console.log(`\nSIN CLASIFICAR (no se copian; --apply se niega mientras existan): ${i.sinClasificar.length}`)
    for (const e of i.sinClasificar) console.log(`  ${e.tabla.padEnd(32)} ${String(e.filas).padStart(6)}`)
  }

  console.log('\nNegocios sembrados:')
  for (const s of i.semillas) console.log(`  [${s.estado.padEnd(9)}] ${s.nombre.padEnd(44)} ${s.para}`)
  if (i.avisos.length) {
    console.log('\nAvisos:')
    for (const a of i.avisos) console.log(`  · ${a}`)
  }
}

function imprimirBorrado(inf: InformeBorrado) {
  console.log('\nBorrado:')
  for (const [t, n] of Object.entries(inf.borradas)) console.log(`  ${t.padEnd(32)} ${String(n).padStart(5)}`)
  console.log(`  archivos: ${inf.archivosBorrados} · alias borrados: ${inf.usuariosBorrados.length} · workspace borrado: ${inf.workspaceBorrado ? 'sí' : 'no'}`)
  for (const b of inf.bloqueos) console.log(`  BLOQUEO: ${b}`)
  for (const [t, n] of Object.entries(inf.residuo)) console.log(`  RESIDUO: ${t} ${n}`)
  for (const [t, m] of Object.entries(inf.errores)) console.log(`  ERROR: ${t}: ${m}`)
}

// ── Ejecución ───────────────────────────────────────────────────────────────

async function main() {
  let almacen: Almacen
  if (DOBLE) {
    almacen = crearAlmacenDoble()
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const llave = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !llave) {
      console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (o usa --doble)')
      process.exit(1)
    }
    almacen = almacenSupabase(url, llave)
  }
  const destinoO = { origen, destino, correoBase }

  if (BORRAR) {
    if (!APPLY) {
      const [ws] = await almacen.leer('workspaces', [['slug', 'eq', destino]])
      console.log(ws ? `\nSIMULACRO: borraría el espacio de pruebas «${destino}» (${String(ws.id)}) entero. Repetir con --borrar --apply.` : `\n«${destino}» no existe: nada que borrar.`)
      return
    }
    imprimirBorrado(await purgar(almacen, destinoO))
    return
  }

  const opciones: OpcionesPlan = {
    origen, destino, nombre, correoBase, incluirClaves,
    hoy: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
    nuevoId: randomUUID,
    caso: casoDeC0(),
  }

  if (!APPLY) {
    if (RESEMBRAR) console.log('\n(--resembrar sin --apply: el simulacro muestra el estado actual; con --apply borra y vuelve a sembrar.)')
    imprimirPlan(await planificar(almacen, opciones), 'SIMULACRO (no escribe nada)')
    console.log('\nNada se escribió. Repetir con --apply para ejecutar.')
    return
  }

  // Antes de crear nada: el simulacro tiene que estar limpio.
  const previo = await planificar(almacen, opciones)
  if (previo.informe.sinClasificar.length && !tiene('ignorar-sin-clasificar')) {
    imprimirPlan(previo, 'NO SE APLICA')
    console.error('\nHay tablas sin clasificar con filas de la cliente. Clasifícalas en src/lib/espacio-pruebas/clasificacion.ts o usa --ignorar-sin-clasificar.')
    process.exit(1)
  }
  if (RESEMBRAR && previo.destino.existe) {
    imprimirBorrado(await purgar(almacen, { ...destinoO, soloSemillas: true }))
  }

  const creados = await crearUsuarios(almacen, correoBase, destino)
  let plan: Plan | null = null
  try {
    plan = await planificar(almacen, opciones)
    imprimirPlan(plan, 'APLICANDO')
    await ejecutar(almacen, plan)
  } catch (e) {
    console.error('\n✗ Falló a mitad de camino:', e instanceof Error ? e.message : String(e))
    if (plan && !plan.destino.existe) {
      console.error('  Se deshace lo escrito en esta corrida…')
      imprimirBorrado(await deshacer(almacen, destinoO, creados))
    }
    process.exit(1)
  }
  console.log('\n✓ Listo.')
  console.log(`  https://${destino}.metrikone.co   (preview: <url-del-preview>/?__ws=${destino})`)
  console.log('  Entrar con los alias de arriba por el código del correo (llega al buzón del correo base).')
}

main().catch(e => {
  console.error('\n✗ ERROR:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
