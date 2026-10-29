// ============================================================
// Arnés del núcleo conversacional — la corrida (Deno)
// ------------------------------------------------------------
// Uso (la llave llega por el entorno; nunca se imprime):
//   ANTHROPIC_API_KEY=… deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/correr.ts --salida <dir>
//     [--conjunto 1|2|perfil|todo] [--solo id1,id2] [--seco] [--humo] [--k 3] [--proveedor anthropic|gemini]
//   --proveedor anthropic (por defecto, 2026-10-29: «No depende de Gemini. Corre con haiku»): el agente, el comercial
//            simulado, la extracción y los lectores de archivos van a Claude Haiku 5.5 por `fetchModelo`, como en
//            producción, pero SIN respaldo y sin poder salir a Gemini (`proveedor-haiku.ts`). Solo pide
//            ANTHROPIC_API_KEY. No hay juez de modelo: la calificación (`calificar.ts`) es por código.
//   --proveedor gemini: el arnés de antes (GEMINI_API_KEY; gemini-3.8-flash con respaldo flash-lite).
//   --k      corre cada caso k veces (por defecto 1). Deja `banco.json` para `asistente_publicar_rol`: `pasa` solo si
//            todas las corridas de todos los casos terminan con éxito y 0 dañinas (y nunca en seco); `huella_fichas` =
//            huellaPublicable de las fichas con que corrieron (`conPerfil(REGLAMENTO_ANEXO_A)`).
//   --rol mano_derecha|asesor_viajes (2026-10-29, roles de Trappvel): corre los casos del rol (`conjuntos-roles.ts`) con
//            las fichas del rol (`bandeja/roles-trappvel.ts`) y el dominio compuesto como en producción (viajes, ONE si
//            el rol lo trae, persona). El banco trae la huella de ESAS fichas. `--fichas-base <json>`: las fichas del
//            reglamento de la bandeja publicado en producción (exportadas con el SELECT del SQL de publicación); sin él,
//            las del código. `--excluir id1,id2`: casos que corren y se reportan pero no entran al banco (los que la
//            bandeja de hoy tampoco pasa k de k en la línea base, `--conjunto base-roles`); el banco los lista.
//   --conjunto adjuntos: fotos y PDF sintéticos en la bandeja (2026-10-21). El lector real va a Haiku (con
//   `--proveedor gemini`, por `fetchModelo` con respaldo Gemini); en --seco, un lector falso.
// --seco   sin red: modelo falso (prueba de cañería, no mide nada). No pide llave.
// --humo   UNA llamada mínima al modelo del proveedor (Haiku por defecto) y sale. Si da 429 o sin crédito, se para ahí.
// La base es la de memoria (`PuertoMemoria`); su estado final es la verdad (§3.8). Sin datos reales.
// Los precios para el gasto: Haiku 5.5, los de la página oficial de Anthropic leída el 2026-10-29 (`proveedor-haiku.ts`);
// Gemini, los de la página oficial de Google leídos por Yuto el 2026-10-06 (§3.12 del diseño). Se pasan aquí, no viven en
// el código del núcleo.
// ============================================================

