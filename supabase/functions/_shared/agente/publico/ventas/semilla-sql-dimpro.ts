// ============================================================
// La semilla SQL del reglamento del asistente de VENTAS de Dimpro (ensayo con conocidos, 29-oct)
// ------------------------------------------------------------
// Genera `sql/dimpro/2026-10-29_reglamento-asistente-ventas-ENSAYO.sql` desde `reglamento-dimpro.ts` (una sola fuente);
// la prueba exige que el archivo sea exactamente esta salida. NO es una migración: ESCRIBE DATOS en producción (las
// fichas en `bot_parametros` y la versión publicada en `bot_reglamentos`, solo del workspace dimpro). La corre la sesión
// principal con service_role, con el visto de Mauricio. Se niega a correr sobre otro workspace.
// Uso: deno run supabase/functions/_shared/agente/publico/ventas/semilla-sql-dimpro.ts > sql/dimpro/2026-10-29_reglamento-asistente-ventas-ENSAYO.sql
// ============================================================

import { BOT_PUBLICO } from '../dominio.ts';
import { filasFichas, lit } from '../semilla-sql.ts';
import type { Ficha } from '../../tipos.ts';
import { REGLAMENTO_DIMPRO } from './reglamento-dimpro.ts';
import { CLAVE_COMPLEMENTOS, fichaComplementos, mapaComplementos } from './complementos-ventas.ts';
import type { MapaComplementos } from './complementos-ventas.ts';

export const WORKSPACE_DIMPRO = '67f7af44-b5ac-4d5c-aa9e-44954368447c';

export function semillaSqlDimpro(fichas: Ficha[] = REGLAMENTO_DIMPRO): string {
  return `-- Reglamento del asistente de VENTAS de Dimpro (bot ${BOT_PUBLICO}, dominio ventas) — ENSAYO CON CONOCIDOS, 29-oct.
--
-- GENERADO desde supabase/functions/_shared/agente/publico/ventas/reglamento-dimpro.ts (semilla-sql-dimpro.ts). No se
-- edita a mano. NO es una migración: escribe DATOS del workspace dimpro (bot_parametros + versión publicada en
-- bot_reglamentos). Las políticas de despacho, recoger, flete, garantía, cambios y factura son [ENSAYO 29-oct]
-- (inventadas; las cambia Mauricio). Los textos de aviso y autorización son borrador (falta el visto de Emilio).
-- El catálogo y los precios NO van aquí: se leen de Ferretería en cada turno.
--
-- Para encender el asistente hace falta además (no lo hace este archivo):
--   config_extra.bot_conversacional.chatwoot = { activo, dominio: 'ventas', cuenta_id, inboxes, terminos_url, ... },
--   los secretos CHATWOOT_WEBHOOK_SECRET_DIMPRO y CHATWOOT_API_TOKEN_DIMPRO, las llaves de Bold en la bóveda de dimpro y
--   la URL del webhook de Bold (/api/webhooks/bold/funciones/${WORKSPACE_DIMPRO}) en el panel de Bold.

do $$
declare
  v_ws uuid := ${lit(WORKSPACE_DIMPRO)};
begin
  if not exists (select 1 from public.workspaces where id = v_ws and slug = 'dimpro') then
    raise exception 'este reglamento es solo del workspace dimpro';
  end if;

  insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  values
${filasFichas(fichas).join(',\n')}
  on conflict do nothing;

  perform public.bot_publicar_reglamento(v_ws, ${lit(BOT_PUBLICO)}, 'asistente de ventas Dimpro: ensayo con conocidos (29-oct)');
end;
$$;
`;
}

/** Las fichas que cambió la venta consultiva (Mauricio, 29-oct): `inv.tres` es nueva; las demás se reescriben. */
export const CLAVES_VENTA_CONSULTIVA = ['alc.producto', 'inv.urgencia', 'inv.tres', 'proc.compra', 'est.breve'];

