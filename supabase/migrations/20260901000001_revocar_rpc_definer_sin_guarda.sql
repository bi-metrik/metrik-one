-- Cierra el paso libre a nueve funciones SECURITY DEFINER que `authenticated` podia
-- invocar por RPC sin pertenecer al workspace que pedia.
--
-- Medido en produccion el 2026-08-31, como `authenticated` sin identidad:
--
--     select count(*) from contactos;                          -- 0   (RLS hace su trabajo)
--     select count(*) from wa_find_contacts(<ws ajeno>, ..);   -- 4   (la funcion la rodea)
--
-- Esas cuatro filas traen nombre, telefono, email y rol. La funcion es SECURITY DEFINER, asi
-- que corre como su dueno y no ve RLS; el `p_workspace_id` lo pone quien llama y nadie lo
-- compara contra el workspace del que llama. El resultado es que la tabla queda cerrada por
-- la puerta y abierta por la ventana: cualquier usuario de cualquier workspace de ONE puede
-- pedir `/rest/v1/rpc/wa_find_contacts` con el id de otro y leerse su libreta.
--
-- Ninguna de las nueve se llama desde el navegador ni desde una server action con la sesion
-- del usuario. Sus unicos consumidores son Edge Functions y rutas que usan la
-- SERVICE_ROLE_KEY (`supabase/functions/wa-webhook`, `_shared/wa-lookup.ts`,
-- `_shared/supabase-client.ts`, `onboarding/actions.ts`), y el rol de servicio no pasa por
-- estos grants. Por eso aqui se revoca el privilegio y no se agrega una guarda: quitar un
-- permiso que nadie ejerce no cambia ningun comportamiento, y una guarda si tendria que
-- decidir que hacer cuando el usuario cambia de workspace. Esa decision es de las que
-- necesitan prueba propia, y va aparte.
--
-- Lo que esta migracion NO cierra, dicho para que no se lea como terminado: quedan funciones
-- SECURITY DEFINER que si se invocan con la sesion del usuario y tampoco comparan el
-- workspace recibido — `count_negocios_por_conciliar`, `crear_notificacion`,
-- `crear_notificacion_equipo`, `generate_cuenta_cobro_numero`, `evaluate_stage_rules`,
-- `resolver_grupo_notificaciones` y las cuatro de `bloque_locks`. Revocarlas romperia la
-- aplicacion; van con guarda, una por una.
--
-- El motivo original del ticket (`search_path` sin fijar, como en el incidente de Valida del
-- 2026-06-03) NO aparece: las 88 funciones SECURITY DEFINER de ONE tienen `search_path`
-- explicito. Ese frente esta limpio; el que estaba abierto era este otro.

-- ── Busqueda difusa que el agente de WhatsApp usa sobre un workspace dado ──────────────
-- Devuelven datos de contacto, negocios y proyectos del workspace que reciban por parametro.
revoke execute on function public.wa_find_contacts(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.wa_find_opportunities(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.wa_find_projects(uuid, text, integer) from public, anon, authenticated;

-- Sin parametro de workspace: resuelve un telefono contra el staff de TODA la base.
revoke execute on function public.wa_identify_user(text) from public, anon, authenticated;

-- ── Lecturas puntuales de otro workspace ──────────────────────────────────────────────
revoke execute on function public.get_profile_by_role(uuid, text) from public, anon, authenticated;
revoke execute on function public.omitir_owner_en_notificaciones(uuid) from public, anon, authenticated;
revoke execute on function public.destinatarios_negocio(uuid) from public, anon, authenticated;

-- ── Escritura ─────────────────────────────────────────────────────────────────────────
-- Inserta bloque_configs en el workspace que reciba. Solo corre en el onboarding, con la
-- service role; expuesta a `authenticated` era una escritura cruzada entre inquilinos.
revoke execute on function public.apply_plantilla_to_workspace(uuid, uuid) from public, anon, authenticated;

-- Consume un consecutivo de lote de certificado del workspace que reciba.
revoke execute on function public.generate_cert_lote_numero(uuid, uuid, text) from public, anon, authenticated;
