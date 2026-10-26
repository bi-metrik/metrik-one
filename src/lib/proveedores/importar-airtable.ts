/**
 * Importador de la base de proveedores de Airtable (Trappvel) → SQL idempotente. PURO: no lee la
 * base ni la red. Lo corre `scripts/importar-proveedores-airtable.ts`.
 *
 * Entrada: un array de filas de Airtable (`id` rec…, `creado` y los campos por su nombre visible).
 * Salida: un `DO $importar$ … $importar$` que, para el workspace dado,
 *   · une cada fila con la ficha que ya existe por `origen_ref` (reimportar no duplica) o por la
 *     misma llave de #1202 (`claveDeFoto`: nombre sin tildes ni signos + ciudad);
 *   · si no, crea la ficha con `origen = 'importacion'`;
 *   · en una ficha que ya existía, solo LLENA lo vacío (nunca pisa lo que alguien escribió) y suma
 *     las etiquetas;
 *   · registra los tarifarios por nombre y tamaño (la URL de Airtable vence: el archivo se sube
 *     aparte), con la vigencia sacada del nombre marcada como inferida.
 *
 * Reconocer contra lo que el espacio ya tiene con OTRO nombre necesita la lista de nombres
 * conocidos (`conocidos`, una consulta de solo lectura que imprime el script): con las MISMAS
 * palabras sin «hotel» ni la ciudad se une y se guarda el alias; si solo se parecen, la fila va a
 * la lista de revisión y NO se importa hasta que una persona decida (`decisiones`).
 */
import { claveDeFoto } from '@/lib/fotos/clave'
import { reconocer, type NombreConocido } from '@/lib/fotos/perfiles'
import { correosDeTexto, normalizarCelular, normalizarWeb } from './contacto'
import { claveDeProveedor, espacioDeTipo, normalizarEtiquetas, type EspacioProveedor, type TipoProveedor } from './tipos'
import { parsearUbicacion } from './ubicacion'
import { vigenciaDeNombre } from './vigencia'

export interface AdjuntoAirtable {
  filename?: string
  url?: string
  size?: number
  type?: string
}

export type FilaAirtable = { id: string; creado?: string } & Record<string, unknown>

/** Un nombre que el espacio ya conoce (de la consulta de solo lectura). */
export interface ConocidoImportacion {
  tipo: EspacioProveedor
  clave: string
  clave_perfil: string
  nombre: string
  ciudad: string | null
  origen_ref?: string | null
}

/** rec… → «nuevo» (crear aparte) o la llave del perfil con el que se une. */
export type Decisiones = Record<string, string>

export interface TarifarioImportado {
  nombreArchivo: string
  bytes: number | null
  mime: string | null
  desde: string | null
  hasta: string | null
  inferida: boolean
  origenRef: string
}

export interface ProveedorImportado {
  origenRef: string
  nombre: string
  tipoProveedor: TipoProveedor
  espacio: EspacioProveedor
  /** La llave con la que se busca o se crea la ficha (la del perfil al que se une, si se une). */
  clave: string
  /** La llave del nombre de Airtable, cuando se une a un perfil con otro nombre: se guarda como alias. */
  claveAlias: string | null
  ciudad: string | null
  pais: string | null
  estrellas: number | null
  web: string | null
  contacto: string | null
  celular: string | null
  celularOriginal: string | null
  correo: string | null
  telefono: string | null
  direccion: string | null
  notas: string | null
  etiquetas: string[]
  tarifasMayorista: boolean
  tarifarios: TarifarioImportado[]
  /** «Documentos/Certificaciones»: solo los nombres (el archivo va aparte). */
  documentos: string[]
  /** Con qué se unió: «origen_ref», «llave», «mismas palabras», «decisión» o `null` (nuevo). */
  union: string | null
}

export interface NotaRevision {
  rec: string
  nombre: string
  motivo: string
  /** La fila NO entra al SQL hasta que se decida. */
  excluida: boolean
}

export interface Importacion {
  proveedores: ProveedorImportado[]
  revision: NotaRevision[]
}

