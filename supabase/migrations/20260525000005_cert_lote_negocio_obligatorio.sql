-- Cada certificacion DEBE estar atada a un negocio del workspace.
-- on delete restrict: un negocio con certificaciones emitidas no se puede borrar.
alter table cert_lotes alter column negocio_id set not null;
alter table cert_lotes drop constraint if exists cert_lotes_negocio_id_fkey;
alter table cert_lotes add constraint cert_lotes_negocio_id_fkey
  foreign key (negocio_id) references negocios(id) on delete restrict;
