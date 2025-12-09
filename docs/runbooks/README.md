# runbooks

operational procedures for production incidents.

## available runbooks

- [connection-pool-exhaustion](connection-pool-exhaustion.md) - 500s everywhere, queue listener down, stuck connections

## when to use

runbooks are for known failure modes with established remediation steps. if you encounter a new type of incident:

1. stabilize first (restart machines if needed)
2. investigate using [logfire](../tools/logfire.md)
3. document the incident and create a new runbook

## general troubleshooting

```bash
# check machine status
fly status -a relay-api

# view recent logs
fly logs -a relay-api

# restart machines
fly machines list -a relay-api
fly machines restart <machine-id> -a relay-api
```
