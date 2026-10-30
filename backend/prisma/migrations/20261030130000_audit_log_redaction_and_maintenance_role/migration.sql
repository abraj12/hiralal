-- HIR-M-09 / HIR-L-04: AuditLog immutability with two narrow exceptions.
--
-- 1. Redaction: when the transaction sets app.audit_redaction = 'on', an UPDATE may only blank
--    PII (ipAddress/userAgent -> NULL, oldValue/newValue -> '[REDACTED]'). Identity, action,
--    entity and timestamp columns must be unchanged, so history cannot be rewritten.
-- 2. Maintenance cleanup (DELETE or arbitrary UPDATE) requires app.allow_audit_log_cleanup = 'on'
--    AND membership of the hiralal_maintenance role. Until that role exists (see
--    scripts/db/create-least-privilege-role.sql) the previous GUC-only behaviour is kept.
CREATE OR REPLACE FUNCTION enforce_audit_log_immutability()
RETURNS TRIGGER AS $$
DECLARE
  is_maintenance BOOLEAN := TRUE;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hiralal_maintenance') THEN
    is_maintenance := pg_has_role(session_user, 'hiralal_maintenance', 'MEMBER');
  END IF;

  IF current_setting('app.allow_audit_log_cleanup', true) = 'on' AND is_maintenance THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND current_setting('app.audit_redaction', true) = 'on'
     AND NEW."id" = OLD."id"
     AND NEW."action" = OLD."action"
     AND NEW."entityType" = OLD."entityType"
     AND NEW."entityId" = OLD."entityId"
     AND NEW."adminId" IS NOT DISTINCT FROM OLD."adminId"
     AND NEW."createdAt" = OLD."createdAt"
     AND (NEW."oldValue" IS NOT DISTINCT FROM OLD."oldValue" OR NEW."oldValue" = '[REDACTED]')
     AND (NEW."newValue" IS NOT DISTINCT FROM OLD."newValue" OR NEW."newValue" = '[REDACTED]')
     AND (NEW."ipAddress" IS NOT DISTINCT FROM OLD."ipAddress" OR NEW."ipAddress" IS NULL)
     AND (NEW."userAgent" IS NOT DISTINCT FROM OLD."userAgent" OR NEW."userAgent" IS NULL)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'AuditLog records are append-only and strictly immutable; UPDATE and DELETE operations are prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON "AuditLog";
CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION enforce_audit_log_immutability();
