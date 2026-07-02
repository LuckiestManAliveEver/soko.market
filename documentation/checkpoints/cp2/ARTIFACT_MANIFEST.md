# CP2 Artifact Manifest

Status: active
Date opened: 2026-07-02

## Created CP2 Artifacts

| Path                                                 | Purpose                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `documentation/checkpoints/cp2/CP2_BASELINE.md`      | Formal CP2 baseline, scope, exit criteria, and rollback instructions. |
| `documentation/checkpoints/cp2/DECISION_LOG.md`      | Account, auth, business, role, language, and audit decisions.         |
| `documentation/checkpoints/cp2/ARTIFACT_MANIFEST.md` | This manifest.                                                        |

## CP2 Opening Checklist

- [x] CP1 accepted as passed.
- [x] CP1 checkpoint tag exists and is pushed.
- [x] CP2 marked `active` in checkpoint log.
- [x] CP2 baseline created.
- [x] CP2 decision log created.
- [x] CP2 scope excludes production SMS provider, M-Pesa provider, marketplace, TIEL, and AI runtime implementation.

## CP2 Completion Checklist

- [ ] Account schema implemented.
- [ ] User schema implemented.
- [ ] Business schema implemented.
- [ ] Membership and role schema implemented.
- [ ] OTP challenge schema implemented.
- [ ] Session schema or equivalent server-side session store implemented.
- [ ] Audit event linkage implemented.
- [ ] OTP request API implemented.
- [ ] OTP verification API implemented.
- [ ] Account creation/resume API implemented.
- [ ] First business creation API implemented.
- [ ] Language preference saved.
- [ ] Logout invalidates active session.
- [ ] Refresh-surviving auth state verified.
- [ ] Server-side role checks implemented.
- [ ] Minimal web flow implemented.
- [ ] API tests cover success and rejection paths.
- [ ] Existing CP1 checks pass.
- [ ] `checkpoint/cp2-auth-business` tag created.
