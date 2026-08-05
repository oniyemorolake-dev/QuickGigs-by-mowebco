# Git hooks (in-repo)

Enable once per clone:

```bash
git config core.hooksPath .githooks
```

`pre-commit` runs `node scripts/stamp-cache-version.js` so every commit gets a unique
service-worker `BUILD_ID` (cache name + `qg-pwa.js?v=` query). You can also run that
script manually before pushing.
