/**
 * Cargue Devolución de IVA → SOENA ONE (un caso). Crea contacto + negocio + carpeta
 * Drive (como la plataforma), siembra bloques fuente con extracción IA real, genera
 * 010/1668/Declaración/Relación con generarFormularioCore (herramienta real) y deja
 * el negocio en Envío. Idempotencia: este runner asume que el código ya fue reservado.
 *
 * Uso: npx tsx scripts/cargue-iva.ts   (ejecuta el caso piloto Paola, código V0013)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { extractFieldsFromDocument, type CampoExtraccion, type CampoResultado } from '../src/lib/ai/extract-fields'
import { createDriveFolder, uploadFileToDrive, setFilePublicByLink } from '../src/lib/google-drive'
import { generarFormularioCore } from '../src/lib/actions/formulario-actions'

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* noop */ }
}
loadEnv()
const GEMINI = process.env.GEMINI_API_KEY || ''
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
) as unknown as SupabaseClient

// ── constantes SOENA / línea VE ──────────────────────────────────────────────
const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const LINEA = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
const ENVIO_ETAPA = '45ebd464-b231-4c2a-9007-d283e623f766'  // orden 13, stage ejecucion
const JESSICA_STAFF = '36a53092-0377-41d3-9e52-7e006979692d'
const JESSICA_PROFILE = '8b60b7aa-b62a-4beb-a6b8-d2ba1d96282b'

// bloque_config_id de los 4 bloques FUENTE
const SRC = {
  factura: 'f2227f75-37e0-4ff9-8e78-0038f0c9c4c6',
  rut: 'b734032c-19ca-4084-8664-ed2e3036b648',
  cert: '5d744172-172f-406b-8da6-4a126eb70ed3',
  upme: '989f3bca-3d72-4470-94c9-9e1da7f267eb',
}
// formularios a generar: Generación (etapa 12, gate) + Envío (etapa 13, regenerables)
const FORMS: Array<[string, string]> = [
  ['formulario_dian', 'e0e92bdb-b6f3-48db-b9f8-26044be02b67'],
  ['formulario_1668', '02872b67-fb16-4620-9705-177314b0adf4'],
  ['declaracion_juramentada', 'f2878f39-5f3a-4067-abe2-3d15ba1a1c03'],
  ['relacion_de_facturas', '123b34e1-11bf-4965-9bff-b1ed29013782'],
  ['formulario_dian_envio', '8d70eb69-d35b-4918-8b80-5d2656b33412'],
  ['formulario_1668_envio', 'f00645a5-c0d1-414c-b03b-d0dfdf8bc45c'],
  ['declaracion_juramentada_envio', '649b426c-01b8-4b56-8c13-b49100b01a75'],
  ['relacion_de_facturas_envio', '2f7c6a0b-ad61-48c4-97d7-fd0289014d15'],
]
// gates previos a sembrar _migrado completo (datos/documento, sin data real)
const SEED_MIGRADO = [
  'f859733c-1c38-49a5-b90e-0d145563043b', // registro_upme (et1)
  '9630e4c7-6b38-4ff6-b5d9-f755181984b6', // pagos_anticipo (et5)
  'ee432524-b469-4d32-ab88-b4bfa7f9910d', // propuesta_firmada (et6)
  'e306f492-890a-47be-a223-c83ea62ef917', // comprobante_pago_upme (et6)
  'b9d634bd-584c-4c83-ae57-a730cec402b6', // confirmacion_de_cargue (et7)
  'a338513e-fdd4-41a6-8ded-ec11cb91690c', // radicado_de_certificacion (et8)
  '633aa6e8-f383-4165-9bbd-15a498a7c885', // pagos_cobro (et11)
]