/**
 * El SQL que pone al día el reglamento PUBLICADO de dimpro con unas fichas del código (por defecto, las de la venta
 * consultiva): actualiza las que cambiaron, inserta las que faltan y, solo si algo cambió, publica una versión nueva.
 * Idempotente: correrlo dos veces no publica dos veces. Archivo: `sql/dimpro/2026-10-29_reglamento-ventas-consultiva.sql`.
 * Uso: deno run supabase/functions/_shared/agente/publico/ventas/semilla-sql-dimpro.ts --consultiva > sql/dimpro/2026-10-29_reglamento-ventas-consultiva.sql
 */
/** Ronda 2 (Mauricio probó en Messenger el 29-oct: «tiene muchos errores»): saludo, una pregunta, relevancia, fotos y redacción. */
export const CLAVES_RONDA_2 = ['alc.saludo', 'alc.producto', 'alc.foto', 'inv.ficha', 'est.breve'];

/** El encabezado y la nota de publicación de cada actualización. */
interface TextosActualizacion { titulo: string; uso: string; despues: string; nota: string }
const TEXTOS_CONSULTIVA: TextosActualizacion = {
  titulo: 'Venta consultiva del asistente de VENTAS de Dimpro (29-oct): una pregunta de uso, máximo 3 sugerencias con su razón y\n-- las fotos que manda el código.',
  uso: 'semilla-sql-dimpro.ts --consultiva',
  despues: 'DESPUÉS del deploy de chatwoot-agente con el código de este cambio (ver_catalogo con `uso` y las fotos).',
  nota: 'asistente de ventas Dimpro: venta consultiva y fotos (29-oct)',
};
export const TEXTOS_RONDA_2: TextosActualizacion = {
  titulo: 'Ronda 2 del asistente de VENTAS de Dimpro (29-oct, prueba de Mauricio en Messenger): saludo sin suponer producto,\n-- una sola pregunta (de mano o magnético), solo lo que sirve para el uso, la foto que no hay y la razón sin muletilla.',
  uso: 'semilla-sql-dimpro.ts --ronda2',
  despues: 'DESPUÉS del deploy de chatwoot-agente con el código de este cambio (ver_catalogo con la `pregunta`, el estado con las fotos).',
  nota: 'asistente de ventas Dimpro: ronda 2 (saludo, una pregunta, relevancia, fotos) (29-oct)',
};

/**
 * Ronda 3 (30-oct, Messenger): cada producto en su línea con su foto después; el código y el nombre solo al presentar;
 * el dato llano, sin «tengo verificado»; lo que no está en la ficha se ofrece a una persona (no «lo dejamos anotado»);
 * la dirección como la escribió el cliente; la aceptación escrita del pedido; la venta cruzada una vez.
 * `ventas.complementos` NO va aquí: tiene su propio SQL (`--complementos`) y esta ronda no debe pisar el mapa cargado.
 */
export const CLAVES_RONDA_3 = ['alc.producto', 'alc.foto', 'alc.complemento', 'alc.especificacion', 'inv.ficha', 'est.breve', 'proc.compra'];
export const TEXTOS_RONDA_3: TextosActualizacion = {
  titulo: 'Ronda 3 del asistente de VENTAS de Dimpro (30-oct, prueba de Mauricio en Messenger): cada producto en su línea\n-- (el código lo publica con su foto justo después), sin repetir código, nombre ni datos, el dato llano, lo que no\n-- está en la ficha ofrecido a una persona, la dirección como la escribió el cliente, el «sí» escrito al pedido y la\n-- venta cruzada una vez.',
  uso: 'semilla-sql-dimpro.ts --ronda3',
  despues: 'DESPUÉS del deploy de chatwoot-agente con el código de este cambio (respuesta partida, ver_complementos,\n-- confirmar_compra).',
  nota: 'asistente de ventas Dimpro: ronda 3 (producto y su foto, sin repetir, dirección, sí escrito, venta cruzada) (30-oct)',
};

/** El nombre del bot (Mauricio, 30-oct: «soy Dimi, asistente virtual de Dimpro»): el perfil y el saludo fijo. */
export const CLAVES_NOMBRE = ['perfil', 'rf.bienvenida'];
export const TEXTOS_NOMBRE: TextosActualizacion = {
  titulo: 'Nombre del asistente de VENTAS de Dimpro (30-oct): «Hola, soy Dimi, asistente virtual de Dimpro».',
  uso: 'semilla-sql-dimpro.ts --nombre',
  despues: 'en cualquier momento: no depende de un deploy (el saludo ya usa {nombre}).',
  nota: 'asistente de ventas Dimpro: se llama Dimi (30-oct)',
};

