# vendor/

Third-party tarballs that aren't published to the npm registry, checked in so `pnpm install`
never depends on a third-party CDN being reachable at build time.

## xlsx-0.20.3.tgz

SheetJS stopped publishing `xlsx` releases newer than `0.18.5` to npm; `0.19+` (including the
`0.20.3` this repo uses, see `services/api/package.json`) is only distributed from
`cdn.sheetjs.com`. Depending on that CDN directly makes every `pnpm install` (local, CI, and
Render's build) a single point of failure - if `cdn.sheetjs.com` is down or rate-limits us,
builds fail.

This tarball is byte-identical to `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, verified
against the sha512 integrity hash already recorded in `pnpm-lock.yaml`
(`sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`).
`services/api/package.json` references it via `file:../../vendor/xlsx-0.20.3.tgz`.

To bump the version: download the new tarball from cdn.sheetjs.com, verify its hash, replace this
file, update the `file:` reference's filename in `services/api/package.json`, and run
`pnpm install`.