import { fetchModelo } from '../../llm-anthropic.ts';
import { CONFIG_POR_DEFECTO } from '../config.ts';
import { escenario } from '../escenario.ts';
import type { Escenario } from '../escenario.ts';
import { modeloGemini } from '../modelo-gemini.ts';
import { modeloGuionado } from '../modelo-guionado.ts';
import type { ExtractorMemoria } from '../memoria.ts';
import type { Modelo, PedidoModelo, Salida, UsoLlamado } from '../tipos.ts';
import type { PrecioModelo } from '../uso.ts';
import { sumarUso } from '../uso.ts';
import { calificar, tabla } from './calificar.ts';
import type { ResultadoCaso } from './calificar.ts';
import { CAMPOS_ARNES, CONJUNTO_1, CONJUNTO_2, CONJUNTO_ADJUNTOS, CONJUNTO_PERFIL, CONJUNTO_RESPONSABLE, preguntaQuienLleva } from './conjuntos.ts';
import type { PasoGuion } from './conjuntos.ts';
import { lectorDeDocumentosDeViaje } from '../bandeja/lectura-adjunto.ts';
import type { ArchivoAdjunto, Lector } from '../one/lectura-adjunto.ts';
import { solicitudViajeSintetica } from './soportes/pdf-minimo.ts';
import { reglamentoDePrueba } from '../escenario.ts';
import { REGLAMENTO_ANEXO_A } from '../bandeja/reglamento-anexo-a.ts';
import { conPerfil } from '../bandeja/reglamento-perfil.ts';
import { extraccionGemini, MODELO_EXTRACCION } from './extraccion-gemini.ts';
import type { CasoArnes } from './conjuntos.ts';
import { promptSimulador, simular, transcripcionParaSimulador } from './simulador.ts';
import { bancoDelArnes } from './banco.ts';
import { FUNCIONES_ROL, ROLES_TRAPPVEL, fichasBaseBandeja, fichasDelRol } from '../bandeja/roles-trappvel.ts';
import type { ClaveRolTrappvel } from '../bandeja/roles-trappvel.ts';
import { leeSoportes } from '../bandeja/turno-con-rol.ts';
import { lectorMixto } from '../bandeja/lectura-mixta.ts';
import { lectorDeSoportes } from '../one/lectura-adjunto.ts';
import { casosDelRol } from './conjuntos-roles.ts';
import { fichaValida } from '../reglamento.ts';
import { MODELO_HAIKU, PRECIOS_HAIKU, humoHaiku, proveedorHaiku } from './proveedor-haiku.ts';
import type { Ficha } from '../tipos.ts';
import type { PuertoMemoria } from '../memoria.ts';

export const PRECIOS_312: PrecioModelo[] = [
  // ai.google.dev/gemini-api/docs/pricing, leída el 2026-10-06 (diseño §3.12). Caché sin dato: se cobra como entrada.
  { modelo: 'gemini-3.8-flash', entrada: 0.75, salida: 3.75, cache: null },
  { modelo: 'gemini-3.5-flash-lite', entrada: 0.30, salida: 2.50, cache: null },
];

const args = Deno.args;
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const seco = args.includes('--seco');
const PROVEEDOR = arg('--proveedor') ?? 'anthropic';
if (PROVEEDOR !== 'anthropic' && PROVEEDOR !== 'gemini') throw new Error('--proveedor: anthropic o gemini');
const CON_GEMINI = PROVEEDOR === 'gemini';
// Con Haiku no se lee GEMINI_API_KEY: ningún pedido lleva llave de Gemini (ni respaldo).
const LLAVE = CON_GEMINI ? (Deno.env.get('GEMINI_API_KEY') ?? '') : '';
const LLAVE_ANTHROPIC = CON_GEMINI ? '' : (Deno.env.get('ANTHROPIC_API_KEY') ?? '').trim();
/** Con Haiku: el `fetch` y el entorno de todo el arnés (sale solo a Anthropic). En seco no hace falta. */
const HAIKU = !CON_GEMINI && !seco ? proveedorHaiku(LLAVE_ANTHROPIC) : null;
const MODELO_SIMULADOR = CON_GEMINI ? { modelo: 'gemini-3.5-flash-lite', razonamiento: 'MINIMAL' } : { modelo: MODELO_HAIKU, razonamiento: null };
/** Los precios del gasto (los dos proveedores: un `--proveedor gemini` con Haiku de principal también se cuenta). */
const PRECIOS: PrecioModelo[] = [...PRECIOS_HAIKU, ...PRECIOS_312];
const ROL = arg('--rol') as ClaveRolTrappvel | undefined;
if (ROL && !ROLES_TRAPPVEL.includes(ROL)) throw new Error(`--rol: uno de ${ROLES_TRAPPVEL.join(', ')}`);

/** Las fichas de la base (las publicadas en producción si llegan por `--fichas-base`; si no, las del código). */
async function fichasBase(): Promise<Ficha[]> {
  const ruta = arg('--fichas-base');
  if (!ruta) return fichasBaseBandeja();
  const crudo = JSON.parse(await Deno.readTextFile(ruta));
  const fichas = (Array.isArray(crudo) ? crudo : []).map(fichaValida).filter((f: Ficha | null): f is Ficha => !!f);
  if (!fichas.length) throw new Error(`--fichas-base: ${ruta} no trae fichas`);
  return fichas;
}
const FICHAS_ROL: Ficha[] | null = ROL ? fichasDelRol(ROL, await fichasBase()) : null;

