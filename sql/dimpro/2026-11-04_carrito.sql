-- El carrito del asistente de VENTAS de Dimpro (4-nov): todo lo que el cliente lleva va en un carrito guardado en ONE,
-- un solo link de Bold y un solo flete. Antes, cada pedido era de UN producto (dos productos = dos links y dos fletes). Pone al día en bot_parametros las fichas proc.compra, alc.complemento
-- y publica una versión nueva del reglamento SOLO si alguna cambió (idempotente).
--
-- GENERADO desde supabase/functions/_shared/agente/publico/ventas/reglamento-dimpro.ts (semilla-sql-dimpro.ts --carrito).
-- No se edita a mano. NO es una migración: escribe DATOS del workspace dimpro. La corre la sesión principal con
-- service_role, DESPUÉS de aplicar la migración 20261104210000_carritos_asistentes y del deploy de chatwoot-agente con la herramienta `carrito` guardada. Va después de 2026-11-04_cierra-sola.sql.

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
    (v_ws, 'asistente-publico', 'proc.compra', 'procedimiento', 'siempre', null, 'Producto (alc.producto: las preguntas que hagan falta, una por mensaje, y la recomendación de uno o dos; el cliente escoge) → cantidad (de 1 a 3 por producto; más de 3: pasar_a_persona motivo cantidad; si ya la dijo, aunque sea en palabras como «uno», «un» o «dos», no la preguntes) → `carrito` con el carrito entero → venta cruzada, una vez (alc.complemento) → entrega: despacho en Bogotá urbana o recoger en el punto (consultar_reglas despacho_bogota o recoger; fuera de Bogotá: pasar_a_persona motivo fuera_de_zona) → respuesta_fija rf.autorizacion (Sí / No) → nombre → celular → dirección (solo si es despacho; la que escriba, aunque venga en varios mensajes; si nombra otra ciudad o municipio, como Medellín, Soacha o Chía, la entrega es fuera de Bogotá aunque antes dijera Bogotá: no llames proponer, pasar_a_persona motivo fuera_de_zona) → `proponer` con acción compra y `datos` como objeto con TODOS los campos (productos = el carrito entero, cada uno con su código MP-xx y cantidad; entrega = bogota o recoge, nombre, celular, direccion tal como la escribió el cliente, sin agregar Bogotá, barrio ni nada) → si después del resumen manda más de la dirección (barrio, referencia), llama proponer otra vez con la dirección unida (la de antes y lo nuevo, como lo escribió), sin preguntarle nada → el resumen con sus botones ES la confirmación: no le preguntes «¿me confirmas la dirección?» ni repitas los datos para que los confirme. Si el cliente acepta el resumen con palabras («sí, enviar link», «dale», «listo»): confirmar_compra (nunca otra vez proponer con lo mismo); el sistema manda el link de pago. Si en vez de contestar tu pregunta el cliente ya escoge (dice «lo quiero», la cantidad o la entrega), eso es avanzar la compra con ese producto: sigue con el paso que falte; no es una duda ni se pasa a persona. Una pregunta por mensaje. Lo que el cliente ya dijo no lo vuelvas a preguntar: si proponer devuelve un error con un dato que el cliente sí escribió, corrige los datos y vuelve a llamar proponer. El carrito: todo lo que el cliente lleva va en UN carrito, que se guarda; cada vez que agrega, quita o cambia algo, llama carrito con el carrito entero. Todo se paga en UN solo link con UN solo flete: nunca le digas que van en dos links. Si cambia algo después del resumen, vuelve a llamar carrito y luego proponer (sale un resumen nuevo; el link del anterior ya no vale). Si pide factura a nombre de empresa o con datos especiales: pasar_a_persona motivo factura.', null, null, 'brief ventas Dimpro §1-§6; Mauricio 30-oct (Messenger): la dirección enredada, «¿me confirmas la dirección?» y «Sí, enviar link» escrito sin link; arnés con Haiku real 3-nov: «Sí, uno, con despacho» pasado a persona como duda, y la dirección de Medellín propuesta con flete de Bogotá; el barrio después del resumen hacía pedir la dirección otra vez; 4-nov (conversación 10): la batería y las puntas iban en dos links con dos fletes; ahora un carrito, un link, un flete', null),
    (v_ws, 'asistente-publico', 'alc.complemento', 'alcance', 'siempre', 'el cliente ya escogió un producto (dijo cuál quiere o que lo compra) y todavía no le has ofrecido nada más en la conversación', 'Antes de pedir la autorización de datos, llama ver_complementos con el código que escogió. Si trae complementos, ofrécele el primero en un mensaje corto: una línea que empieza por su código, con nombre corto, precio y la razón que trae, y pregúntale si lo quiere agregar (si dice que sí, va al mismo carrito: llama carrito con el carrito entero). Si no trae, tu mensaje es SOLO «¿Necesitas algo más para ese trabajo?» (la entrega va después de su respuesta). Si a «¿Necesitas algo más?» contesta «sí» sin decir qué, pregúntale qué más necesita: ese «sí» no es la autorización de datos ni un sí a la compra. Es UNA vez por conversación: si dice que no, o contesta otra cosa, sigue con la compra sin volver a ofrecer: en ese mismo mensaje haz la siguiente pregunta de proc.compra, sin «¿Necesitas algo más?» ni otra oferta. Sin presión (inv.urgencia): nada de «aprovecha» ni «lo llevan mucho».', null, null, 'Mauricio 30-oct: «Necesitamos ofrecer ventas cruzadas… que si está interesado, antes del cierre. O preguntar que si no tiene alguna necesidad adicional»; arnés con Haiku real 3-nov: repetía la oferta; 4-nov: lo que acepta va al mismo carrito; banco 5-nov: el «sí» a «¿Necesitas algo más?» saltaba a la autorización', null);

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
    perform public.bot_publicar_reglamento(v_ws, v_bot, 'asistente de ventas Dimpro: carrito, un link y un flete (4-nov)');
    raise notice 'fichas cambiadas: %; reglamento publicado', v_cambios;
  else
    raise notice 'sin cambios: no se publica';
  end if;
end;
$$;
