#!/bin/sh
set -eu
# Import only ClassBridge's own stable IDs. Existing workflows and credentials remain.
n8n import:workflow --separate --input=/opt/classbridge/workflows
for workflow in cbIngest20261018 cbDispatch20261018 cbSchedule20261018; do
  n8n publish:workflow --id="$workflow"
done
exec n8n start
