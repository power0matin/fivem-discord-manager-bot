# Changelog

## 2.1.1 — Unreleased

Production-hardening release candidate.

### Fixed

- serialized and atomic `data.json` persistence with verified backup and corrupt-file fail-closed behavior
- shared canonical runtime database reference across `/setup` and modules
- private ticket creation is atomic and fails closed when permission overwrites cannot be enforced
- ticket close state is crash-aware; mappings are removed only after Discord confirms channel deletion
- ticket state reconciliation after restart and duplicate ticket-creation serialization
- fatal process errors exit non-zero; SIGTERM/SIGINT flush pending persistence
- Welcome server-stat voice channel handling and Presence intent support
- anti-raid only reports successful kicks after Discord confirmation
- FiveM scheduled-event guild resolution and failed-event timestamp handling
- FiveM non-JSON/invalid endpoint response handling
- restart scheduling across DST calendar-day boundaries
- invalid Welcome button URLs and pathological configurable regexes
- clean-install `.env.example` placeholders and runtime configuration validation
- stale Ticket command documentation

### Security / dependencies

- updated direct dependency ranges for current patched releases within compatible major versions
- added `npm audit --audit-level=high` release gate
- tightened production systemd sandbox and file permissions

### Reliability / operations

- added readiness check
- added verified backup/restore scripts
- added reproducible systemd installer
- added locked updater with release rollback
- added guarded uninstaller that preserves data by default
- added automated persistence/config/lifecycle/deployment regression tests
- added GitHub Actions CI

### Compatibility

Existing `data.json` structures are loaded through backward-compatible defaults and legacy Ticket mappings are migrated in memory without deleting user state. No intentional command namespace breaking change is introduced; documentation was updated to the command definitions already present in 2.1.0 source.
