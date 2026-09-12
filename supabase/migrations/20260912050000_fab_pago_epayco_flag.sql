-- ePayco pasa a ser una capacidad declarada del workspace, no una verdad del producto.
--
-- El modal "Registrar pago" del FAB ofrecía ePayco como ÚNICA fuente, pedía una
-- ref_payco numérica y la verificaba contra la API de la pasarela. Y la vía única de
-- escritura exigía área financiera para cualquier pago que no entrara por ahí.
--
-- Eso describe a SOENA, que cobra por la pasarela. En un workspace que cobra por
-- transferencia y consignación, TODO pago es "fuera de ePayco": el módulo quedaba
-- inservible. Termotech lo tenía encendido (`modules.fab_registrar_pago`) y cero
-- cobros registrados.
--
-- El flag se ENCIENDE solo donde la pasarela existe. Ausente = no, que es lo correcto
-- para todo workspace nuevo: una integración de cobro se habilita cuando se contrata,
-- no por defecto.

UPDATE workspaces
SET modules = coalesce(modules, '{}'::jsonb) || '{"fab_pago_epayco": true}'::jsonb
WHERE slug = 'soena';
