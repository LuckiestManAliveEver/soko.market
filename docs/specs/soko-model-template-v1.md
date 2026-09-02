# `.soko` Model Template format v1

Status: canonical. Media type: `application/vnd.soko.template+json`. Archive suffix: `.soko`.

A `.soko` artifact is a portable, integrity-checked package of executable domain expertise. It is
not a model identity and is not shorthand for “weights plus a system prompt.”

## Layout

The portable representation is a deterministic archive or the equivalent JSON export envelope:

```text
expert.soko
├── manifest.json
├── expertise/
│   ├── source.json                 required
│   ├── vocabulary.json             optional when embedded in source.json
│   └── compiled/                    optional object pointers or small inline artifacts
├── runtime/
│   ├── prompt.txt                  required, may be empty
│   ├── tools.json                  required
│   └── output-schemas.json         required
├── eval/
│   └── suite-references.json       required, may be empty
└── lineage.json                    required
```

Large adapters, deltas, gists, and weights are not embedded in PostgreSQL. The manifest records an
object key, size, checksum, exact base model, and architecture. Archive tooling may include those
objects when policy and size permit.

## Manifest

`SokoModelTemplateManifestV1` in `model-templates/types.ts` is the executable contract. Required
top-level fields are:

| Field           | Requirement                                                                               |
| --------------- | ----------------------------------------------------------------------------------------- |
| `format`        | Literal `soko-template`                                                                   |
| `formatVersion` | Integer `1`                                                                               |
| `template`      | Stable ID, kebab-case slug, name, semantic version, domain, owning business, and agent ID |
| `tasks`         | One or more namespaced task contracts such as `catalog.product-classify`                  |
| `capabilities`  | Declared expertise/runtime capabilities; these do not grant permission                    |
| `baseModel`     | Compatibility requirements, preferred/tested bases, and explicit incompatibilities        |
| `expertise`     | Portable source expertise plus optional base-specific compiled artifacts                  |
| `runtime`       | Prompt, registered Soko tools, output schemas, context requirements, constraints          |
| `evaluation`    | Frozen suite references and baseline metric metadata                                      |
| `lineage`       | Parent, improvement run, dataset version, actor, timestamp, and change summary            |
| `ownership`     | Business and distribution visibility                                                      |
| `checksums`     | Safe relative path to `sha256:<64 lowercase hex>`                                         |

Unknown tool IDs are invalid. Tool declarations are requests to the existing Soko tool and policy
pipeline, never authority to invoke arbitrary shell, network, filesystem, or provider tools.

## Source and compiled expertise

Source expertise is the portable asset:

```json
{
  "instructions": ["Classify retail products and preserve quantity and unit."],
  "vocabulary": { "rice": ["basmati", "pishori"] },
  "rules": [
    {
      "id": "correction:123",
      "match": "pishori rice",
      "output": { "department": "food", "category": "cereals" },
      "provenance": "CORRECTION",
      "sourceCorrectionId": "123"
    }
  ]
}
```

Compiled artifacts are replaceable products of a strategy. `PROMPT` and vocabulary artifacts can
be base-neutral. `ADAPTER` and `DELTA` artifacts must specify `baseModelId` and
`baseArchitecture`. Runtime resolution rejects an architecture-free adapter; it never pretends an
adapter is universally portable.

## Versioning

- `formatVersion` versions the container/schema. A reader must reject an unsupported value.
- `template.version` uses semantic versioning and versions behavior.
- Historical version rows are never overwritten with new expertise. Runtime state may transition
  through `DRAFT -> CANDIDATE/EVALUATING -> PASSED/FAILED -> PROMOTED`.
- An improvement creates a new version with `lineage.parentVersionId`. Branches are valid.
- Dataset and evaluation-suite versions are independently frozen. A run references exact IDs.

## Integrity and signatures

Every materialized file must be listed in `checksums`. Import performs these checks in order:

1. Parse bounded input and reject unsafe paths (`/`, `..`, backslashes).
2. Validate the v1 manifest and tool names.
3. Recompute the canonical manifest SHA-256.
4. Recompute every file SHA-256 before storage or execution.
5. Resolve tenant ownership and base compatibility.

The current vertical slice implements checksums but not public-key signatures. A future
`signature.json` may sign the canonical manifest hash with a Marketplace publisher key. Signature
absence must not be shown as “verified provenance.”

## Compatibility and base replacement

Compatibility is capability-based:

- `requiredCapabilities` must all exist on the selected catalogue model.
- `minimumContextWindow` must be satisfied and knowable.
- `incompatibleModels` always wins.
- `preferredModels` affects selection preference, not identity.
- `testedModels` records evidence, not a permanent lock.

To replace a base model, retain the source expertise and evaluation history, select a compatible
catalogue model, compile any base-specific artifacts again, and evaluate the candidate against the
same baseline suite. A user override follows the same check.

## Runtime resolution

```text
authorized conversation
  -> active agent and native runtime binding
  -> promoted template for business + agent
  -> selected native model and host
  -> compatibility check
  -> compiled expertise appended to the existing prompt contract
  -> existing AgentRuntimeAdapter and ModelRuntimeAdapter
```

The template may reference the native runtime binding used during evaluation. The native graph
remains authoritative for model/host availability and fallback. Incompatible selection fails with
`TEMPLATE_BASE_MODEL_INCOMPATIBLE`; expertise is never silently dropped.

## Ownership, import, and export

- Every persisted object carries `businessId` and `accountId` derived from the authenticated
  session, not trusted from an arbitrary request body.
- Private exports retain provenance. Import into another business creates a new ownership record
  and an import provenance edge; it does not impersonate the publisher.
- Public or unlisted distribution is a Marketplace policy outside the v1 runtime lifecycle.
- Export returns the manifest, canonical manifest hash, file map/object descriptors, and suggested
  `.soko` filename. This proves portability without copying a GGUF model.

## Privacy constraints

Templates must not include credentials, whole private conversations, or unreviewed production
outputs. Production observations are separate records. Only an explicitly approved correction can
enter a training dataset. Secret-shaped keys are redacted before observation persistence.

## Minimal example

```json
{
  "format": "soko-template",
  "formatVersion": 1,
  "template": {
    "id": "fish-inventory",
    "slug": "fish-inventory-expert",
    "name": "Fish Inventory Expert",
    "version": "1.4.0",
    "domain": "retail.inventory",
    "businessId": "shop-id",
    "agentId": "shop-agent-id"
  },
  "tasks": ["inventory.reorder"],
  "capabilities": ["structured-output"],
  "baseModel": {
    "mode": "compatible",
    "requirements": {
      "requiredCapabilities": ["chat"],
      "minimumContextWindow": 2048,
      "preferredModels": ["qwen2.5-0.5b-android"],
      "testedModels": ["qwen2.5-0.5b-android", "smollm2-360m"],
      "incompatibleModels": []
    }
  },
  "expertise": {
    "source": { "instructions": [], "vocabulary": {}, "rules": [] },
    "compiledArtifacts": []
  },
  "runtime": {
    "prompt": "",
    "tools": [],
    "outputSchemas": [],
    "contextRequirements": [],
    "constraints": {}
  },
  "evaluation": { "suiteIds": [], "baselineMetrics": {} },
  "lineage": {
    "parentVersionId": null,
    "improvementRunId": null,
    "datasetVersionId": null,
    "createdBy": "owner-id",
    "createdAt": "2026-09-02T00:00:00.000Z",
    "changeSummary": "Initial version"
  },
  "ownership": { "businessId": "shop-id", "visibility": "PRIVATE" },
  "checksums": {}
}
```
