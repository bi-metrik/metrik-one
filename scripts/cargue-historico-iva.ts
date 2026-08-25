/**
 * Cargue histórico Devolución de IVA → SOENA ONE.
 *
 * Diferencia con `cargue-iva-batch.ts` (que cargó los 8 casos de junio): allí la etapa,
 * el responsable y los bloques a sembrar estaban HARDCODEADOS a la fase IVA. Aquí cada
 * caso entra en SU etapa, con SU responsable y los bloques que su etapa implica.
 *
 * El input trae rutas EXPLÍCITAS de los documentos, clasificados abriéndolos (no por
 * regex sobre el nombre del archivo). Ver proyectos/soena/ve/cargue-iva-2026-07/README.md.
 *
 * Uso:
 *   npx tsx scripts/cargue-historico-iva.ts <input.json> --dry-run
 *   npx tsx scripts/cargue-historico-iva.ts <input.json> --dry-run --probar-extraccion
 *   npx tsx scripts/cargue-historico-iva.ts <input.json> --solo V0127,V0128
 *   npx tsx scripts/cargue-historico-iva.ts <input.json> --limit 10
 *   npx tsx scripts/cargue-historico-iva.ts <input.json> --con-cobros      (default: NO)
 *
 * Idempotente por `negocios.metadata.id_hubspot`: re-correr no duplica.
 */
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { extractFieldsFromDocument, type CampoExtraccion, type CampoResultado } from '../src/lib/ai/extract-fields'
import { createDriveFolder, uploadFileToDrive, setFilePublicByLink } from '../src/lib/google-drive'
import { generarFormularioCore } from '../src/lib/actions/formulario-actions'
import { nitSinDv, calcularDvNit } from '../src/lib/dian/nit'
import { asignarResponsable } from '../src/lib/negocios/responsable-rol'
import { canonizarSeccional } from '../src/lib/dian/seccionales'

for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const GEMINI = process.env.GEMINI_API_KEY || ''
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as unknown as SupabaseClient

const ARCHIVE = '1eOdIGxDB7KCecDQLnhvPtyo47rrPQ5t3'
const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const LINEA = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
const FUENTE = 'historico_iva_2026_07'
const ASSIGNED_BY = '8b60b7aa-b62a-4beb-a6b8-d2ba1d96282b' // profiles.id (Jessica) — solo para negocio_responsables.assigned_by

/** Bloques donde viven los documentos fuente. */
const DOC = {
  factura:   'f2227f75-37e0-4ff9-8e78-0038f0c9c4c6', // Validación
  rut:       'b734032c-19ca-4084-8664-ed2e3036b648', // Documentación
  upme:      '989f3bca-3d72-4470-94c9-9e1da7f267eb', // Certificación
  cert:      '5d744172-172f-406b-8da6-4a126eb70ed3', // Anexos (se movió el 2026-07-24)
  // Los dos de Inclusión: solo los traen los casos que entran por esa etapa, porque
  // son justo lo que la UPME pide para incluir un vehículo que aún no está registrado.
  ficha:     '4821f586-742c-4f05-a463-1c9fe0a4c19a', // Inclusión — ficha técnica
  emisiones: 'c730288e-a974-4bd4-a075-b5467df6f92e', // Inclusión — certificado de emisiones (CEPD)
}
/** Bloques de datos que gobiernan gates y routing. */
const DATO = {
  registro_upme:        'f859733c-1c38-49a5-b90e-0d145563043b',
  numero_solicitantes:  'b52fb2f7-88e4-44fd-b857-4e6d6386e234',
  tipo_de_solicitante:  'a563908d-8b30-4dd7-a726-159b1a6f4abe',
  confirmar_tarifa:     '3ea01228-d825-44ac-8a31-d031faf69b5a',
  certificacion_upme:   '85e254b8-227d-41df-abcc-e79c1ef7d6e2',
  devolucion_de_iva:    '07068eb5-8f0c-4eb4-a47d-e245515eb33f',
  titularidad:          'a6a0732b-a427-499c-b806-15d68608cb24',
  cita_dian_requerida:  'd482cdf1-bf01-4820-87fe-d16986f8fa41',
  vehiculos:            'fc3550b7-68c3-4d7f-80f5-7cca876072fc',
  solicitantes:         'b753555b-ad88-4955-a983-ad45da35f920',
  radicado_cert:        'a338513e-fdd4-41a6-8ded-ec11cb91690c',
  // El radicado de INCLUSIÓN no es el de certificación: son dos trámites y dos bloques.
  // Meter el de inclusión en `radicado_cert` deja el dato en una etapa que el caso no ha
  // alcanzado (Cargue, orden 7) y deja vacío el gate que sí está abierto.
  decision_inclusion:   'c7a8959b-e105-4109-b49b-c23eb8f47036',
  radicado_incl:        '90a12ede-7310-4f41-b2ce-7c850bd0326c',
  servicio_contratado:  '20ede2cd-9647-4c8f-b149-fd49be53620e',
  confirmacion_cargue:  'b9d634bd-584c-4c83-ae57-a730cec402b6',
  comprobante_pago:     'e306f492-890a-47be-a223-c83ea62ef917',
  propuesta:            '7620b095-3b47-475f-9f95-b6bb3df8607a',
}
/** Formularios DIAN: solo se generan si el caso ya está en Generación o Envío. */
const FORMS_GEN = ['e0e92bdb-b6f3-48db-b9f8-26044be02b67', '02872b67-fb16-4620-9705-177314b0adf4', 'f2878f39-5f3a-4067-abe2-3d15ba1a1c03', '123b34e1-11bf-4965-9bff-b1ed29013782']
const FORMS_ENV = ['8d70eb69-d35b-4918-8b80-5d2656b33412', 'f00645a5-c0d1-414c-b03b-d0dfdf8bc45c', '649b426c-01b8-4b56-8c13-b49100b01a75', '2f7c6a0b-ad61-48c4-97d7-fd0289014d15']
const ES_010 = new Set(['e0e92bdb-b6f3-48db-b9f8-26044be02b67', '8d70eb69-d35b-4918-8b80-5d2656b33412'])

