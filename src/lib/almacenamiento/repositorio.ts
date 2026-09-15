// ============================================================
// Repositorio de archivos de un negocio (almacenamiento externo): el reemplazo de la
// "carpeta de Drive". Agrupa lo que hay bajo `negocios/<id>/` por subcarpeta.
//
// Las subcarpetas visibles son las que la LÍNEA declara en `drive_subfolder` (las
// mismas donde cada bloque guarda su archivo, "5. Documentos del viajero"), aunque
// estén vacías: igual que en Drive, el compartimento se ve desde el primer día. Las
// claves de Storage van normalizadas (`5-documentos-del-viajero`), así que la etiqueta
// legible sale de esa declaración y no de la clave.
//
// ⚠️ No se usan las 5 carpetas iniciales de `ensure-drive-folder.ts` ("3. UPME",
// "4. DIAN"...): son las de SOENA, y en otra línea serían compartimentos que ningún
// bloque llena.
//
// Módulo PURO: lo prueban `repositorio.test.ts` y la prueba de render de la vista.
// ============================================================

import { BUCKET_ARCHIVOS, CARPETA_PENDIENTES, carpetaSegura, construirReferencia, prefijoNegocio } from './referencia'

export interface ArchivoListado {
  /** Ruta completa dentro del bucket. */
  path: string
  bytes: number | null
  actualizado: string | null
  mime: string | null
}

export interface ArchivoRepositorio extends ArchivoListado {
  nombre: string
  referencia: string
}

export interface GrupoRepositorio {
  /** Subcarpeta relativa al negocio, normalizada ('' = raíz). */
  clave: string
  etiqueta: string
  archivos: ArchivoRepositorio[]
}

/** Destinos que escribe el servidor sin que la línea los declare. */
const ETIQUETAS_FIJAS: Record<string, string> = {
  cotizaciones: 'Cotizaciones',
  '1-legal/propuestas': '1. Legal / Propuestas',
}

const ETIQUETA_RAIZ = 'Sin subcarpeta'

/** Clave normalizada de una subcarpeta declarada ("1. Legal/Propuestas" → "1-legal/propuestas"). */
export function claveSubcarpeta(subcarpeta: string): string {
  return subcarpeta
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)
    .map(carpetaSegura)
    .join('/')
}

function etiquetaDeclarada(subcarpeta: string): string {
  return subcarpeta
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)
    .join(' / ')
}

/** Etiqueta legible de una clave que nadie declaró: "otros-soportes" → "Otros soportes". */
function etiquetaDeClave(clave: string): string {
  return clave
    .split('/')
    .map(s => {
      const t = s.replace(/-/g, ' ').trim()
      return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
    })
    .join(' / ')
}

/** Subcarpeta relativa al negocio de una ruta, o null si la ruta no es de ese negocio. */
export function carpetaRelativa(path: string, negocioId: string): string | null {
  const prefijo = prefijoNegocio(negocioId)
  if (!path.startsWith(prefijo)) return null
  const resto = path.slice(prefijo.length)
  const corte = resto.lastIndexOf('/')
  return corte === -1 ? '' : resto.slice(0, corte)
}

export function agruparRepositorio(
  negocioId: string,
  archivos: ArchivoListado[],
  subcarpetasDeclaradas: string[],
): GrupoRepositorio[] {
  const grupos = new Map<string, GrupoRepositorio>()

  for (const declarada of subcarpetasDeclaradas) {
    const clave = claveSubcarpeta(declarada)
    if (!clave || grupos.has(clave)) continue
    grupos.set(clave, { clave, etiqueta: etiquetaDeclarada(declarada), archivos: [] })
  }

  for (const archivo of archivos) {
    const carpeta = carpetaRelativa(archivo.path, negocioId)
    if (carpeta === null) continue
    // Una subida que nadie confirmó no es un archivo del negocio todavía.
    if (carpeta === CARPETA_PENDIENTES || carpeta.startsWith(`${CARPETA_PENDIENTES}/`)) continue

    let grupo = grupos.get(carpeta)
    if (!grupo) {
      grupo = {
        clave: carpeta,
        etiqueta: carpeta === '' ? ETIQUETA_RAIZ : ETIQUETAS_FIJAS[carpeta] ?? etiquetaDeClave(carpeta),
        archivos: [],
      }
      grupos.set(carpeta, grupo)
    }
    grupo.archivos.push({
      ...archivo,
      nombre: archivo.path.split('/').pop() ?? archivo.path,
      referencia: construirReferencia(BUCKET_ARCHIVOS, archivo.path),
    })
  }

  const orden = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })
  return [...grupos.values()]
    .map(g => ({ ...g, archivos: g.archivos.sort((a, b) => orden.compare(a.nombre, b.nombre)) }))
    .sort((a, b) => {
      if (a.clave === '') return 1
      if (b.clave === '') return -1
      return orden.compare(a.etiqueta, b.etiqueta)
    })
}

/** "1,2 MB", "340 KB", "812 B". Sin tamaño conocido → "—". */
export function formatearTamano(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb.toLocaleString('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: mb < 10 ? 1 : 0 })} MB`
}
