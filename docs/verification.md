# Verification — version 0.2, 2026-10-03

The release scope is the bring-your-own-AI repository/CLI workflow and a bounded optional local toolchain. It is not a completed protocol audit, formal proof service or website. The previous 0.1 source-only/blocked samples remain historical examples.

## Verification performed

- Node 22.23.3 / pnpm 10.34.6 frozen dependencies, TypeScript build and formatting checks.
- Full local suite: **38 passed, zero failed, zero skipped** with the solc 0.8.28 image; root/monorepo integration also passed separately for 0.8.26 and 0.8.30.
- Production JavaScript dependency audit reported zero advisories on this date; this is a registry check, not a code audit.
- Controller/CLI regression tests: scope → immutable snapshot → exact approval → run → context → inert review import → report, plus denial and failure cases. Provider transports are mocked and clearly labelled.
- Live root and nested-monorepo fixture runs through the actual restricted Docker adapter. Native compiler, seven existing fixture tests and Slither all complete. Three tests verify FFI denial, filesystem-cheatcode denial and absence of a synthetic host-environment canary.
- Live compiler variants: solc 0.8.26, 0.8.28 and 0.8.30; Forge 1.3.1; Slither 0.11.3; crytic-compile 0.3.11. Each compiler is tested separately using the original fixture with the matching temporary pragma.
- Inside-container checks enforce UID 65534, loopback-only interfaces, zero effective capabilities, no-new-privileges, seccomp, read-only source/controller/root mounts and the effective compiler policy. Tool configuration mismatch fails before assessment.
- Source-only compatibility intake against the locally authorized project's two compiler packages. That source and its private evidence are **not** published. It establishes snapshot/context compatibility, not a security review or a verified target build. Missing dependency scope remains explicit.
- Four evaluation plumbing controls pass. No security precision/recall, formal proof coverage or independent audit assurance is claimed.

Regression tests cover scope traversal, ordinary and dependency symlink escapes/cycles, credential aliases, explicit pnpm dependencies, source/manifest/evidence corruption, hash-bound approvals, unsupported configuration, unavailable tools, empty test campaigns, malformed analyzer output, external review hashes/source spans, provider failures, cancellation/time/output bounds, leases, budgets, decision history, stale comparison and inert exports. Report generation verifies source plus every referenced task/tool/review artifact, including runs with no findings.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm format:check
pnpm test
pnpm evaluate
```

Without `GEBAL_INTEGRATION_IMAGE`, local tests explicitly skip the two executable integration cases. To exercise them, follow [sandbox preparation](sandbox.md), select the image and compiler, then run the same tests. GitHub CI additionally runs a required three-compiler matrix with real Docker execution; check the Actions result for the exact commit. A local pass is not a claim that a queued or running hosted job passed.

A representative retained live fixture run is `001fb821-2e36-40a5-b147-08120aed68db`: compilation, seven tests and Slither succeeded, with six unreviewed analyzer observations. It is implementation evidence, not a labelled vulnerability benchmark. Current CI rebuilds the fixtures rather than trusting this historical run ID.

## Failures caught during integration

Forge 1.8.4 plus Slither 0.11.3 failed source mapping. The adapter now restricts supported tool versions rather than treating that failure as clean output. Tool parsing failures retain raw evidence and an execution record. Slither's empty-detector form requires positive completion evidence, and unsuccessful analysis is rejected before interpreting findings. The image installs the native compiler after solc-select so pip cannot replace it with a downloader shim.

The image-preparation script verifies release checksums, pins the base digest and uses hash-locked wheels; assembly and assessment run without network. Upstream binaries and the local Docker daemon remain trusted dependencies. No live paid provider call, generated exploit, wallet operation or GlazeCorp code execution occurred during this verification.
