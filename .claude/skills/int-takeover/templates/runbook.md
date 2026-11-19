# <Provider>: runbook (<Project>)

**What it does:** <one paragraph>
**System of record:** <which side owns which records>
**Auth:** <type> · scopes <list> · stored as <Vault id / env var name> · <"full account" if so>
**Endpoints used:** <list with method + path>
**Webhooks in:** <endpoint · events · signature scheme · replay window>
**Schedules:** <job · cron · what it reconciles>
**Rate limits:** <numbers from the provider profile; what we do on 429>
**When it's down:** <what users see · what the system does · how to tell (provider_health, failed jobs)>
**Reconnect:** <steps; who can do it>
**Simulator:** `tests/mocks/<provider>/` · modes <ok, slow, 429, 500, revoked, drift>
**Known issues:** <…>
**Evidence:** <file:line list>
