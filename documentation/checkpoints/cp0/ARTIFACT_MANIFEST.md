# CP0 Artifact Manifest

Status: passed
Date opened: 2026-07-01
Date passed: 2026-07-01

## Created CP0 Artifacts

| Path | Purpose |
|---|---|
| `documentation/README.md` | Harmonized documentation entry point and roadmap. |
| `documentation/checkpoints/CHECKPOINT_LOG.md` | Global checkpoint status and tag plan. |
| `documentation/checkpoints/cp0/CP0_BASELINE.md` | Formal CP0 baseline. |
| `documentation/checkpoints/cp0/DECISION_LOG.md` | Accepted and open planning decisions. |
| `documentation/checkpoints/cp0/RISK_REGISTER.md` | Initial risk register. |
| `documentation/checkpoints/cp0/SCOPE_BASELINE.md` | MVP, beta, launch, and post-launch scope boundaries. |
| `documentation/checkpoints/cp0/ARTIFACT_MANIFEST.md` | This manifest. |

## Source Artifacts Preserved

| Path | Role |
|---|---|
| `documentation/Soko doc 5 June ctrl .pdf` | Master Control Document. |
| `documentation/Soko_Master_Control_Document_v1.docx` | Master Control Document source duplicate. |
| `documentation/Soko_Master_Control_Document_v1 (1).docx` | Master Control Document source duplicate. |
| `documentation/Soko doc 1 june.pdf` | Master Architecture Document. |
| `documentation/Soko doc 2 June .pdf` | Technical Architecture Specification. |
| `documentation/Soko doc 3 june.pdf` | PRD and Development Blueprint. |
| `documentation/Soko doc 4 June  (1).pdf` | Sokoclaw Runtime Specification. |
| `documentation/Soko doc 1.0 june (1).pdf` | TIEL base specification. |
| `documentation/Soko doc 1,1 june.pdf` | TIEL implementation supplement. |
| `documentation/1000157660.png` | UI reference. |
| `documentation/1000157661.png` | UI reference. |
| `documentation/1000157662.png` | UI reference. |

## Invalid or Superseded Artifacts

| Path | Reason |
|---|---|
| `documentation/Soko doc 4 June .pdf` | Broken one-page placeholder. Excluded from authority. |

## Integrity Notes

- The two Master Control DOCX files have identical extracted text, even though their container file hashes differ.
- The workspace has a read-only environment mount at `.git`.
- Git metadata is stored in `.repo.git`.
- CP0 is Git-tagged in `.repo.git`.

## CP0 Completion Checklist

- [x] Harmonized README created.
- [x] Source hierarchy documented.
- [x] Broken placeholder identified.
- [x] CP0 baseline created.
- [x] Decision log created.
- [x] Risk register created.
- [x] Scope baseline created.
- [x] Artifact manifest created.
- [x] Checkpoint log created.
- [x] Alternate Git repository initialized at `.repo.git`.
- [x] `checkpoint/cp0-planning-baseline` tag created.
- [x] CP0 marked `passed` in checkpoint log.
