# GHL simulator fixtures

These are **not recordings**. No live GoHighLevel call has been made (no token yet). The success bodies were
written from the field names on the official HighLevel pages listed in `docs/integration-contract.md` "Sources"
(Create Contact, Get Duplicate Contact, Add Tags, Remove Tags); the duplicate-search page documents `contact: null`
for "no duplicate". Every error body in `errors.json` is **invented**, and so is every status the simulator
returns for a situation the docs do not describe. See "unverified (live)" in `docs/integrations/ghl.md`.

All values are fake and use the reserved `example.test` domain. Replace these files with scrubbed recordings after
the first live test on the test sub-account, then re-run `tests/integrations/ghl`.