// DIVIPOLA departamento (los del set 74; ampliar según haga falta)
const DIVIPOLA_DPTO: Record<string, string> = {
  'bogota': '11', 'bogota d.c.': '11', 'bogota dc': '11', 'cundinamarca': '25',
  'antioquia': '05', 'valle del cauca': '76', 'valle': '76', 'atlantico': '08',
  'santander': '68', 'bolivar': '13', 'risaralda': '66', 'caldas': '17',
  'tolima': '73', 'meta': '50', 'huila': '41', 'narino': '52', 'cauca': '19',
  'boyaca': '15', 'norte de santander': '54', 'cordoba': '23', 'magdalena': '47',
  'quindio': '63', 'cesar': '20', 'sucre': '70', 'caqueta': '18',
}
const noac = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// ── campos_extraccion (= bloque_configs.config_extra, de DB) ──────────────────
const C_RUT: CampoExtraccion[] = [
  { slug: 'nit', label: 'NIT', tipo: 'texto', required: true, descripcion_ai: 'Número de Identificación Tributaria SIN dígito de verificación (casilla 5). Solo dígitos, sin puntos ni guiones.' },
  { slug: 'dv', label: 'DV', tipo: 'texto', required: true, descripcion_ai: 'Dígito de verificación del NIT (casilla 6). Un solo dígito numérico.' },
  { slug: 'razon_social', label: 'Razón social', tipo: 'texto', required: true, descripcion_ai: 'Razón social completa o nombres y apellidos del contribuyente (casillas 31 a 35 del RUT). Si es persona natural, concatenar primer apellido, segundo apellido, primer nombre y otros nombres.' },
  { slug: 'numero_identificacion', label: 'No. identificación', tipo: 'texto', required: true, descripcion_ai: 'Número de identificación / cédula del titular tal como aparece en el RUT, COMPLETO. Solo dígitos, sin puntos, comas, guiones ni espacios. Suele tener entre 7 y 10 dígitos. NO truncar ni omitir el último dígito.' },
  { slug: 'direccion_seccional', label: 'Dirección seccional', tipo: 'texto', required: true, descripcion_ai: 'Nombre de la dirección seccional DIAN (renglón 12 del RUT).' },
  { slug: 'direccion', label: 'Dirección', tipo: 'texto', required: true, descripcion_ai: 'Dirección de notificación (renglón 41 del RUT)' },
  { slug: 'telefono', label: 'Teléfono', tipo: 'texto', required: true, descripcion_ai: 'Número de teléfono (renglón 44 del RUT)' },
  { slug: 'email', label: 'Email', tipo: 'texto', required: true, descripcion_ai: 'Correo electrónico registrado (renglón 42 del RUT)' },
  { slug: 'municipio', label: 'Municipio', tipo: 'texto', required: false, descripcion_ai: 'Municipio o ciudad del domicilio fiscal registrado en el RUT' },
  { slug: 'departamento', label: 'Departamento', tipo: 'texto', required: false, descripcion_ai: 'Departamento del domicilio fiscal registrado en el RUT' },
  { slug: 'pais', label: 'País', tipo: 'texto', required: false, descripcion_ai: 'País del domicilio fiscal registrado en el RUT' },
  { slug: 'primer_apellido', label: 'Primer apellido', tipo: 'texto', required: false, descripcion_ai: 'Primer apellido del titular, casilla 31 del RUT. Solo el primer apellido. Vacío si es persona jurídica.' },
  { slug: 'segundo_apellido', label: 'Segundo apellido', tipo: 'texto', required: false, descripcion_ai: 'Segundo apellido del titular, casilla 32 del RUT. Vacío si no tiene o si es persona jurídica.' },
  { slug: 'primer_nombre', label: 'Primer nombre', tipo: 'texto', required: false, descripcion_ai: 'Primer nombre del titular, casilla 33 del RUT. Vacío si es persona jurídica.' },
  { slug: 'otros_nombres', label: 'Otros nombres', tipo: 'texto', required: false, descripcion_ai: 'Otros nombres del titular, casilla 34 del RUT. Vacío si no tiene o si es persona jurídica.' },
  { slug: 'codigo_pais', label: 'Código país', tipo: 'texto', required: false, descripcion_ai: 'Código numérico del país del domicilio en el RUT (casilla 26). Para Colombia suele ser 169.' },
  { slug: 'codigo_departamento', label: 'Código departamento', tipo: 'texto', required: false, descripcion_ai: 'Código numérico del departamento del domicilio en el RUT (casilla 27).' },
  { slug: 'codigo_municipio', label: 'Código municipio', tipo: 'texto', required: false, descripcion_ai: 'Código numérico del municipio del domicilio en el RUT (casilla 28, DIVIPOLA).' },
]
const C_FACTURA: CampoExtraccion[] = [
  { slug: 'tipo_vehiculo', label: 'Tipo de vehículo', tipo: 'texto', required: true, descripcion_ai: 'Tipo de vehículo: eléctrico o híbrido. Determinar según la descripción del vehículo en la factura.' },
  { slug: 'marca', label: 'Marca', tipo: 'texto', required: true, descripcion_ai: 'Marca o fabricante del vehículo (ej: BYD, Renault, Chevrolet, BMW)' },
  { slug: 'linea', label: 'Línea', tipo: 'texto', required: true, descripcion_ai: 'Modelo o línea del vehículo (ej: Dolphin, Kwid E-Tech, Onix)' },
  { slug: 'valor_unitario_sin_iva', label: 'Valor unitario sin IVA', tipo: 'currency', required: true, descripcion_ai: 'Valor unitario del vehículo SIN IVA en pesos colombianos. Buscar el subtotal o valor antes de impuestos. Solo números sin puntos ni comas.' },
  { slug: 'proveedor', label: 'Proveedor', tipo: 'texto', required: true, descripcion_ai: 'Razón social del emisor de la factura (quien vende el vehículo). Es el vendedor, no el comprador.' },
  { slug: 'numero_factura', label: 'No. Factura', tipo: 'texto', required: false, descripcion_ai: 'Número consecutivo de la factura electrónica de venta. Buscar en el encabezado del documento.' },
  { slug: 'fecha_factura', label: 'Fecha factura', tipo: 'fecha', required: false, descripcion_ai: 'Fecha de emisión de la factura en formato YYYY-MM-DD' },
  { slug: 'valor_iva', label: 'Valor IVA', tipo: 'currency', required: false, descripcion_ai: 'Valor total del IVA cobrado en la factura, en pesos colombianos. Solo números sin puntos ni comas.' },
  { slug: 'nit_proveedor', label: 'NIT proveedor', tipo: 'texto', required: false, descripcion_ai: 'NIT o número de identificación del emisor/vendedor de la factura, solo dígitos sin puntos ni guiones' },
]
const C_CERT: CampoExtraccion[] = [
  { slug: 'entidad_financiera', label: 'Entidad financiera', tipo: 'texto', required: true, descripcion_ai: 'Nombre del banco o entidad financiera que emite el certificado. Ejemplo: Bancolombia, Davivienda, BBVA.' },
  { slug: 'numero_cuenta', label: 'Número de cuenta', tipo: 'texto', required: true, descripcion_ai: 'Número de cuenta bancaria, solo dígitos sin guiones ni espacios.' },
  { slug: 'tipo_cuenta', label: 'Tipo de cuenta', tipo: 'texto', required: true, descripcion_ai: 'Tipo de cuenta: Ahorros o Corriente. Buscar si dice cuenta de ahorros o cuenta corriente.' },
  { slug: 'fecha_expedicion', label: 'Fecha de expedición', tipo: 'fecha', required: false, descripcion_ai: 'Fecha de expedición del certificado bancario en formato YYYY-MM-DD.' },
]
const C_UPME: CampoExtraccion[] = [
  { slug: 'numero_caso_upme', label: 'Número del caso', tipo: 'texto', required: true, descripcion_ai: 'Número de caso o radicado UPME, formato VEH_GEE seguido de dígitos. Buscar en el encabezado RADICADO No.' },
  { slug: 'nombre_certificado', label: 'Nombre', tipo: 'texto', required: true, descripcion_ai: 'Nombre completo o razón social del beneficiario (Dueño del Proyecto) en la sección BENEFICIARIOS. Texto tal como aparece.' },
  { slug: 'numero_identificacion_certificado', label: 'No. identificación', tipo: 'texto', required: true, descripcion_ai: 'Número de cédula o NIT del beneficiario en BENEFICIARIOS, solo dígitos.' },
  { slug: 'marca_certificado', label: 'Marca', tipo: 'texto', required: true, descripcion_ai: 'Marca del vehículo en BIENES APROBADOS (ej BYD). Texto exacto.' },
  { slug: 'linea_modelo_certificado', label: 'Línea / modelo', tipo: 'texto', required: true, descripcion_ai: 'Línea y modelo del vehículo en BIENES APROBADOS (ej YUAN UP 380 GS 2026, incluye el año). Exacto.' },
]

