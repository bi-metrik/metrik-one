-- ⚠️ TOCA DATOS DE PRODUCCIÓN (11 filas de `negocios.metadata`, workspace SOENA).
--
-- Repara las marcas `metadata.siigo_cliente` que la emisión de la factura pisó.
--
-- El defecto: `emitirFacturaNegocio` leía el negocio al empezar, y más abajo
-- `asegurarClienteSiigo` REESCRIBÍA `siigo_cliente` con la identificación buena
-- cuando la marca vieja no coincidía con el RUT. Al final la emisión guardaba
-- `siigo_factura` fusionando sobre la copia VIEJA y devolvía esa corrección a su
-- valor anterior. El código quedó arreglado en el mismo PR
-- (`guardarMarcaEnMetadata`); esto limpia la secuela.
--
-- El daño original venía de la heurística `nit_sin_dv`: la marca guardaba la
-- cédula del RUT MENOS su último dígito. Medido en producción el 2026-09-02:
-- 19 marcas desalineadas, 12 en negocios ya facturados.
--
-- ✅ VERIFICADO CONTRA SIIGO ANTES DE TOCAR NADA (GET /v1/invoices/{id}, sin un
-- solo POST): **11 de las 12 facturas salieron con la identificación del RUT**,
-- o sea que el documento fiscal está bien y lo único que mentía era la marca.
--
-- ❌ V0189 / FV-2-244 NO SE TOCA: esa factura sí salió con la cédula truncada
-- (8081571, cuando el RUT dice 80815711). Su marca es el registro fiel de un
-- documento mal emitido y corregirla borraría la evidencia. Qué hacer con esa
-- factura lo deciden Mauricio y Carmen, no una migración.
--
-- Tampoco se tocan las 7 marcas de negocios SIN factura (V0012, V0046, V0066,
-- V0087, V0279, V0282, V0283): esas se reparan solas la próxima vez que corra
-- `asegurarClienteSiigo`, que compara la marca contra el RUT (`marcaSigueValida`).
-- V0279 además no es una truncación sino otra identidad; ver el reporte.
--
-- Ensayada contra producción en transacción con rollback el 2026-09-02:
-- 11 respaldadas, 11 corregidas, 0 desalineadas después, V0189 y V0279 intactas,
-- las 11 facturas y el resto de `metadata` sin cambio.
--
-- VUELTA ATRÁS:
--   update negocios n set metadata = n.metadata
--          || jsonb_build_object('siigo_cliente', b.siigo_cliente_antes)
--     from public.backup_marcas_siigo_cliente_20260902 b
--    where b.id = n.id;

begin;

create temporary table correccion(codigo text, truncada text, identificacion text, siigo_id text)
  on commit drop;

-- `siigo_id` sale del `customer.id` que Siigo devolvió para CADA factura, no de
-- la marca: la marca apunta al tercero basura creado con la cédula truncada.
-- Corregir solo la identificación y dejar ese id habría dejado la marca
-- apuntando a un tercero cuya cédula ya no es la que la marca declara, y el
-- siguiente `corregirContactoParaFactura` habría hecho PUT de los datos buenos
-- ENCIMA del tercero basura.
insert into correccion values
  ('V0129','3969127',  '39691277',  '2d8eccb6-0e9c-4bff-9b5f-881f3c20cfea'),
  ('V0135','112841873','1128418738','a71392bf-ad85-4f81-a802-c3e1a858dd9d'),
  ('V0137','8087030',  '80870304',  'c8610bb4-ba21-4879-b14e-334899352145'),
  ('V0160','7992446',  '79924462',  '69b5e9a3-3a6d-4736-911d-73a0aae42f8b'),
  ('V0177','13274770', '132747706', 'd2034395-6282-439e-b659-f136a9f5090c'),
  ('V0181','3546435',  '35464355',  '70874816-3125-4fb5-9ee6-85ea67afee96'),
  ('V0191','7955483',  '79554838',  'e9ed25e5-dad3-4540-88dc-495c8a81f95a'),
  ('V0199','5253001',  '52530011',  '4074fbb9-b588-4788-a4f7-f16c91f82a15'),
  ('V0206','2987732',  '29877326',  'd85f2ad6-9ca3-432e-af61-1ba937d2144b'),
  ('V0272','9149165',  '91491650',  'f9501e11-f25d-4e65-8453-293ac0ad03cd'),
  ('V0275','8073397',  '80733970',  '677848e3-1350-498f-8512-3d3bc7708169');

-- Respaldo ANTES de tocar nada.
-- server-only: respaldo puntual de esta corrección; no lo consume ninguna pantalla.
create table if not exists public.backup_marcas_siigo_cliente_20260902 as
select n.id, n.codigo,
       n.metadata->'siigo_cliente' as siigo_cliente_antes,
       n.metadata->'siigo_factura'->>'numero' as factura,
       now() as respaldado_at
  from negocios n
  join correccion c on c.codigo = n.codigo
 where n.workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5';

alter table public.backup_marcas_siigo_cliente_20260902 enable row level security;

-- El guard va DENTRO de la sentencia, no en un `if` previo: solo se toca la fila
-- que HOY tiene la identificación truncada y una factura registrada. Con eso la
-- migración es idempotente: una segunda corrida no encuentra nada que cambiar.
update negocios n
   set metadata = n.metadata || jsonb_build_object(
         'siigo_cliente',
         (n.metadata->'siigo_cliente') || jsonb_build_object(
           'identificacion', c.identificacion,
           'siigo_id', c.siigo_id,
           'corregido_at', to_jsonb(now()),
           'corregido_motivo',
             'La marca la piso la escritura de siigo_factura (read-modify-write). '
             || 'La factura SI salio con la identificacion del RUT: verificado contra Siigo por GET el 2026-09-02.'))
  from correccion c
 where n.workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5'
   and n.codigo = c.codigo
   and n.metadata->'siigo_cliente'->>'identificacion' = c.truncada
   and n.metadata->'siigo_factura'->>'numero' is not null;

commit;
