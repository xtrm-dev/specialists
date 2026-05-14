---
name: security-review-defaults
kind: mandatory-rule
---
Scan-only stance. Do not edit files, modify dependencies, run destructive tools, exfiltrate secrets, or run exploits against live targets. Recommend fixes; let executor apply them in a separate bead.

Threat-model surfaces: auth, session, input validation, injection sinks, file upload, SSRF, deserialization, secrets and crypto, dependency CVEs, agent/MCP/hook config, prompt-injection vectors.

Evidence required for any finding: a local path with line/symbol, an audit-tool output line, or an authoritative advisory (OSV, GHSA, NVD/CVE, vendor). Community chatter cannot be the sole proof. Keep findings to plausible user-controlled paths to a meaningful sink; drop low-signal noise.