const DIVIPOLA: Record<string, string> = { 'bogota':'11','bogota d.c.':'11','bogota dc':'11','cundinamarca':'25','antioquia':'05','valle del cauca':'76','valle':'76','atlantico':'08','santander':'68','bolivar':'13','risaralda':'66','caldas':'17','tolima':'73','meta':'50','huila':'41','narino':'52','cauca':'19','boyaca':'15','norte de santander':'54','cordoba':'23','magdalena':'47','quindio':'63','cesar':'20','sucre':'70','caqueta':'18' }
const noac = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const C_RUT: CampoExtraccion[] = [
  { slug:'nit',label:'NIT',tipo:'texto',required:true,normalizar:'nit_sin_dv',descripcion_ai:'NIT SIN dígito de verificación (casilla 5). Solo dígitos.' },
  { slug:'dv',label:'DV',tipo:'texto',required:true,normalizar:'dv_desde_nit',normalizar_desde:'nit',descripcion_ai:'Dígito de verificación (casilla 6). Un dígito.' },
  { slug:'razon_social',label:'Razón social',tipo:'texto',required:true,descripcion_ai:'Nombres y apellidos del contribuyente (casillas 31 a 35). Persona natural: concatenar primer apellido, segundo apellido, primer nombre, otros nombres.' },
  { slug:'numero_identificacion',label:'No. id',tipo:'texto',required:true,descripcion_ai:'Número de identificación de la casilla 26 (documento real). Solo dígitos. NO truncar.' },
  { slug:'tipo_documento',label:'Tipo doc',tipo:'texto',required:false,descripcion_ai:'Tipo de documento (casilla 25).' },
  { slug:'direccion_seccional',label:'Dir seccional',tipo:'texto',required:true,descripcion_ai:'Nombre de la dirección seccional DIAN (renglón 12).' },
  { slug:'direccion',label:'Dirección',tipo:'texto',required:true,descripcion_ai:'Dirección de notificación (renglón 41), íntegra.' },
  { slug:'telefono',label:'Teléfono',tipo:'texto',required:false,descripcion_ai:'Teléfono (renglón 44).' },
  { slug:'email',label:'Email',tipo:'texto',required:false,descripcion_ai:'Correo electrónico (renglón 42).' },
  { slug:'municipio',label:'Municipio',tipo:'texto',required:false,descripcion_ai:'Municipio del domicilio fiscal.' },
  { slug:'departamento',label:'Departamento',tipo:'texto',required:false,descripcion_ai:'Departamento del domicilio fiscal.' },
  { slug:'pais',label:'País',tipo:'texto',required:false,descripcion_ai:'País del domicilio fiscal.' },
  { slug:'primer_apellido',label:'1er apellido',tipo:'texto',required:false,descripcion_ai:'Primer apellido (casilla 31). Vacío si jurídica.' },
  { slug:'segundo_apellido',label:'2do apellido',tipo:'texto',required:false,descripcion_ai:'Segundo apellido (casilla 32).' },
  { slug:'primer_nombre',label:'1er nombre',tipo:'texto',required:false,descripcion_ai:'Primer nombre (casilla 33).' },
  { slug:'otros_nombres',label:'Otros nombres',tipo:'texto',required:false,descripcion_ai:'Otros nombres (casilla 34).' },
  { slug:'codigo_pais',label:'Cód país',tipo:'texto',required:false,descripcion_ai:'Código país (casilla 26 del domicilio). Colombia=169.' },
  { slug:'codigo_departamento',label:'Cód depto',tipo:'texto',required:false,descripcion_ai:'Código departamento (casilla 27).' },
  { slug:'codigo_municipio',label:'Cód municipio',tipo:'texto',required:false,descripcion_ai:'Código municipio (casilla 28, DIVIPOLA).' },
]
const C_FACTURA: CampoExtraccion[] = [
  { slug:'tipo_vehiculo',label:'Tipo',tipo:'texto',required:true,descripcion_ai:'Tipo de vehículo: eléctrico o híbrido.' },
  { slug:'marca',label:'Marca',tipo:'texto',required:true,descripcion_ai:'Marca del vehículo.' },
  { slug:'linea',label:'Línea',tipo:'texto',required:true,descripcion_ai:'Línea o modelo comercial del vehículo.' },
  { slug:'modelo',label:'Modelo',tipo:'texto',required:false,descripcion_ai:'Año modelo del vehículo.' },
  { slug:'cantidad',label:'Cantidad',tipo:'texto',required:false,descripcion_ai:'Cantidad de vehículos facturados.' },
  { slug:'valor_unitario_sin_iva',label:'Valor sin IVA',tipo:'currency',required:true,descripcion_ai:'Valor unitario SIN IVA en COP (subtotal antes de impuestos). Solo números.' },
  { slug:'proveedor',label:'Proveedor',tipo:'texto',required:true,descripcion_ai:'Razón social legal del emisor/vendedor (no el nombre comercial).' },
  { slug:'numero_factura',label:'No. Factura',tipo:'texto',required:false,descripcion_ai:'Número de la factura electrónica, con su prefijo alfabético completo.' },
  { slug:'fecha_factura',label:'Fecha',tipo:'fecha',required:false,descripcion_ai:'Fecha de emisión (YYYY-MM-DD).' },
  { slug:'valor_iva',label:'IVA',tipo:'currency',required:false,descripcion_ai:'Valor total del IVA en COP. Solo números.' },
  { slug:'nit_proveedor',label:'NIT prov',tipo:'texto',required:false,normalizar:'nit_sin_dv',descripcion_ai:'NIT del emisor, solo dígitos, sin DV.' },
  { slug:'ciudad_venta',label:'Ciudad venta',tipo:'texto',required:false,alerta_revision:true,descripcion_ai:'Ciudad donde se facturó. NO sustituir por la capital del departamento.' },
]
const C_CERT: CampoExtraccion[] = [
  { slug:'entidad_financiera',label:'Entidad',tipo:'texto',required:true,descripcion_ai:'Banco que emite el certificado.' },
  { slug:'numero_cuenta',label:'No cuenta',tipo:'texto',required:true,descripcion_ai:'Número de cuenta, solo dígitos.' },
  { slug:'tipo_cuenta',label:'Tipo cuenta',tipo:'texto',required:true,descripcion_ai:'Ahorros o Corriente.' },
  { slug:'fecha_expedicion',label:'Fecha exp',tipo:'fecha',required:false,descripcion_ai:'Fecha de expedición (YYYY-MM-DD).' },
]
const C_UPME: CampoExtraccion[] = [
  { slug:'numero_caso_upme',label:'Caso',tipo:'texto',required:true,descripcion_ai:'Número de radicado UPME, formato VEH_GEE seguido de dígitos.' },
  { slug:'nombre_certificado',label:'Nombre',tipo:'texto',required:true,descripcion_ai:'Nombre/razón social del beneficiario (Dueño del Proyecto).' },
  { slug:'numero_identificacion_certificado',label:'No id',tipo:'texto',required:true,descripcion_ai:'Cédula/NIT del beneficiario, solo dígitos.' },
  { slug:'marca_certificado',label:'Marca',tipo:'texto',required:true,descripcion_ai:'Marca del vehículo en BIENES APROBADOS.' },
  { slug:'linea_modelo_certificado',label:'Línea',tipo:'texto',required:true,descripcion_ai:'Línea y modelo del vehículo en BIENES APROBADOS, exacto (incluye el año).' },
  { slug:'valor_total',label:'Valor total',tipo:'currency',required:false,descripcion_ai:'Valor total de la inversión aprobada.' },
]

