## Summary / 变更说明

<!-- Describe the user-visible problem and result. / 描述问题和结果。 -->

## Validation / 验证

- [ ] `node tests/static-checks.mjs`
- [ ] `node scripts/audit-public-content.mjs --history`
- [ ] `node tests/run-browser-tests.mjs`
- [ ] Prepared package audited and browser-tested when release files changed

## Privacy checklist / 隐私检查

- [ ] Remote URLs use approved public roots or explicit `Example-*` fixtures
- [ ] No credentials, Authorization headers, tokens, passphrases, private bookmarks, or personal paths are included
- [ ] Screenshots use synthetic data and were reviewed manually because automated auditing does not perform OCR
- [ ] Production errors use `logErrorSafely()` and do not expose raw `Error` objects

## Compatibility / 兼容性

- [ ] Internal database, storage, backup, and sync identifiers remain compatible, or the migration is documented and tested
- [ ] Direct `file://` use still works
