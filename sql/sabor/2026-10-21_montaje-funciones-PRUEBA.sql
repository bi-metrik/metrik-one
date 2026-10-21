-- Montaje y funciones de Sabor & Experiencias, etapa 2 — SOLO PARA UN WORKSPACE DE PRUEBA.
--
-- TODO ES INVENTADO: el plano real del salón es HUECO 1 (Otrosí No. 1, cláusula segunda) y los minutos de apartado
-- son HUECO 4 (los decide Paula). Las mesas, sus puestos, sus zonas y el cupo de abajo son [EJEMPLO] para probar el
-- mapa y la lista del día; no describen el salón de Sabor.
-- NO es una migración y NO se aplica en producción sobre Sabor. El bloque se niega a correr si el workspace no está
-- marcado config_extra.espacio_de_pruebas = true, o si no tiene el módulo `funciones` (la migración 20261021120000).
--
-- Uso: reemplazar <WORKSPACE_DE_PRUEBA> por el id del workspace de prueba y correrlo como dueño de la base (escribe
-- directo: las tablas no conceden escritura a nadie más). En la operación real, montajes y funciones se crean desde el
-- formulario de ONE (/funciones/montajes/nuevo y /funciones/nueva), que es la única puerta.

do $$
declare
  v_ws uuid := '<WORKSPACE_DE_PRUEBA>';
  v_exp uuid;
  v_montaje uuid;
begin
  if coalesce((select (config_extra->>'espacio_de_pruebas')::boolean from public.workspaces where id = v_ws), false) is not true then
    raise exception 'esta semilla es inventada: solo se siembra en un workspace con espacio_de_pruebas = true';
  end if;
  if to_regclass('public.funcion_funciones') is null then
    raise exception 'falta la migración 20261021120000_modulo_funciones';
  end if;

  insert into public.funcion_experiencias (workspace_id, nombre, minutos_apartado)
  values (v_ws, '[EJEMPLO] Ratatouille', 30)  -- 30 min: [EJEMPLO], HUECO 4
  returning id into v_exp;

  insert into public.funcion_montajes (workspace_id, experiencia_id, nombre, notas)
  values (v_ws, v_exp, '[EJEMPLO] Salón cena', 'Plano INVENTADO para pruebas (HUECO 1).')
  returning id into v_montaje;

  insert into public.funcion_mesas (workspace_id, montaje_id, etiqueta, puestos, zona, condicion, x, y, ancho, alto, forma, orden)
  values
    (v_ws, v_montaje, 'F1', 4, '[EJEMPLO] frente', '[EJEMPLO] cerca de la pantalla', 8, 8, 14, 12, 'rectangular', 1),
    (v_ws, v_montaje, 'F2', 4, '[EJEMPLO] frente', '[EJEMPLO] cerca de la pantalla', 30, 8, 14, 12, 'rectangular', 2),
    (v_ws, v_montaje, 'C1', 2, '[EJEMPLO] centro', null, 10, 45, 9, 9, 'redonda', 3),
    (v_ws, v_montaje, 'C2', 2, '[EJEMPLO] centro', null, 30, 45, 9, 9, 'redonda', 4),
    (v_ws, v_montaje, 'B1', 6, '[EJEMPLO] fondo', '[EJEMPLO] mesa larga para grupos', 55, 30, 25, 12, 'rectangular', 5);

  insert into public.funcion_funciones (workspace_id, experiencia_id, montaje_id, inicia_at, cupo_total)
  values
    (v_ws, v_exp, v_montaje, (current_date + 7 + time '19:00') at time zone 'America/Bogota', 18),
    (v_ws, v_exp, null,      (current_date + 8 + time '19:00') at time zone 'America/Bogota', 18);
end;
$$;
