# Deploying specialists-service alongside an existing compose stack

You have an existing `docker-compose.yml` with services on a custom network. You want to add `specialists-service` as a sidecar that those services can call at `http://specialists-service:8000`. This page is the copyable recipe plus the three undocumented tweaks needed to make it work.

For first-time install on a fresh project, see [`specialists-service-install.md`](specialists-service-install.md). The minimal example at [`docker/compose.example.yml`](../docker/compose.example.yml) is the same shape with placeholders.

For the HTTP contract, see [`specialists-service.md`](specialists-service.md).

## The three tweaks

These are not obvious and are not enforced by the image entrypoint — they are deploy-time decisions.

### 1. `user: "1000:1000"` — host UID/GID for SQLite write perms

The image runs as UID `10001` (`specialists` user) by default. The bind mount at `.specialists/` is owned by your **host** UID — typically `1000:1000` for an interactive Linux user. Without overriding, `sp serve` crash-loops with `EPERM` or `EROFS` the first time it tries to open `observability.db`.

```yaml
user: "${UID:-1000}:${GID:-1000}"
```

For non-`1000` hosts, prefer the env-var form so the same compose file works across machines.

### 2. `HOME=/pi-home` — so pi finds its auth + models

The `pi` runtime resolves auth and `models.json` from `$HOME/.pi/`. The image sets `HOME=/home/specialists` for its built-in user, but consumer deployments mount the host's `~/.pi` into `/pi-home/.pi` and need pi to look there instead.

Without this, pi looks at `/root/.pi` (or `/home/specialists/.pi`) and **silently has zero models**. Symptom: every request returns `error_type: specialist_load_error` or `internal` with a model-not-found message in `error`.

```yaml
environment:
  HOME: /pi-home
volumes:
  - ${HOME}/.pi:/pi-home/.pi:ro
```

The `:ro` is fine — pi only reads its config.

### 3. RW bind mount of `.specialists/`

The service writes `observability.db` (and SQLite's `-wal` / `-shm` siblings) into `.specialists/db/`. Mount the **directory**, not just the `.db` file, so SQLite can create siblings.

```yaml
volumes:
  - ./.specialists:/work/.specialists
```

The mount is intentionally **read-write**. Read-only breaks observability writes and causes `db_not_writable` from `/readyz`.

## Copyable recipe

This is the production shape from darth-feedor's `ingestion/infra/docker-compose.yml`, slightly de-projectified.

```yaml
services:
  specialists-service:
    container_name: specialists-service
    image: specialists-service:local      # build separately, or use a published tag
    user: "${UID:-1000}:${GID:-1000}"
    stop_grace_period: 30s
    restart: unless-stopped
    command: ["serve", "--port", "8000"]
    env_file:
      - .env                              # forwards Pi auth tokens / API keys
    environment:
      HOME: /pi-home
    volumes:
      - ./.specialists:/work/.specialists # rw — observability.db lives here
      - ${HOME}/.pi:/pi-home/.pi:ro       # ro — pi auth + models.json
    networks:
      - merc                              # your existing network
    # Healthcheck is baked into the image (port 8000 default). Only declare a
    # compose-level `healthcheck:` block when you override the listen port.
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M

  # Your other services call it at http://specialists-service:8000
  my-app:
    image: my-app:local
    environment:
      SPECIALISTS_SERVICE_URL: http://specialists-service:8000
    depends_on:
      specialists-service:
        condition: service_healthy
    networks:
      - merc

networks:
  merc:
    external: true
    name: ${MERC_NET_NAME:-mercury_dev_network}
```

### Build the image

```bash
git clone https://github.com/Jaggerxtrm/specialists ~/dev/specialists
cd ~/dev/specialists
docker build -t specialists-service:local .
```

The `:local` tag matches the `image:` field above. Once a published tag is available you can swap it out.

### Bring up

```bash
docker compose up -d specialists-service
docker compose logs -f specialists-service       # watch for `serve listening on 8000`
curl -sS http://localhost:8000/readyz             # if you exposed the port; otherwise hit it from a sibling container
```

For internal-network deploys (no host port), call `/readyz` from a sibling container or use `docker exec`:

```bash
docker exec my-app curl -sS http://specialists-service:8000/readyz
```

## Troubleshooting matrix

Symptom → cause → fix.

| Symptom | Likely cause | Fix |
|---|---|---|
| Container restart loop, logs show `EACCES`/`EPERM`/`EROFS` opening `observability.db` | Bind mount owned by host UID 1000, container running as UID 10001 | Add `user: "${UID:-1000}:${GID:-1000}"` |
| `/readyz` returns `503 db_not_writable` | `.specialists/` mounted read-only, or wrong UID | Make the mount rw; check `user:` |
| Every `/v1/generate` returns `error_type: internal` with `models.json not found` or `no models for ...` | `HOME` not set in environment, pi looks at `/root/.pi` | Add `environment: HOME: /pi-home` AND mount `${HOME}/.pi:/pi-home/.pi:ro` |
| `/readyz` returns `503 pi_config_unreadable` | `~/.pi` not mounted, or mounted at wrong path | Mount host `~/.pi` to `/pi-home/.pi`; ensure `HOME=/pi-home` |
| `/readyz` returns `503 empty_user_dir` | `.specialists/user/` has no `*.specialist.json` files | Author or copy at least one script-class spec into `.specialists/user/` |
| `/readyz` returns `503 invalid_spec_in_user_dir` | One spec file fails schema validation | Run `sp doctor` against the dir, or check container logs for the offending file path |
| Sibling container can't resolve `specialists-service` hostname | Sibling is not on the same network | Both services must be on the same `networks:` entry |
| `.specialists/db/observability.db-wal` and `-shm` files appear but the service crashes | SQLite is on a remote filesystem that breaks fcntl locking | Move `.specialists/db/` to a local-disk path |
| Build fails with `npm` errors during `pi` install | Network restrictions during build | Use `--network=host` on the build, or pre-pull a published `pi` version via `--build-arg PI_VERSION=<tag>` |
| Healthcheck never passes despite `serve listening` log | Compose-level `healthcheck:` block uses `wget`/`curl` (not in image) and overrides the baked-in node-fetch healthcheck | Remove the compose-level block — image bakes one in. Only override when you change the listen port. |

## Rootless Podman / Fedora / SELinux

For rootless podman or SELinux-enforcing hosts, append `:z` (or `:Z` for unshared bind mounts) to bind mounts:

```yaml
volumes:
  - ./.specialists:/work/.specialists:z
  - ${HOME}/.pi:/pi-home/.pi:z,ro
```

And pass `--userns=keep-id` to keep host UID matching inside the container so the `user:` override remains correct. See [`specialists-service-install.md`](specialists-service-install.md#rootless-podman--fedora-selinux) for the broader rootless flow.

## Why these tweaks aren't baked into the image

- **`user:`** is intentionally a deploy decision. The image declares its built-in UID via the `org.specialists.uid="10001"` label, but bind-mount permissions belong to the host filesystem and the operator is the only party that knows the right UID for a given deploy.
- **`HOME=/pi-home`** is consumer-controlled because pi auth resolution needs a stable mount target across hosts. Hard-coding a path inside the image would make the mount target image-version-dependent.
- **rw `.specialists/`** is fundamental: the service is a stateful sidecar (observability + reload state), and the host operator owns where that state lives.

The recipe above is the working pattern. If you find a fourth deploy-time decision that should be on this page, file a bead with `discovered-from:unitAI-2fz5b`.