/** En seco, el lector de soportes falso (la factura sintética). */
const lectorSecoSoporte: Lector = async (a) => (a.nombre?.startsWith('factura')
  ? { legible: true, monto: 84500, fecha: '2026-10-20', comercio: 'Ferretería El Tornillo Feliz', nit: null, descripcion: 'brochas, rodillo y pintura' }
  : { legible: false, monto: null, fecha: null, comercio: null, nit: null, descripcion: null });

/** UNA llamada mínima al modelo principal. `cuota`: 429 o RESOURCE_EXHAUSTED (hay que parar). */
export async function llamadaDeHumo(llave: string): Promise<{ status: number; ms: number; uso: string; cuota: boolean }> {
  const t0 = performance.now();
  const res = await fetchModelo(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG_POR_DEFECTO.principal.modelo}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': llave },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responde solo: ok' }] }], generationConfig: { maxOutputTokens: 64, thinkingConfig: { thinkingLevel: 'LOW' } } }),
  });
  const cuerpo = await res.text();
  let uso = '';
  try { const u = JSON.parse(cuerpo).usageMetadata ?? {}; uso = `entrada ${u.promptTokenCount ?? 0}, salida ${u.candidatesTokenCount ?? 0}, razonamiento ${u.thoughtsTokenCount ?? 0}`; } catch { /* sin json */ }
  return { status: res.status, ms: Math.round(performance.now() - t0), uso, cuota: res.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(cuerpo) };
}

async function humo(): Promise<void> {
  if (!CON_GEMINI) {
    if (!LLAVE_ANTHROPIC) { console.error('sin ANTHROPIC_API_KEY'); Deno.exit(2); }
    const r = await humoHaiku(HAIKU!.fetch);
    console.log(JSON.stringify({ humo: r.status, ms: r.ms, modelo: r.modelo, uso: r.uso, cuota: r.cuota, bloqueados: HAIKU!.bloqueados.length }));
    if (r.status !== 200 || HAIKU!.bloqueados.length) Deno.exit(3);
    return;
  }
  const r = await llamadaDeHumo(LLAVE);
  console.log(JSON.stringify({ humo: r.status, ms: r.ms, uso: r.uso, cuota: r.cuota }));
  if (r.status !== 200) Deno.exit(3);
}

function modeloParaCaso(): Modelo {
  if (!seco && HAIKU) {
    // Haiku 5.5 como en producción, sin respaldo; el nombre del modelo en la URL es el de Haiku (así queda en el uso).
    return modeloGemini({ llave: '', principal: { ...CONFIG_POR_DEFECTO.principal, modelo: MODELO_HAIKU }, respaldo: null, corteMs: CONFIG_POR_DEFECTO.corteMs, fetch: HAIKU.fetch, haiku: true });
  }
  if (!seco) {
    const t = arg('--temperatura');
    const principal = t !== undefined ? { ...CONFIG_POR_DEFECTO.principal, temperatura: Number(t) } : CONFIG_POR_DEFECTO.principal;
    return modeloGemini({ llave: LLAVE, principal, respaldo: CONFIG_POR_DEFECTO.respaldo, corteMs: CONFIG_POR_DEFECTO.corteMs });
  }
  // Seco: contesta siempre algo corto, sin datos (prueba que la cañería corre de punta a punta).
  return modeloGuionado(Array.from({ length: 200 }, () => (_p: PedidoModelo) => ({ name: 'responder', args: { tema: 'solicitud', texto: '¿Me cuentas más?' } })));
}

function verSalida(s: Salida): string {
  const ops = 'opciones' in s ? ` ${s.opciones.map((o) => `[${o.titulo}]`).join(' ')}` : '';
  return `${s.texto}${ops}`;
}