// ── Lectura de los campos ────────────────────────────────────────────────────

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(texto).filter(Boolean).join(', ') || null
  if (typeof v === 'object' && 'name' in (v as object)) return texto((v as { name: unknown }).name)
  return null
}

function lista(v: unknown): string[] {
  if (v === null || v === undefined) return []
  if (Array.isArray(v)) return v.map(texto).filter((x): x is string => !!x)
  const t = texto(v)
  return t ? t.split(',').map((x) => x.trim()).filter(Boolean) : []
}

function adjuntos(v: unknown): AdjuntoAirtable[] {
  return Array.isArray(v) ? v.filter((a): a is AdjuntoAirtable => !!a && typeof a === 'object' && typeof (a as AdjuntoAirtable).filename === 'string') : []
}

const llano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** «Tipo Proveedor» de Airtable → el tipo de ONE. */
const TIPO_DE_AIRTABLE: [RegExp, TipoProveedor][] = [
  [/hotel|alojamiento|hostal|resort/, 'hotel'],
  [/mayorista/, 'mayorista'],
  [/operador|dmc|receptivo/, 'operador'],
  [/parque/, 'parque'],
  [/lancha|nautic|embarcacion|yate|catamaran/, 'lancha'],
  [/transporte|traslado|terrestre/, 'transporte'],
  [/actividad|tour|excursion|experiencia|plan/, 'actividad'],
]

/** Nombres que son hotel sin dudar. */
const ES_HOTEL = /\b(hotel|hoteles|hostal|hostel|resort|apartahotel|aparta hotel|posada|lodge|glamping|inn|suites)\b/
const CADENAS_HOTEL = /\b(decameron|hilton|marriott|sheraton|iberostar|riu|barcelo|ghl|estelar|movich|sonesta|hyatt|intercontinental|holiday inn|radisson|melia|ibis|dann carlton|hampton|wyndham|catalonia|occidental|royalton|hard rock|dreams|secrets|bahia principe|nh)\b/

/** Del nombre, solo lo que no admite duda; lo demás «otro» y a revisión. */
function tipoDelNombre(nombre: string): { tipo: TipoProveedor; seguro: boolean } {
  const n = llano(nombre)
  if (ES_HOTEL.test(n) || CADENAS_HOTEL.test(n)) return { tipo: 'hotel', seguro: true }
  for (const [re, t] of TIPO_DE_AIRTABLE) if (t !== 'hotel' && re.test(n)) return { tipo: t, seguro: false }
  return { tipo: 'otro', seguro: false }
}

function estrellasDe(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(texto(v))
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null
}

function booleano(v: unknown): boolean {
  return v === true || (typeof v === 'string' && /^(si|sí|true|1|x|yes)$/i.test(v.trim()))
}

const recorta = (s: string | null, n: number) => (s ? s.slice(0, n) : null)

// ── Preparar ─────────────────────────────────────────────────────────────────