/** El saludo doble (Mauricio, 30-oct): el aviso ya presenta a Dimi; el modelo solo pregunta qué busca. */
export const CLAVES_SALUDO = ['alc.saludo'];
export const TEXTOS_SALUDO: TextosActualizacion = {
  titulo: 'Saludo del asistente de VENTAS de Dimpro (30-oct, «está saludando doble vez»): el modelo no se presenta ni saluda otra vez.',
  uso: 'semilla-sql-dimpro.ts --saludo',
  despues: 'en cualquier momento: no depende de un deploy.',
  nota: 'asistente de ventas Dimpro: sin saludo doble (30-oct)',
};

/** Preguntas primero (Mauricio, 30-oct): una a una hasta recomendar uno o dos, y el presupuesto que no alcanza. */
export const CLAVES_PREGUNTAS = ['alc.producto', 'proc.compra', 'est.breve'];
export const TEXTOS_PREGUNTAS: TextosActualizacion = {
  titulo: 'Preguntas primero del asistente de VENTAS de Dimpro (30-oct): cable o inalámbrico y presupuesto, una a una, antes de\n-- recomendar uno o dos; si nada cabe en el presupuesto, el más cercano y por qué vale la diferencia.',
  uso: 'semilla-sql-dimpro.ts --preguntas',
  despues: 'DESPUÉS del deploy de chatwoot-agente con ver_catalogo de preguntas primero (energia, presupuesto, falta).',
  nota: 'asistente de ventas Dimpro: preguntas primero, uno o dos (30-oct)',
};

/**
 * El SQL que carga (o reemplaza) el mapa de venta cruzada sin redesplegar: la ficha `ventas.complementos` con el mapa de
 * un JSON `{ "MP-38": [{ "codigo": "MP-30", "razon": "…" }] }`. Lo que no tenga código y razón se rechaza (no se carga
 * un mapa a medias). Idempotente como las demás. Los complementos que no estén publicados y activos se ignoran al
 * ofrecer, no al cargar.
 * Uso: deno run --allow-read …/semilla-sql-dimpro.ts --complementos <mapa.json> > sql/dimpro/<fecha>_venta-cruzada.sql
 */
export function complementosSqlDimpro(mapa: MapaComplementos, fuente: string): string {
  if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) throw new Error('el mapa tiene que ser un objeto { "MP-xx": [...] }');
  const leido = mapaComplementos({ fichas: [fichaComplementos(mapa, fuente)] });
  const entradas = Object.values(mapa).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
  const validas = [...leido.values()].reduce((n, l) => n + l.length, 0);
  if (validas !== entradas || leido.size !== Object.keys(mapa).length) throw new Error(`el mapa trae ${entradas - validas} complementos sin código o sin razón (o un código de producto inválido)`);
  return actualizacionSqlDimpro([CLAVE_COMPLEMENTOS], [fichaComplementos(mapa, fuente)], {
    titulo: `Mapa de venta cruzada del asistente de VENTAS de Dimpro: ${leido.size} productos, ${validas} complementos.`,
    uso: 'semilla-sql-dimpro.ts --complementos <mapa.json>',
    despues: 'DESPUÉS del deploy de chatwoot-agente con ver_complementos (ronda 3).',
    nota: `asistente de ventas Dimpro: mapa de venta cruzada (${leido.size} productos)`,
  });
}