type Campos = Record<string, CampoResultado>
type Fila = {
  id_hubspot: string; nombre: string; nombre_negocio: string; codigo: string
  celular: string; correo: string; cedula: string
  rut: string | null; factura: string | null; upme: string | null; cert_bancario: string | null
  ficha?: string | null; emisiones?: string | null
  marca: string | null; linea: string | null; anio: string | number | null
  comercial: string | null; responsable_staff_id: string | null; responsable_nombre: string | null
  tarifa_con_iva: number | null; primer_pago: number | null; ref_anticipo: string
  segundo_pago: number | null; ref_segundo: string
  radicado_upme: string | null; seccional: string | null; fecha_cita: string | null
  etapa: string; etapa_id: string; etapa_orden: number; stage: string; motivo_etapa: string
  /**
   * Campos opcionales para los casos que NO entran ya avanzados. Omitidos, el script se
   * comporta igual que en el cargue de julio/agosto (vehículo ya registrado en UPME,
   * servicio completo), que es lo que traían esos 189 casos.
   */
  cargado_upme?: 'si' | 'no'
  servicio?: 'completo' | 'solo_upme' | 'solo_iva'
  decision_incluir?: 'si' | 'no'
  radicado_inclusion?: string | null
}

const mimeOf = (p: string) => { const l = p.toLowerCase(); return l.endsWith('.png') ? 'image/png' : (l.endsWith('.jpg') || l.endsWith('.jpeg')) ? 'image/jpeg' : 'application/pdf' }
function descargar(remotePath: string, localPath: string) {
  execFileSync('rclone', ['copyto', `gdrive:${remotePath}`, localPath, '--drive-root-folder-id', ARCHIVE, '--low-level-retries', '5'], { stdio: 'pipe', timeout: 300_000 })
}
const PY_DECRYPT = `import sys
try:
 from pypdf import PdfReader,PdfWriter
except Exception:
 from PyPDF2 import PdfReader,PdfWriter
r=PdfReader(sys.argv[1])
if r.is_encrypted: r.decrypt(sys.argv[3])
w=PdfWriter()
for p in r.pages: w.add_page(p)
w.write(open(sys.argv[2],'wb'))`

