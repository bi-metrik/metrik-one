-- Numero de lote autogenerado, consecutivo POR PRODUCTO (SKU) dentro del workspace.
-- Formato: {SKU}-{NNN}. Concurrencia segura via advisory lock (patron ONE).
create or replace function generate_cert_lote_numero(p_workspace uuid, p_producto uuid, p_sku text)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform pg_advisory_xact_lock(hashtext(p_workspace::text), hashtext(p_producto::text));
  select coalesce(max(substring(numero_lote from '([0-9]+)$')::int), 0) + 1
    into v_n
  from cert_lotes
  where workspace_id = p_workspace
    and cert_producto_id = p_producto
    and numero_lote like (p_sku || '-%');
  return p_sku || '-' || lpad(v_n::text, 3, '0');
end $$;

create or replace function cert_lote_set_numero() returns trigger language plpgsql as $$
begin
  if (new.numero_lote is null or new.numero_lote = '') and new.cert_producto_id is not null then
    new.numero_lote := generate_cert_lote_numero(new.workspace_id, new.cert_producto_id, new.sku);
  end if;
  return new;
end $$;

drop trigger if exists trg_cert_lote_numero on cert_lotes;
create trigger trg_cert_lote_numero before insert on cert_lotes
  for each row execute function cert_lote_set_numero();
