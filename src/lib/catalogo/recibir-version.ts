/**
 * La decisión de qué hacer con un archivo de catálogo que llega del cerebro, separada de la
 * ruta HTTP para poder probarla sin levantar Next.
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §3.2 (entrega A2).
 *
 * ## Qué llega y por qué ASÍ
 *
 * Llega el **texto crudo del archivo**, no el frontmatter ya convertido a JSON. Es más trabajo
 * para ONE y es lo correcto: así ONE calcula la huella del archivo **él mismo** y lee la
 * definición **del archivo**. Si la Action mandara el JSON, la huella diría una cosa y el
 * contenido podría decir otra, y la revisión de deriva nocturna —que compara huellas— no lo
 * notaría nunca.
 *
 * Y por eso `frontmatter.ts` no es un parser de YAML permisivo: lo que no entiende lo rechaza
 * con la línea, en vez de leerlo mal.
 *
 * ## Qué comprueba, en orden
 *
 * 1. que el cuerpo traiga `fuente_ruta` y `archivo`;
 * 2. que la ruta sea `cerebro/catalogo/servicios/<slug>.md`;
 * 3. que el frontmatter se pueda leer;
 * 4. que la definición pase el esquema (`definicion.ts`);
 * 5. que el `slug` del frontmatter sea el del nombre del archivo. Sin esto, renombrar el
 *    archivo publica el mismo tipo dos veces con dos slugs, y un contrato queda apuntando al
 *    que se abandonó.
 */
import { leerFrontmatter, ErrorFrontmatter } from './frontmatter'
import { validarDefinicion, type DefinicionServicio } from './definicion'
import { sha256 } from './firma'

export interface CuerpoVersion {
  fuente_ruta?: unknown
  archivo?: unknown
}

export type Preparada =
  | {
      ok: true
      slug: string
      version: number
      definicion: DefinicionServicio
      fuenteRuta: string
      fuenteSha256: string
    }
  | { ok: false; codigo: 400 | 422; error: string; detalles: string[] }

const RUTA = /^cerebro\/catalogo\/servicios\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/

export function prepararVersion(cuerpo: CuerpoVersion): Preparada {
  const ruta = cuerpo.fuente_ruta
  const archivo = cuerpo.archivo

  if (typeof ruta !== 'string' || ruta === '') {
    return { ok: false, codigo: 400, error: 'falta_fuente_ruta', detalles: ['`fuente_ruta` es obligatoria'] }
  }
  if (typeof archivo !== 'string' || archivo === '') {
    return {
      ok: false,
      codigo: 400,
      error: 'falta_archivo',
      detalles: ['`archivo` es el texto crudo del .md; ONE calcula su huella y lee su frontmatter'],
    }
  }

  const m = RUTA.exec(ruta)
  if (!m) {
    return {
      ok: false,
      codigo: 400,
      error: 'ruta_fuera_del_catalogo',
      detalles: [`«${ruta}» no es cerebro/catalogo/servicios/<slug>.md`],
    }
  }
  const slugDelArchivo = m[1]

  let crudo: Record<string, unknown>
  try {
    crudo = leerFrontmatter(archivo) as Record<string, unknown>
  } catch (e) {
    const mensaje = e instanceof ErrorFrontmatter ? e.message : String(e)
    return { ok: false, codigo: 422, error: 'frontmatter_ilegible', detalles: [mensaje] }
  }

  const v = validarDefinicion(crudo)
  if (!v.ok || !v.definicion) {
    return { ok: false, codigo: 422, error: 'definicion_invalida', detalles: v.errores }
  }

  if (v.definicion.slug !== slugDelArchivo) {
    // Renombrar el archivo sin cambiar el slug publicaría el mismo tipo dos veces, y un
    // contrato quedaría apuntando al que se abandonó.
    return {
      ok: false,
      codigo: 422,
      error: 'slug_no_coincide',
      detalles: [`el archivo se llama «${slugDelArchivo}.md» y su frontmatter dice «${v.definicion.slug}»`],
    }
  }

  return {
    ok: true,
    slug: v.definicion.slug,
    version: v.definicion.version,
    definicion: v.definicion,
    fuenteRuta: ruta,
    // La huella la calcula ONE, sobre el archivo que recibió. Es la que compara la revisión
    // de deriva contra `GET /api/catalogo/huellas`.
    fuenteSha256: sha256(archivo),
  }
}
