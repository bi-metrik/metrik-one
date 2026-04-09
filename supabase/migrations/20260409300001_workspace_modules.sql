-- Migration: workspace_modules JSONB
-- Agrega columna modules a workspaces para arquitectura modular por workspace
-- Default: {"business": true} — todos los workspaces existentes son business

-- 1. Agregar columna con default
ALTER TABLE workspaces
  ADD COLUMN modules JSONB NOT NULL DEFAULT '{"business": true}'::jsonb;

-- 2. Backfill workspaces existentes
UPDATE workspaces
  SET modules = '{"business": true}'::jsonb
  WHERE modules IS NULL OR modules = '{}'::jsonb;