// ── caso piloto ───────────────────────────────────────────────────────────────
const CASO = {
  id: '57030392877', codigo: 'V0013', dir: '/tmp/paola',
  nombre: 'Paola Avila', email: 'pao_avila6@hotmail.com',
  celular: '3006037468', marca: 'BYD',
}

type Campos = Record<string, CampoResultado>
function mime(p: string) { const l = p.toLowerCase(); return l.endsWith('.png') ? 'image/png' : (l.endsWith('.jpg') || l.endsWith('.jpeg')) ? 'image/jpeg' : 'application/pdf' }
function pick(dir: string, re: RegExp) { const f = readdirSync(dir).find((x) => re.test(x)); return f ? join(dir, f) : null }
async function extraer(path: string, campos: CampoExtraccion[]): Promise<Campos> {
  const { data, error } = await extractFieldsFromDocument(readFileSync(path), mime(path), campos, GEMINI)
  if (error || !data) throw new Error(`extracción falló (${path}): ${error}`)
  return data
}

async function main() {
  console.log(`\n=== CARGUE IVA · ${CASO.nombre} (${CASO.codigo}) ===`)

  // 1) Extracción (005_Factura, NO 002_Relacion)
  const fRut = pick(CASO.dir, /004_Rut|rut/i)!
  const fFac = pick(CASO.dir, /005_Factura|factura_/i) || pick(CASO.dir, /factura/i)!
  const fCert = pick(CASO.dir, /006_certificado_banc|certificado_banc/i)!
  const fUpme = pick(CASO.dir, /001_Cert|certificado_vehiculos|vehiculoselectricos/i)!
  console.log('Extrayendo:', [fRut, fFac, fCert, fUpme].map((p) => p.split('/').pop()).join(' · '))
  const rut = await extraer(fRut, C_RUT)
  const fac = await extraer(fFac, C_FACTURA)
  const cert = await extraer(fCert, C_CERT)
  const upme = await extraer(fUpme, C_UPME)

  // 2) Ajustes: código depto→DIVIPOLA, entidad sin S.A.
  //    El TELÉFONO de los formularios DIAN se deja el del RUT (decisión Mauricio
  //    2026-06-25) — NO el celular. El celular solo alimenta el contacto del CRM.
  const dpto = noac(rut.departamento?.value || '')
  if (DIVIPOLA_DPTO[dpto]) rut.codigo_departamento = { value: DIVIPOLA_DPTO[dpto], confidence: 1, manual: false }
  if (cert.entidad_financiera?.value) cert.entidad_financiera.value = cert.entidad_financiera.value.replace(/\s*S\.?\s*A\.?S?\.?\s*$/i, '').trim()
  console.log(`  RUT ${rut.numero_identificacion?.value} · IVA ${fac.valor_iva?.value} · ${cert.entidad_financiera?.value} ${cert.numero_cuenta?.value} · depto ${rut.codigo_departamento?.value}`)

  // 3) Contacto (dedupe por teléfono)
  let contactoId: string
  const { data: ex } = await supabase.from('contactos').select('id').eq('workspace_id', WS).eq('telefono', CASO.celular).maybeSingle()
  if (ex) { contactoId = (ex as { id: string }).id }
  else {
    const { data, error } = await supabase.from('contactos').insert({ workspace_id: WS, telefono: CASO.celular, nombre: CASO.nombre, email: CASO.email }).select('id').single()
    if (error) throw new Error(`contacto: ${error.message}`)
    contactoId = (data as { id: string }).id
  }
  console.log('  contacto:', contactoId)

  // 4) Negocio (código ya reservado)
  const { data: neg, error: nerr } = await supabase.from('negocios').insert({
    workspace_id: WS, linea_id: LINEA, contacto_id: contactoId, empresa_id: null,
    nombre: `${CASO.nombre} - ${CASO.marca}`, codigo: CASO.codigo,
    precio_estimado: null, precio_aprobado: null, responsable_id: JESSICA_STAFF,
    etapa_actual_id: ENVIO_ETAPA, stage_actual: 'ejecucion', estado: 'abierto',
  }).select('id').single()
  if (nerr) throw new Error(`negocio: ${nerr.message}`)
  const negocioId = (neg as { id: string }).id
  await supabase.from('negocio_responsables').insert({ negocio_id: negocioId, staff_id: JESSICA_STAFF, assigned_by: JESSICA_PROFILE })
  console.log('  negocio:', negocioId, CASO.codigo)

  // 5) Carpeta Drive (igual que la plataforma)
  const { data: ln } = await supabase.from('lineas_negocio').select('drive_folder_id').eq('id', LINEA).maybeSingle()
  const { data: wsr } = await supabase.from('workspaces').select('drive_folder_id').eq('id', WS).single()
  const parent = (ln as { drive_folder_id: string | null } | null)?.drive_folder_id || (wsr as { drive_folder_id: string }).drive_folder_id
  const folderId = await createDriveFolder(`${CASO.codigo} - ${CASO.nombre}`, parent, WS)
  for (const c of ['1. Legal', '2. Comercial', '3. UPME', '4. DIAN', '5. Otros']) { try { await createDriveFolder(c, folderId, WS) } catch { /* */ } }
  const carpetaUrl = `https://drive.google.com/drive/folders/${folderId}`
  await supabase.from('negocios').update({ carpeta_url: carpetaUrl }).eq('id', negocioId)
  console.log('  carpeta:', carpetaUrl)

  // 6) Bloques fuente: subir PDF + sembrar campos extraídos
  const srcDocs: Array<[string, string, string, Campos]> = [
    [SRC.rut, fRut, 'RUT.pdf', rut], [SRC.factura, fFac, 'Factura.pdf', fac],
    [SRC.cert, fCert, 'Certificado bancario.pdf', cert], [SRC.upme, fUpme, 'Concepto UPME.pdf', upme],
  ]
  for (const [cfg, path, fname, campos] of srcDocs) {
    let durl: string | null = null
    try { const up = await uploadFileToDrive(readFileSync(path), fname, mime(path), folderId, WS); await setFilePublicByLink(up.fileId, WS); durl = up.webViewLink } catch (e) { console.warn('   upload', fname, 'falló:', e instanceof Error ? e.message : e) }
    await supabase.from('negocio_bloques').insert({ negocio_id: negocioId, bloque_config_id: cfg, estado: 'completo', data: { campos, drive_url: durl, file_name: fname, _migrado: true } })
  }
  // toggles + gates previos
  await supabase.from('negocio_bloques').insert({ negocio_id: negocioId, bloque_config_id: '07068eb5-8f0c-4eb4-a47d-e245515eb33f', estado: 'completo', data: { requiere_devolucion_iva: true, _migrado: true } })
  await supabase.from('negocio_bloques').insert({ negocio_id: negocioId, bloque_config_id: 'a6a0732b-a427-499c-b806-15d68608cb24', estado: 'completo', data: { modalidad_solicitante: 'unico', _migrado: true } })
  for (const cfg of SEED_MIGRADO) await supabase.from('negocio_bloques').insert({ negocio_id: negocioId, bloque_config_id: cfg, estado: 'completo', data: { _migrado: true } })
  console.log('  bloques fuente + gates sembrados')

  // 7) Generar los 4 formularios con la herramienta real
  for (const [slug, cfg] of FORMS) {
    const { data: inst, error: ierr } = await supabase.from('negocio_bloques').insert({ negocio_id: negocioId, bloque_config_id: cfg, estado: 'pendiente', data: {} }).select('id').single()
    if (ierr) { console.error(`  ${slug}: no se creó instancia: ${ierr.message}`); continue }
    const r = await generarFormularioCore(supabase, WS, JESSICA_PROFILE, (inst as { id: string }).id, negocioId)
    console.log(`  ${slug}: ${r.success ? '✓ ' + (r.drive_url ?? 'sin url') : '✗ ' + r.error}`)
  }

  console.log(`\n✅ ${CASO.codigo} creado en Envío. Revisar: https://soena.metrikone.co/negocios/${negocioId}\n`)
}
main().catch((e) => { console.error('\n❌', e); process.exit(1) })
