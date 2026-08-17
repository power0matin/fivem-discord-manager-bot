# Changelog

## 2.1.1 — Unreleased

Production-hardening release candidate.

### Fixed

- bounded/coalescing serialized and atomic `data.json` persistence with verified backup, fsync and corrupt-file fail-closed behavior
- shared canonical runtime database reference across `/setup` and modules
- persistence write/fsync/rename failures no longer permanently poison the write queue
- private ticket creation validates Manage Channels/Manage Roles and staff-role hierarchy before channel creation
- private ticket creation applies the `@everyone` deny atomically and does not acknowledge success before persistence succeeds
- failed Ticket setup/persistence cleans the temporary channel or quarantines it as `recovery_required` for deterministic restart cleanup
- ticket close state is crash-aware; mappings are removed only after Discord confirms channel deletion
- ticket state reconciliation after restart and duplicate ticket-creation serialization
- fatal process errors exit non-zero; SIGTERM/SIGINT flush pending persistence
- Welcome server-stat voice channel handling and Presence intent support
- anti-raid only reports successful kicks after Discord confirmation
- FiveM scheduled-event guild resolution and failed-event/persistence timestamp handling
- FiveM non-JSON/invalid endpoint response handling
- restart scheduling across DST calendar-day boundaries
- invalid Welcome button URLs and pathological configurable regexes
- clean-install `.env.example` placeholders and runtime configuration validation
- stale Ticket command documentation

### Security / dependencies

- production runtime floor is now Node.js **22+**
- updated direct dependency ranges and pinned the patched `ws` transitive runtime
- added `npm audit --audit-level=high` release gate
- tightened production systemd sandbox, capability set and file permissions
- added safe managed-install identity checks for uninstall

### Reliability / operations

- installer is failure-safe and rerunnable: validates platform/account/permissions, stages before switching, removes orphan interrupted staging, backs up existing data, and rolls code/unit/service state back on failure
- updater uses a shared atomic `flock`, verified external backup, persistence hash verification and automatic data rollback when a failed candidate changed state
- restore validates checksum/JSON before mutation, freezes the active service before its safety snapshot, uses atomic replacement and restores the original DB on post-swap readiness failure
- backup names are collision-safe under rapid successive operations and include verified SHA-256 sidecars
- added readiness check and version-controlled hardened systemd service
- added guarded uninstaller that preserves data/backups by default
- added automated configuration, Discord permission, Ticket recovery, persistence stress, installer/update, backup/restore and systemd regression tests
- added read-only GitHub Actions release gates with Node 22/24 coverage, ShellCheck and `systemd-analyze verify`

### Compatibility

Existing `data.json` structures are loaded through backward-compatible defaults and legacy Ticket mappings are migrated in memory without deleting user state. No intentional Discord command namespace breaking change is introduced.

The only intentional runtime requirement change is the production Node.js floor from the previous 18.x-compatible declaration to Node.js 22+. Upgrade the host runtime before installing/updating this release.
