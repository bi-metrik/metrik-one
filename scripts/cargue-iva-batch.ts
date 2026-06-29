/**
 * Cargue masivo Devolución de IVA → SOENA ONE, data-driven.
 * Lee un mapping JSON (clasificación de documentos hecha a mano / por Claude) con
 * rutas EXPLÍCITAS de los 4 documentos fuente en el archivo SOE035 — sin adivinar
 * por regex. Descarga, extrae, genera 010/1668/Declaración/Relación (Gen + Envío)
 * con la herramienta real y deja cada negocio en Envío.
 *
 * Uso: npx tsx scripts/cargue-iva-batch.ts /tmp/wave1.json
 * Mapping: [{ id, nombre, celular, codigo, rut, factura, cert, upme }]  (rutas SOE035)
 */
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { extractFieldsFromDocument, type CampoExtraccion, type CampoResultado } from '../src/lib/ai/extract-fields'
import { createDriveFolder, uploadFileToDrive, setFilePublicByLink } from '../src/lib/google-drive'
import { generarFormularioCore } from '../src/lib/actions/formulario-actions'

for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const GEMINI = process.env.GEMINI_API_KEY || ''
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as unknown as SupabaseClient
const ARCHIVE = '1eOdIGxDB7KCecDQLnhvPtyo47rrPQ5t3'
const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const LINEA = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
const ENVIO = '45ebd464-b231-4c2a-9007-d283e623f766'
const JESSICA_STAFF = '36a53092-0377-41d3-9e52-7e006979692d'
const JESSICA_PROFILE = '8b60b7aa-b62a-4beb-a6b8-d2ba1d96282b'
const SRC = { factura: 'f2227f75-37e0-4ff9-8e78-0038f0c9c4c6', rut: 'b734032c-19ca-4084-8664-ed2e3036b648', cert: '5d744172-172f-406b-8da6-4a126eb70ed3', upme: '989f3bca-3d72-4470-94c9-9e1da7f267eb' }
const FORMS: string[] = [
  'e0e92bdb-b6f3-48db-b9f8-26044be02b67','02872b67-fb16-4620-9705-177314b0adf4','f2878f39-5f3a-4067-abe2-3d15ba1a1c03','123b34e1-11bf-4965-9bff-b1ed29013782', // Generación
  '8d70eb69-d35b-4918-8b80-5d2656b33412','f00645a5-c0d1-414c-b03b-d0dfdf8bc45c','649b426c-01b8-4b56-8c13-b49100b01a75','2f7c6a0b-ad61-48c4-97d7-fd0289014d15', // Envío
]
const SEED_MIGRADO = ['f859733c-1c38-49a5-b90e-0d145563043b','9630e4c7-6b38-4ff6-b5d9-f755181984b6','ee432524-b469-4d32-ab88-b4bfa7f9910d','e306f492-890a-47be-a223-c83ea62ef917','b9d634bd-584c-4c83-ae57-a730cec402b6','a338513e-fdd4-41a6-8ded-ec11cb91690c','633aa6e8-f383-4165-9bbd-15a498a7c885']
const DIVIPOLA: Record<string, string> = { 'bogota':'11','bogota d.c.':'11','bogota dc':'11','cundinamarca':'25','antioquia':'05','valle del cauca':'76','valle':'76','atlantico':'08','santander':'68','bolivar':'13','risaralda':'66','caldas':'17','tolima':'73','meta':'50','huila':'41','narino':'52','cauca':'19','boyaca':'15','norte de santander':'54','cordoba':'23','magdalena':'47','quindio':'63','cesar':'20','sucre':'70','caqueta':'18' }
const noac = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const C_RUT: CampoExtraccion[] = [
  { slug:'nit',label:'NIT',tipo:'texto',required:true,descripcion_ai:'Número de Identificación Tributaria SIN dígito de verificación (casilla 5). Solo dígitos.' },
  { slug:'dv',label:'DV',tipo:'texto',required:true,descripcion_ai:'Dígito de verificación del NIT (casilla 6). Un solo dígito.' },
  { slug:'razon_social',label:'Razón social',tipo:'texto',required:true,descripcion_ai:'Nombres y apellidos del contribuyente (casillas 31 a 35 del RUT). Persona natural: concatenar primer apellido, segundo apellido, primer nombre, otros nombres.' },
  { slug:'numero_identificacion',label:'No. id',tipo:'texto',required:true,descripcion_ai:'Número de identificación/cédula del titular, COMPLETO. Solo dígitos. NO truncar el último dígito.' },
  { slug:'direccion_seccional',label:'Dir seccional',tipo:'texto',required:true,descripcion_ai:'Nombre de la dirección seccional DIAN (renglón 12).' },
  { slug:'direccion',label:'Dirección',tipo:'texto',required:true,descripcion_ai:'Dirección de notificación (renglón 41).' },
  { slug:'telefono',label:'Teléfono',tipo:'texto',required:true,descripcion_ai:'Número de teléfono (renglón 44).' },
  { slug:'email',label:'Email',tipo:'texto',required:true,descripcion_ai:'Correo electrónico (renglón 42).' },
  { slug:'municipio',label:'Municipio',tipo:'texto',required:false,descripcion_ai:'Municipio del domicilio fiscal.' },
  { slug:'departamento',label:'Departamento',tipo:'texto',required:false,descripcion_ai:'Departamento del domicilio fiscal.' },
  { slug:'pais',label:'País',tipo:'texto',required:false,descripcion_ai:'País del domicilio fiscal.' },
  { slug:'primer_apellido',label:'1er apellido',tipo:'texto',required:false,descripcion_ai:'Primer apellido (casilla 31). Vacío si jurídica.' },
  { slug:'segundo_apellido',label:'2do apellido',tipo:'texto',required:false,descripcion_ai:'Segundo apellido (casilla 32).' },
  { slug:'primer_nombre',label:'1er nombre',tipo:'texto',required:false,descripcion_ai:'Primer nombre (casilla 33).' },
  { slug:'otros_nombres',label:'Otros nombres',tipo:'texto',required:false,descripcion_ai:'Otros nombres (casilla 34).' },
  { slug:'codigo_pais',label:'Cód país',tipo:'texto',required:false,descripcion_ai:'Código país del domicilio (casilla 26). Colombia=169.' },
  { slug:'codigo_departamento',label:'Cód depto',tipo:'texto',required:false,descripcion_ai:'Código departamento (casilla 27).' },
  { slug:'codigo_municipio',label:'Cód municipio',tipo:'texto',required:false,descripcion_ai:'Código municipio (casilla 28, DIVIPOLA).' },
]
const C_FACTURA: CampoExtraccion[] = [
  { slug:'tipo_vehiculo',label:'Tipo',tipo:'texto',required:true,descripcion_ai:'Tipo de vehículo: eléctrico o híbrido.' },
  { slug:'marca',label:'Marca',tipo:'texto',required:true,descripcion_ai:'Marca del vehículo (ej BYD, Renault).' },
  { slug:'linea',label:'Línea',tipo:'texto',required:true,descripcion_ai:'Modelo o línea del vehículo.' },
  { slug:'valor_unitario_sin_iva',label:'Valor sin IVA',tipo:'currency',required:true,descripcion_ai:'Valor unitario SIN IVA en COP. Subtotal antes de impuestos. Solo números.' },
  { slug:'proveedor',label:'Proveedor',tipo:'texto',required:true,descripcion_ai:'Razón social del emisor/vendedor de la factura.' },
  { slug:'numero_factura',label:'No. Factura',tipo:'texto',required:false,descripcion_ai:'Número consecutivo de la factura electrónica.' },
  { slug:'fecha_factura',label:'Fecha',tipo:'fecha',required:false,descripcion_ai:'Fecha de emisión (YYYY-MM-DD).' },
  { slug:'valor_iva',label:'IVA',tipo:'currency',required:false,descripcion_ai:'Valor total del IVA en COP. Solo números.' },
  { slug:'nit_proveedor',label:'NIT prov',tipo:'texto',required:false,descripcion_ai:'NIT del emisor/vendedor, solo dígitos.' },
]
const C_CERT: CampoExtraccion[] = [
  { slug:'entidad_financiera',label:'Entidad',tipo:'texto',required:true,descripcion_ai:'Nombre del banco que emite el certificado (ej Bancolombia, Davivienda).' },
  { slug:'numero_cuenta',label:'No cuenta',tipo:'texto',required:true,descripcion_ai:'Número de cuenta bancaria, solo dígitos.' },
  { slug:'tipo_cuenta',label:'Tipo cuenta',tipo:'texto',required:true,descripcion_ai:'Tipo de cuenta: Ahorros o Corriente.' },
  { slug:'fecha_expedicion',label:'Fecha exp',tipo:'fecha',required:false,descripcion_ai:'Fecha de expedición (YYYY-MM-DD).' },
]
const C_UPME: CampoExtraccion[] = [
  { slug:'numero_caso_upme',label:'Caso',tipo:'texto',required:true,descripcion_ai:'Número de caso/radicado UPME, formato VEH_GEE seguido de dígitos. Buscar RADICADO No.' },
  { slug:'nombre_certificado',label:'Nombre',tipo:'texto',required:true,descripcion_ai:'Nombre/razón social del beneficiario (Dueño del Proyecto) en BENEFICIARIOS.' },
  { slug:'numero_identificacion_certificado',label:'No id',tipo:'texto',required:true,descripcion_ai:'Cédula/NIT del beneficiario en BENEFICIARIOS, solo dígitos.' },
  { slug:'marca_certificado',label:'Marca',tipo:'texto',required:true,descripcion_ai:'Marca del vehículo en BIENES APROBADOS.' },
  { slug:'linea_modelo_certificado',label:'Línea',tipo:'texto',required:true,descripcion_ai:'Línea y modelo del vehículo en BIENES APROBADOS (incluye el año). Exacto.' },
]

