# Local verification — 2026-10-03

Final scope: CLI repository with own-agent context/import workflow. Web application and HTTP API are absent. This local verification record was captured before initial repository publication. No hosted service was deployed.

## Passed locally

- Node 22.23.3 / pnpm 10.34.6 frozen workspace install.
- `pnpm test`: 31 passed, 0 failed, 1 skipped. Includes an actual child-process CLI flow: scope → plan → hash approval → source-only run → context export → inert synthetic review import → Markdown report. The imported review is labelled a test, with no actual model call.
- `pnpm build`: TypeScript validation of controller, worker, adapters, CLI and tests.
- `pnpm format:check`: source formatting checks.
- `pnpm evaluate`: four isolated infrastructure controls; not a vulnerability-detection benchmark.
- Real bundled-fixture source-only demo, run `7b9fcbbf-396d-48d4-adb4-d9658f02bcaf`: three source/config/test files snapshotted, intake completed, reports written. No Solidity execution or model review occurred.
- Real tools-mode partial demo, run `77a4cf35-baa8-4310-8f6a-732175075df9`: intake completed, no immutable image configured, local analysis blocked and tests not run. Preserved separately as a labelled partial-run sample.

Regression coverage includes path traversal, selected nested symlinks, hardlinks, secret-file exclusions, oversized files, source/manifest integrity, configuration/FFI restrictions, exact-plan approval binding, malformed/unknown tool output, empty test campaigns, provider refusal/invalid outputs, bounded process output/time/cancellation, shared token reservations, leases/recovery, ambiguous remote outcomes, cancellation, concurrent worker resource limits, append-only human decisions, comparison invalidation, inert HTML reports, cold-context separation, stale-context imports, forbidden extra/executable review fields, source references, duplicate imports, and export aliases into assessed projects.

## Mocks and unverified integrations

OpenAI/Anthropic tests intercept HTTP with synthetic response bodies. Slither/Foundry parser fixtures are synthetic versioned examples. No cloud credential was available to the checked process and no paid call was attempted. Claimed external reviewer identity is unverified by design.

Docker CLI probe failed to connect to `unix:///var/run/docker.sock`. The opt-in real Forge/Slither integration test is skipped until `GEBAL_INTEGRATION_IMAGE` names an approved immutable image with a running local daemon. Docker resource arguments and policy construction are tested, but actual containment and tool output compatibility have not been established here. Host Forge/Slither were not used to bypass isolation.

Hosted GitHub CI had not run when this local record was captured. Check the repository Actions page for the result associated with the exact published commit. Broader evaluations, actual property proofs and later integrations remain unfinished. The first useful iteration is the local own-agent harness, not a verified end-to-end automated audit service.
