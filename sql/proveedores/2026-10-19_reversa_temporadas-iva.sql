-- Reversa de supabase/migrations/20261019130000_proveedores_temporadas_iva.sql.
--
-- SE PIERDE: el calendario de temporadas, las extracciones guardadas, el departamento, destino, IVA
-- y canal de cada ficha, la fecha de la última solicitud de tarifas, la casilla del IVA de cada
-- cotización y el IVA de cada línea. Los costos quedan como estaban: el IVA nunca se guardó dentro
-- del costo. Correr SOLO después de revertir el código que los lee, y recalcular antes las
-- cotizaciones en borrador que tenían la casilla encendida (si no, su precio guardado incluye un
-- IVA que la cascada ya no suma). Y borrar la fila del ledger:
--   delete from supabase_migrations.schema_migrations where version = '20261019130000';

drop table if exists public.proveedor_extracciones;
drop table if exists public.temporadas_agencia;

alter table public.items drop column if exists iva_costo_pct;
alter table public.cotizaciones
  drop column if exists costos_con_iva,
  drop column if exists viajero_residente;

drop index if exists public.idx_fotos_perfiles_destino;
alter table public.fotos_perfiles
  drop column if exists departamento,
  drop column if exists destino,
  drop column if exists iva_declarado,
  drop column if exists iva_incluido,
  drop column if exists tarifa_canal,
  drop column if exists tarifas_solicitadas_at,
  drop column if exists tarifas_solicitadas_por;

comment on column public.fotos_perfiles.ciudad is null;
