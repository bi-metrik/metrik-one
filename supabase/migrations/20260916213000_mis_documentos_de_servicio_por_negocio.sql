-- ============================================================
-- 20260916213000: la constancia de un documento es la del NEGOCIO del cliente
--
-- Corrige `mis_documentos_de_servicio()` de `20260916180000_modulo_valida_api.sql` (C2).
-- Solo `create or replace function`: ni una fila de datos, ni una tabla, ni un cambio de
-- firma.
--
-- ## El defecto
--
-- La constancia se unía a la versión del documento SOLO por la huella del PDF
-- (`aceptaciones_terminos.documento_sha256 = documentos_contractuales_versiones.pdf_sha256`).
-- La huella dice QUÉ se aceptó, no en qué contrato. Cualquier otra aceptación del mismo
-- archivo entraba al `left join` y repetía el documento con otra constancia.
--
-- Caso real, medido el 2026-09-16: la prueba interna del 2026-09-15 (`41233b25`, "Mauricio
-- Moreno (PRUEBA)", sin negocio) usó el mismo PDF que la aceptación de 4D SOFT (`def579c7`,
-- Juan Guillermo, apoderado, negocio X1 26 1). Con la versión de los términos cargada, la
-- pestaña Documentos de 4d-soft muestra los términos DOS veces, una con la constancia de la
-- prueba.
--
-- ## La regla
--
-- Una aceptación es constancia del documento de un cliente solo si cuelga de un negocio de
-- un contrato de ESA empresa que cubre al workspace de la sesión, como pagador o como
-- beneficiario (el mismo criterio de `mios`). Una aceptación sin negocio no es de ningún
-- contrato: `NULL in (...)` no es verdadero y queda fuera.
--
-- El documento se sigue mostrando aunque no le quede constancia: el join sigue siendo `left`.
--
-- ## Lo que no cambia
--
-- Firma, columnas de salida, `stable`, `security definer`, `search_path = public, pg_temp`
-- y ACL. `create or replace` conserva la ACL; el revoke y el grant se repiten al final para
-- que este archivo diga por sí solo quién la ejecuta.
--
-- ## Límite conocido
--
-- Dos aceptaciones del mismo PDF sobre negocios del MISMO cliente siguen saliendo como dos
-- filas, cada una con su constancia. Hoy no existe ese caso (medido: una sola aceptación de
-- 4D SOFT) y, si llega, son dos constancias reales de ese cliente, no una ajena.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select md5(p.prosrc), p.prosecdef, p.proconfig, p.proacl
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'mis_documentos_de_servicio';
--     -> prosecdef = true, proconfig = {"search_path=public, pg_temp"},
--        proacl con authenticated=X y SIN anon ni =X/ (PUBLIC),
--        md5 igual al del cuerpo de este archivo (el PR lo anota, medido en PGlite:
--        Postgres guarda `prosrc` tal cual va entre los `$$`).
-- ============================================================

-- Documentos contractuales del cliente: los de su empresa, con la constancia de su
-- aceptación cuando existe y es de un negocio de sus contratos.
create or replace function public.mis_documentos_de_servicio()
returns table (
  documento_id uuid,
  slug text,
  titulo text,
  version text,
  alcance text,
  texto_md text,
  pdf_bucket text,
  pdf_path text,
  pdf_sha256 text,
  vigente_desde date,
  vigente_hasta date,
  aceptado_at timestamptz,
  aceptado_por text,
  aceptado_calidad text,
  aceptado_canal text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mios as (
    -- `distinct`: un cliente con dos contratos de la misma empresa (uno que paga y otro del
    -- que es beneficiario) duplicaba cada documento. Visto al correr la migración.
    select distinct sc.empresa_id
    from public.servicios_contratados sc
    where public.current_user_workspace_id() is not null
      and (
        sc.workspace_pagador_id = public.current_user_workspace_id()
        or exists (
          select 1 from public.servicio_contratado_beneficiarios b
          where b.servicio_contratado_id = sc.id
            and b.workspace_id = public.current_user_workspace_id()
        )
      )
  )
  select
    d.id,
    d.slug,
    d.titulo,
    d.version,
    d.alcance,
    d.texto_md,
    d.pdf_bucket,
    d.pdf_path,
    d.pdf_sha256,
    d.vigente_desde,
    d.vigente_hasta,
    a.created_at,
    a.nombre_aceptante,
    a.calidad,
    -- El canal se nombra porque cambia lo que la constancia demuestra: por WhatsApp la
    -- v1.0 descansa en un webhook cuya firma no se verifica (§8, riesgo preexistente).
    case when a.prompt_wamid is not null then 'whatsapp' else 'modulo' end
  from public.documentos_contractuales_versiones d
  join mios m on m.empresa_id = d.empresa_id
  left join public.aceptaciones_terminos a
    on a.documento_sha256 = d.pdf_sha256
   and a.estado = 'aceptado'
   -- La huella dice QUÉ se aceptó, no en qué contrato. Sin esta condición, una prueba
   -- interna con el mismo PDF (sin negocio) salía como una segunda constancia del
   -- documento. Visto con 4D SOFT el 2026-09-16.
   and a.negocio_id in (
     select sc.negocio_id
     from public.servicios_contratados sc
     where sc.empresa_id = d.empresa_id
       and (
         sc.workspace_pagador_id = public.current_user_workspace_id()
         or exists (
           select 1 from public.servicio_contratado_beneficiarios b
           where b.servicio_contratado_id = sc.id
             and b.workspace_id = public.current_user_workspace_id()
         )
       )
   )
  order by d.slug, d.vigente_desde desc;
$$;

comment on function public.mis_documentos_de_servicio() is
  'Documentos contractuales de la empresa del cliente con la constancia de su aceptación, solo si la aceptación es de un negocio de sus contratos. Nunca salen el teléfono, el wamid ni el payload de Meta: se quedan en ONE como evidencia.';

-- ejecutable-por-cliente: la invoca el servidor con el cliente de SESIÓN (pestaña Documentos
-- de /valida-api) y el filtro por workspace vive dentro de la función, no en el guard.
revoke execute on function public.mis_documentos_de_servicio() from public, anon;
grant  execute on function public.mis_documentos_de_servicio() to authenticated;
