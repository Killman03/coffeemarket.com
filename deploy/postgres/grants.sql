\set ON_ERROR_STOP on
BEGIN;
GRANT USAGE ON SCHEMA public TO coffee_app, coffee_admin;
GRANT SELECT ON site_owner TO coffee_app;
GRANT SELECT, INSERT ON site_settings_audit TO coffee_app;
GRANT SELECT, INSERT, UPDATE ON site_settings TO coffee_app;
GRANT SELECT, INSERT, DELETE ON analytics_events TO coffee_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_sessions, pnl_requests, pnl_updates TO coffee_app;
GRANT SELECT ON auth_user, auth_account, auth_verification TO coffee_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_session, auth_rate_limit TO coffee_app;
GRANT SELECT, INSERT ON site_owner, auth_user, auth_audit TO coffee_admin;
GRANT SELECT, INSERT, UPDATE ON auth_account TO coffee_admin;
GRANT SELECT, DELETE ON auth_session TO coffee_admin;
COMMIT;