/** Toca por título; si el bot no mostró esa opción, la persona contesta escribiendo (`oEscribe`, o «sí»), y queda dicho. */
async function tocarOEscribir(e: Escenario, titulo: string, oEscribe = 'sí'): Promise<string> {
  try {
    await e.toca(titulo);
    return `[toque: ${titulo}]`;
  } catch {
    await e.escribe(oEscribe);
    return `«${oEscribe}» (no había botón «${titulo}»)`;
  }
}

/** Los archivos sintéticos de la bandeja (sin datos de clientes). */
async function archivoBandeja(a: NonNullable<PasoGuion['adjunta']>['archivo']): Promise<{ tipo: 'foto' | 'pdf'; nombre?: string; archivo: ArchivoAdjunto }> {
  if (a === 'solicitud') return { tipo: 'pdf', nombre: 'solicitud-viaje.pdf', archivo: { bytes: solicitudViajeSintetica(), mime: 'application/pdf', nombre: 'solicitud-viaje.pdf' } };
  const archivo = a === 'pantallazo' ? 'pantallazo-viaje-sintetico.jpg' : 'factura-ferreteria-sintetica.jpg';
  return { tipo: 'foto', archivo: { bytes: await Deno.readFile(new URL(`./soportes/${archivo}`, import.meta.url)), mime: 'image/jpeg', nombre: archivo } };
}

/** En seco, un lector falso que «lee» lo que se sabe de cada archivo sintético (prueba de cañería, no mide nada). */
export const lectorSecoBandeja: Lector = async (a) => {
  if (a.mime === 'application/pdf') {
    return { legible: true, clase: 'viaje', texto: 'Solicitud de viaje. Destino: San Andrés. Salida: 8 de enero de 2027, desde Medellín. Regreso: 13 de enero de 2027. Viajeros: Laura (38), Andrés (40), Sofía (9), Tomás (1). Hotel 4 estrellas todo incluido. Presupuesto hasta COP 9.000.000.', monto: null, fecha: null, comercio: null, nit: null, descripcion: null };
  }
  return a.nombre?.startsWith('pantallazo')
    ? { legible: true, clase: 'viaje', texto: 'Queremos ir a Cartagena del 12 al 16 de diciembre de 2026. Somos 2 adultos y un niño de 7 años. Hotel 4 estrellas, todo incluido. Presupuesto: 6 millones en total.', monto: null, fecha: null, comercio: null, nit: null, descripcion: null }
    : { legible: true, clase: 'pago', texto: 'Factura de Ferretería El Tornillo Feliz por $84.500: brochas, rodillo y pintura.', monto: 84500, fecha: '2026-10-20', comercio: 'Ferretería El Tornillo Feliz', nit: null, descripcion: null };
};

/** Seco: la extracción no entiende nada (todo por definir). */
const extraccionSeca: ExtractorMemoria = async ({ campos }) => ({ mensajes: [], citas: [], valores: Object.fromEntries(campos.map((f) => [f.slug, { valor: 'por_definir', frase: '' }])) });
const extracciones: Array<{ ms: number; ok: boolean }> = [];