/**
 * Réplica de `aplicarNormalizaciones` de `documento-actions.ts` (que no se puede importar:
 * ese archivo es 'use server' y solo exporta funciones async). Misma lógica y los MISMOS
 * helpers canónicos de `src/lib/dian/nit.ts`, así que no hay dos verdades del DV.
 *
 * Sin esto el NIT queda con el DV pegado (18498227 + 8 → "184982278") y los formularios
 * 010/1668 salen mal, que es justo el bug que cerró el PR #99. El script de junio no lo
 * hacía porque es anterior a ese fix.
 */
function aplicarNormalizaciones(campos: CampoExtraccion[], resultado: Campos): void {
  for (const campo of campos) {
    if (campo.normalizar === 'nit_sin_dv') {
      const cr = resultado[campo.slug]
      if (cr?.value) cr.value = nitSinDv(cr.value)
    }
  }
  for (const campo of campos) {
    if (campo.normalizar === 'dv_desde_nit') {
      const nitVal = resultado[campo.normalizar_desde ?? 'nit']?.value ?? null
      const dvCalc = calcularDvNit(nitVal)
      if (dvCalc != null) {
        const cr = resultado[campo.slug]
        if (cr) cr.value = dvCalc
        else resultado[campo.slug] = { value: dvCalc, confidence: 1, manual: false }
      }
    }
  }
}

/**
 * Una extracción "sin error" pero con los campos REQUERIDOS en null no sirve: es el caso
 * de los expedientes que son un paquete de varias páginas, donde la primera es una carta
 * del concesionario y la factura está más adentro. Gemini responde bien formado pero
 * vacío, no marca error, y sin este chequeo el fallback nunca se activaba.
 */
function faltanRequeridos(campos: CampoExtraccion[], data: Campos | null): boolean {
  if (!data) return true
  const req = campos.filter((c) => c.required)
  if (!req.length) return false
  const vacios = req.filter((c) => data[c.slug]?.value == null || data[c.slug]?.value === '').length
  return vacios > req.length / 2   // más de la mitad vacíos = no se leyó el documento
}