type Campos = Record<string, CampoResultado>
type Caso = { id:string; nombre:string; celular:string; codigo:string; rut:string; factura:string; cert:string; upme:string; seccional?:string }
const mimeOf = (p:string) => { const l=p.toLowerCase(); return l.endsWith('.png')?'image/png':(l.endsWith('.jpg')||l.endsWith('.jpeg'))?'image/jpeg':'application/pdf' }

function descargar(remotePath:string, localPath:string) {
  execFileSync('rclone', ['copyto', `gdrive:${remotePath}`, localPath, '--drive-root-folder-id', ARCHIVE], { stdio:'pipe' })
}
async function extraer(path:string, campos:CampoExtraccion[]):Promise<Campos> {
  const { data, error } = await extractFieldsFromDocument(readFileSync(path), mimeOf(path), campos, GEMINI)
  if (error || !data) throw new Error(`extracción (${path.split('/').pop()}): ${error}`)
  return data
}

async function procesar(c:Caso) {
  console.log(`\n=== ${c.codigo} · ${c.nombre} (${c.id}) ===`)
  const dir = `/tmp/iva/${c.id}`; mkdirSync(dir, { recursive:true })
  const local:Record<string,string> = {}
  for (const k of ['rut','factura','cert','upme'] as const) {
    const rp = (c as Record<string,string>)[k]; if (!rp) throw new Error(`falta ruta ${k}`)
    const lp = join(dir, `${k}.${rp.split('.').pop()}`)
    if (!existsSync(lp)) descargar(rp, lp); local[k] = lp
  }
  const rut = await extraer(local.rut, C_RUT)
  const fac = await extraer(local.factura, C_FACTURA)
  const cert = await extraer(local.cert, C_CERT)
  const upme = await extraer(local.upme, C_UPME)
  // ajustes: depto DIVIPOLA, entidad sin S.A. (teléfono = el del RUT, NO override)
  const dp = noac(rut.departamento?.value || ''); if (DIVIPOLA[dp]) rut.codigo_departamento = { value:DIVIPOLA[dp], confidence:1, manual:false }
  if (cert.entidad_financiera?.value) cert.entidad_financiera.value = cert.entidad_financiera.value.replace(/\s*S\.?\s*A\.?S?\.?\s*$/i,'').trim()
  console.log(`  RUT ${rut.numero_identificacion?.value} · tel ${rut.telefono?.value} · IVA ${fac.valor_iva?.value} · ${cert.entidad_financiera?.value} ${cert.numero_cuenta?.value}`)

  // contacto (dedup por teléfono)
  let contactoId:string
  const { data: ex } = await supabase.from('contactos').select('id').eq('workspace_id', WS).eq('telefono', c.celular).maybeSingle()
  if (ex) contactoId = (ex as {id:string}).id
  else {
    const { data, error } = await supabase.from('contactos').insert({ workspace_id:WS, telefono:c.celular, nombre:c.nombre, email:rut.email?.value ?? null }).select('id').single()
    if (error) throw new Error(`contacto: ${error.message}`); contactoId = (data as {id:string}).id
  }
  const marca = fac.marca?.value ?? ''
  const { data: neg, error: nerr } = await supabase.from('negocios').insert({ workspace_id:WS, linea_id:LINEA, contacto_id:contactoId, empresa_id:null, nombre:`${c.nombre} - ${marca}`, codigo:c.codigo, responsable_id:JESSICA_STAFF, etapa_actual_id:ENVIO, stage_actual:'ejecucion', estado:'abierto' }).select('id').single()
  if (nerr) throw new Error(`negocio: ${nerr.message}`)
  const negocioId = (neg as {id:string}).id
  await supabase.from('negocio_responsables').insert({ negocio_id:negocioId, staff_id:JESSICA_STAFF, assigned_by:JESSICA_PROFILE })

  // carpeta Drive
  const { data: ln } = await supabase.from('lineas_negocio').select('drive_folder_id').eq('id', LINEA).maybeSingle()
  const { data: wsr } = await supabase.from('workspaces').select('drive_folder_id').eq('id', WS).single()
  const parent = (ln as {drive_folder_id:string|null}|null)?.drive_folder_id || (wsr as {drive_folder_id:string}).drive_folder_id
  const folderId = await createDriveFolder(`${c.codigo} - ${c.nombre}`, parent, WS)
  for (const f of ['1. Legal','2. Comercial','3. UPME','4. DIAN','5. Otros']) { try { await createDriveFolder(f, folderId, WS) } catch { /* */ } }
  await supabase.from('negocios').update({ carpeta_url:`https://drive.google.com/drive/folders/${folderId}` }).eq('id', negocioId)

  // bloques fuente (subir + sembrar campos)
  const srcDocs:Array<[string,string,string,Campos]> = [[SRC.rut,local.rut,'RUT.pdf',rut],[SRC.factura,local.factura,'Factura.pdf',fac],[SRC.cert,local.cert,'Certificado bancario.pdf',cert],[SRC.upme,local.upme,'Concepto UPME.pdf',upme]]
  for (const [cfg,path,fname,campos] of srcDocs) {
    let durl:string|null=null
    try { const up=await uploadFileToDrive(readFileSync(path), fname, mimeOf(path), folderId, WS); await setFilePublicByLink(up.fileId, WS); durl=up.webViewLink } catch (e) { console.warn('   upload',fname,'falló:',e instanceof Error?e.message:e) }
    await supabase.from('negocio_bloques').insert({ negocio_id:negocioId, bloque_config_id:cfg, estado:'completo', data:{ campos, drive_url:durl, file_name:fname, _migrado:true } })
  }
  await supabase.from('negocio_bloques').insert({ negocio_id:negocioId, bloque_config_id:'07068eb5-8f0c-4eb4-a47d-e245515eb33f', estado:'completo', data:{ requiere_devolucion_iva:true, _migrado:true } })
  await supabase.from('negocio_bloques').insert({ negocio_id:negocioId, bloque_config_id:'a6a0732b-a427-499c-b806-15d68608cb24', estado:'completo', data:{ modalidad_solicitante:'unico', _migrado:true } })
  for (const cfg of SEED_MIGRADO) await supabase.from('negocio_bloques').insert({ negocio_id:negocioId, bloque_config_id:cfg, estado:'completo', data:{ _migrado:true } })

  // generar 4 formularios en Gen + 4 en Envío. Los 010 nacen con data.seccional
  // (de CIUDAD FACTURA del sheet) para que el preset por seccional se aplique.
  const ES_010 = new Set(['e0e92bdb-b6f3-48db-b9f8-26044be02b67', '8d70eb69-d35b-4918-8b80-5d2656b33412'])
  let ok=0
  for (const cfg of FORMS) {
    const initData = (ES_010.has(cfg) && c.seccional) ? { seccional: c.seccional } : {}
    const { data: inst, error } = await supabase.from('negocio_bloques').insert({ negocio_id:negocioId, bloque_config_id:cfg, estado:'pendiente', data:initData }).select('id').single()
    if (error) { console.error('   instancia:', error.message); continue }
    const r = await generarFormularioCore(supabase, WS, JESSICA_PROFILE, (inst as {id:string}).id, negocioId)
    if (r.success) ok++; else console.error('   gen ✗', r.error)
  }
  console.log(`  ✓ ${c.codigo} en Envío · ${ok}/8 formularios · /negocios/${negocioId}`)
  return { codigo:c.codigo, negocioId, ok }
}

async function main() {
  const casos:Caso[] = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  console.log(`Cargue IVA · ${casos.length} casos`)
  const res=[]
  for (const c of casos) {
    try { res.push(await procesar(c)) }
    catch (e) { console.error(`❌ ${c.codigo} ${c.nombre}:`, e instanceof Error?e.message:e); res.push({ codigo:c.codigo, error:String(e) }) }
  }
  console.log('\n=== RESUMEN ===')
  for (const r of res) console.log(' ', r.codigo, 'error' in r ? '❌ '+r.error : `✓ ${r.ok}/8`)
}
main().catch((e)=>{ console.error(e); process.exit(1) })
