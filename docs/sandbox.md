# Preparing and running the local sandbox

Source-only review needs no Docker. Optional executable checks require a locally operated Linux Docker daemon. Gebal never falls back to host Forge/Slither, inherits a remote Docker context, installs project dependencies, or downloads anything during assessment.

## Supported toolchain

The tested adapter is **Forge 1.3.1, Slither 0.11.3, crytic-compile 0.3.11, Python 3.12**, with native **solc 0.8.26, 0.8.28 or 0.8.30**, on Linux amd64. Other exact 0.8.x compilers require a separately verified image and integration run. Parsers reject other Forge/Slither versions. Forge 1.8.4 was tried during development and Slither failed source mapping; that combination is not supported. A supported version does not imply the upstream tools are defect-free.

`docker/requirements.lock` pins and hashes all Python wheels for CPython 3.12/Linux amd64. `docker/python-notices.json` records their published license metadata. Installed wheels retain their upstream notices. Original Gebal code is MIT; the container's tools are separately licensed, including Slither's AGPL. Preparing an image locally does not grant a right to redistribute third-party components without their license obligations.

## Runtime

The default endpoint is `unix:///var/run/docker.sock`. Set `GEBAL_DOCKER_HOST` to another **local Unix socket** if necessary. Remote TCP/SSH endpoints are rejected. The operator must ensure the socket is a local daemon, rather than an externally forwarded service. The endpoint is recorded in execution provenance.

`GEBAL_SANDBOX_ROOT` selects an existing absolute scratch directory, outside the assessed repository, visible at the same path inside the Docker VM. Its default is the system temporary directory. This directory contains disposable source snapshots, so use a private parent. Do not mount your home directory or credentials into an assessment container.

For Apple Silicon with Lima and Rosetta already installed, an isolated runtime can be created with:

```sh
mkdir -p "$HOME/.local/share/gebal-runtime/work"
limactl start --yes --name=gebal --vm-type=vz --rosetta --cpus=2 --memory=4 --disk=20 \
  --mount-only="$HOME/.local/share/gebal-runtime/work:w" template:docker
export GEBAL_DOCKER_HOST="unix://$HOME/.lima/gebal/sock/docker.sock"
export GEBAL_SANDBOX_ROOT="$HOME/.local/share/gebal-runtime/work"
```

This creates a VM; it is not needed for source-only review. Reuse an existing suitable runtime instead of overwriting one. Docker Desktop and Linux Docker may use the default socket. Linux amd64 images require an amd64 host or working local emulation on ARM. No Docker socket is ever mounted inside the assessment container.

## Image preparation

Review and run this from the Gebal checkout, using a **new directory outside the assessed project** that your local Docker daemon can see:

```sh
python3 scripts/prepare-tools.py --compiler 0.8.28 --output /absolute/vm-visible/gebal-image
```

This preparation step uses network access to fetch the digest-pinned Python base, release-checksummed Forge and solc, and hash-locked wheels. It mounts only its preparation directory. Image assembly is offline. It neither installs nor executes assessed project code. It emits `provenance.json` and an immutable image ID. Repeat with `--compiler 0.8.26` or `0.8.30` in distinct preparation directories if needed. Release URLs/checksums are fixed in the script; failures are not silently bypassed.

```sh
export GEBAL_TOOL_IMAGE="$(docker --host "$GEBAL_DOCKER_HOST" image inspect --format '{{.Id}}' gebal-tools:0.8.28)"
export GEBAL_INTEGRATION_IMAGE="$GEBAL_TOOL_IMAGE"
export GEBAL_ISOLATION_CANARY=synthetic-not-a-secret
pnpm exec tsx --test tests/sandbox.integration.test.ts
pnpm demo --tools
```

For other prepared compilers set `GEBAL_INTEGRATION_COMPILER` accordingly. Integration tests use only the original bundled fixture, with a temporary pragma change for the selected compiler. They execute root and nested-monorepo layouts. CI runs all three compiler variants, not an optional skipped test.

## Execution policy

Set the immutable image ID in scope configuration, choose `sourceOnly: false`, and create/approve a new exact plan. `existingTests: true` additionally executes selected existing tests. Every task gets a fresh container and copy of hash-verified source. Source/controller mounts and the image root are read-only. Network is disabled; user is 65534; capabilities are dropped; no-new-privileges, seccomp, process/memory/CPU/output/disk/time limits apply. Only bounded tmpfs scratch paths are writable.

The fixed controller checks the actual UID, interfaces, capabilities, seccomp, mount flags and host-environment canary before tools run. It verifies Forge's effective configuration against the approved normalized settings. FFI, filesystem cheatcode access, RPC access, automatic remappings and downloads are disabled. The fixed fuzz seed is `0x…01`, fuzz runs 256, invariant runs 64/depth 32. These bounded campaigns replace repository campaign settings and do not establish equivalent production test coverage.

Only `profile.default` is used. Compiler/EVM, optimizer/via-IR, bytecode hash and CBOR metadata are preserved. Source/test/library/remapping paths are normalized inside the authorized monorepo snapshot. RPC endpoints, other profiles and formatting settings are not loaded; output/cache/script paths are controller-owned. Tests requiring denied capabilities fail or remain incomplete. See [monorepo scope](monorepos.md).

The total controller deadline remains bounded even if the host worker disappears. Normal cancellation removes the container and disposable source copy. A crashed host/daemon can leave a scratch directory: inspect only `gebal-*` scratch directories in the configured root and remove them after confirming no associated container is active. Never delete source repositories or the persistent evidence store as cleanup.

Old 0.1 execution plans remain reportable, but require a new plan and approval before running adapter 0.2. Gebal never silently executes old approval against changed controller policy.
