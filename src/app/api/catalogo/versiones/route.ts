import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { CABECERA_FIRMA, verificarFirma } from '@/lib/catalogo/firma'
import { prepararVersion } from '@/lib/catalogo/recibir-version'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/catalogo/versiones` — recibe una versión del catálogo de servicios desde el
 * cerebro (`bi-metrik/metrik-system`), publicada por su Action en cada push a `main` que toque
 * `cerebro/catalogo/servicios/**`.
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §3.2 (entrega A2).
 *
 * ## Cuerpo
 *
 * ```json
 * { "fuente_ruta": "cerebro/catalogo/servicios/licencia-clarity.md",
 *   "archivo": "---\ntipo: servicio\n…\n---\n…" }
 * ```
 *
 * Llega el archivo crudo, no el frontmatter ya convertido: así ONE calcula la huella él mismo
 * y lee la definición del archivo. Ver `lib/catalogo/recibir-version.ts`.
 *
 * ## Quién entra
 *
 * Solo quien tenga `CATALOGO_SYNC_SECRET` y firme (`x-one-firma: t=…,v1=…`, ventana de ±300 s,
 * la ruta y el cuerpo dentro del mensaje). **Sin secreto configurado no entra nadie**: 503, no
 * un "pase porque no hay con qué comparar".
 *
 * ## Códigos
 *
 * | Código | Qué pasó |
 * |---|---|
 * | 201 | la versión no existía y se creó |
 * | 200 | la misma versión con la MISMA huella: reenvío, nada que hacer |
 * | 409 | la misma versión con OTRA huella. **El archivo cambió sin subir la versión**: aceptarlo movería las condiciones de los contratos vivos bajo la misma etiqueta |
 * | 422 | el frontmatter no se pudo leer, la definición no pasa el esquema, o el slug no coincide con el nombre del archivo |
 * | 400 | cuerpo incompleto o ruta fuera del catálogo |
 * | 401 | firma ausente, vencida o que no coincide |
 * | 503 | falta `CATALOGO_SYNC_SECRET` |
 *
 * El 409 es el que hace que el catálogo sirva de algo: sin él, editar un precio en el cerebro
 * cambiaría en silencio lo que un cliente firmó.
 */
export async function POST(request: NextRequest) {
  const crudo = await request.text()

  const firma = verificarFirma({
    metodo: 'POST',
    ruta: '/api/catalogo/versiones',
    cuerpo: crudo,
    cabecera: request.headers.get(CABECERA_FIRMA),
    secreto: process.env.CATALOGO_SYNC_SECRET,
    ahoraSegundos: Math.floor(Date.now() / 1000),
  })
  if (!firma.ok) {
    if (firma.motivo === 'sin_secreto') {
      return NextResponse.json({ error: 'sincronizacion_no_configurada' }, { status: 503 })
    }
    return NextResponse.json({ error: 'firma_invalida', motivo: firma.motivo }, { status: 401 })
  }

  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(crudo)
  } catch {
    return NextResponse.json({ error: 'json_invalido' }, { status: 400 })
  }
  if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    return NextResponse.json({ error: 'cuerpo_invalido' }, { status: 400 })
  }

  const p = prepararVersion(cuerpo as Record<string, unknown>)
  if (!p.ok) {
    return NextResponse.json({ error: p.error, detalles: p.detalles }, { status: p.codigo })
  }

  // Una sola llamada: las dos tablas se apuntan y la llave foránea del servicio a su versión
  // va diferida, así que fuera de una transacción no hay orden de inserts que funcione.
  // Medido con PGlite antes de escribir esto (`lib/catalogo/migracion-sql.test.ts`).
  const supabase = createServiceClient()
  // Las tablas del catálogo todavía no están en los tipos generados (`database.ts`): cast
  // puntual, mismo patrón que el webhook de KYC. Pendiente regenerar tipos + re-agregar aliases.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('registrar_version_catalogo', {
    p_slug: p.slug,
    p_version: p.version,
    p_definicion: p.definicion,
    p_fuente_ruta: p.fuenteRuta,
    p_fuente_sha256: p.fuenteSha256,
  })

  if (error) {
    return NextResponse.json({ error: 'db_error', message: error.message }, { status: 500 })
  }

  const resultado = (data as { resultado?: string } | null)?.resultado
  if (resultado === 'conflicto_huella') {
    return NextResponse.json(
      {
        error: 'conflicto_huella',
        detalles: [
          `${p.slug} v${p.version} ya está publicada con otra huella. ` +
            'Un archivo del catálogo no se edita en su sitio: subí la versión en el frontmatter. ' +
            'Cambiarla por debajo movería las condiciones de los contratos ya firmados.',
        ],
        ...(data as object),
      },
      { status: 409 },
    )
  }

  return NextResponse.json(data, { status: resultado === 'creada' ? 201 : 200 })
}
