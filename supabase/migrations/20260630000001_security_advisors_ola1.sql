-- Cierre de 2 hallazgos del Security Advisor de Supabase (ola 1, bajo riesgo).
-- Alcance estricto: solo estos dos. NO toca las 45 funciones SECURITY DEFINER
-- ni la vista v_cardumen_live (se planean aparte).

-- =============================================================================
-- TAREA 1 — function_search_path_mutable (lint 0011)
-- =============================================================================
-- Fija un search_path inmutable en 3 funciones trigger/helper para que no
-- resuelvan objetos por un search_path mutable del rol que las dispara.
--
-- - cert_lote_set_numero(): llama a public.generate_cert_lote_numero (sin
--   calificar) -> el search_path DEBE incluir 'public' o el trigger rompe.
--   Se fija a 'public' (consistente con generate_cert_lote_numero, que ya usa
--   security definer set search_path = public). pg_catalog siempre se resuelve.
-- - gen_cert_short_code(): solo usa builtins (string_agg, substr, floor,
--   random, generate_series) -> search_path vacío es seguro.
-- - set_updated_at_segmentacion(): solo usa now() (builtin) -> vacío seguro.

alter function public.cert_lote_set_numero() set search_path = public;
alter function public.gen_cert_short_code() set search_path = '';
alter function public.set_updated_at_segmentacion() set search_path = '';

-- =============================================================================
-- TAREA 2 — public_bucket_allows_listing (lint 0025) — bucket cert-documentos
-- =============================================================================
-- El bucket cert-documentos es público (public=true) y tenía una policy de
-- SELECT sobre storage.objects para el rol `public`/`anon`, lo que permitía
-- ENUMERAR (listar) todos los objetos del bucket vía el endpoint de listing.
--
-- Decisión (Mauricio): restringir el listado, manteniendo el acceso directo por
-- URL/path. En un bucket público, el endpoint de objeto público
-- (/storage/v1/object/public/cert-documentos/<path>) NO depende de esta policy
-- RLS: sirve el objeto por su path porque el bucket es public=true. Por eso
-- quitar la policy `to public` elimina la enumeración SIN romper la entrega del
-- certificado (la página pública /cert y /c lee vía service-role + el Databook
-- real se sirve por bucket PRIVADO `cert-databooks` con signed URL).
--
-- Se reemplaza la policy amplia (public) por una de SELECT acotada a
-- `authenticated` y por carpeta-workspace, simétrica a las policies de
-- insert/delete ya existentes en este bucket. Esto preserva la capacidad del
-- panel autenticado y NO reintroduce el listing anónimo (el lint 0025 aplica a
-- buckets públicos con SELECT para anon/public).

drop policy if exists "Anyone can read cert documentos" on storage.objects;

drop policy if exists "Users can read cert documentos" on storage.objects;
create policy "Users can read cert documentos"
on storage.objects for select to authenticated
using (
  bucket_id = 'cert-documentos'
  and (storage.foldername(name))[1] = (
    select workspace_id::text from profiles where id = auth.uid()
  )
);
