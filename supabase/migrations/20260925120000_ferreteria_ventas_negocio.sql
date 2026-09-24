-- ============================================================================
-- Ferretería: cada venta queda como negocio de ONE, en una línea Ferretería propia de Dimpro.
--
-- Pedido de Mauricio (24-sep). Una venta de Marketplace se registra a mano en Ferretería (Dietmar
-- o MeTRIK) y nace como negocio de la línea "Ferretería" del espacio dimpro, con tres etapas:
--
--   Vendido → Entregado → Pagado
--
--   · contra entrega: nace en Vendido, pasa a Entregado, y el pago la lleva a Pagado y la cierra.
--   · anticipado: el cobro se registra al crearla y se cierra al marcarla entregada.
--
-- La parte de MeTRIK (50 % de la ganancia) NO es un costo del negocio: se liquida por MES en
-- Ferretería sumando la ganancia de todas las ventas del mes, pérdidas incluidas (una venta con
-- pérdida daría un costo negativo, que rompería los gastos). Por eso esta migración no toca
-- `gastos` ni guarda comisión por venta.
--
-- Qué escribe:
--   1. Columnas nuevas en `ferreteria_ventas` (esquema, sin datos: la tabla está vacía en
--      producción al 24-sep; el backfill de abajo existe solo por si no lo está).
--   2. DATOS: una fila en `lineas_negocio` y tres en `etapas_negocio`, SOLO para el espacio
--      dimpro. No toca las plantillas globales (workspace_id null) ni ninguna otra línea.
--      Idempotente: si la línea ya existe (marcada con config_extra.modulo = 'ferreteria'), no
--      hace nada.
--
-- Las etapas se reconocen por `config_extra.ferreteria_paso`, no por su nombre (el nombre se
-- puede editar sin romper nada). Ninguna declara `avisar_al_entrar` ni `avisar_al_cliente`: el
-- trigger `trg_avisar_entrada_etapa` sale sin hacer nada en las tres, así que crear, mover o
-- cerrar un negocio de esta línea no manda avisos a nadie, ni internos ni al cliente.
-- `saltar_si_saldo_cero: false` en las tres: una venta pagada por anticipado NO se salta
-- Entregado por tener el saldo en cero (Entregado es un hecho físico, no un cobro).
-- `etapa_cierre: true` en Pagado: `completarNegocio` solo deja cerrar desde ahí. La línea NO
-- declara `cierre_automatico`: el cierre lo pide Ferretería con la acción normal de ONE, que
-- deja "Proyecto completado" en el historial.
-- ============================================================================

-- ── 1. ferreteria_ventas ─────────────────────────────────────────────────────

alter table public.ferreteria_ventas
  -- El negocio de ONE que es esta venta. Una venta, un negocio.
  add column negocio_id uuid references public.negocios(id),
  add column forma_pago text check (forma_pago in ('anticipado', 'contra_entrega')),
  -- Día de la venta en Bogotá. De él salen el costo del día y el mes de la liquidación.
  add column fecha_venta date,
  add column comprador_nombre text,
  add column entregada_at timestamptz;

-- Hasta hoy la venta era el primer pago: una fila vieja se lee como anticipada ese mismo día.
update public.ferreteria_ventas
   set fecha_venta = fecha_primer_pago,
       forma_pago  = 'anticipado'
 where fecha_venta is null;

alter table public.ferreteria_ventas
  alter column fecha_venta set not null,
  alter column forma_pago set not null,
  -- Una venta contra entrega nace sin pago.
  alter column fecha_primer_pago drop not null;

comment on column public.ferreteria_ventas.fecha_primer_pago is
  'Día en que entró el pago. Null mientras una venta contra entrega no se paga.';

-- Anticipada = pagada desde que nace.
alter table public.ferreteria_ventas
  add constraint ferreteria_ventas_pago_coherente
  check (forma_pago = 'contra_entrega' or fecha_primer_pago is not null);

create unique index ferreteria_ventas_negocio_unico
  on public.ferreteria_ventas (negocio_id) where negocio_id is not null;

create index idx_ferreteria_ventas_fecha on public.ferreteria_ventas (workspace_id, fecha_venta);

-- ── 2. Línea Ferretería de dimpro ────────────────────────────────────────────

do $$
declare
  v_ws constant uuid := '67f7af44-b5ac-4d5c-aa9e-44954368447c';
  v_linea uuid;
  v_etapas int;
begin
  -- En una base sin dimpro (local, pruebas) no hay a quién crearle la línea.
  if not exists (select 1 from public.workspaces where id = v_ws) then
    raise notice 'ferreteria: el espacio dimpro no existe en esta base; no se crea la línea';
    return;
  end if;

  select id into v_linea
    from public.lineas_negocio
   where workspace_id = v_ws
     and config_extra ->> 'modulo' = 'ferreteria';

  if v_linea is not null then
    raise notice 'ferreteria: la línea ya existe (%), no se toca', v_linea;
    return;
  end if;

  insert into public.lineas_negocio (workspace_id, nombre, descripcion, tipo, is_active, config_extra)
  values (
    v_ws,
    'Ferretería',
    'Ventas del piloto Marketplace (alianza Dimpro x MeTRIK). Cada venta registrada en Ferretería es un negocio de esta línea.',
    'clarity',
    true,
    jsonb_build_object('modulo', 'ferreteria')
  )
  returning id into v_linea;

  insert into public.etapas_negocio (linea_id, stage, nombre, orden, is_active, config_extra) values
    (v_linea, 'ejecucion', 'Vendido',   1, true,
      jsonb_build_object('ferreteria_paso', 'vendido', 'saltar_si_saldo_cero', false)),
    (v_linea, 'cobro',     'Entregado', 2, true,
      jsonb_build_object('ferreteria_paso', 'entregado', 'saltar_si_saldo_cero', false)),
    (v_linea, 'cobro',     'Pagado',    3, true,
      jsonb_build_object('ferreteria_paso', 'pagado', 'saltar_si_saldo_cero', false, 'etapa_cierre', true));

  select count(*) into v_etapas from public.etapas_negocio where linea_id = v_linea;
  if v_etapas <> 3 then
    raise exception 'ferreteria: se esperaban 3 etapas en la línea %, hay %', v_linea, v_etapas;
  end if;
end $$;
