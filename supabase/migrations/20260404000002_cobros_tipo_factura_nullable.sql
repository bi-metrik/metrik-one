-- cobros: tipo_cobro para clasificar anticipos y saldos VE
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS tipo_cobro TEXT
  DEFAULT 'regular' CHECK (tipo_cobro IN ('regular', 'anticipo', 'saldo'));

-- cobros: factura_id pasa a ser opcional
-- Los anticipos y saldos VE se registran antes de emitir factura formal
ALTER TABLE cobros ALTER COLUMN factura_id DROP NOT NULL;
