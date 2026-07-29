/**
 * Carga los prompts del motor de auditoria a `workspaces.config_extra`.
 *
 * El archivo del proyecto es la fuente documentada; la base es la copia
 * operativa. Este script es el UNICO puente entre las dos, y va en esa
 * direccion: archivo → base. Editar la base a mano deja el documento
 * explicando algo que el motor ya no hace, y eso no se ve hasta que alguien
 * pregunta por que el resultado cambio.
 *
 * Guarda ademas el hash del archivo del que salio, para poder detectar despues
 * que se separaron.
 *
 * Uso:
 *   npx tsx scripts/setup-calidad-prompts.ts regat
 *   npx tsx scripts/setup-calidad-prompts.ts regat --verificar   (no escribe)
 */

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const RUTA_PROMPT =
  '/Users/mauricio/Developer/metrik/proyectos/regat/clarity/docs/entrega/prompt-motor-auditoria.md'

/**
 * Extrae los dos prompts del documento.
 *
 * NO se parten por bloques cercados. El documento usa ``` DENTRO del prompt de
 * sistema (para resaltar la lista de codigos de bloque), asi que una regex de
 * "bloque cercado" corta ahi y entrega un prompt MUTILADO — sin la lista de
 * codigos y sin el esquema de salida. Paso: el modelo devolvia
 * `apertura_identificacion`, `escucha_control`… y la validacion los rechazaba.
 * El sintoma parecia del modelo y el defecto era de esta funcion.
 *
 * Se parte por SECCION: desde el encabezado hasta el separador `---` de nivel
 * superior, quitando solo la primera y la ultima linea de cerca. Asi el
 * contenido interno viaja tal cual, incluidos sus propios ```.
 */
function seccion(md: string, encabezado: string): string {
  const i = md.indexOf(encabezado)
  if (i < 0) throw new Error(`No se encontró la sección "${encabezado}"`)
  const desde = i + encabezado.length
  const j = md.indexOf('\n---', desde)
  const cuerpo = (j < 0 ? md.slice(desde) : md.slice(desde, j)).trim()

  const lineas = cuerpo.split('\n')
  if (lineas[0].trim() === '```') lineas.shift()
  if (lineas[lineas.length - 1].trim() === '```') lineas.pop()
  return lineas.join('\n').trim()
}

function extraer(md: string) {
  const cumplimiento = seccion(md, '## Solo cumplimiento (pasada A)')
  const tecnica = seccion(md, '## Prompt de sistema')

  // Guardas de integridad: si el prompt llega mutilado, que falle aqui y no
  // tres pasos despues con un sintoma que parece del modelo.
  if (!/C1[\s\S]*C6/.test(cumplimiento)) {
    throw new Error('El prompt de cumplimiento no trae las seis banderas')
  }
  for (const [que, patron] of [
    ['la lista de códigos de bloque', /apertura · descubrimiento/],
    ['el esquema de salida', /"resumen"/],
    ['los 7 bloques', /7 bloques/],
  ] as const) {
    if (!patron.test(tecnica)) {
      throw new Error(`El prompt de técnica llegó incompleto: falta ${que}`)
    }
  }
  return { cumplimiento, tecnica }
}

async function main() {
  const slug = process.argv[2]
  const soloVerificar = process.argv.includes('--verificar')
  if (!slug) throw new Error('Falta el slug del workspace')

  const md = readFileSync(RUTA_PROMPT, 'utf-8')
  const prompts = extraer(md)
  // El hash es del CONTENIDO EXTRAIDO, no del archivo. Si fuera del archivo, un
  // arreglo en el extractor no cambiaria el hash y la base se quedaria con la
  // version vieja creyendose al dia — que es exactamente lo que paso al
  // corregir el corte por bloques cercados.
  const hashFuente = createHash('sha256')
    .update(prompts.cumplimiento + '\u0000' + prompts.tecnica)
    .digest('hex')
    .slice(0, 16)

  console.log(`fuente         ${RUTA_PROMPT.split('/').slice(-1)[0]} · hash ${hashFuente}`)
  console.log(`pasada A       ${prompts.cumplimiento.length} caracteres`)
  console.log(`pasada B       ${prompts.tecnica.length} caracteres`)

  const svc = createClient(URL, KEY, { auth: { persistSession: false } })
  const { data: ws, error: eWs } = await svc
    .from('workspaces')
    .select('id, config_extra')
    .eq('slug', slug)
    .single()
  if (eWs || !ws) throw new Error(`No existe el workspace ${slug}`)

  const actual = (ws as { config_extra: Record<string, unknown> | null }).config_extra ?? {}
  const guardado = actual.calidad_prompts as { hashFuente?: string; actualizado?: string } | undefined

  if (guardado?.hashFuente === hashFuente) {
    console.log(`estado         al día (cargado el ${guardado.actualizado})`)
    return
  }
  if (guardado) {
    console.log(`estado         DESACTUALIZADO · en base hash ${guardado.hashFuente} del ${guardado.actualizado}`)
  } else {
    console.log('estado         sin cargar')
  }

  if (soloVerificar) {
    console.log('\n(--verificar: no se escribió nada)')
    process.exit(guardado?.hashFuente === hashFuente ? 0 : 1)
  }

  // Se preserva el resto de config_extra: ahi viven credenciales de otros
  // modulos y pisarlo entero seria destructivo.
  const { error } = await svc
    .from('workspaces')
    .update({
      config_extra: {
        ...actual,
        calidad_prompts: {
          ...prompts,
          hashFuente,
          actualizado: new Date().toISOString().slice(0, 10),
        },
      },
    })
    .eq('id', (ws as { id: string }).id)
  if (error) throw new Error(`No se pudo guardar: ${error.message}`)

  console.log(`\nguardado       workspaces.config_extra.calidad_prompts de ${slug}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
