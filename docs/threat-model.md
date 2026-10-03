# Threat model and boundaries

Untrusted inputs: selected source, TOML, test code, dependencies, comments, provider replies, analyzer output and proposed method packs. Trusted: the local operator, Gebal controller, OS, Docker daemon, reviewed immutable tool image, installed dependencies, and private state directory. A malicious local user with write access to Gebal's process or private store is outside this threat model. Portable Node filesystem checks do not claim race-free traversal against a concurrent hostile filesystem writer; freeze the selected working tree while snapshotting.

Implemented boundaries:

- Literal relative authorized paths; no glob expansion; secret-directory/file exclusions; symlink and hardlink rejection; bounded file count, size and aggregate bytes. The store must resolve outside the assessed repository. No package script or project config is executed on the host.
- Content-addressed artifacts are bounded, immutable by convention/mode, and hash-verified when read. Input references and normalized output use runtime schemas. Output overflows and unknown schemas fail explicitly.
- Docker uses an explicitly local Unix socket, immutable images, `--pull=never`, non-root UID, read-only root/source/controller mounts, dropped capabilities, no-new-privileges, no network, bounded memory/swap/CPU/PIDs, tmpfs limits, wall time, and no daemon log capture. The container receives no host home, environment credentials, SSH agents or Docker socket. No assessed code runs without the sandbox.
- Controller-owned Foundry config sets FFI off, no filesystem cheatcode permissions, offline compiler, explicit compiler/EVM/settings, bounded fuzz seed/campaign. No user flags, generated commands, RPC URLs or model tools enter the execution command. Slither uses a controller-owned empty configuration.
- Provider gateway is separate from the container. It uses fixed official HTTPS endpoints, rejects redirects, provides no tool access, and validates structured outputs. Code/comments are untrusted prompt data. No output can approve a plan, execute a test, alter a specification, or mutate a source repository. Repository instructions never become controller policy.
- Own-agent exports contain only scoped source/requirements and hashes. Imports are inert JSON with strict schemas and source/hash validation; no command, code, tool call or permission can enter the worker through this path. External assistants are controlled by the operator, not Gebal; their data egress/spend are outside Gebal enforcement and recorded as unknown. No web/API server exists. Standalone HTML reports have no scripts or network access, and source/output is escaped as text.


Remaining risks / release gates:

Container isolation relies on Docker and its kernel/VM. Resource arguments are unit-tested but live containment has not been exercised in this environment because Docker's daemon is unavailable. The supplied image recipe has not been built here. Foundry/Slither end-to-end execution and filesystem/FFI/network denial must be tested on the reviewed image before security-sensitive use. No third-party image is implicitly trusted. Compiler and analyzer bugs can exist. Source files may themselves contain secrets: automated filename exclusions cannot prove absence; inspect the egress manifest before approving cloud review.

There is no hosted tenant boundary, remote API exposure, arbitrary method-pack runtime, archive ingestion, deployed-contract discovery, wallet handling, transaction execution, exploit generation, automatic fixes, or bounty/contest workflow. Generated executable tests/specifications are not implemented and cannot enter the worker. Do not wrap this prototype in a public execution service.
