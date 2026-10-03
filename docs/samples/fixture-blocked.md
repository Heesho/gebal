# Gebal assessment

Run: 77a4cf35-baa8-4310-8f6a-732175075df9

**Outcome: blocked**

An empty findings list is not a security certificate\. Completed checks establish only their stated coverage\.

Snapshot: dc898a432137fae87c279c25d7a5ceeae4b5cb8ddb490a5c7638e4743b6d57a5

## Incomplete checks

- foundry-build: **blocked** — No approved immutable tool image\. No host execution was attempted\.
- slither: **blocked** — No approved immutable tool image\. No host execution was attempted\.
- foundry-test: **not-run** — Prerequisite did not succeed

## Scope and requirements

Original synthetic fixture: owner-only credit issuance, accounting conservation, bounded retirement, downward unit rounding\. No real funds\.

Authorized: src, test, foundry\.toml

Excluded/absent:

## Check evidence

- intake: succeeded. Recorded 3 authorized files\. Supported Foundry configuration\.
  Evidence: c7d3fb11c6b10191bc3f9ed3a38c415f7f01063199a5849fd945d6edcd79e0d8
- foundry-build: blocked. No approved immutable tool image\. No host execution was attempted\.
  Evidence: none
- slither: blocked. No approved immutable tool image\. No host execution was attempted\.
  Evidence: none
- foundry-test: not-run. Prerequisite did not succeed
  Evidence: none

## Findings requiring human review

No findings recorded. This does not establish safety.

## Coverage gaps

- No semantic, test, or property coverage established by intake\.
- Check incomplete or blocked; no security coverage claimed\.
- Check incomplete or blocked; no security coverage claimed\.

## Provenance and cost

Method: native-review-v1; adapter: 0.1.0

Tool image: unavailable; compiler: 0\.8\.28; EVM: cancun

Provider/model: none

Tokens consumed: 0; reserved: 0. Monetary cost: unknown. Local compute cost is not measured.

The JSON report retains manifests, settings, decisions, invocations, source hashes, timelines and coverage records. Artifact IDs resolve through the local store or CLI evidence command.