async function extraer(path: string, campos: CampoExtraccion[], password?: string): Promise<Campos> {
  let src = path
  let { data, error } = await extractFieldsFromDocument(readFileSync(src), mimeOf(src), campos, GEMINI)
  if (!error && faltanRequeridos(campos, data)) error = 'requeridos vacíos'
  // Certificados bancarios suelen venir CIFRADOS con la cédula del titular.
  if ((error || !data) && mimeOf(src) === 'application/pdf' && password) {
    const dec = src.replace(/\.[^.]+$/, '') + '_dec.pdf'
    try {
      execFileSync('python3', ['-c', PY_DECRYPT, src, dec, password], { stdio: 'pipe' })
      if (existsSync(dec)) {
        ;({ data, error } = await extractFieldsFromDocument(readFileSync(dec), 'application/pdf', campos, GEMINI))
        if (data && !error) { src = dec; console.log(`      (descifrado con cédula)`) }
      }
    } catch { /* sin pypdf o password incorrecto */ }
  }
  // Reintento del PDF completo: la extracción es inestable y falla de forma transitoria
  // (sobre el mismo documento se vio dar valor, null y otro valor en corridas seguidas).
  if (error || !data) {
    ;({ data, error } = await extractFieldsFromDocument(readFileSync(src), mimeOf(src), campos, GEMINI))
    if (!error && faltanRequeridos(campos, data)) error = 'requeridos vacíos'
    if (data && !error) console.log(`      (ok en reintento)`)
  }
  // PDFs escaneados que Gemini rechaza → páginas a PNG. Se prueban las primeras 4, NO
  // solo la 1: varios expedientes son paquetes donde la página 1 es una carta de
  // bienvenida del concesionario y la factura real vive en la 2 o la 3.
  if ((error || !data) && mimeOf(src) === 'application/pdf') {
    for (const pag of [1, 2, 3, 4]) {
      const png = src.replace(/\.[^.]+$/, '') + `_p${pag}`
      try {
        execFileSync('pdftoppm', ['-png', '-r', '200', '-f', String(pag), '-l', String(pag), '-singlefile', src, png], { stdio: 'pipe' })
        if (!existsSync(png + '.png')) break
        ;({ data, error } = await extractFieldsFromDocument(readFileSync(png + '.png'), 'image/png', campos, GEMINI))
        if (!error && faltanRequeridos(campos, data)) error = 'requeridos vacíos'
        if (data && !error) { console.log(`      (extraído vía PNG, página ${pag})`); break }
      } catch { break /* pdftoppm no disponible o no hay más páginas */ }
    }
  }
  if (error || !data) throw new Error(`extracción (${path.split('/').pop()}): ${error}`)
  aplicarNormalizaciones(campos, data)
  return data
}

const val = (c: Campos, k: string) => c[k]?.value ?? null

/** Un bloque "sembrado" sin dato real: marca el paso como superado por migración. */
const migrado = (negocioId: string, cfg: string, extra: Record<string, unknown> = {}) =>
  ({ negocio_id: negocioId, bloque_config_id: cfg, estado: 'completo', data: { _migrado: true, ...extra } })

