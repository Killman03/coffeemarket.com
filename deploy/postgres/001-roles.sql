\set ON_ERROR_STOP on
-- psql reads environment values without putting passwords in process arguments.
\getenv migrator_password COFFEE_MIGRATOR_PASSWORD
\getenv application_password COFFEE_APPLICATION_PASSWORD
\getenv operator_password COFFEE_OPERATOR_PASSWORD

CREATE ROLE coffee_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'migrator_password';
CREATE ROLE coffee_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'application_password';
CREATE ROLE coffee_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'operator_password';
ALTER DATABASE coffee_market OWNER TO coffee_migrator;
REVOKE ALL ON DATABASE coffee_market FROM PUBLIC;
GRANT CONNECT ON DATABASE coffee_market TO coffee_app, coffee_admin;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
