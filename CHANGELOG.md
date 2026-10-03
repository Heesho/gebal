# Changes

## 0.2.0

- Support explicit Foundry packages inside a monorepo, custom test roots, remappings.txt, compiler metadata settings and selected installed Solidity dependencies.
- Add reproducible local image preparation with pinned binaries, base image and Python wheel hashes; validate Forge 1.3.1/Slither 0.11.3 with three compiler versions.
- Verify effective compiler settings and isolation inside every tool container. Add real root/monorepo fixture execution and a three-compiler GitHub CI matrix.
- Verify all report evidence, retain execution provenance after parser failures, distinguish deadline cancellation, and return a failing demo exit status for incomplete execution.
- Preserve readable 0.1 records while requiring new approval for changed execution policy.

## 0.1.0

Initial CLI repository with scoped snapshots, own-agent context/export/import, private evidence, owner decisions and reports. Optional tool adapters initially had parser-only verification; see 0.2 for live integration.
