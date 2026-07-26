# Contributing

Thank you for helping make BNA's validation rules auditable.

Please open an issue before substantial work, keep pull requests focused, and
run `npm run check` before submitting a change. BNA is maintained by one
person alongside a company, so responses are best effort, typically within one
week.

Do not include credentials or personal data in an issue or pull request.
Report security vulnerabilities privately as described in
[SECURITY.md](./SECURITY.md).

## Schema release rule

Any change to an existing field that can move a score is a major schema
version. Announce it 30 days in advance, retain prior-version results for
comparison, and document the migration path before release.

Fields move from `bna` to `required` in a new major schema version only. The
release notes must identify the field, migration guidance, and the end of the
30-day notice period. During that period, consumers should continue to
validate with the prior schema version; this package never silently changes a
field's enforcement level in a patch or minor release.
