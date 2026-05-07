# specialists-client (Python)

Stdlib-only reference client for the [specialists-service](../../docs/specialists-service.md) HTTP API.

- **Zero runtime dependencies.** Built on `urllib.request` and `json` from the stdlib.
- **Closed `error_type` taxonomy** mirrored 1:1 from the service, plus a single caller-side `transport` value for HTTP/socket failures.
- **No retries.** The caller owns retry policy — the service intentionally does not retry.

## Install

Drop the file into your project:

```bash
cp clients/python/specialists_client.py your_project/shared/
```

Or install from this directory:

```bash
pip install -e clients/python/
```

## Usage

```python
from specialists_client import SpecialistsClient, SpecialistErrorType

client = SpecialistsClient(base_url="http://specialists-service:8000")

# Health check
assert client.healthz(), "service not ready"

# Invoke a script-class specialist
result = client.run(
    "mercury-atomic-summarizer",
    variables={"title": article.title, "content": article.body},
)

if result.success:
    save_summary(result.parsed_json)
else:
    if result.error_type == SpecialistErrorType.TIMEOUT:
        retry_later(article.id)
    elif result.error_type == SpecialistErrorType.TEMPLATE_FIELD_MISUSE:
        # Caller bug — passed a spec key name instead of a template body.
        # Fix the call site, do not retry.
        raise RuntimeError(result.error)
    else:
        log.warning("specialist failed: %s (%s) trace=%s",
                    result.error, result.error_type, result.meta.get("trace_id"))
```

## Contract notes

- `variables` are substituted into the spec's `prompt.task_template` with `$varname` syntax.
- `template` overrides the template body for the call. **Do not pass a spec key name** (e.g. `"task_template"`, `"normalize_template"`); the service returns `template_field_misuse` for that pattern. Pass either the literal template text or omit the field.
- `meta.trace_id` propagates into the service's `/v1/generate` operational logs (`sp serve --log-level info`). Surface it in your own logs to correlate caller and service.
- `attempts` is a caller-tracked field for caller-side retry counting. The service itself does not retry; it returns `internal`/`quota`/`network`/etc. and the caller decides.

## Smoke test

A small smoke test runs against a live service:

```bash
SPECIALISTS_SERVICE_URL=http://localhost:8000 \
SPECIALISTS_SMOKE_SPECIALIST=mercury-atomic-summarizer \
pytest clients/python/tests/test_smoke.py
```

Skipped automatically when `SPECIALISTS_SERVICE_URL` is unset.

## Adapting

This client is intentionally minimal. To extend:

- **Retries**: wrap `client.run(...)` with your own backoff. Decide which `error_type` values are retryable (`timeout`, `network`, `quota` typically yes; `auth`, `template_field_misuse`, `template_variable_missing`, `prompt_too_large` no).
- **Connection pooling**: replace `urllib` with `httpx` or `requests` and keep the dataclass shape.
- **Async**: wrap `client.run` in `asyncio.to_thread(...)` or port to `httpx.AsyncClient`.

The dataclass shape (`SpecialistResult`) and the enum (`SpecialistErrorType`) are the stable surface — keep them when you swap the transport.
