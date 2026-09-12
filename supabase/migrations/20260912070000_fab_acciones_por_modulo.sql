-- "Registrar cobro" y "Registrar horas" del FAB pasan a ser capacidad declarada por
-- workspace, como ya lo era "Registrar pago". El FAB es la puerta más visible del
-- producto: un botón que el cliente no usa le quita el sitio a los que sí.
--
-- Se encienden EXACTAMENTE en los workspaces que hoy los usan, medido sobre los datos
-- de producción el 2026-09-12, para que nadie pierda un botón que ya venía usando:
--   cobros → advise (16), ana-demo (11), metrik (61), soena (410)
--   horas  → ana-demo (38), dimpro (14)
-- El resto queda apagado, incluido termotech, que no tiene ni un cobro ni una hora.
-- Reversible con un UPDATE del mismo jsonb si alguno los pide.

UPDATE workspaces
SET modules = coalesce(modules, '{}'::jsonb) || '{"fab_registrar_cobro": true}'::jsonb
WHERE slug IN ('advise', 'ana-demo', 'metrik', 'soena');

UPDATE workspaces
SET modules = coalesce(modules, '{}'::jsonb) || '{"fab_registrar_horas": true}'::jsonb
WHERE slug IN ('ana-demo', 'dimpro');
