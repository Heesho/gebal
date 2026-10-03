# Gebal

**Bring your own AI. Keep the review reproducible.**

Gebal is a Solidity review harness you run from a cloned repository with Codex, Claude Code, another assistant, or a local model. It pins the source and scope, prepares review context, validates AI observations, records evidence and keeps human decisions separate from model claims.

The first iteration is a CLI and agent workflow. No Gebal account, website, hosted service or platform API key is needed. Original code is MIT licensed. Tool dependencies retain their own licenses. Brand domain: [gebal.ai](https://gebal.ai).

## Tell your model to use it

From your smart-contract repository, give your coding assistant this prompt:

> Use https://github.com/Heesho/gebal as the harness for a defensive source review of this smart-contract repository. Read START_HERE.md and follow its workflow. You may set up and run the source-only workflow for this repository, keeping the harness, state and reports outside it. Use your current model, document the selected scope and assumptions, import your observations, and give me the Markdown/JSON reports. Ask before executing assessed code, calling an additional provider, expanding scope or modifying this project. Keep findings unreviewed for my triage and clearly state what was not checked.

**Agent entry point: [START_HERE.md](START_HERE.md).** It covers cloning/setup, scope, approval, context export, review import and delivery. The assistant you already use performs the review; Gebal does not require a second AI account.

## Try it

Install Node **22.23.3** and pnpm **10.34.6**, then clone and run:

```sh
git clone https://github.com/Heesho/gebal.git
cd gebal
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm demo
```

The demo runs real source intake on an original synthetic credit ledger and saves JSON, Markdown, standalone HTML and SARIF reports. It prints `RUN_ID` and a separate `GEBAL_HOME` directory. It makes no model request and executes no Solidity. The report explicitly says source-only; successful intake is not successful security analysis.

Use your own AI on that snapshot:

```sh
export GEBAL_HOME=/path/printed/by/demo
pnpm gebal context RUN_ID --output /tmp/gebal-context.json
```

Give your assistant [agents/REVIEW.md](agents/REVIEW.md), [agents/response.schema.json](agents/response.schema.json) and the exported context. For example:

> Use Gebal's agents/REVIEW.md workflow to review /tmp/gebal-context.json. Save a source-linked JSON review matching agents/response.schema.json to /tmp/gebal-review.json. Use the exact snapshotHash and contextHash from the export. State assumptions and gaps. Do not execute code, generate exploits or modify the original project.

Then import and inspect the result:

```sh
pnpm gebal import-review RUN_ID --input /tmp/gebal-review.json --reviewer "my assistant / my selected model"
pnpm gebal findings RUN_ID
pnpm gebal report RUN_ID --format md --output /tmp/gebal-report.md
```

The import validates hashes, schema and source spans. It records **unreviewed observations**, never confirmation or executed tests. External model identity, settings, usage and spend are operator-reported or unknown. The import cannot make blocked tool checks pass. Gebal performs no external transmission in this workflow; approve any cloud assistant's access to the exported source under your own account settings.

## Review your project

Select only a repository you own or are expressly authorized to review. Keep Gebal's state/configuration outside that repository. Original source is never modified.

```sh
pnpm gebal init --output /tmp/my-scope.json
# Edit the authorized paths, exclusions and intended behavior.
pnpm gebal review /absolute/project --config /tmp/my-scope.json --authorized
# Inspect the plan, diagnosis and exact hash before approving it.
pnpm gebal approve PLAN_ID --hash PLAN_HASH --actor YOUR_NAME --reason "Reviewed scope and execution plan"
pnpm gebal run PLAN_ID
pnpm gebal context RUN_ID --output /tmp/project-context.json
```

The default generated configuration is `sourceOnly: true`: useful with your own AI without Docker, API keys or paid calls. `gebal.example.json` contains concrete fixture requirements. Gebal snapshots actual file bytes, including selected uncommitted changes, rather than relying on a Git commit.

The private store defaults to `~/.local/share/gebal`. Override with `GEBAL_HOME` or `pnpm gebal --home /absolute/path ...`. Context exports contain only scoped source, stated requirements and provenance, not peer findings, analyzer warnings or evaluation labels.

## Add local tool evidence

Set `sourceOnly: false` and optionally `existingTests: true` in your scope configuration. Supply a reviewed immutable tool image and re-plan/approve. See [sandbox preparation](docs/sandbox.md).

```sh
pnpm gebal doctor
# GEBAL_TOOL_IMAGE must be an existing local sha256 image ID or registry digest.
pnpm demo --tools
```

Foundry and Slither run only inside the restricted local Docker sandbox. No network, host credentials, FFI, project package scripts or host-tool fallback. Missing Docker, missing images, unsupported config, failed compilation and unknown output stay visibly incomplete. The current machine lacks a Docker daemon, so live adapter validation is still blocked; parser tests are not a substitute.

Queue long-running checks for a separate worker:

```sh
pnpm gebal run PLAN_ID --enqueue
pnpm worker
pnpm gebal status RUN_ID
pnpm gebal cancel RUN_ID
pnpm gebal resume RUN_ID
```

## Triage, reports and comparison

```sh
pnpm gebal decide FINDING_ID --action needs-review --actor YOUR_NAME --reason "Inspect the assumptions"
pnpm gebal report RUN_ID --format json --output /tmp/report.json
pnpm gebal report RUN_ID --format html --output /tmp/report.html
pnpm gebal evidence ARTIFACT_SHA256
pnpm gebal compare LEFT_RUN RIGHT_RUN
pnpm gebal evaluation
```

Decisions append to history. Reports separate severity, confidence, evidence type and owner disposition. Comparisons identify changed source and scope; they are partial and invalidate old findings rather than infer unchanged callers are safe. An empty findings list is not a security certificate.

CLI exit codes: `0` command/planned checks completed; `2` configuration, approval or policy error; `3` failed/incomplete assessment. Enqueueing only confirms queue acceptance. Finding severity policy is distinct from execution success. CI examples must not reinterpret blocked analysis as a passing security gate.

## Optional direct API adapters

If you prefer Gebal to make a bounded review request, OpenAI Responses and Anthropic Messages adapters are included. Set the appropriate key in the controller environment and add an explicit provider/model to the full scope config, then approve the new plan's source egress:

```json
{"provider":{"provider":"openai","model":"YOUR_MODEL_ID","maxOutputTokens":2048},"limits":{"tokens":40000,"maxTasks":5}}
```

No model is chosen or silently substituted. Keys never enter assessed source or containers. No consumer subscription is assumed to include API credits. Direct calls reserve token capacity and avoid retries when outcomes may be billable. Dollar pricing is unknown; external assistant usage is outside those enforceable limits. Provider transport tests use mocks; no live paid calls have been performed.

## Development and status

```sh
pnpm test
pnpm build
pnpm format:check
pnpm evaluate
```

Implemented: CLI/worker, versioned schemas, scope/snapshot/approval controls, SQLite persistence, content-addressed evidence, own-agent context/import workflow, optional provider adapters, restricted tool execution adapters, human triage, reports and infrastructure evaluation controls.

Unfinished: live Forge/Slither validation, independent review orchestration, full property registry, skeptical adjudication, semantic impact/coverage metrics, benchmark-quality evaluation, additional tool/providers and advanced formal verification. No generated executable content is run. No exploit, deployed-target discovery, transaction, wallet, automatic remediation or publication workflow is included.

Read [architecture](docs/architecture.md), [methodology](docs/methodology.md), [threat model](docs/threat-model.md), [integration status](docs/integration-matrix.md), [evaluation](docs/evaluation.md), [limitations](docs/limitations.md), [local verification](docs/verification.md), and [license boundaries](docs/licensing.md). The repository is the distribution; no hosted service is deployed.
