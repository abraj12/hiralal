-- HIR-L-04: Least-privilege database role for the API and worker containers.
--
-- Run ONCE as the database owner (POSTGRES_USER) after migrations have been applied:
--
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v app_password="$APP_DB_PASSWORD" -v owner_role="$POSTGRES_USER" \
--     -f - < scripts/db/create-least-privilege-role.sql
--
-- Then set APP_DB_USER=hiralal_app and APP_DB_PASSWORD in .env and restart backend + worker.
-- Migrations (migrate service) and backups keep using the owner account.
--
-- Effect:
--   * hiralal_app can read and write application rows but cannot run DDL, cannot delete audit
--     entries, and cannot bypass the AuditLog trigger (it is not a member of hiralal_maintenance).
--   * hiralal_maintenance is granted to the owner only; maintenance cleanup must be done by the owner.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hiralal_maintenance') THEN
    CREATE ROLE hiralal_maintenance NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hiralal_app') THEN
    CREATE ROLE hiralal_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

ALTER ROLE hiralal_app WITH PASSWORD :'app_password';
GRANT hiralal_maintenance TO :"owner_role";

SELECT format('GRANT CONNECT ON DATABASE %I TO hiralal_app', current_database()) \gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO hiralal_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hiralal_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hiralal_app;

-- Audit entries: insert and (trigger-restricted) redaction only
REVOKE DELETE ON "AuditLog" FROM hiralal_app;

-- Prisma's migration bookkeeping is owner-only
REVOKE INSERT, UPDATE, DELETE ON "_prisma_migrations" FROM hiralal_app;

-- Tables created by future migrations (run as the owner) are granted automatically
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hiralal_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hiralal_app;
