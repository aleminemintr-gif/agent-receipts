# Errors and fixes

A running log of what broke while building this and how it was fixed.

| # | Symptom | Cause | Fix |
|---|---------|-------|-----|
| 1 | `npm test` failed with `MODULE_NOT_FOUND` on `test/` | `node --test test/` treats the folder as a module path on Node 22 | Use a glob: `node --test test/*.test.mjs` |
