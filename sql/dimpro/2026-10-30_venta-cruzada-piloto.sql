-- Mapa de venta cruzada del asistente de VENTAS de Dimpro: 32 productos, 49 complementos. Pone al día en bot_parametros las fichas ventas.complementos
-- y publica una versión nueva del reglamento SOLO si alguna cambió (idempotente).
--
-- GENERADO desde supabase/functions/_shared/agente/publico/ventas/reglamento-dimpro.ts (semilla-sql-dimpro.ts --complementos <mapa.json>).
-- No se edita a mano. NO es una migración: escribe DATOS del workspace dimpro. La corre la sesión principal con
-- service_role, DESPUÉS del deploy de chatwoot-agente con ver_complementos (ronda 3).

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
    (v_ws, 'asistente-publico', 'ventas.complementos', 'guia', 'con_herramienta', null, 'Mapa de venta cruzada: por código MP-xx, los complementos en orden con la razón de una línea. Lo usa el código en ver_complementos; solo se ofrecen los que estén publicados y activos.', '{}'::text[], null, 'mapa de venta cruzada (complementos.json)', '{"mapa":{"MP-01":[{"codigo":"MP-60","razon":"Juego de dados de impacto 1/2\": la llave DCPB358 es de cuadrante 1/2\" y solo trae una copa"},{"codigo":"MP-61","razon":"Dados largos 1/2\" para pernos con espárrago largo que el dado corto no alcanza"}],"MP-04":[{"codigo":"MP-62","razon":"Tercera batería 20V 4.0Ah del mismo sistema Dongcheng de la rebordeadora DCMP6, para trabajar sin parar"}],"MP-05":[{"codigo":"MP-63","razon":"Respirador doble para el polvo de lijado (EPP)"}],"MP-10":[{"codigo":"MP-64","razon":"Puntas PH2 x20 para el portapuntas hexagonal 1/4\" del atornillador DCPL208"},{"codigo":"MP-65","razon":"Autoperforante hex 12x1 (300 und): trabajo típico del atornillador de impacto DCPL208"}],"MP-13":[{"codigo":"MP-61","razon":"Dados de impacto largos 1/2\": la PSN085 es cuadrante 1/2\" y trae copas cortas"}],"MP-15":[{"codigo":"MP-66","razon":"Brocas SDS-Plus para concreto: el DZC05-26B es encastre SDS-Plus"},{"codigo":"MP-67","razon":"Adaptador SDS-Plus a mandril para usar brocas de metal y madera en el rotomartillo"}],"MP-16":[{"codigo":"MP-68","razon":"Tubo flexible 1\" x 1\": la periférica EKM80 tiene succión y descarga de 1\""}],"MP-17":[{"codigo":"MP-64","razon":"Puntas PH2 x20 para atornillar con el mismo taladro DCJZ2050i (mandril 13 mm)"},{"codigo":"MP-69","razon":"Brocas HSS 1/16\"-1/2\" (máx. 12,7 mm): el DCJZ2050i tiene mandril de 13 mm"}],"MP-18":[{"codigo":"MP-66","razon":"Brocas SDS-Plus para concreto: el UY-RTM03-26 es encastre SDS-Plus"},{"codigo":"MP-67","razon":"Adaptador SDS-Plus a mandril para usar brocas de metal y madera en el rotomartillo"}],"MP-20":[{"codigo":"MP-70","razon":"Grillete 1/2\" para enganchar la carga al cable del malacate; verificar carga de trabajo (no está en la descripción)"}],"MP-22":[{"codigo":"MP-63","razon":"Respirador doble para el polvo de cemento al mezclar (EPP)"},{"codigo":"MP-71","razon":"Aspa de repuesto del mismo modelo DQU02-160B"}],"MP-23":[{"codigo":"MP-72","razon":"Grata de acero 8\" para el esmeril de banco de 8\"; verificar agujero contra el eje de 16 mm"}],"MP-25":[{"codigo":"MP-63","razon":"Respirador doble para el aserrín del cepillado (EPP)"},{"codigo":"MP-73","razon":"Carbones de repuesto del mismo modelo DMB110"}],"MP-26":[{"codigo":"MP-68","razon":"Tubo flexible 1\" x 1\": la centrífuga ECM130 tiene succión y descarga de 1\""}],"MP-31":[{"codigo":"MP-74","razon":"Llave americana 14\" para uniones de 1/2\" a 1\", el mismo rango de la tarraja TRC3PU"}],"MP-32":[{"codigo":"MP-75","razon":"Puntas PH2 x10 para el portapuntas hexagonal 1/4\" del destornillador DCPL04-5"}],"MP-34":[{"codigo":"MP-63","razon":"Respirador doble para la niebla de pintura de la pistola HVLP (EPP)"},{"codigo":"MP-76","razon":"Cinta de enmascarar 24 mm para proteger bordes antes de pintar con la PST650"}],"MP-35":[{"codigo":"MP-77","razon":"Disco flap 115 mm grano 80 para la pulidora UY-AMA115 de 115 mm"},{"codigo":"MP-78","razon":"Disco diamantado 115 mm en seco para concreto o cerámica con la misma pulidora de 115 mm"}],"MP-37":[{"codigo":"MP-63","razon":"Respirador doble al fumigar (EPP); verificar que el filtro sirva para agroquímicos"}],"MP-38":[{"codigo":"MP-69","razon":"Brocas HSS 1/16\"-1/2\" (máx. 12,7 mm): el TLJ513 tiene mandril de 13 mm"},{"codigo":"MP-79","razon":"Brocas planas para madera x6, el vástago cabe en el mandril de 13 mm del TLJ513"}],"MP-40":[{"codigo":"MP-80","razon":"Alicate universal 8\" para equipar la caja de herramientas (uso típico)"},{"codigo":"MP-81","razon":"Juego de llaves Allen plegable para equipar la caja de herramientas (uso típico)"}],"MP-44":[{"codigo":"MP-69","razon":"Brocas HSS para el mandril del taladro magnético; verificar capacidad del mandril incluido"},{"codigo":"MP-82","razon":"Aceitera para lubricar la broca al perforar acero (uso típico)"}],"MP-45":[{"codigo":"MP-69","razon":"Brocas HSS para el mandril del taladro magnético; verificar capacidad del mandril incluido"},{"codigo":"MP-82","razon":"Aceitera para lubricar la broca al perforar acero (uso típico)"}],"MP-46":[{"codigo":"MP-69","razon":"Brocas HSS para el mandril del TLM930; verificar capacidad del mandril"},{"codigo":"MP-82","razon":"Aceitera para lubricar la broca al perforar acero (uso típico)"}],"MP-48":[{"codigo":"MP-83","razon":"Disco de 16\" de repuesto del mismo modelo SEA410 (consumible)"}],"MP-51":[{"codigo":"MP-69","razon":"Brocas HSS para el mandril del TLM925; verificar capacidad del mandril"},{"codigo":"MP-82","razon":"Aceitera para lubricar la broca al perforar acero (uso típico)"}],"MP-52":[{"codigo":"MP-63","razon":"Respirador doble para el aserrín de la cepilladora (EPP)"}],"MP-53":[{"codigo":"MP-68","razon":"Tubo flexible 1\" x 1\": el hidroneumático EKM60 tiene entrada y salida de 1\""},{"codigo":"MP-84","razon":"Membrana de repuesto del tanque 24CT, el mismo tanque que trae el EKM60"}],"MP-54":[{"codigo":"MP-68","razon":"Tubo flexible 1\" x 1\": la EJM100LB tiene entrada y salida de 1\""}],"MP-55":[{"codigo":"MP-85","razon":"Cuñas de nivelación x100: mismo trabajo de enchape que el cortapiso DZE02-110"}],"MP-58":[{"codigo":"MP-61","razon":"Dados de impacto largos 1/2\": la UY-LLI500 es cuadrante 1/2\" y trae copas cortas"},{"codigo":"MP-86","razon":"Extensión 250 mm cuadrante 1/2\" para pernos de difícil acceso con la llave UY-LLI500"}],"MP-59":[{"codigo":"MP-87","razon":"Lanza de repuesto del mismo modelo MQL90PC"}]}}'::jsonb);

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
    perform public.bot_publicar_reglamento(v_ws, v_bot, 'asistente de ventas Dimpro: mapa de venta cruzada (32 productos)');
    raise notice 'fichas cambiadas: %; reglamento publicado', v_cambios;
  else
    raise notice 'sin cambios: no se publica';
  end if;
end;
$$;