async function correrCaso(caso: CasoArnes): Promise<{ r: ResultadoCaso; usoSimulador: UsoLlamado[]; comercial: string[] }> {
  const conExtraccion = caso.extraccion ? { campos: CAMPOS_ARNES, extraer: seco ? extraccionSeca : HAIKU ? extraccionGemini('', extracciones, { fetch: HAIKU.fetch, modelo: MODELO_HAIKU }) : extraccionGemini(LLAVE, extracciones) } : {};
  // El reglamento que tendrá Trappvel al publicar las fichas del perfil (2026-10-12): todos los casos corren con él. Con
  // `--rol`, el del rol.
  const reglamento = await reglamentoDePrueba(FICHAS_ROL ?? conPerfil(REGLAMENTO_ANEXO_A));
  // El lector de documentos solo en los casos con archivos (los demás corren exactamente como antes). Un rol que
  // registra gastos lee cada archivo también como soporte de pago (el lector mixto, como en producción).
  const conArchivos = (caso.pasos ?? []).some((p) => p.adjunta);
  const opcionesLector = HAIKU ? HAIKU.lector : { llaveGemini: LLAVE };
  const deViaje = seco ? lectorSecoBandeja : lectorDeDocumentosDeViaje(opcionesLector);
  const lector = !conArchivos ? null
    : ROL && leeSoportes(FUNCIONES_ROL[ROL]) ? lectorMixto(deViaje, seco ? lectorSecoSoporte : lectorDeSoportes(opcionesLector))
    : deViaje;
  const e = await escenario({
    modelo: modeloParaCaso(), contactos: caso.contactos, viajes: caso.viajes, reglamento, reloj: () => performance.now(), ...conExtraccion,
    ...(caso.equipo ? { equipo: caso.equipo } : {}), ...(caso.remitente ? { remitente: caso.remitente } : {}), ...(lector ? { lector } : {}),
    ...(caso.ahora ? { inicio: Date.parse(caso.ahora) } : {}),
    // Con un rol: el dominio compuesto; los viajes son también negocios de ONE (mismo código), como en Trappvel.
    ...(ROL ? { rol: { clave: ROL, funciones: FUNCIONES_ROL[ROL], negocios: caso.viajes.filter((v) => v.abierto).map((v) => ({ id: v.id, codigo: v.codigo, nombre: v.nombre, empresa: null, contacto: caso.contactos.find((c) => c.id === v.contactoId)?.nombre ?? null, etapa: 'venta' })) } } : {}),
  });
  for (const id of caso.autorizados ?? []) e.puerto.autorizaciones.set(id, { estado: 'autorizado', fecha: '2026-10-01T15:00:00Z', menores: false });
  if (caso.semilla) e.semilla(caso.semilla);
  const comercial: string[] = [];
  const usoSimulador: UsoLlamado[] = [];
  let error: string | undefined;
  try {
    if (caso.pasos) {
      for (const p of caso.pasos) {
        if (p.escribe !== undefined) { await e.escribe(p.escribe); comercial.push(p.escribe); }
        else if (p.reenvia !== undefined) { await e.reenvia(p.reenvia); comercial.push(`(reenvío) ${p.reenvia}`); }
        else if (p.dicta !== undefined) { await e.dicta(p.dicta); comercial.push(`(audio) ${p.dicta}`); }
        else if (p.toca !== undefined) comercial.push(await tocarOEscribir(e, p.toca, p.oEscribe));
        else if (p.adjunta) {
          const a = await archivoBandeja(p.adjunta.archivo);
          await e.adjunta({ tipo: a.tipo, nombre: a.nombre, pie: p.adjunta.pie, reenviado: p.adjunta.reenviado, archivo: a.archivo });
          comercial.push(`${p.adjunta.reenviado ? '(reenvío) ' : ''}(${a.tipo === 'pdf' ? `PDF ${a.nombre}` : `foto ${p.adjunta.archivo}`})${p.adjunta.pie ? ` ${p.adjunta.pie}` : ''}`);
        }
      }
    } else {
      const pendientes = [...(caso.mensajesCliente ?? [])];
      const vistas: Array<{ quien: 'tu' | 'asistente' | 'reenvio'; texto: string; opciones?: string[] }> = [];
      for (let i = 0; i < 10; i++) {
        let a: { accion: string; texto: string };
        if (seco) {
          a = pendientes.length ? { accion: 'reenvia', texto: '' } : i < (caso.mensajesCliente?.length ?? 0) + 1 ? { accion: 'escribe', texto: 'listo' } : { accion: 'fin', texto: '' };
        } else {
          const s = await simular({
            llave: LLAVE, modelo: MODELO_SIMULADOR.modelo, razonamiento: MODELO_SIMULADOR.razonamiento, ...(HAIKU ? { fetch: HAIKU.fetch } : {}),
            sistema: promptSimulador({ objetivo: caso.objetivo!, estilo: caso.estilo!, pendientes: pendientes.length }),
            transcripcion: transcripcionParaSimulador(vistas),
          });
          usoSimulador.push(s.uso);
          if (!s.ok) { error = `simulador: ${s.motivo}`; break; }
          a = s.accion;
        }
        if (a.accion === 'fin') break;
        let salidas: Salida[] = [];
        if (a.accion === 'reenvia') {
          const m = pendientes.shift();
          if (!m) { vistas.push({ quien: 'tu', texto: '(no te quedan mensajes para reenviar)' }); continue; }
          salidas = await e.reenvia(m);
          comercial.push(`(reenvío) ${m}`);
          vistas.push({ quien: 'reenvio', texto: m });
        } else if (a.accion === 'toca') {
          const antes = e.mensajero.enviados.length;
          comercial.push(await tocarOEscribir(e, a.texto));
          vistas.push({ quien: 'tu', texto: `[tocaste: ${a.texto}]` });
          salidas = e.mensajero.enviados.slice(antes).map((x) => x.salida);
        } else {
          salidas = await e.escribe(a.texto);
          comercial.push(a.texto);
          vistas.push({ quien: 'tu', texto: a.texto });
        }
        for (const s of salidas) vistas.push({ quien: 'asistente', texto: s.texto, opciones: 'opciones' in s ? s.opciones.map((o) => o.titulo) : undefined });
      }
    }
  } catch (err) {
    error = String(err).slice(0, 300);
  }
  // Solo las trazas del caso: las de la semilla (un registro de antes, ya borrado) no escribieron en esta base.
  // Con un rol, la verdad son las dos bases (la de la bandeja y la de ONE): una vista con las escrituras de las dos.
  const vista: PuertoMemoria = e.puertoOne ? Object.assign(Object.create(e.puerto), { escrituras: [...e.puerto.escrituras, ...e.puertoOne.escrituras] }) : e.puerto;
  let r = calificar(caso, e.pasos, vista, e.pasos.flatMap((p) => p.trazas), PRECIOS, error);
  // r-ignora: además de no abrir, la pregunta tiene que seguir en pie (el último mensaje vuelve a preguntar).
  if (caso.id === 'r-ignora' && r.exito.ok && !preguntaQuienLleva(e.pasos)) r = { ...r, exito: { ok: false, motivo: 'no abrió, pero dejó de preguntar quién lleva el viaje' } };
  return { r, usoSimulador, comercial };
}

