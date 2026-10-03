# Preparing an execution image

Gebal does not download a compiler, tool or dependency during assessment. Docker must expose a **local** daemon at `/var/run/docker.sock`. The adapter deliberately does not inherit remote Docker contexts. On macOS use a locally operated Linux VM/runtime that provides this socket. Docker CLI alone is insufficient.

The first image contract requires Linux Python 3 at `/usr/bin/python3`, Foundry Forge 1.x at `/usr/local/bin/forge`, Slither 0.11.x at `/usr/local/bin/slither`, and the exact native Solidity compiler at `/usr/local/bin/solc`. The conservative parser fixtures use Forge 1.3.1 and Slither 0.11.3. This is a proposed compatibility range; only parser fixtures have been tested here. Do not interpret it as a live compatibility certification. The bundled fixture requests solc 0.8.28 / Cancun. Version mismatch fails before analysis.

`docker/Dockerfile` assembles a locally prepared image without assessment-time network access. In a separate, reviewed preparation directory supply:

1. A reviewed Python 3.12 Debian base image pinned by digest, already present locally.
2. Verified native Linux `forge` and `solc` binaries matching your architecture and source settings. Record release checksums, provenance and applicable notices.
3. The pinned `slither-analyzer==0.11.3` wheel and its complete reviewed dependency wheel set in `wheels/`, fetched in a separate preparation step. Capture hashes and transitive licensing. Use an architecture-compatible wheel set.
4. A copy of this Dockerfile. Build with `--network=none --pull=false --build-arg BASE_IMAGE=...` and resolve the resulting local image ID with `docker image inspect --format '{{.Id}}' gebal-tools:local`.

Set the exact `sha256:...` image ID in scope configuration `image` or `GEBAL_TOOL_IMAGE` **before** planning. The resulting plan binds that image and must be approved by hash. No tag is accepted. Tool invocation versions, fixed controller/configuration version, compiler setting, seed (`0x…01`), 256 fuzz runs and invariant limits (64 runs / depth 32) are reproducible from the adapter version and execution record. Container output and normalized outcomes are preserved.

Compatibility restrictions: default Foundry profile, `src`, `test`, local `lib`, explicit solc 0.8.x and EVM, supported optimizer/via-IR fields, simple in-config remappings. External remappings.txt, arbitrary profiles, RPC, FFI, extra settings and missing authorized dependencies block execution. No silent settings rewrite is used to make unsupported projects pass. All nondefault settings outside the allowlist must be reviewed for explicit support.

Before trusting this adapter on a real project, run the opt-in integration tests against the reviewed image and inspect actual compiler/test/Slither output. Live network-denial, host-secret isolation and FFI denial verification remain release gates. A missing sandbox must keep the assessment incomplete.
