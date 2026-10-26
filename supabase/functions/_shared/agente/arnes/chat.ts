// ============================================================
// Arnés del núcleo conversacional — modo chat en la terminal (para que Mauricio lo pruebe él mismo)
// ------------------------------------------------------------
// Tú escribes como el comercial; el núcleo responde turno a turno con el modelo real (llave de PRUEBAS) sobre una base
// en memoria con clientes y viajes inventados (los del conjunto 1 y dos clientes más con varios viajes abiertos) y el
// reglamento del Anexo A. Nada toca la base de verdad ni WhatsApp.
//
// Comandos: texto libre = escrito del comercial · /reenvio <texto> = reenvío del cliente · /toca <n> = tocar la opción n
// del último mensaje con botones o lista · /estado = cómo quedó la base · /salir = cierra y guarda la transcripción.
// Uso: bash supabase/functions/_shared/agente/arnes/chat.sh [--tope 0.30]
//      (--guion: modelo falso guionado, sin red ni gasto; sirve para probar la cañería).
// ============================================================

import { escenario } from '../escenario.ts';
import type { Escenario } from '../escenario.ts';
import { CONFIG_POR_DEFECTO } from '../config.ts';
import { modeloGemini } from '../modelo-gemini.ts';
import { modeloGuionado } from '../modelo-guionado.ts';
import { tanda } from '../bandeja/dominio.ts';
import type { ContactoMem, ViajeMem } from '../memoria.ts';
import type { Modelo, PedidoModelo, Salida, Traza } from '../tipos.ts';
import { sumarUso } from '../uso.ts';
import { CONJUNTO_1 } from './conjuntos.ts';
import { llamadaDeHumo, PRECIOS_312 } from './correr.ts';

const GRIS = '\x1b[90m';
const NEGRITA = '\x1b[1m';
const FIN = '\x1b[0m';
const SALIDA_DIR = '/home/mauricio/Developer/metrik/proyectos/trappvel/clarity/qa/bandeja-wa/nucleo-2026-10-06';

// ── La base inventada: el conjunto 1 y dos clientes más con varios viajes abiertos ──

const v = (id: string, codigo: string, contactoId: string, nombre: string): ViajeMem =>
  ({ id, codigo, contactoId, nombre, destino: nombre, abierto: true, datos: {} });

export function baseDelChat(): { contactos: ContactoMem[]; viajes: ViajeMem[] } {
  const c1 = CONJUNTO_1[0];
  return {
    contactos: [
      ...c1.contactos,
      { id: 'c-camila', nombre: 'CAMILA RIOS', celular: '3016660021', correo: 'camila.rios@ejemplo.co' },
      { id: 'c-jorge', nombre: 'JORGE TELLEZ', celular: '3182224455' },
    ],
    viajes: [
      ...c1.viajes,
      v('v-c1', 'C1 26 1', 'c-camila', 'EJE CAFETERO'), v('v-c2', 'C1 26 2', 'c-camila', 'CURAZAO'), v('v-c3', 'C1 26 3', 'c-camila', 'BUENOS AIRES'),
      v('v-j1', 'J1 26 1', 'c-jorge', 'SANTA MARTA'), v('v-j2', 'J1 26 2', 'c-jorge', 'ORLANDO'),
    ],
  };
}

// ── Lo que se ve ─────────────────────────────────────────────────────────────

export function verSalida(s: Salida): string {
  const lineas = [s.texto];
  if ('opciones' in s) s.opciones.forEach((o, i) => lineas.push(`  ${i + 1}. ${o.titulo}${o.descripcion ? ` — ${o.descripcion}` : ''}`));
  if ('opciones' in s) lineas.push(`${GRIS}  (toca con /toca <n> o contesta escribiendo)${FIN}`);
  return lineas.join('\n');
}

export function lineaGris(ms: number | null, trazas: Traza[]): string {
  const t = trazas.at(-1);
  if (!t) return `${GRIS}[sin respuesta]${FIN}`;
  if (t.tipo !== 'modelo') return `${GRIS}[${ms ?? '—'} ms · sin modelo (${t.tipo})]${FIN}`;
  const usos = t.uso ?? [];
  const llamados = usos.map((u) => `${u.modelo.replace('gemini-', '')}${u.ok ? '' : ` ✗${u.motivo ? ` ${u.motivo.split(':')[0]}` : ''}`}`).join(' → ');
  const respaldo = usos.filter((u) => u.modelo.includes('lite') && u.ok).length;
  const tok = usos.reduce((a, u) => ({ e: a.e + u.entrada, s: a.s + u.salida, r: a.r + u.razonamiento }), { e: 0, s: 0, r: 0 });
  const herr = (t.herramientas ?? []).map((h) => h.nombre).join(', ') || 'sin herramientas';
  const extra = [
    t.candados?.length ? `candado: ${t.candados.map((c) => c.candado).join(', ')}` : '',
    t.verificador?.length ? `verificador: ${t.verificador.length}` : '',
  ].filter(Boolean).join(' · ');
  return `${GRIS}[${ms ?? '—'} ms · ${t.llamados} llamado(s): ${llamados} · ${respaldo} al respaldo · ${herr} · tokens ${tok.e} entrada / ${tok.s} salida / ${tok.r} razonamiento${extra ? ` · ${extra}` : ''}]${FIN}`;
}