export function actualizacionSqlDimpro(claves: string[] = CLAVES_VENTA_CONSULTIVA, fichas: Ficha[] = REGLAMENTO_DIMPRO, t: TextosActualizacion = TEXTOS_CONSULTIVA): string {
  const elegidas = claves.map((c) => {
    const f = fichas.find((x) => x.clave === c);
    if (!f) throw new Error(`la ficha ${c} no está en el reglamento`);
    return f;
  });
  return `-- ${t.titulo} Pone al día en bot_parametros las fichas ${claves.join(', ')}
-- y publica una versión nueva del reglamento SOLO si alguna cambió (idempotente).
--
-- GENERADO desde supabase/functions/_shared/agente/publico/ventas/reglamento-dimpro.ts (${t.uso}).
-- No se edita a mano. NO es una migración: escribe DATOS del workspace dimpro. La corre la sesión principal con
-- service_role, ${t.despues}

do $$
declare
  v_ws uuid := ${lit(WORKSPACE_DIMPRO)};
  v_bot text := ${lit(BOT_PUBLICO)};
  v_cambios integer := 0;
  v_n integer;
begin
  if not exists (select 1 from public.workspaces where id = v_ws and slug = 'dimpro') then
    raise exception 'este reglamento es solo del workspace dimpro';
  end if;

  create temporary table _fichas_dimpro (workspace_id uuid, bot text, clave text, tipo text, carga text, cuando text, hacer text, herramientas text[], prioridad integer, fuente text, valores jsonb) on commit drop;
  insert into _fichas_dimpro (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  values
${filasFichas(elegidas).join(',\n')};

  update public.bot_parametros p
     set tipo = f.tipo, carga = f.carga, cuando = f.cuando, hacer = f.hacer, herramientas = f.herramientas,
         prioridad = f.prioridad, fuente = f.fuente, valores = f.valores, activo = true, updated_at = now()
    from _fichas_dimpro f
   where p.workspace_id = v_ws and p.bot = v_bot and p.clave = f.clave
     and (p.tipo, p.carga, p.cuando, p.hacer, p.herramientas, p.prioridad, p.fuente, p.valores, p.activo)
         is distinct from (f.tipo, f.carga, f.cuando, f.hacer, f.herramientas, f.prioridad, f.fuente, f.valores, true);
  get diagnostics v_n = row_count;
  v_cambios := v_cambios + v_n;

  insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  select f.workspace_id, f.bot, f.clave, f.tipo, f.carga, f.cuando, f.hacer, f.herramientas, f.prioridad, f.fuente, f.valores
    from _fichas_dimpro f
   where not exists (select 1 from public.bot_parametros p where p.workspace_id = v_ws and p.bot = v_bot and p.clave = f.clave);
  get diagnostics v_n = row_count;
  v_cambios := v_cambios + v_n;

  if v_cambios > 0 then
    perform public.bot_publicar_reglamento(v_ws, v_bot, ${lit(t.nota)});
    raise notice 'fichas cambiadas: %; reglamento publicado', v_cambios;
  else
    raise notice 'sin cambios: no se publica';
  end if;
end;
$$;
`;
}

if (import.meta.main) {
  const iMapa = Deno.args.indexOf('--complementos');
  const sql = iMapa >= 0 ? complementosSqlDimpro(JSON.parse(Deno.readTextFileSync(Deno.args[iMapa + 1])), `mapa de venta cruzada (${Deno.args[iMapa + 1].split('/').pop()})`)
    : Deno.args.includes('--saludo') ? actualizacionSqlDimpro(CLAVES_SALUDO, REGLAMENTO_DIMPRO, TEXTOS_SALUDO)
    : Deno.args.includes('--preguntas') ? actualizacionSqlDimpro(CLAVES_PREGUNTAS, REGLAMENTO_DIMPRO, TEXTOS_PREGUNTAS)
    : Deno.args.includes('--nombre') ? actualizacionSqlDimpro(CLAVES_NOMBRE, REGLAMENTO_DIMPRO, TEXTOS_NOMBRE)
    : Deno.args.includes('--ronda3') ? actualizacionSqlDimpro(CLAVES_RONDA_3, REGLAMENTO_DIMPRO, TEXTOS_RONDA_3)
    : Deno.args.includes('--ronda2') ? actualizacionSqlDimpro(CLAVES_RONDA_2, REGLAMENTO_DIMPRO, TEXTOS_RONDA_2)
    : Deno.args.includes('--consultiva') ? actualizacionSqlDimpro() : semillaSqlDimpro();
  console.log(sql.trimEnd());
}
