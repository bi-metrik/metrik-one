-- QA de compliance (2026-10-12): la evidencia de cumplimiento era editable desde
-- el navegador por cualquier rol del workspace.
--
-- Medido en producción ese día con information_schema.role_table_grants:
-- `authenticated` tenía SELECT, INSERT, UPDATE y DELETE sobre las cuatro tablas
-- de abajo, y `anon` SELECT. Las tres primeras nacieron antes del 2026-08-10,
-- cuando toda tabla nueva recibía esos privilegios por defecto (ver CLAUDE.md de
-- ONE), y sus policies filtran solo por workspace, sin rol. Resultado: un
-- operador con sesión podía, con su propio JWT y por PostgREST,
--   - cambiar la severidad o borrar hallazgos de `consultas_listas_dual`, que es
--     el soporte de cada consulta en listas y del Reporte Supertransporte;
--   - reescribir la metodología de segmentación (`valida_segmentacion_config`) y
--     su bitácora versionada, que la pantalla reserva a owner/admin/supervisor;
--   - leer `kyc_expediente_ref` con el motivo de rechazo de la oficial, que la
--     app reserva a owner/admin.
--
-- Ninguna de las cuatro se lee ni se escribe con el cliente de sesión: todo el
-- código pasa por `createServiceClient()` (revisado con grep el 2026-10-12:
-- compliance-dual, barrido, liberaciones, sujetos, segmentos, auditoría de
-- compras, reporte-supertransporte, valida-segmentacion, calculo-score, webhook
-- kyc). Por eso pasan a server-only y no se toca ninguna policy.
--
-- Solo privilegios: no mueve ni cambia datos.

-- server-only: evidencia de consultas en listas; escriben compliance-dual.ts y barrido.ts con service_role
revoke all on table public.consultas_listas_dual from anon, authenticated;

-- server-only: metodología de segmentación; la escribe valida-segmentacion.ts con service_role tras validar el rol
revoke all on table public.valida_segmentacion_config from anon, authenticated;

-- server-only: bitácora versionada de la segmentación; misma acción
revoke all on table public.valida_segmentacion_bitacora from anon, authenticated;

-- server-only: espejo del expediente KYC; lo escribe el webhook de Valida con service_role
revoke all on table public.kyc_expediente_ref from anon, authenticated;
