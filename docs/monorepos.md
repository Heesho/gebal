# Monorepo and dependency scope

Use the monorepo as the repository root and select **one compiler profile per run**. `projectPath` identifies the directory containing that package's `foundry.toml`. All `paths`, `dependencyPaths`, exclusions and report source references are relative to the monorepo root.

```json
{
  "projectPath": "packages/contracts",
  "paths": [
    "packages/contracts/src",
    "packages/contracts/test/minimal",
    "packages/contracts/foundry.toml",
    "packages/contracts/remappings.txt",
    "pnpm-lock.yaml"
  ],
  "dependencyPaths": [
    "packages/contracts/node_modules/@openzeppelin/contracts",
    "packages/contracts/lib/forge-std/src"
  ],
  "exclusions": [],
  "requirements": "Replace with the owner's intended behavior and explicit requirements.",
  "permission": "owned",
  "sourceOnly": true,
  "existingTests": false
}
```

The paths above are examples; select the dependencies actually imported by your authorized package. Do not include the entire `node_modules` tree or unrelated projects. `paths` rejects symlinks and omits dependency directories. `dependencyPaths` explicitly opts into reading selected installed dependency aliases, including pnpm symlinks/hardlinks. Only Solidity, package metadata and license files are captured through this path. Resolved paths must remain inside the selected monorepo; credential paths, escaping links and cycles are rejected. Source bytes are hashed into the snapshot; no dependency setup script runs.

`remappings.txt` and simple in-config remappings are supported. Relative targets such as `../../node_modules/...` may resolve inside the selected monorepo. Context-specific, conflicting, escaping or dynamic remappings remain unsupported. Longest matching prefixes take precedence. When an unremapped import resolves to exactly one selected library file, the plan records an explicit file remapping so the compiler and analyzer use the same source identity. Missing/ambiguous imports prevent executable coverage. Configuration notes disclose settings that are intentionally overridden by sandbox policy.

A project can be reviewed source-only with unavailable dependencies, but its report must describe the missing dependency behavior as a coverage gap. Full executable checks require the exact locked dependency sources to be available and explicitly selected. Gebal does not repair an installed dependency tree or silently substitute another package/version. Prepare dependencies separately using the project's approved process in a sandbox; do not execute assessed install hooks on the host.

Each compiler package needs its own scope, plan, image, source context and report. Review cross-package assumptions explicitly. A set of completed task statuses is not an end-to-end protocol audit, and several packages using different compiler versions must not be represented as one verified build.
