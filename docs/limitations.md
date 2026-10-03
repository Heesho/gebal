# Status and known limitations

The first iteration is a CLI repository for using your own AI. It includes source-only context export and validated review import; scope/snapshot approvals; versioned schemas; content-addressed artifacts; SQLite migration and transactional leases; optional bounded Docker Foundry/Slither adapters; optional OpenAI/Anthropic HTTP adapters; reports; append-only owner decisions; partial comparison and infrastructure evaluation controls. There is no website, dashboard or API service.

Real local verification covers controller tests, source intake, persisted outcomes, exports/imports and reports. Provider request/response tests use mocked HTTP transports. Tool parser tests use synthetic output examples. Docker CLI is installed but no local daemon/image is available, so successful live Forge/Slither execution is not verified. No paid provider calls, formal proofs or meaningful security benchmark scores are claimed.

Source-only mode completes only intake and any explicitly selected direct AI pass. It establishes no compiler, static-analysis, executable test, property or security coverage. Own-agent import validates source/provenance hashes and schema, but does not verify the external model's identity, settings, claimed execution, usage or cost. External AI operation is outside Gebal's sandbox and enforceable budget. The owner chooses whether and where to share the exported context.

Unfinished: independent reviewer orchestration, skeptical adjudication, full property registry and owner-approved generated-artifact workflow, manual merge/unmerge, semantic caller/dependency impact, reach/revert/vacuity metrics, priced USD budget reservations, genuine matched-budget evaluations and held-out benchmarks. The lightweight evaluation runner tests plumbing only.

Later integrations are absent: Aderyn, Echidna, Halmos, Gemini, local compatible endpoints, corpus management and AutoProver/Certora. There is no arbitrary method-pack execution, exploit generation, deployed-target discovery, wallet or live transaction workflow. No automatic source fixes or publication/deployment.

Compatibility is deliberately narrow: root-level default Foundry project, explicit compiler/EVM, supported settings allowlist, local authorized dependencies. There is no automatic nested-monorepo selection, Hardhat execution, full compiler-derived system map, cross-run cache, aggregate database quota, or signed portable evidence export. Filesystem checks do not claim race-free safety against a concurrently hostile local writer; the local owner/process/store are trusted.