async function procesar(f: Fila, opts: { conCobros: boolean }) {
  console.log(`\n=== ${f.codigo} · ${f.nombre} → ${f.etapa} (${f.motivo_etapa})`)
  const dir = `/tmp/cargue-iva/${f.id_hubspot}`; mkdirSync(dir, { recursive: true })

  // 1. descargar + extraer los documentos que tenga
  const local: Record<string, string> = {}
  for (const k of ['rut', 'factura', 'upme', 'cert_bancario', 'ficha', 'emisiones'] as const) {
    const rp = f[k]; if (!rp) continue
    const lp = join(dir, `${k}.${rp.split('.').pop()!.replace(/[^a-zA-Z0-9]/g, '') || 'pdf'}`)
    if (!existsSync(lp)) descargar(rp, lp)
    local[k] = lp
  }
  const rut = local.rut ? await extraer(local.rut, C_RUT) : null
  const fac = local.factura ? await extraer(local.factura, C_FACTURA) : null
  const cedulaRut = (rut && String(val(rut, 'numero_identificacion') ?? '')) || f.cedula || undefined
  const cert = local.cert_bancario ? await extraer(local.cert_bancario, C_CERT, cedulaRut).catch((e) => { console.warn('      cert bancario:', e.message); return null }) : null
  const upme = local.upme ? await extraer(local.upme, C_UPME) : null

  if (rut) {
    const dp = noac(String(val(rut, 'departamento') ?? ''))
    if (DIVIPOLA[dp]) rut.codigo_departamento = { value: DIVIPOLA[dp], confidence: 1, manual: false }
  }
  if (cert && cert.entidad_financiera?.value) {
    cert.entidad_financiera.value = String(cert.entidad_financiera.value).replace(/\s*S\.?\s*A\.?S?\.?\s*$/i, '').trim()
  }

  // 2. contacto (dedup por teléfono, luego por cédula)
  let contactoId: string | null = null
  if (f.celular) {
    const { data: ex } = await supabase.from('contactos').select('id').eq('workspace_id', WS).eq('telefono', f.celular).maybeSingle()
    if (ex) contactoId = (ex as { id: string }).id
  }
  if (!contactoId) {
    const { data, error } = await supabase.from('contactos')
      // `contactos` NO tiene columna `cedula`: la cédula del titular va en `custom_data`,
      // que es el punto de extensión de la tabla (ahí vive también `origen`). El cargue de
      // julio corrió con una versión anterior de esta línea; el `cedula:` suelto entró
      // después (#138) y nunca se ejerció contra el esquema real, así que reventaba los 70
      // casos en el paso 2 — antes de crear el negocio, por fortuna.
      .insert({ workspace_id: WS, nombre: f.nombre.toUpperCase(), telefono: f.celular || null, email: f.correo || (rut ? val(rut, 'email') : null), custom_data: cedulaRut ? { cedula: cedulaRut } : {} })
      .select('id').single()
    if (error) throw new Error(`contacto: ${error.message}`)
    contactoId = (data as { id: string }).id
  }

  // 3. negocio — idempotente por id_hubspot
  const { data: yaExiste } = await supabase.from('negocios').select('id').eq('workspace_id', WS).eq('metadata->>id_hubspot', f.id_hubspot).maybeSingle()
  if (yaExiste) { console.log(`  ↺ ya existe (${(yaExiste as { id: string }).id}), se salta`); return { codigo: f.codigo, saltado: true } }

  const { data: neg, error: nerr } = await supabase.from('negocios').insert({
    workspace_id: WS, linea_id: LINEA, contacto_id: contactoId, empresa_id: null,
    nombre: f.nombre_negocio, codigo: f.codigo,
    responsable_id: f.responsable_staff_id, etapa_actual_id: f.etapa_id, stage_actual: f.stage,
    estado: 'abierto', origen: 'otro',
    // La seccional se guarda CANONIZADA: el cargue de julio metió el texto del Excel
    // tal cual ("Bogota", "Medellin") y partió en dos cada ciudad del tablero, además
    // de dejar sin preset al 010. Ver `seccional-negocio.ts`.
    metadata: { id_hubspot: f.id_hubspot, fuente_cargue: FUENTE, seccional: canonizarSeccional(f.seccional) },
  }).select('id').single()
  if (nerr) throw new Error(`negocio: ${nerr.message}`)
  const negocioId = (neg as { id: string }).id
  if (f.responsable_staff_id) {
    // Vía el helper para que la fila nazca CON `rol`: el cargue de julio insertó sin él y
    // dejó 247 responsables invisibles para el routing de avisos (ver responsable-rol.ts).
    await asignarResponsable(supabase, {
      negocioId,
      staffId: f.responsable_staff_id,
      assignedBy: ASSIGNED_BY,
    })
  }

  // 4. carpeta Drive
  const { data: ln } = await supabase.from('lineas_negocio').select('drive_folder_id').eq('id', LINEA).maybeSingle()
  const { data: wsr } = await supabase.from('workspaces').select('drive_folder_id').eq('id', WS).single()
  const parent = (ln as { drive_folder_id: string | null } | null)?.drive_folder_id || (wsr as { drive_folder_id: string }).drive_folder_id
  const folderId = await createDriveFolder(`${f.codigo} - ${f.nombre}`, parent, WS)
  for (const sub of ['1. Legal', '2. Comercial', '3. UPME', '4. DIAN', '5. Otros']) { try { await createDriveFolder(sub, folderId, WS) } catch { /* ya existe */ } }
  await supabase.from('negocios').update({ carpeta_url: `https://drive.google.com/drive/folders/${folderId}` }).eq('id', negocioId)

  // 5. documentos → su bloque de origen
  const subir = async (cfg: string, path: string, fname: string, campos: Campos | null, estado = 'completo') => {
    let durl: string | null = null
    try {
      const up = await uploadFileToDrive(readFileSync(path), fname, mimeOf(path), folderId, WS)
      await setFilePublicByLink(up.fileId, WS); durl = up.webViewLink
    } catch (e) { console.warn(`      upload ${fname}:`, e instanceof Error ? e.message : e) }
    await supabase.from('negocio_bloques').insert({
      negocio_id: negocioId, bloque_config_id: cfg, estado,
      data: { campos: campos ?? {}, drive_url: durl, file_name: fname, _migrado: true, _extraction_status: campos ? 'ok' : 'no_key' },
    })
  }
  if (local.factura) await subir(DOC.factura, local.factura, 'Factura.pdf', fac)
  if (local.rut) await subir(DOC.rut, local.rut, 'RUT.pdf', rut)
  if (local.upme) await subir(DOC.upme, local.upme, 'Concepto UPME.pdf', upme)
  // El certificado bancario se vence a los 30 días (decisión 2026-07-24): se sube el
  // archivo para no perderlo, pero queda PENDIENTE — un humano valida vigencia.
  if (local.cert_bancario) await subir(DOC.cert, local.cert_bancario, 'Certificado bancario.pdf', cert, 'pendiente')
  if (local.ficha) await subir(DOC.ficha, local.ficha, 'Ficha técnica.pdf', null)
  if (local.emisiones) await subir(DOC.emisiones, local.emisiones, 'Certificado de emisiones.pdf', null)

  // 6. bloques de datos que gobiernan gates y routing
  const servicio = f.servicio ?? 'completo'
  const filas: Array<Record<string, unknown>> = [
    migrado(negocioId, DATO.registro_upme, { cargado_upme: f.cargado_upme ?? 'si' }),
    migrado(negocioId, DATO.numero_solicitantes, { numero_solicitantes: /[/]|\by\b/i.test(f.nombre) ? 2 : 1 }),
    migrado(negocioId, DATO.tipo_de_solicitante, { tipo_persona: 'natural' }),
    // `servicio_contratado` es la fuente: los dos toggles de abajo están declarados con
    // `lock_when` sobre él. Sin este bloque la pantalla los muestra derivados de nada, que
    // es la deuda que dejó el cargue de julio (ver 2026-08-03_9-casos-sin-servicio-contratado).
    migrado(negocioId, DATO.servicio_contratado, { servicio }),
    migrado(negocioId, DATO.certificacion_upme, { requiere_certificacion_upme: servicio !== 'solo_iva' }),
    migrado(negocioId, DATO.devolucion_de_iva, { requiere_devolucion_iva: servicio !== 'solo_upme' }),
    migrado(negocioId, DATO.titularidad, { modalidad_solicitante: 'unico' }),
    migrado(negocioId, DATO.cita_dian_requerida, { seccional_display: f.seccional ?? null, requiere_cita_dian: ['Bogota', 'Medellin', 'Cali', 'Bucaramanga'].includes(noac(f.seccional ?? '').replace(/^\w/, (c) => c.toUpperCase())) }),
    migrado(negocioId, DATO.confirmar_tarifa),
    migrado(negocioId, DATO.propuesta),
    migrado(negocioId, DATO.confirmacion_cargue),
    migrado(negocioId, DATO.comprobante_pago),
  ]
  if (f.radicado_upme) filas.push(migrado(negocioId, DATO.radicado_cert, { radicado_certificacion: f.radicado_upme }))
  if (f.decision_incluir) filas.push(migrado(negocioId, DATO.decision_inclusion, { decision_incluir: f.decision_incluir }))
  if (f.radicado_inclusion) filas.push(migrado(negocioId, DATO.radicado_incl, { radicado_inclusion: f.radicado_inclusion }))
  if (fac) filas.push(migrado(negocioId, DATO.vehiculos, {
    tipo_vehiculo: val(fac, 'tipo_vehiculo'), marca: val(fac, 'marca'), linea: val(fac, 'linea'),
    modelo: val(fac, 'modelo') ?? f.anio, cantidad: val(fac, 'cantidad') ?? 1,
    valor_unitario_sin_iva: val(fac, 'valor_unitario_sin_iva'), proveedor: val(fac, 'proveedor'),
  }))
  if (rut) filas.push(migrado(negocioId, DATO.solicitantes, {
    tipo_persona: 'natural', nombre_razon_social: val(rut, 'razon_social'),
    numero_identificacion: val(rut, 'numero_identificacion'), telefono: val(rut, 'telefono'),
    municipio: val(rut, 'municipio'), correo: val(rut, 'email'), direccion: val(rut, 'direccion'),
  }))
  const { error: berr } = await supabase.from('negocio_bloques').insert(filas)
  if (berr) console.warn('      bloques:', berr.message)

  // 7. cobros (opt-in) — mueven recaudo y EBITDA, por eso van apagados por defecto
  if (opts.conCobros && f.primer_pago) {
    const ref = f.ref_anticipo || null
    const dup = ref ? await supabase.from('cobros').select('id').eq('workspace_id', WS).eq('external_ref', ref).maybeSingle() : { data: null }
    if (dup.data) console.warn(`      cobro ${ref} ya existe, se salta`)
    else await supabase.from('cobros').insert({ workspace_id: WS, negocio_id: negocioId, monto: f.primer_pago, tipo_cobro: 'anticipo', external_ref: ref, fecha: null, notas: `Anticipo — cargue histórico ${FUENTE}` })
  }

  // 8. formularios DIAN solo si el caso ya está en Generación o Envío
  let forms = 0
  if (f.etapa === 'Generación' || f.etapa === 'Envío') {
    const cfgs = f.etapa === 'Envío' ? [...FORMS_GEN, ...FORMS_ENV] : FORMS_GEN
    for (const cfg of cfgs) {
      const initData = (ES_010.has(cfg) && f.seccional) ? { seccional: f.seccional } : {}
      const { data: inst, error } = await supabase.from('negocio_bloques').insert({ negocio_id: negocioId, bloque_config_id: cfg, estado: 'pendiente', data: initData }).select('id').single()
      if (error) { console.error('      instancia:', error.message); continue }
      const r = await generarFormularioCore(supabase, WS, ASSIGNED_BY, (inst as { id: string }).id, negocioId)
      if (r.success) forms++; else console.error('      form ✗', r.error)
    }
  }
  console.log(`  ✓ ${f.codigo} en ${f.etapa} · ${filas.length} bloques · ${forms} formularios · /negocios/${negocioId}`)
  return { codigo: f.codigo, negocioId, forms }
}