function transcripcion(caso: CasoArnes, r: ResultadoCaso, comercial: string[]): string {
  const filas: string[] = [];
  const conHoy = caso.conjunto === 1;
  filas.push(conHoy ? '| # | Comercial | Bot nuevo (núcleo) | Bot de hoy (la conversación real) |' : '| # | Comercial (simulado) | Bot nuevo (núcleo) |');
  filas.push(conHoy ? '|---|---|---|---|' : '|---|---|---|');
  const celda = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  r.pasos.forEach((p, i) => {
    const t = p.trazas.at(-1);
    const nota = t ? ` <sub>${t.tipo === 'modelo' ? `${t.llamados} llamado(s) · ${(t.herramientas ?? []).map((h) => h.nombre).join(', ') || 'sin herramientas'}` : t.tipo}${p.ms !== null ? ` · ${p.ms} ms` : ''}${t.candados?.length ? ` · candado: ${t.candados.map((c) => c.candado).join(', ')}` : ''}${t.verificador?.length ? ` · verificador: ${t.verificador.length}` : ''}${t.uso?.some((u) => u.modelo.includes('lite')) ? ' · respaldo lite' : ''}</sub>` : '';
    const bot = p.salidas.length ? p.salidas.map(verSalida).join('<br>—<br>') : '(no contesta)';
    const quien = comercial[i] ?? (p.clase === 'toque' ? `[toque: ${p.texto}]` : p.texto);
    filas.push(conHoy ? `| ${i + 1} | ${celda(quien)} | ${celda(bot)}${nota} | ${celda(caso.botDeHoy?.[i] ?? '')} |` : `| ${i + 1} | ${celda(quien)} | ${celda(bot)}${nota} |`);
  });
  return [
    `### ${caso.id} · ${caso.titulo}`,
    '',
    `**Éxito de la tarea:** ${r.exito.ok ? 'sí' : 'NO'} — ${r.exito.motivo}. **Dañinas:** ${r.daninas.length ? r.daninas.join('; ') : '0'}. **Atajadas:** ${r.atajadas.length ? r.atajadas.join('; ') : '0'}. **Rechazos del verificador:** ${r.rechazosVerificador}. **«No pude»:** ${r.caidos}. **Pregunta repetida:** ${r.preguntaDoble}.${r.error ? ` **Error del arnés:** ${r.error}` : ''}`,
    '',
    ...filas,
    '',
  ].join('\n');
}