export function prepararImportacion(
  filas: readonly FilaAirtable[],
  opts: { conocidos?: readonly ConocidoImportacion[]; decisiones?: Decisiones } = {},
): Importacion {
  const revision: NotaRevision[] = []
  const proveedores: ProveedorImportado[] = []
  const conocidos = opts.conocidos ?? []
  const decisiones = opts.decisiones ?? {}
  const nota = (rec: string, nombre: string, motivo: string, excluida = false) => revision.push({ rec, nombre, motivo, excluida })
  /** Lo ya aceptado de esta misma importación, por llave, para detectar filas repetidas. */
  const yaEnLaEntrada = new Map<string, string>()

  for (const f of filas) {
    const rec = typeof f.id === 'string' ? f.id.trim() : ''
    const nombre = texto(f['Nombre proveedor'])?.replace(/\s+/g, ' ').slice(0, 200) ?? ''
    if (!rec) {
      nota('(sin id)', nombre || '(sin nombre)', 'Fila sin id de Airtable: no se puede reimportar sin duplicar', true)
      continue
    }
    if (!nombre) {
      nota(rec, '(sin nombre)', 'Sin «Nombre proveedor»', true)
      continue
    }

    // Tipo.
    const deAirtable = lista(f['Tipo Proveedor'])
      .map((t) => TIPO_DE_AIRTABLE.find(([re]) => re.test(llano(t)))?.[1])
      .filter((t): t is TipoProveedor => !!t)
    let tipoProveedor: TipoProveedor
    if (deAirtable.length > 0) {
      tipoProveedor = deAirtable[0]
      if (new Set(deAirtable).size > 1) nota(rec, nombre, `Varios tipos en Airtable (${[...new Set(deAirtable)].join(', ')}): se tomó «${tipoProveedor}»`)
    } else {
      const inferido = tipoDelNombre(nombre)
      tipoProveedor = inferido.tipo
      if (!inferido.seguro) {
        nota(rec, nombre, inferido.tipo === 'otro' ? 'Sin tipo en Airtable: quedó «otro»' : `Sin tipo en Airtable: se tomó «${inferido.tipo}» por el nombre`)
      }
    }
    const espacio = espacioDeTipo(tipoProveedor)

    // Ubicación y contacto.
    const ubic = parsearUbicacion(texto(f['Ubicación']))
    if (ubic.dudosa) nota(rec, nombre, ubic.dudosa)
    const cel = normalizarCelular(texto(f['Celular/Whatsapp']), ubic.pais ?? 'CO')
    if (cel.original && !cel.e164) nota(rec, nombre, `Celular sin entender: «${cel.original}» (queda el original)`)
    const correoCrudo = texto(f['Correo contacto/Reserva'])
    const correos = correosDeTexto(correoCrudo)
    if (correoCrudo && !correos.correo) nota(rec, nombre, `Correo sin entender: «${correoCrudo.slice(0, 80)}»`)

    const tarifarios: TarifarioImportado[] = adjuntos(f['Portafolio/Tarifas Vigentes']).map((a) => {
      const vig = vigenciaDeNombre(a.filename)
      return {
        nombreArchivo: (a.filename as string).slice(0, 300),
        bytes: typeof a.size === 'number' && a.size > 0 ? Math.round(a.size) : null,
        mime: typeof a.type === 'string' ? a.type.slice(0, 120) : null,
        desde: vig?.desde ?? null,
        hasta: vig?.hasta ?? null,
        inferida: !!vig,
        origenRef: `${rec}:${a.filename}`.slice(0, 400),
      }
    })
    const documentos = adjuntos(f['Documentos/Certificaciones']).map((a) => a.filename as string)

    const extras = [
      correos.otros.length > 0 ? `Otros correos: ${correos.otros.join(', ')}` : null,
      correoCrudo && !correos.correo ? `Correo como venía: ${correoCrudo}` : null,
      documentos.length > 0 ? `Documentos en Airtable (por subir): ${documentos.join(', ')}` : null,
    ].filter(Boolean)
    const notas = [texto(f['Notas/Observaciones']), ...extras].filter(Boolean).join('\n\n') || null

    // ¿Con qué ficha se une?
    const clavePropia = claveDeProveedor(nombre, ubic.ciudad)
    let clave = clavePropia
    let claveAlias: string | null = null
    let union: string | null = null
    const decision = decisiones[rec]
    const delEspacio = conocidos.filter((c) => c.tipo === espacio)
    const porRef = conocidos.find((c) => c.origen_ref === rec)
    if (porRef) {
      clave = porRef.clave_perfil
      union = 'origen_ref'
    } else if (decision && decision !== 'nuevo') {
      clave = decision
      union = 'decisión'
    } else if (decision !== 'nuevo') {
      const exacto = delEspacio.find((c) => c.clave === clavePropia)
      if (exacto) {
        clave = exacto.clave_perfil
        union = 'llave'
      } else if (espacio !== 'proveedor') {
        const nombres: NombreConocido[] = delEspacio.map((c) => ({ tipo: espacio, clave: c.clave, clavePerfil: c.clave_perfil, nombre: c.nombre, ciudad: c.ciudad }))
        const r = reconocer({ tipo: espacio, clave: claveDeFoto(espacio, nombre, ubic.ciudad), nombre, ciudad: ubic.ciudad }, nombres, { preguntarDudas: true })
        if (r.tipo === 'seguro' || r.tipo === 'exacto') {
          clave = r.clavePerfil
          union = 'mismas palabras'
        } else if (r.tipo === 'duda') {
          nota(rec, nombre, `¿Es el mismo que «${r.nombre}»${r.ciudad ? ` (${r.ciudad})` : ''}? Decide: "${rec}": "${r.clavePerfil}" para unir, o "${rec}": "nuevo"`, true)
          continue
        }
      }
    }
    if (union && clave !== clavePropia && espacio !== 'proveedor') claveAlias = clavePropia

    // Repetida dentro de la misma importación.
    const k = `${espacio}:${clave}`
    const otra = yaEnLaEntrada.get(k)
    if (otra) {
      nota(rec, nombre, `Repetido en Airtable con ${otra} (misma llave «${clave}»): no se importa`, true)
      continue
    }
    if (!union && espacio !== 'proveedor') {
      const previos: NombreConocido[] = proveedores
        .filter((p) => p.espacio === espacio)
        .map((p) => ({ tipo: espacio, clave: p.clave, clavePerfil: p.clave, nombre: p.nombre, ciudad: p.ciudad }))
      const r = reconocer({ tipo: espacio, clave, nombre, ciudad: ubic.ciudad }, previos, { preguntarDudas: true })
      if (r.tipo === 'seguro') {
        nota(rec, nombre, `Parece el mismo que ${proveedores.find((p) => p.clave === r.clavePerfil)?.origenRef} en Airtable: no se importa`, true)
        continue
      }
    }
    yaEnLaEntrada.set(k, rec)

    proveedores.push({
      origenRef: rec.slice(0, 100),
      nombre,
      tipoProveedor,
      espacio,
      clave,
      claveAlias,
      ciudad: recorta(ubic.ciudad, 120),
      pais: ubic.pais,
      estrellas: estrellasDe(f['Categoria/Servicio']),
      web: normalizarWeb(texto(f['Website'])),
      contacto: recorta(texto(f['Persona Contacto']), 200),
      celular: cel.e164,
      celularOriginal: recorta(cel.original, 120),
      correo: correos.correo && correos.correo.length <= 200 ? correos.correo : null,
      telefono: recorta(texto(f['Telefono']), 120),
      direccion: recorta(texto(f['Dirección/Ubicación']), 300),
      notas: recorta(notas, 20000),
      etiquetas: normalizarEtiquetas(lista(f['Segmentos/Perfiles'])),
      tarifasMayorista: booleano(f['Tarifas Mayorista']),
      tarifarios,
      documentos,
      union,
    })
  }
  return { proveedores, revision }
}

