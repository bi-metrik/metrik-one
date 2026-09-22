-- ============================================================================
-- SOENA · línea GIT EV/HEV · `config_extra.siigo.recibo_por_concepto` · 2026-09-22
--
-- El honorario de cada pago deja de salir como ANTICIPO suelto (RC-1 AdvancePayment)
-- y pasa a ser un ABONO a la factura del negocio (RC-1 DebtPayment, mismo comprobante
-- 4594). La porción UPME sigue saliendo como el RC-3 de siempre (33546).
--
-- ⚠️ ESTO NO ESTÁ APLICADO. Es configuración sobre datos de producción y la aplica la
-- sesión principal. Es UNA clave nueva, `tipo: 'abono'`, dentro del componente
-- honorario. Nada más cambia: ni el comprobante, ni el concepto, ni el pasante.
--
-- ── Orden: es seguro antes o después del deploy ─────────────────────────────
-- · Antes del deploy: el código que corre hoy no conoce `tipo`, lo ignora y emite el
--   honorario como anticipo, que es exactamente lo que hace hoy.
-- · Después del deploy sin este SQL: el código nuevo lee la config sin `tipo` y
--   también emite anticipo. La factura libre SÍ queda activa (eso es código, no
--   config), así que una factura emitida en esa ventana NO recibe abonos: los pagos que
--   entren después salen como anticipo, igual que hoy. Por eso conviene aplicarlo
--   pegado al deploy.
--
-- ── Qué cambia el día que se aplique ────────────────────────────────────────
-- · Pago que entra con factura ya emitida → abono por la porción honorario (topado en
--   el saldo que Siigo le reporta a la factura) + RC-3 por la porción UPME.
-- · Pago que entra SIN factura → solo el RC-3; el honorario no emite nada y no se
--   avisa si el pago era solo de honorario. Se abona el día que se facture.
-- · Al emitir la factura → un abono por cada pago anterior con porción honorario que no
--   tenga ya abono ni RC-1 de anticipo. Sin aviso al cliente.
-- · Pago con `cobros.retencion > 0` → no se abona: queda marcado para Tesorería.
--
-- ⚠️ `recibo_automatico` SIGUE en `false` y este SQL NO lo toca. Mientras siga así, los
-- abonos de pagos NUEVOS no salen solos: salen cuando Tesorería oprime «Emitir» en el
-- control de recibos. El abono al FACTURAR sí sale solo: lo dispara la emisión de la
-- factura, que ya es una decisión de una persona.
--
-- ── Alcance medido el 2026-09-22 (solo lectura) ─────────────────────────────
-- De 427 cobros vivos de SOENA: 343 con `recibo_no_aplica` (corte histórico), 16 con
-- marca vieja por el total, 1 con RC-1 de honorario emitido como anticipo (no recibe
-- abono, regla 3), 2 sin porción honorario, y **65 con honorario sin acusar**: 34 en
-- negocios ya facturados (los 34 con `siigo_id` en la marca, así que se pueden abonar
-- desde Tesorería) y 31 en negocios sin factura (se abonan al facturar; 8 de esos
-- cobros son de 7 negocios cerrados, que no se pueden facturar desde ONE). Cero
-- cobros con retención.
-- ============================================================================

do $$
declare
  v_linea constant uuid := '34a0fa6b-9ed3-4652-a419-42601132d1a8';  -- GIT EV/HEV
  v_hon   jsonb;
begin
  select config_extra -> 'siigo' -> 'recibo_por_concepto' -> 'honorario' into v_hon
  from public.lineas_negocio
  where id = v_linea;

  if v_hon is null then
    raise exception 'La línea % no declara recibo_por_concepto.honorario', v_linea;
  end if;

  -- Guarda: se aplica sobre la config medida el 2026-09-22 y no sobre otra.
  if (v_hon ->> 'document_id') is distinct from '4594' then
    raise exception 'El comprobante del honorario ya no es 4594. Revisar antes de aplicar. Actual: %', v_hon;
  end if;
  if v_hon ? 'tipo' then
    raise exception 'El honorario ya declara tipo (%). Nada que hacer.', v_hon ->> 'tipo';
  end if;

  -- `||` y no `jsonb_set` con un nivel nuevo: `jsonb_set` no crea el nivel PADRE y
  -- devuelve el jsonb sin tocar, sin error. Aquí los tres niveles ya existen (la guarda
  -- de arriba lo comprobó), pero se escribe con `||` sobre el objeto del honorario
  -- para no depender de eso.
  update public.lineas_negocio
  set config_extra = jsonb_set(
    config_extra,
    '{siigo,recibo_por_concepto,honorario}',
    (config_extra -> 'siigo' -> 'recibo_por_concepto' -> 'honorario') || jsonb_build_object('tipo', 'abono')
  )
  where id = v_linea;

  -- Comprobación sobre lo que QUEDÓ, no sobre lo que se envió.
  select config_extra -> 'siigo' -> 'recibo_por_concepto' -> 'honorario' into v_hon
  from public.lineas_negocio
  where id = v_linea;

  if (v_hon ->> 'tipo') is distinct from 'abono' then
    raise exception 'El honorario no quedó como abono: %', v_hon;
  end if;
  if (v_hon ->> 'document_id') is distinct from '4594' then
    raise exception 'Se perdió el comprobante del honorario: %', v_hon;
  end if;

  raise notice 'Listo. Honorario: %', v_hon;
end $$;