if (import.meta.main) {
  if (args.includes('--humo')) { await humo(); Deno.exit(0); }
  if (!seco && CON_GEMINI && LLAVE.length < 20) { console.error('sin GEMINI_API_KEY'); Deno.exit(2); }
  if (!seco && !CON_GEMINI && !LLAVE_ANTHROPIC) { console.error('sin ANTHROPIC_API_KEY'); Deno.exit(2); }
  const salida = arg('--salida');
  if (!salida) { console.error('falta --salida <dir>'); Deno.exit(2); }
  const conjunto = arg('--conjunto') ?? 'todo';
  const solo = arg('--solo')?.split(',');
  // `--conjunto base-roles`: los casos de la bandeja que también corren los roles, sin rol (la línea base de hoy).
  const casos = (ROL ? casosDelRol(ROL) : conjunto === 'base-roles' ? [...CONJUNTO_1, ...CONJUNTO_RESPONSABLE, ...CONJUNTO_PERFIL, ...CONJUNTO_ADJUNTOS] : conjunto === 'adjuntos' ? CONJUNTO_ADJUNTOS : conjunto === 'responsable' ? CONJUNTO_RESPONSABLE : conjunto === 'perfil' ? CONJUNTO_PERFIL : [
    ...(conjunto === '2' ? [] : CONJUNTO_1), ...(conjunto === '1' ? [] : CONJUNTO_2), ...(conjunto === 'todo' ? CONJUNTO_PERFIL : []),
  ]).filter((c) => !solo || solo.includes(c.id));
  const resultados: ResultadoCaso[] = [];
  const transcripciones: string[] = [];
  const usoSim: UsoLlamado[] = [];
  const k = Math.max(1, Number(arg('--k') ?? 1));
  const porCaso = new Map<string, { pasa: boolean; daninas: number }>();
  for (let corrida = 1; corrida <= k; corrida++) {
    for (const c of casos) {
      const { r, usoSimulador, comercial } = await correrCaso(c);
      resultados.push(r);
      usoSim.push(...usoSimulador);
      transcripciones.push(transcripcion(c, r, comercial));
      const antes = porCaso.get(c.id) ?? { pasa: true, daninas: 0 };
      porCaso.set(c.id, { pasa: antes.pasa && r.exito.ok, daninas: antes.daninas + r.daninas.length });
      console.log(JSON.stringify({ caso: c.id, corrida, exito: r.exito.ok, motivo: r.exito.motivo, daninas: r.daninas.length, atajadas: r.atajadas.length, verificador: r.rechazosVerificador, caidos: r.caidos, pregunta_doble: r.preguntaDoble, tokens: r.uso.entrada + r.uso.salida + r.uso.razonamiento, error: r.error ?? null }));
    }
  }
  const t = tabla(resultados, PRECIOS);
  const sim = sumarUso([{ tipo: 'modelo', bot: 'simulador', uso: usoSim }], PRECIOS);
  const etiqueta = seco ? 'seco (modelo falso)' : HAIKU ? `${MODELO_HAIKU}, sin respaldo (agente, simulador, extracción y lectores; sin Gemini)` : `${CONFIG_POR_DEFECTO.principal.modelo} ${CONFIG_POR_DEFECTO.principal.razonamiento}, respaldo ${CONFIG_POR_DEFECTO.respaldo?.modelo} a los ${CONFIG_POR_DEFECTO.corteMs} ms${arg('--temperatura') !== undefined ? `, temperatura ${arg('--temperatura')}` : ', temperatura por defecto'}`;
  await Deno.mkdir(salida, { recursive: true });
  await Deno.writeTextFile(`${salida}/resultados.json`, JSON.stringify({ etiqueta, tabla: t, simulador: sim, resultados }, null, 2));
  const resumen = [
    `# Arnés del núcleo conversacional — ${etiqueta}`,
    '',
    `Corrida: ${new Date().toISOString()} · casos: ${t.casos} · conjunto ${conjunto}. Base en memoria; datos inventados.`,
    '',
    '| Métrica | Valor |',
    '|---|---|',
    `| Dañinas (llegaron) | ${t.daninas} |`,
    `| Atajadas por candado o verificador | ${t.atajadas} |`,
    `| Rechazos del verificador (cada uno cuesta un llamado) | ${t.rechazosVerificador} |`,
    `| Turnos que terminaron en «no pude» (rf.modelo_caido) | ${t.caidos} |`,
    `| Propuestas con la pregunta repetida arriba del resumen | ${t.preguntaDoble} |`,
    ...(extracciones.length ? [`| Extracción real (${HAIKU ? MODELO_HAIKU : MODELO_EXTRACCION}, n=${extracciones.length}) | ${extracciones.filter((x) => !x.ok).length} fallas · ms ${extracciones.map((x) => x.ms).join(', ')} |`] : []),
    `| Éxito de la tarea | ${t.exitos} de ${t.casos} |`,
    ...Object.entries(t.porTipo).map(([k, v]) => `| Turno ${k} (n=${v.n}) | p50 ${v.p50 ?? '—'} ms · p90 ${v.p90 ?? '—'} ms |`),
    `| Todos los turnos con modelo (n=${t.modelo.n}) | p50 ${t.modelo.p50 ?? '—'} ms · p90 ${t.modelo.p90 ?? '—'} ms |`,
    `| Tokens del agente | entrada ${t.uso.entrada} · salida ${t.uso.salida} · razonamiento ${t.uso.razonamiento} · caché ${t.uso.cache} · ${t.uso.llamados} llamados en ${t.uso.turnos} turnos |`,
    `| Gasto del agente | ${t.uso.costo_usd === null ? 'sin precio' : `${t.uso.costo_usd.toFixed(4)} USD`} |`,
    `| Tokens y gasto del simulador | entrada ${sim.entrada} · salida ${sim.salida + sim.razonamiento} · ${sim.costo_usd === null ? 'sin precio' : `${sim.costo_usd.toFixed(4)} USD`} |`,
    '',
    'Latencia: desde que la fila entra (el webhook) hasta el primer envío, con la base en memoria y sin el envío a Meta.',
    '',
    ...transcripciones,
  ].join('\n');
  await Deno.writeTextFile(`${salida}/transcripciones.md`, resumen);
  // El banco para publicar (`asistente_publicar_rol`), con la huella de las fichas con que corrieron los casos.
  const banco = await bancoDelArnes({
    fichas: FICHAS_ROL ?? conPerfil(REGLAMENTO_ANEXO_A), k,
    arnes: `arnes/correr.ts ${ROL ? `--rol ${ROL}${arg('--fichas-base') ? ' --fichas-base <json>' : ''}` : `--conjunto ${conjunto}`}${solo ? ` --solo ${solo.join(',')}` : ''}${arg('--excluir') ? ` --excluir ${arg('--excluir')}` : ''}`,
    modelo: seco ? 'seco' : HAIKU ? MODELO_HAIKU : CONFIG_POR_DEFECTO.principal.modelo, seco,
    resultados: [...porCaso].map(([id, x]) => ({ id, pasa: x.pasa, daninas: x.daninas })),
    excluidos: arg('--excluir')?.split(',').filter(Boolean),
  });
  // Con Haiku, un pedido que quiso salir a otro lado (Gemini) invalida la corrida: no se deja banco.
  if (HAIKU?.bloqueados.length) {
    console.error(JSON.stringify({ error: 'pedidos bloqueados (no eran a Anthropic): sin banco', bloqueados: [...new Set(HAIKU.bloqueados)] }));
    Deno.exit(4);
  }
  await Deno.writeTextFile(`${salida}/banco.json`, JSON.stringify(banco, null, 2));
  console.log(JSON.stringify({ tabla: t, simulador: { entrada: sim.entrada, salida: sim.salida, costo_usd: sim.costo_usd } }));
}