// ── SQL ──────────────────────────────────────────────────────────────────────

/** Literal SQL seguro (comillas dobladas, sin barras especiales: standard_conforming_strings). */
export function lit(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return `'${v.replace(/\0/g, '').replace(/'/g, "''")}'`
}

function arr(v: readonly string[]): string {
  return v.length === 0 ? `'{}'::text[]` : `ARRAY[${v.map(lit).join(', ')}]::text[]`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function comentario(s: string): string {
  return s.replace(/[\r\n]+/g, ' ')
}

/**
 * El SQL idempotente para el workspace (`uuid` o slug). Correrlo dos veces deja lo mismo.
 */
export function sqlDeImportacion(imp: Importacion, workspace: string): string {
  const ws = UUID.test(workspace) ? `${lit(workspace.toLowerCase())}::uuid` : `(SELECT id FROM public.workspaces WHERE slug = ${lit(workspace)})`
  const l: string[] = []
  l.push('-- Importación de proveedores desde Airtable (scripts/importar-proveedores-airtable.ts).')
  l.push(`-- Proveedores: ${imp.proveedores.length}. En revisión: ${imp.revision.length} (excluidos: ${imp.revision.filter((r) => r.excluida).length}).`)
  l.push('-- Idempotente: une por origen_ref o por la llave; en una ficha existente solo llena lo vacío.')
  if (imp.revision.length > 0) {
    l.push('--')
    l.push('-- REVISAR:')
    for (const r of imp.revision) l.push(`--   ${r.excluida ? '[NO SE IMPORTA] ' : ''}${r.rec} «${comentario(r.nombre)}»: ${comentario(r.motivo)}`)
  }
  l.push('')
  l.push('DO $__TAG__$')
  l.push('DECLARE')
  l.push(`  ws uuid := ${ws};`)
  l.push('  pid uuid;')
  l.push('  otra_ref text;')
  l.push('  creados int := 0;')
  l.push('  unidos int := 0;')
  l.push('  saltados int := 0;')
  l.push('  tarifarios int := 0;')
  l.push('  n int;')
  l.push('BEGIN')
  l.push(`  IF ws IS NULL THEN RAISE EXCEPTION 'No existe el workspace ${workspace.replace(/'/g, '')}'; END IF;`)
  for (const p of imp.proveedores) {
    l.push('')
    l.push(`  -- ${p.origenRef} «${comentario(p.nombre)}» (${p.tipoProveedor})${p.union ? ` · une por ${p.union}` : ''}`)
    l.push('  pid := NULL; otra_ref := NULL;')
    l.push(`  SELECT id INTO pid FROM public.fotos_perfiles WHERE workspace_id = ws AND origen_ref = ${lit(p.origenRef)};`)
    l.push('  IF pid IS NULL THEN')
    l.push(`    SELECT id, origen_ref INTO pid, otra_ref FROM public.fotos_perfiles WHERE workspace_id = ws AND tipo = ${lit(p.espacio)} AND clave = ${lit(p.clave)};`)
    l.push('  END IF;')
    l.push(`  IF pid IS NOT NULL AND otra_ref IS NOT NULL AND otra_ref <> ${lit(p.origenRef)} THEN`)
    l.push(`    RAISE NOTICE '% ya es la ficha de %: se salta', ${lit(p.origenRef)}, otra_ref;`)
    l.push('    saltados := saltados + 1;')
    l.push('    pid := NULL;')
    l.push('  ELSIF pid IS NULL THEN')
    l.push('    INSERT INTO public.fotos_perfiles (workspace_id, tipo, clave, nombre, ciudad, tipo_proveedor, pais, estrellas, web, contacto_nombre,')
    l.push('      celular, celular_original, correo, telefono, direccion, notas, etiquetas, tarifas_mayorista, origen, origen_ref)')
    l.push(
      `    VALUES (ws, ${lit(p.espacio)}, ${lit(p.clave)}, ${lit(p.nombre)}, ${lit(p.ciudad)}, ${lit(p.tipoProveedor)}, ${lit(p.pais)}, ${lit(p.estrellas)}, ${lit(p.web)}, ${lit(p.contacto)},`,
    )
    l.push(
      `      ${lit(p.celular)}, ${lit(p.celularOriginal)}, ${lit(p.correo)}, ${lit(p.telefono)}, ${lit(p.direccion)}, ${lit(p.notas)}, ${arr(p.etiquetas)}, ${lit(p.tarifasMayorista)}, 'importacion', ${lit(p.origenRef)})`,
    )
    l.push('    RETURNING id INTO pid;')
    l.push('    creados := creados + 1;')
    l.push('  ELSE')
    l.push('    UPDATE public.fotos_perfiles SET')
    l.push(`      origen_ref = coalesce(origen_ref, ${lit(p.origenRef)}),`)
    for (const [col, v] of [
      ['pais', lit(p.pais)],
      ['estrellas', lit(p.estrellas)],
      ['web', lit(p.web)],
      ['contacto_nombre', lit(p.contacto)],
      ['celular', lit(p.celular)],
      ['celular_original', lit(p.celularOriginal)],
      ['correo', lit(p.correo)],
      ['telefono', lit(p.telefono)],
      ['direccion', lit(p.direccion)],
      ['notas', lit(p.notas)],
    ] as const) {
      if (v !== 'NULL') l.push(`      ${col} = coalesce(${col}, ${v}),`)
    }
    if (p.etiquetas.length > 0) l.push(`      etiquetas = ARRAY(SELECT DISTINCT e FROM unnest(etiquetas || ${arr(p.etiquetas)}) e ORDER BY e),`)
    if (p.tarifasMayorista) l.push('      tarifas_mayorista = true,')
    l.push('      updated_at = now()')
    l.push('    WHERE id = pid;')
    l.push('    unidos := unidos + 1;')
    l.push('  END IF;')
    if (p.claveAlias || p.tarifarios.length > 0) {
      l.push('  IF pid IS NOT NULL THEN')
      if (p.claveAlias) {
        l.push('    INSERT INTO public.fotos_perfiles_alias (workspace_id, perfil_id, tipo, clave, nombre, ciudad)')
        l.push(`    SELECT ws, pid, ${lit(p.espacio)}, ${lit(p.claveAlias)}, ${lit(p.nombre)}, ${lit(p.ciudad)}`)
        l.push(`    WHERE NOT EXISTS (SELECT 1 FROM public.fotos_perfiles_alias WHERE workspace_id = ws AND tipo = ${lit(p.espacio)} AND clave = ${lit(p.claveAlias)})`)
        l.push(`      AND NOT EXISTS (SELECT 1 FROM public.fotos_perfiles WHERE workspace_id = ws AND tipo = ${lit(p.espacio)} AND clave = ${lit(p.claveAlias)});`)
      }
      for (const t of p.tarifarios) {
        l.push('    INSERT INTO public.proveedor_tarifarios (workspace_id, proveedor_id, nombre_archivo, bytes, mime, vigente_desde, vigente_hasta, vigencia_inferida, origen, origen_ref)')
        l.push(
          `    VALUES (ws, pid, ${lit(t.nombreArchivo)}, ${lit(t.bytes)}, ${lit(t.mime)}, ${t.desde ? `${lit(t.desde)}::date` : 'NULL'}, ${t.hasta ? `${lit(t.hasta)}::date` : 'NULL'}, ${lit(t.inferida)}, 'importacion', ${lit(t.origenRef)})`,
        )
        l.push('    ON CONFLICT (workspace_id, origen_ref) WHERE origen_ref IS NOT NULL DO NOTHING;')
        l.push('    GET DIAGNOSTICS n = ROW_COUNT; tarifarios := tarifarios + n;')
      }
      l.push('  END IF;')
    }
  }
  l.push('')
  l.push(`  RAISE NOTICE 'Proveedores: % creados, % unidos a una ficha que ya estaba, % saltados. Tarifarios nuevos: %', creados, unidos, saltados, tarifarios;`)
  l.push('END')
  l.push('$__TAG__$;')
  l.push('')
  // La etiqueta del bloque no puede aparecer en ningún dato (un nombre con «$importar$» lo cortaría).
  const cuerpo = l.join('\n')
  let tag = 'importar'
  for (let i = 1; cuerpo.includes(`$${tag}$`); i++) tag = `importar${i}`
  return cuerpo.replaceAll('$__TAG__$', `$${tag}$`)
}

/** La consulta de SOLO LECTURA que da los nombres conocidos del espacio (para `--conocidos`). */
export function consultaConocidos(workspace: string): string {
  const ws = UUID.test(workspace) ? `${lit(workspace.toLowerCase())}::uuid` : `(SELECT id FROM public.workspaces WHERE slug = ${lit(workspace)})`
  return `SELECT coalesce(json_agg(x), '[]'::json) FROM (
  SELECT p.tipo, p.clave, p.clave AS clave_perfil, p.nombre, p.ciudad, p.origen_ref
    FROM public.fotos_perfiles p WHERE p.workspace_id = ${ws}
  UNION ALL
  SELECT a.tipo, a.clave, p.clave, a.nombre, a.ciudad, NULL
    FROM public.fotos_perfiles_alias a JOIN public.fotos_perfiles p ON p.id = a.perfil_id WHERE a.workspace_id = ${ws}
  UNION ALL
  SELECT DISTINCT ON (f.tipo, f.clave) f.tipo, f.clave, f.clave, f.nombre, f.ciudad, NULL
    FROM public.fotos_catalogo f
   WHERE f.workspace_id = ${ws} AND f.tipo IN ('hotel', 'actividad')
     AND NOT EXISTS (SELECT 1 FROM public.fotos_perfiles p WHERE p.workspace_id = f.workspace_id AND p.tipo = f.tipo AND p.clave = f.clave)
) x;`
}
