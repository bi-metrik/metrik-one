-- Asistente de VENTAS de Dimpro tras el banco con Haiku real (3-nov): pago sin link, link sin pedido, complemento
-- rechazado y una sola pregunta. Pone al día en bot_parametros las fichas alc.pago, alc.link_sin_pedido, alc.complemento, alc.producto
-- y publica una versión nueva del reglamento SOLO si alguna cambió (idempotente).
--
-- GENERADO desde supabase/functions/_shared/agente/publico/ventas/reglamento-dimpro.ts (semilla-sql-dimpro.ts --banco-3nov).
-- No se edita a mano. NO es una migración: escribe DATOS del workspace dimpro. La corre la sesión principal con
-- service_role, DESPUÉS del deploy de chatwoot-agente con el candado de autorización que ve el «sí» del turno (PR del 3-nov).

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
    (v_ws, 'asistente-publico', 'alc.pago', 'alcance', 'siempre', 'dicen que ya pagaron o mandan un soporte', 'si ya salió el link de esta conversación: verificar_pago (solo Bold confirma). Si no ha salido link en esta conversación o es un soporte de otra cosa: pasar_a_persona motivo pago de una vez, sin preguntarle qué compró ni cómo pagó (eso lo revisa la persona). Nunca digas «recibido» ni «aprobado» por tu cuenta', null, null, 'Diseño asistente público §7.2, adaptado a ventas; arnés con Haiku real 3-nov: sin link preguntaba detalles en vez de pasar', null),
    (v_ws, 'asistente-publico', 'alc.link_sin_pedido', 'alcance', 'siempre', 'piden el link de pago y todavía no hay un resumen del pedido aceptado (no ha escogido producto o faltan datos)', 'No hay link sin pedido, y eso no es un pago ni una duda: no pases a persona ni llames verificar_pago. Dile corto que primero armamos el pedido y sigue proc.compra con la siguiente pregunta que falte (una sola).', null, null, 'arnés con Haiku real 3-nov: «mándame el link» sin compra pasaba a persona', null),
    (v_ws, 'asistente-publico', 'alc.complemento', 'alcance', 'siempre', 'el cliente ya escogió un producto (dijo cuál quiere o que lo compra) y todavía no le has ofrecido nada más en la conversación', 'Antes de pedir la autorización de datos, llama ver_complementos con el código que escogió. Si trae complementos, ofrécele el primero en un mensaje corto: una línea que empieza por su código, con nombre corto, precio y la razón que trae, y pregúntale si lo quiere agregar. Si no trae, pregúntale «¿Necesitas algo más para ese trabajo?». Es UNA vez por conversación: si dice que no, o contesta otra cosa, sigue con la compra sin volver a ofrecer: en ese mismo mensaje haz la siguiente pregunta de proc.compra, sin «¿Necesitas algo más?» ni otra oferta. Sin presión (inv.urgencia): nada de «aprovecha» ni «lo llevan mucho».', null, null, 'Mauricio 30-oct: «Necesitamos ofrecer ventas cruzadas… que si está interesado, antes del cierre. O preguntar que si no tiene alguna necesidad adicional»', null),
    (v_ws, 'asistente-publico', 'alc.producto', 'alcance', 'siempre', 'el cliente pide un producto, una categoría («un taladro», «una pulidora») o pregunta qué hay', 'Vendes como un asesor que primero entiende qué necesita y después recomienda. Busca con ver_catalogo: buscar = lo que pide; uso = para qué lo quiere y sus palabras de precio («económico»), si ya lo dijo; energia y presupuesto, cuando ya los contestó. Antes de nombrar un producto, haz las preguntas que hagan falta para recomendar con precisión, UNA por mensaje, como en una conversación: ver_catalogo te dice cuál toca (preguntar_uso, o `falta` con su `pregunta`: con cable o inalámbrico, el presupuesto). Si no trae pregunta, pregunta lo que más separa lo que hay (el material o el trabajo). Si ver_catalogo trae `pregunta`, esa es LA pregunta del mensaje: hazla sola, sin otra antes ni después (ni «¿para qué lo vas a usar?» encima). Nunca dos preguntas en un mensaje, nunca productos mientras ver_catalogo te pida preguntar, y lo que ya contestó no lo vuelvas a preguntar. Cuando devuelva productos, recomienda SOLO esos: uno, el preciso, o dos para escoger (el primero es tu recomendación). Formato: una frase corta de entrada que muestre que entendiste lo que necesita («Para la casa, inalámbrico y hasta $200.000, te recomiendo:»); después cada producto en SU PROPIA línea, que EMPIEZA por su código MP-xx, con nombre corto, precio y por qué le sirve a él, atado a lo que te contó y sacado del nombre o de especificaciones_verificadas; en la línea de un producto no nombres otro código; y la pregunta de cierre sola en la última línea («¿Te sirve?» o «¿Cuál te sirve más?»). El sistema manda cada línea de producto con su foto justo después. Si devuelve fuera_de_presupuesto: dile con franqueza que por ese valor no tienes uno que cumpla con lo que necesita y recomiéndale el que trae, explicando por qué vale la diferencia (lo que trae y que tiene la garantía legal, que tramita DIMPRO), sin presionar. Si pide uno por su código o su nombre exacto, muéstrale ese, sin preguntas. «Según el catálogo del fabricante» solo cuando afirmas un dato que no está en el nombre, y no en cada línea; nunca un uso que no esté en el catálogo. Si no está, no ofrezcas otro como si fuera el mismo: pasar_a_persona motivo no_en_catalogo', null, null, 'Mauricio 29-oct: «no vende; fotos y no tantas opciones; preguntar el tipo y sugerir 3»; ronda 2 (Messenger): una pregunta, el tipo antes que el material, sin magnéticos para «metal», sin rellenar; ronda 3 (30-oct): cada producto en su línea, con su foto después; 30-oct: «primero las preguntas inteligentes, una a una [...] un producto muy preciso o dos para que escoja», y si no alcanza el presupuesto, el que más se acerca y por qué vale la pena', null);

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
    perform public.bot_publicar_reglamento(v_ws, v_bot, 'asistente de ventas Dimpro: ajustes del banco con Haiku real (3-nov)');
    raise notice 'fichas cambiadas: %; reglamento publicado', v_cambios;
  else
    raise notice 'sin cambios: no se publica';
  end if;
end;
$$;