export function estadoDeLaBase(e: Escenario): string {
  const p = e.puerto;
  const nombre = (id: string) => p.contactos.find((c) => c.id === id)?.nombre ?? id;
  const t = tanda(e.almacen.filas);
  return [
    `${NEGRITA}Viajes abiertos${FIN}`,
    ...p.viajes.filter((x) => x.abierto).map((x) => `  ${x.codigo} · ${x.nombre} · ${nombre(x.contactoId)}${(x.datos.textos as string[] | undefined)?.length ? ` · cargado: ${(x.datos.textos as string[]).map((s) => `«${s.slice(0, 60)}»`).join(' ')}` : ''}`),
    `${NEGRITA}Tanda sin cargar${FIN} ${t.length ? '' : '(vacía)'}`,
    ...t.map((f) => `  «${(f.texto ?? '').slice(0, 80)}»`),
    `${NEGRITA}Escrituras de esta sesión${FIN} ${p.escrituras.length ? '' : '(ninguna)'}`,
    ...p.escrituras.map((w) => `  ${JSON.stringify(w)}`),
  ].join('\n');
}

export function gasto(e: Escenario): { usd: number; tokens: string } {
  const u = sumarUso(e.almacen.trazas(), PRECIOS_312);
  return { usd: u.costo_usd ?? 0, tokens: `entrada ${u.entrada} · salida ${u.salida} · razonamiento ${u.razonamiento} · ${u.llamados} llamados en ${u.turnos} turnos` };
}

// ── El modelo ────────────────────────────────────────────────────────────────

/** Guion de la prueba de cañería: buscar → responder; proponer viaje nuevo; (el toque no llama al modelo). */
function guion(): Modelo {
  return modeloGuionado([
    { name: 'buscar', args: { texto: 'Camila Ríos' } },
    { name: 'responder', args: { tema: 'solicitud', texto: 'Listo, viaje nuevo para Camila Rios, la que ya tenemos (cel. …0021). ¿A dónde quiere ir?', reglas_usadas: ['g.buscar_primero'] } },
    { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: 'Camila Rios (cel. …0021)', destino: 'Cartagena' } } },
    ...Array.from({ length: 50 }, () => (_p: PedidoModelo) => ({ name: 'responder', args: { tema: 'solicitud', texto: '(guion agotado)' } })),
  ], { modelo: 'guion' });
}

// ── La sesión ────────────────────────────────────────────────────────────────

async function* lineas(): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let resto = '';
  for await (const trozo of Deno.stdin.readable) {
    resto += dec.decode(trozo, { stream: true });
    let i: number;
    while ((i = resto.indexOf('\n')) >= 0) {
      yield resto.slice(0, i).replace(/\r$/, '');
      resto = resto.slice(i + 1);
    }
  }
  if (resto) yield resto;
}

