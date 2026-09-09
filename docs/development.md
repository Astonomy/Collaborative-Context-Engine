# Development

The preferred Windows environment is Ubuntu under WSL2 with Node.js 24, pnpm 11.22.0, and native
PostgreSQL 18. Keeping CCE and PostgreSQL in WSL makes `localhost` unambiguous and needs no Docker
Desktop.

## Initial WSL setup

Install WSL from elevated PowerShell, then open Ubuntu:

```powershell
wsl --install -d Ubuntu
```

When Ubuntu's default PostgreSQL is not version 18, use the PostgreSQL project's official Apt
repository helper:

```bash
sudo apt update
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt update
sudo apt install -y postgresql-18 postgresql-client-18
sudo service postgresql start
```

Choose a local-only password at the prompt below. It belongs in ignored `.env`, never Git. `CREATEDB`
lets the test bootstrap manage its isolated databases; application runtime permissions remain ordinary
database-owner permissions.

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE cce LOGIN CREATEDB;
\password cce
CREATE DATABASE cce OWNER cce;
SQL
```

PostgreSQL 18 stores new passwords with SCRAM-SHA-256 by default. Keep TCP authentication as
`scram-sha-256`; do not add broad `trust` rules. The default loopback-only `listen_addresses` is correct
for the recommended topology and must not be changed to `*`.

Install Node.js 24 in WSL using a supported version manager, then:

```bash
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
```

Set both URLs to the developer-controlled password (percent-encode reserved URL characters):

```dotenv
DATABASE_URL=postgresql://cce:<password>@localhost:5432/cce
TEST_DATABASE_URL=postgresql://cce:<password>@localhost:5432/postgres
```

`TEST_DATABASE_URL` is a maintenance connection, not a disposable database. Test commands derive a
unique `cce_test_*` URL, migrate it, and remove it after the suite. They never test against `cce`.

```bash
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The root `.env` is loaded for local Web, database CLI, and test commands without replacing variables
already supplied by the shell or IDE. Production and containers inject secrets explicitly.

## Daily development

```bash
sudo service postgresql start
pg_isready -h localhost -p 5432 -U cce -d cce
pnpm dev
```

Open <http://localhost:3000>. `GET /api/health` is database-aware. PostgreSQL continues while the WSL
distribution is active; stop it with `sudo service postgresql stop`. `wsl --shutdown` from PowerShell
stops all WSL distributions and their services.

Use `pnpm db:migrate` and `pnpm db:seed` after pulling migrations or changing the seed identity.
Migrations remain forward-only and checksum-verified. Seed remains idempotent and stores only the API
token hash.

## Testing

```bash
pnpm test:integration
pnpm exec playwright install chromium  # once
pnpm test:e2e
```

Both suites create an isolated database through `TEST_DATABASE_URL` and clean it after success or
failure. E2E also migrates, seeds Owner/Editor/Viewer fixtures, starts the deterministic model fixture
and CCE, then runs Chromium. If forcibly killed, list leftovers with
`psql "$TEST_DATABASE_URL" -c '\l cce_test_*'`, verify the prefix, and remove only the known stale name
with `dropdb --if-exists --force --maintenance-db="$TEST_DATABASE_URL" <name>`.

`pnpm validate` is the deterministic gate (format, lint, typecheck, coverage, build).
`pnpm verify:full` adds PostgreSQL integration and E2E and is the complete local gate.

## Running CCE on Windows

Running the repository inside WSL is recommended. If CCE runs as a Windows process, current WSL2
normally forwards Linux ports to Windows `localhost`; try the same URLs first and run
`Test-NetConnection localhost -Port 5432`. Mirrored networking on supported Windows 11 releases also
supports bidirectional localhost.

If localhost forwarding is disabled, prefer restoring it or moving CCE into WSL. An explicit WSL
address from `wsl.exe hostname -I` changes when the VM restarts and requires a narrow matching
`listen_addresses` value plus a SCRAM `pg_hba.conf` rule limited to the Windows host address. Do not
bind PostgreSQL to `0.0.0.0`, use an unrestricted CIDR, add a LAN port proxy, or weaken authentication.

## Troubleshooting

- **Service unavailable:** run `sudo service postgresql status`, start it, then use `pg_isready`.
- **Port 5432 unavailable:** inspect `sudo ss -ltnp 'sport = :5432'` in WSL and
  `Get-NetTCPConnection -LocalPort 5432` in PowerShell. Stop the conflict or select one local port and
  update both URLs.
- **Authentication failed:** test `psql "$DATABASE_URL"`; reset with `sudo -u postgres psql` and
  `\password cce`. Confirm the URL password is percent-encoded and HBA uses SCRAM.
- **Wrong URL:** `DATABASE_URL` must name `cce`; `TEST_DATABASE_URL` normally names `postgres` and its
  role needs `CREATEDB`.
- **Windows cannot reach WSL:** confirm `wsl --status`, `wsl --update`, the service listener, and
  `Test-NetConnection localhost -Port 5432`. Use the all-in-WSL topology if forwarding is unavailable.
- **Migration checksum mismatch:** restore the applied SQL and add a forward migration. Never edit
  applied history or its recorded checksum.
- **Test database safety rejection:** correct `TEST_DATABASE_URL` or the generated-name input; never
  disguise the development database to bypass the guard.
- **Abrupt test termination:** identify the exact stale `cce_test_*` database before using the guarded
  manual `dropdb` command above. Normal cleanup terminates suite connections automatically.

The retained Compose file is an optional compatibility path, not the recommended workflow. The
production Dockerfile and release migrator/runner behavior are independent of WSL.

Authoritative setup references: [PostgreSQL Ubuntu packages and official Apt repository](https://www.postgresql.org/download/linux/ubuntu/),
[PostgreSQL 18 password authentication](https://www.postgresql.org/docs/18/auth-password.html), and
[Microsoft WSL networking](https://learn.microsoft.com/windows/wsl/networking).
