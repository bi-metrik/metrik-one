-- Bloque nuevo tipo 'contacto': lee y escribe la ficha del CONTACTO desde dentro del
-- negocio. Amplia el CHECK de bloque_definitions.tipo y crea la definition global
-- (sin workspace_id). La instancia por linea (bloque_config con `variante` y `campos`)
-- es configuracion de cada workspace y vive en proyectos/<cliente>/<linea>/migrations.
--
-- Por que: el perfil del cliente y su autorizacion de tratamiento de datos son de la
-- persona, no del viaje. En Trappvel vivian como bloques de la etapa 1, asi que un
-- cliente recurrente volvia a teclear en cada negocio lo que ya habia dado, y la
-- autorizacion se registraba una vez por negocio en vez de una por titular.
--
-- can_be_gate = false A PROPOSITO. El gate sobre el contacto ("tiene autorizacion
-- vigente") es una pieza aparte: este bloque no se marca completo, asi que un gate
-- configurado hoy nunca dejaria avanzar la etapa. Se abre cuando el motor de gates
-- sepa leer el estado del contacto.
--
-- Idempotente.

ALTER TABLE bloque_definitions DROP CONSTRAINT IF EXISTS bloque_definitions_tipo_check;
ALTER TABLE bloque_definitions ADD CONSTRAINT bloque_definitions_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'datos','documentos','documento','cotizacion','cobros','checklist',
    'checklist_soporte','equipo','aprobacion','cronograma','resumen_financiero',
    'ejecucion','historial','formulario','plan_recurrente','historial_valida',
    'propuesta_economica','guia_devolucion','facturacion','contacto'
  ]::text[]));

INSERT INTO bloque_definitions (tipo, nombre, descripcion, is_visualization, can_be_gate, default_estado, codigo)
SELECT 'contacto', 'Ficha del contacto',
       'Campos de la persona (perfil y autorizacion de datos) editados desde el negocio. Lo que se escribe queda en contactos, no en el negocio, y sigue ahi en el siguiente viaje.',
       false, false, 'editable', 'CT'
WHERE NOT EXISTS (SELECT 1 FROM bloque_definitions WHERE tipo = 'contacto');
