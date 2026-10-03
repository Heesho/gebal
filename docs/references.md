# Primary references

Consulted 2026-10-03. Exact Git revisions below were resolved using GitHub repository/commit APIs. Root READMEs and available license/notice files were inspected at these revisions; this was not a full code audit. Nothing was copied into the runtime or installed as a method pack. Copyright notices remain upstream. Missing permissions block future copying/redistribution.

| Reference | Consulted revision | Observed root license | Use here |
|---|---|---|---|
| [0xsimao/0xsimao-ai](https://github.com/0xsimao/0xsimao-ai/tree/3f81e5803174182a7db07eca87849d2b3d571113) | `3f81e5803174182a7db07eca87849d2b3d571113` | UNRESOLVED: no root license identified | Conceptual accounting-first review and separate perspectives; pack import blocked pending permission. |
| [pashov/skills](https://github.com/pashov/skills/tree/8ce544c9c9affab448d3dc4c79191d052e3a57ec) | `8ce544c9c9affab448d3dc4c79191d052e3a57ec` | MIT | Conceptual pre-review threat models, entry points and invariants; no imported skills. |
| [Kritt-ai/open-kritt](https://github.com/Kritt-ai/open-kritt/tree/43e1d19a00ce50bd93253d1c6c3a48cfffbcc4c3) | `43e1d19a00ce50bd93253d1c6c3a48cfffbcc4c3` | AGPL-3.0 | Conceptual separation of workflows, providers and findings; its broader execution authority is not adopted. |
| [trailofbits/skills](https://github.com/trailofbits/skills/tree/82fe8226252622fa807643bdca1710901198553a) | `82fe8226252622fa807643bdca1710901198553a` | CC-BY-SA-4.0 | Conceptual explicit review context and evidence discipline; no copied skill content. |
| [crytic/slither](https://github.com/crytic/slither/tree/eef5df948b8992eff85786b6b0bb4a193933e2c9) | `eef5df948b8992eff85786b6b0bb4a193933e2c9` | AGPL-3.0 | External subprocess adapter, structured detector output. |
| [Cyfrin/aderyn](https://github.com/Cyfrin/aderyn/tree/de6a0904a07ec20966b2b8f2ece4e89f0ada7bdb) | `de6a0904a07ec20966b2b8f2ece4e89f0ada7bdb` | GPL-3.0 | Future optional static perspective; not integrated. |
| [foundry-rs/foundry](https://github.com/foundry-rs/foundry/tree/60255eee79332caef99f0c885f55589769f8f0c0) | `60255eee79332caef99f0c885f55589769f8f0c0` | MIT OR Apache-2.0 (both license files inspected) | External compiler/test subprocess adapter. |
| [crytic/echidna](https://github.com/crytic/echidna/tree/5403657dbf515f5bd8801bf99d4fcdec302ee817) | `5403657dbf515f5bd8801bf99d4fcdec302ee817` | AGPL-3.0 | Future approved property campaigns; not integrated. |
| [a16z/halmos](https://github.com/a16z/halmos/tree/079bb4241d1b460baf986257d56ea86977d73451) | `079bb4241d1b460baf986257d56ea86977d73451` | AGPL-3.0 | Future bounded symbolic property checks; not integrated. |
| [Certora/AutoProver](https://github.com/Certora/AutoProver/tree/709293a91de9c23d18694dcc7e0fdf3d0e508d6d) | `709293a91de9c23d18694dcc7e0fdf3d0e508d6d` | GPL-3.0 | Future opt-in specification/prover integration; not integrated. |

## Website and API references

- [V12 product reference](https://v12.sh/): retrieved 2026-10-03, response SHA-256 `82d3bd95bbf70d4bc2a3ef8645859ebe607193d5244b470e750b46396b687f22`; final URL `https://v12.sh/`. No public source revision claimed.
- [Optional Codex SDK](https://developers.openai.com/codex/sdk/): retrieved 2026-10-03, response SHA-256 `909387cf2869fd1debf9b5fb86ae75e5e7431ed3ca198d8b01d9c24700c61c3f`; final URL `https://learn.chatgpt.com/docs/codex-sdk`. No public source revision claimed.
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): retrieved 2026-10-03, response SHA-256 `b7476c0c0158907257c931dd7597368e4609423ab9e31e049423d05eb7b6989a`; final URL `https://developers.openai.com/api/docs/guides/structured-outputs`. No public source revision claimed.
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs): retrieved 2026-10-03, response SHA-256 `ed2acc7a2b9a1299f99e2b1fa0a6f660c69e994ac0a1287419e9336cde866a99`; final URL `https://platform.claude.com/docs/en/build-with-claude/structured-outputs`. No public source revision claimed.
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create): retrieved 2026-10-03, response SHA-256 `cd21c7f4c2c4b99f5a06fefa5ffacc05ada8ea8f5e0995498b02fe35a846cd60`; final URL `https://platform.claude.com/docs/en/api/messages/create`. No public source revision claimed.

V12 was inspected for high-level CLI/workbench product context only. Its illustrative findings, exploit examples, branding, layout assets and performance claims are not used or reproduced. Gebal has no affiliation. The optional Codex SDK is not a dependency: the first implementation uses bounded provider HTTP calls and a native durable queue.
