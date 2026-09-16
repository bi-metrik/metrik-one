-- Cierra el bucket publico `cert-documentos`.
--
-- Por que es seguro: el bucket esta VACIO (0 objetos) y la tabla `cert_documentos` no tiene
-- ni una fila. No hay un solo `getPublicUrl`, upload ni download contra ese bucket en el
-- repo: las certificaciones reales viven en el bucket PRIVADO `cert-databooks` y se
-- entregan con URL firmada. Cerrarlo no le quita acceso a nada que exista hoy.
--
-- Dos efectos, los dos idempotentes:
--   1. el bucket deja de ser publico, asi que un GET por path deja de servir el objeto;
--   2. se retira la policy que permitia leer `storage.objects` de ese bucket sin declarar
--      rol alguno, o sea PUBLIC: cualquiera, con sesion o sin ella.

update storage.buckets set public = false where id = 'cert-documentos';

drop policy if exists "Anyone can read cert documentos" on storage.objects;