function plan(f: Fila) {
  const docs = (['factura', 'rut', 'upme', 'cert_bancario', 'ficha', 'emisiones'] as const).filter((k) => f[k])
  const upme = `upme=${f.cargado_upme ?? 'si'}`
  console.log(`${f.codigo}  ${f.nombre_negocio.slice(0, 42).padEnd(42)} → ${f.etapa.padEnd(14)} ${(f.seccional ?? '?').padEnd(12)} resp=${(f.responsable_nombre ?? '—').padEnd(16)} ${(f.servicio ?? 'completo').padEnd(9)} ${upme.padEnd(8)} docs=[${docs.join(',')}]`)
  if (docs.length < 3) console.log(`        ⚠ solo ${docs.length} documentos`)
}

async function main() {
  const args = process.argv.slice(2)
  const file = args[0]
  if (!file) { console.error('Falta el archivo de entrada'); process.exit(1) }
  const dryRun = args.includes('--dry-run')
  const conCobros = args.includes('--con-cobros')
  const probar = args.includes('--probar-extraccion')
  const limIdx = args.indexOf('--limit'); const limit = limIdx >= 0 ? Number(args[limIdx + 1]) : 0
  const soloIdx = args.indexOf('--solo'); const solo = soloIdx >= 0 ? new Set(args[soloIdx + 1].split(',')) : null

  let filas: Fila[] = JSON.parse(readFileSync(file, 'utf8'))
  if (solo) filas = filas.filter((f) => solo.has(f.codigo))
  if (limit) filas = filas.slice(0, limit)

  console.log(`Cargue histórico IVA · ${filas.length} casos · ${dryRun ? 'DRY-RUN (no escribe)' : 'EN VIVO'} · cobros=${conCobros ? 'SÍ' : 'no'}`)
  const porEtapa = filas.reduce<Record<string, number>>((a, f) => { a[f.etapa] = (a[f.etapa] ?? 0) + 1; return a }, {})
  console.log('Etapas:', Object.entries(porEtapa).map(([k, v]) => `${k}=${v}`).join(' · '), '\n')

  if (dryRun) {
    filas.forEach(plan)
    const sinDoc = filas.filter((f) => !f.factura || !f.rut).length
    console.log(`\nResumen: ${filas.length} casos · ${sinDoc} con menos de 2 documentos base`)
    if (probar && filas[0]) {
      console.log(`\n--- Prueba de extracción sobre ${filas[0].codigo} (no escribe en DB) ---`)
      const dir = `/tmp/cargue-iva/probe`; mkdirSync(dir, { recursive: true })
      for (const k of ['factura', 'rut'] as const) {
        const rp = filas[0][k]; if (!rp) continue
        const lp = join(dir, `${k}.pdf`); descargar(rp, lp)
        const campos = await extraer(lp, k === 'rut' ? C_RUT : C_FACTURA)
        console.log(`  ${k}:`, Object.entries(campos).slice(0, 6).map(([kk, vv]) => `${kk}=${vv?.value}`).join(' · '))
      }
    }
    return
  }

  const res = []
  for (const f of filas) {
    try { res.push(await procesar(f, { conCobros })) }
    catch (e) { console.error(`❌ ${f.codigo} ${f.nombre}:`, e instanceof Error ? e.message : e); res.push({ codigo: f.codigo, error: String(e) }) }
  }
  console.log('\n=== RESUMEN ===')
  const ok = res.filter((r) => 'negocioId' in r).length
  const salt = res.filter((r) => 'saltado' in r).length
  const err = res.filter((r) => 'error' in r)
  console.log(`  creados: ${ok} · saltados (ya existían): ${salt} · errores: ${err.length}`)
  for (const e of err) console.log('   ❌', e.codigo, (e as { error: string }).error.slice(0, 120))
}
main().catch((e) => { console.error(e); process.exit(1) })
