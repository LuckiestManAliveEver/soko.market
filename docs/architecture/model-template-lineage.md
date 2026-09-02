# Model Template lineage and reproducibility

## Ancestry

Every template version records its parent version, source dataset, improvement run, creator,
timestamp, strategy output, base model, prompt footprint, artifact size, manifest checksum, and
compiled artifact descriptors. Parent links allow branches; semantic versions need only be unique
within a template.

```text
v1 (promoted)
 └─ v1.1 candidate, dataset v2, prompt optimization
     ├─ promoted
     └─ future base-migration branch
```

## Dataset lineage

An approved production correction points back to its observation, producing template version,
base model, native binding, execution host, submitter, approver, and timestamps. Dataset creation
copies the approved input/expected result into an immutable example and records those IDs. Training,
validation, and regression splits are explicit. Evaluation cases cannot enter `TRAINING`.

The SHA-256 covers ordered materialized content. Historical rows have no update API, and migration
081 rejects changed dataset-version/example JSON while allowing the persistence layer's identical
upserts.

## Improvement runs

An improvement run references exactly one parent version, frozen dataset version, suite, target
base, strategy, and configuration. A successful run creates a new candidate; it never mutates its
parent. Unsupported strategies persist a failed run and surface an explicit error.

## Promotion and rollback

Promotion records baseline, candidate, evaluation run, thresholds, decision, actor, and reason.
Rollback swaps the active template runtime binding to the previous promoted version and writes a
`ROLLED_BACK` decision. The version and evaluation evidence remain intact. Rolling forward is a
normal re-promotion after gates pass.

## Reproduction boundary

The v1 vertical slice can reproduce source expertise, prompt optimization, deterministic
evaluation, and report cards. Reproducing adapter or full-weight training will also require the
external worker image, exact dependencies, hardware/seed settings, and immutable object-storage
objects. Those are future provenance fields, not claimed by v1.