function horaBogota(): string {
  const d = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10)}_${d.slice(11, 13)}${d.slice(14, 16)}${d.slice(17, 19)}`;
}

if (import.meta.main) {
  const args = Deno.args;
  const conGuion = args.includes('--guion');
  const i = args.indexOf('--tope');
  const tope = i >= 0 ? Number(args[i + 1]) : 0.30;
  let modelo: Modelo;
  if (conGuion) {
    modelo = guion();
    console.log(`${GRIS}Modo guion: modelo falso, sin red ni gasto.${FIN}`);
  } else {
    const llave = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (llave.length < 20) { console.error('Sin la llave de pruebas: corre esto con chat.sh.'); Deno.exit(2); }
    const h = await llamadaDeHumo(llave);
    if (h.status !== 200 || h.cuota) {
      console.error(`La llamada de humo falló (HTTP ${h.status}${h.cuota ? ', cuota agotada' : ''}). No se arranca.`);
      Deno.exit(3);
    }
    console.log(`${GRIS}Humo OK: HTTP 200 en ${h.ms} ms (${h.uso}). Tope de gasto: ${tope.toFixed(2)} USD.${FIN}`);
    modelo = modeloGemini({ llave, principal: CONFIG_POR_DEFECTO.principal, respaldo: CONFIG_POR_DEFECTO.respaldo, corteMs: CONFIG_POR_DEFECTO.corteMs });
  }
  const base = baseDelChat();
  const e = await escenario({ modelo, contactos: base.contactos, viajes: base.viajes, reloj: () => performance.now() });
  const transcripcion: string[] = [];
  const anotar = (quien: string, texto: string) => transcripcion.push(`**${quien}:** ${texto.replace(/\x1b\[[0-9;]*m/g, '').replace(/\n/g, '  \n')}`);

  console.log([
    `${NEGRITA}Núcleo conversacional — chat de prueba${FIN} (${conGuion ? 'guion' : `${CONFIG_POR_DEFECTO.principal.modelo} ${CONFIG_POR_DEFECTO.principal.razonamiento}, respaldo ${CONFIG_POR_DEFECTO.respaldo?.modelo}`})`,
    `${GRIS}Escribe como el comercial. /reenvio <texto> · /toca <n> · /estado · /salir. Base inventada: ${base.contactos.map((c) => c.nombre).join(', ')}.${FIN}`,
  ].join('\n'));

  let cortado = false;
  let avisado80 = false;
  const cerrar = async (motivo: string) => {
    const g = gasto(e);
    const archivo = `${SALIDA_DIR}/chat-${horaBogota()}.md`;
    await Deno.mkdir(SALIDA_DIR, { recursive: true });
    await Deno.writeTextFile(archivo, [
      `# Chat de prueba del núcleo — ${horaBogota().replace('_', ' ')} (Bogotá)`,
      '',
      `Modelo: ${conGuion ? 'guion (falso)' : `${CONFIG_POR_DEFECTO.principal.modelo} ${CONFIG_POR_DEFECTO.principal.razonamiento}, respaldo ${CONFIG_POR_DEFECTO.respaldo?.modelo} a los ${CONFIG_POR_DEFECTO.corteMs} ms`}. Base en memoria, datos inventados. Cierre: ${motivo}.`,
      '',
      `**Gasto:** ${g.usd.toFixed(4)} USD (precios de §3.12) · ${g.tokens}`,
      '',
      ...transcripcion.flatMap((l) => [l, '']),
      '## Estado final de la base',
      '',
      '```',
      estadoDeLaBase(e).replace(/\x1b\[[0-9;]*m/g, ''),
      '```',
      '',
    ].join('\n'));
    console.log(`${GRIS}Gasto: ${g.usd.toFixed(4)} USD · ${g.tokens}\nTranscripción: ${archivo}${FIN}`);
  };

  for await (const crudo of lineas()) {
    const linea = crudo.trim();
    if (!linea) continue;
    if (linea === '/salir') { await cerrar('/salir'); cortado = true; break; }
    if (linea === '/estado') { console.log(estadoDeLaBase(e)); continue; }
    let salidas: Salida[];
    try {
      if (linea.startsWith('/reenvio ')) {
        const t = linea.slice('/reenvio '.length).trim();
        anotar('Comercial (reenvío del cliente)', t);
        salidas = await e.reenvia(t);
      } else if (linea.startsWith('/toca')) {
        const n = Number(linea.slice('/toca'.length).trim());
        const ultimo = [...e.mensajero.enviados].reverse().find((x) => 'opciones' in x.salida);
        const ops = ultimo && 'opciones' in ultimo.salida ? ultimo.salida.opciones : [];
        if (!Number.isInteger(n) || n < 1 || n > ops.length) { console.log(`${GRIS}No hay una opción ${linea.slice(5).trim() || '(sin número)'}: el último mensaje con opciones tiene ${ops.length}.${FIN}`); continue; }
        anotar('Comercial', `[toque: ${ops[n - 1].titulo}]`);
        salidas = await e.toca(ops[n - 1].titulo);
      } else if (linea.startsWith('/')) {
        console.log(`${GRIS}Comando desconocido. /reenvio <texto> · /toca <n> · /estado · /salir${FIN}`);
        continue;
      } else {
        anotar('Comercial', linea);
        salidas = await e.escribe(linea);
      }
    } catch (err) {
      console.log(`${GRIS}[error del arnés: ${String(err).slice(0, 200)}]${FIN}`);
      continue;
    }
    const paso = e.pasos.at(-1)!;
    for (const s of salidas) { console.log(verSalida(s)); anotar('Bot', verSalida(s)); }
    const gris = lineaGris(paso.ms, paso.trazas);
    console.log(gris);
    transcripcion.push(`<sub>${gris.replace(/\x1b\[[0-9;]*m/g, '')}</sub>`);
    const g = gasto(e);
    if (!avisado80 && g.usd >= tope * 0.8 && g.usd < tope) {
      avisado80 = true;
      console.log(`${NEGRITA}Aviso: van ${g.usd.toFixed(4)} USD, el 80 % del tope de ${tope.toFixed(2)} USD de esta sesión.${FIN}`);
    }
    if (g.usd >= tope) {
      console.log(`${NEGRITA}Se llegó al tope de gasto de la sesión (${g.usd.toFixed(4)} de ${tope.toFixed(2)} USD): se corta aquí.${FIN}`);
      await cerrar(`tope de gasto (${tope.toFixed(2)} USD)`);
      cortado = true;
      break;
    }
  }
  if (!cortado) await cerrar('fin de la entrada');
}
