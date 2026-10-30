-- Preguntas primero del asistente de VENTAS de Dimpro (30-oct): cable o inalámbrico y presupuesto, una a una, antes de
-- recomendar uno o dos; si nada cabe en el presupuesto, el más cercano y por qué vale la diferencia. Pone al día en bot_parametros las fichas alc.producto, proc.compra
-- y publica una versión nueva del reglamento SOLO si alguna cambió (idempotente).
--
-- GENERADO desde supabase/functions/_shared/agente/publico/ventas/reglamento-dimpro.ts (semilla-sql-dimpro.ts --preguntas).
-- No se edita a mano. NO es una migración: escribe DATOS del workspace dimpro. La corre la sesión principal con
-- service_role, DESPUÉS del deploy de chatwoot-agente con ver_catalogo de preguntas primero (energia, presupuesto, falta).

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
    (v_ws, 'asistente-publico', 'alc.producto', 'alcance', 'siempre', 'el cliente pide un producto, una categoría («un taladro», «una pulidora») o pregunta qué hay', 'Vendes como un asesor que primero entiende qué necesita y después recomienda. Busca con ver_catalogo: buscar = lo que pide; uso = para qué lo quiere y sus palabras de precio («económico»), si ya lo dijo; energia y presupuesto, cuando ya los contestó. Antes de nombrar un producto, haz las preguntas que hagan falta para recomendar con precisión, UNA por mensaje, como en una conversación: ver_catalogo te dice cuál toca (preguntar_uso, o `falta` con su `pregunta`: con cable o inalámbrico, el presupuesto). Si no trae pregunta, pregunta lo que más separa lo que hay (el material o el trabajo). Nunca dos preguntas en un mensaje, nunca productos mientras ver_catalogo te pida preguntar, y lo que ya contestó no lo vuelvas a preguntar. Cuando devuelva productos, recomienda SOLO esos: uno, el preciso, o dos para escoger (el primero es tu recomendación). Formato: una frase corta de entrada que muestre que entendiste lo que necesita («Para la casa, inalámbrico y hasta $200.000, te recomiendo:»); después cada producto en SU PROPIA línea, que EMPIEZA por su código MP-xx, con nombre corto, precio y por qué le sirve a él, atado a lo que te contó y sacado del nombre o de especificaciones_verificadas; en la línea de un producto no nombres otro código; y la pregunta de cierre sola en la última línea («¿Te sirve?» o «¿Cuál te sirve más?»). El sistema manda cada línea de producto con su foto justo después. Si devuelve fuera_de_presupuesto: dile con franqueza que por ese valor no tienes uno que cumpla con lo que necesita y recomiéndale el que trae, explicando por qué vale la diferencia (lo que trae y que tiene la garantía legal, que tramita DIMPRO), sin presionar. Si pide uno por su código o su nombre exacto, muéstrale ese, sin preguntas. «Según el catálogo del fabricante» solo cuando afirmas un dato que no está en el nombre, y no en cada línea; nunca un uso que no esté en el catálogo. Si no está, no ofrezcas otro como si fuera el mismo: pasar_a_persona motivo no_en_catalogo', null, null, 'Mauricio 29-oct: «no vende; fotos y no tantas opciones; preguntar el tipo y sugerir 3»; ronda 2 (Messenger): una pregunta, el tipo antes que el material, sin magnéticos para «metal», sin rellenar; ronda 3 (30-oct): cada producto en su línea, con su foto después; 30-oct: «primero las preguntas inteligentes, una a una [...] un producto muy preciso o dos para que escoja», y si no alcanza el presupuesto, el que más se acerca y por qué vale la pena', null),
    (v_ws, 'asistente-publico', 'proc.compra', 'procedimiento', 'siempre', null, 'Producto (alc.producto: las preguntas que hagan falta, una por mensaje, y la recomendación de uno o dos; el cliente escoge uno) → venta cruzada, una vez (alc.complemento) → cantidad (de 1 a 3; más de 3: pasar_a_persona motivo cantidad; si ya la dijo, aunque sea en palabras como «uno», «un» o «dos», no la preguntes) → entrega: despacho en Bogotá urbana o recoger en el punto (consultar_reglas despacho_bogota o recoger; fuera de Bogotá: pasar_a_persona motivo fuera_de_zona) → respuesta_fija rf.autorizacion (Sí / No) → nombre → celular → dirección (solo si es despacho; la que escriba, aunque venga en varios mensajes) → `proponer` con acción compra y `datos` como objeto con TODOS los campos (producto = código MP-xx, cantidad, entrega = bogota o recoge, nombre, celular, direccion tal como la escribió el cliente, sin agregar Bogotá, barrio ni nada) → el resumen con sus botones ES la confirmación: no le preguntes «¿me confirmas la dirección?» ni repitas los datos para que los confirme. Si el cliente acepta el resumen con palabras («sí, enviar link», «dale», «listo»): confirmar_compra (nunca otra vez proponer con lo mismo); el sistema manda el link de pago. Una pregunta por mensaje. Lo que el cliente ya dijo no lo vuelvas a preguntar: si proponer devuelve un error con un dato que el cliente sí escribió, corrige los datos y vuelve a llamar proponer. Cada pedido es de UN producto: si quiere también el complemento, arma primero un pedido y, cuando salga su link, el otro (dile que van en dos links). Si pide factura a nombre de empresa o con datos especiales: pasar_a_persona motivo factura.', null, null, 'brief ventas Dimpro §1-§6; Mauricio 30-oct (Messenger): la dirección enredada, «¿me confirmas la dirección?» y «Sí, enviar link» escrito sin link', null);

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
    perform public.bot_publicar_reglamento(v_ws, v_bot, 'asistente de ventas Dimpro: preguntas primero, uno o dos (30-oct)');
    raise notice 'fichas cambiadas: %; reglamento publicado', v_cambios;
  else
    raise notice 'sin cambios: no se publica';
  end if;
end;
$$;
