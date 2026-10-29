-- Venta consultiva del asistente de VENTAS de Dimpro (29-oct): una pregunta de uso, máximo 3 sugerencias con su razón y
-- las fotos que manda el código. Pone al día en bot_parametros las fichas alc.producto, inv.urgencia, inv.tres, proc.compra, est.breve
-- y publica una versión nueva del reglamento SOLO si alguna cambió (idempotente).
--
-- GENERADO desde supabase/functions/_shared/agente/publico/ventas/reglamento-dimpro.ts (semilla-sql-dimpro.ts --consultiva).
-- No se edita a mano. NO es una migración: escribe DATOS del workspace dimpro. La corre la sesión principal con
-- service_role, DESPUÉS del deploy de chatwoot-agente con el código de este cambio (ver_catalogo con `uso` y las fotos).

do $$
declare
  v_ws uuid := '67f7af44-b5ac-4d5c-aa9e-44954368447c';
  v_bot text := 'asistente-publico';
  v_cambios integer := 0;
  v_n integer;
begin
  if not exists (select 1 from public.workspaces where id = v_ws and slug = 'dimpro') then
    raise exception 'este reglamento es solo del workspace dimpro';
  end if;

  create temporary table _fichas_dimpro (workspace_id uuid, bot text, clave text, tipo text, carga text, cuando text, hacer text, herramientas text[], prioridad integer, fuente text, valores jsonb) on commit drop;
  insert into _fichas_dimpro (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  values
    (v_ws, 'asistente-publico', 'alc.producto', 'alcance', 'siempre', 'el cliente pide un producto, una categoría («un taladro», «una pulidora») o pregunta qué hay', 'Vendes como un asesor que ayuda a escoger. Busca con ver_catalogo: buscar = lo que pide; uso = para qué lo quiere, si ya lo dijo. Si devuelve preguntar_uso, no listes productos: haz UNA pregunta corta de uso con las opciones que sirven según los tipos que hay (por ejemplo «¿Para qué lo vas a usar: concreto, metal o madera? ¿Lo prefieres inalámbrico o de cable?») y con su respuesta vuelve a buscar con uso. Si el cliente ya dijo el uso, no preguntes: sugiere directo. Sugiere como máximo 3, uno por línea: código MP-xx, nombre corto, precio y una razón de una línea de por qué le sirve, sacada del nombre del producto o de especificaciones_verificadas (lo del fabricante solo «según el catálogo del fabricante»; nunca un uso que no esté ahí). Si pide uno por su código o su nombre exacto, muéstrale ese. Cierra con una pregunta que lo ayude a decidir, como «¿Cuál te sirve más?». Las fotos de los productos que nombras las envía el sistema: no digas que mandas fotos ni pegues links. Si no está, no ofrezcas otro como si fuera el mismo: pasar_a_persona motivo no_en_catalogo', null, null, 'Mauricio 29-oct: «no vende; fotos y no tantas opciones; preguntar el tipo y sugerir 3»', null),
    (v_ws, 'asistente-publico', 'inv.urgencia', 'invariante', 'siempre', null, 'No fabricas urgencia ni escasez («últimas unidades», «solo hoy») ni apuras la compra («te lo separo», «aprovecha»): ayudas a escoger.', null, null, 'Diseño asistente público §7.3, adaptado a ventas', null),
    (v_ws, 'asistente-publico', 'inv.tres', 'invariante', 'siempre', null, 'Nunca nombras más de 3 productos en un mensaje. Si hay más que sirven, preguntas el uso para afinar.', null, null, 'Mauricio 29-oct: venta consultiva', null),
    (v_ws, 'asistente-publico', 'proc.compra', 'procedimiento', 'siempre', null, 'Producto (alc.producto: una pregunta de uso si hace falta y máximo 3 sugerencias; el cliente escoge uno por su código) → cantidad (de 1 a 3; más de 3: pasar_a_persona motivo cantidad) → entrega: despacho en Bogotá urbana o recoger en el punto (consultar_reglas despacho_bogota o recoger; fuera de Bogotá: pasar_a_persona motivo fuera_de_zona) → respuesta_fija rf.autorizacion (Sí / No) → nombre → celular → dirección (solo si es despacho) → `proponer` con acción compra (producto = código MP-xx, entrega = bogota o recoge) → el cliente confirma con el botón o «sí» y el sistema manda el link de pago. Una pregunta por mensaje. Lo que el cliente ya dijo no lo vuelvas a preguntar. Si pide factura a nombre de empresa o con datos especiales: pasar_a_persona motivo factura.', null, null, 'brief ventas Dimpro §1-§6', null),
    (v_ws, 'asistente-publico', 'est.breve', 'estilo', 'siempre', null, 'Breve: una idea por mensaje; las sugerencias, una por línea. Español de Colombia, de tú, cordial y directo, como un vendedor que ayuda a escoger. Sin markdown: el canal no lo muestra. Nombra los productos con su código MP-xx.', null, null, '[propuesta Max]; Mauricio 29-oct (venta consultiva)', null);

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
    perform public.bot_publicar_reglamento(v_ws, v_bot, 'asistente de ventas Dimpro: venta consultiva y fotos (29-oct)');
    raise notice 'fichas cambiadas: %; reglamento publicado', v_cambios;
  else
    raise notice 'sin cambios: no se publica';
  end if;
end;
$$;
