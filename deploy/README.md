# deploy/ — TEMPLATES ONLY (not applied to any host)

Nothing here is a secret and nothing here has been executed against a real host. Replace every `<PLACEHOLDER>` yourself.
Procedure, checks and rollback: `docs/deployment-packet.md`.

| file | purpose |
|---|---|
| `Caddyfile.example` | TLS reverse proxy (automatic HTTPS), single instance, overwrites forwarded headers |
| `nginx.conf.example` | the same, for nginx + certbot |
| `docker-compose.prod.example.yml` | single-instance app (read-only rootfs, non-root, read-only data volume, log rotation, healthcheck) |
| `hamghadam.env.example` | server-side environment (no secrets are needed for the mock/offline product) |
| `backup-restore.sh.example` | DB snapshot + sha256 + integrity check + restore |
