#!/usr/bin/env bash
# Throwaway-container drill for install.sh. Runs INSIDE `ubuntu:24.04` as root
# for setup only, then runs the installer twice as a non-root user.
#
#   docker run --rm -v "$PWD":/work:ro -w /work ubuntu:24.04 \
#     bash /work/infra/machine/drill/container-drill.sh <kit_ref_commit>
#
# /work is read-only; everything else happens in the container's own
# filesystem and disappears with it. No real keys, accounts or URLs.
set -euo pipefail

KIT_REF="${1:?usage: container-drill.sh <kit tag or commit>}"
BUNDLE="/work/.baseleap/kit.bundle"

# ---- setup (not part of the installer's output) ----
apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends sudo >/dev/null
useradd -m -s /bin/bash agent
echo 'agent ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/agent
chmod 440 /etc/sudoers.d/agent

install -d -o agent -g agent /home/agent/src
cp -r /work/infra/machine /home/agent/src/machine
chown -R agent:agent /home/agent/src

cat >/home/agent/machine.json <<EOF
{
  "machine_id": "drill-container-01",
  "operator": "drill",
  "client_id": "baseleap",
  "teams": ["dev"],
  "timezone": "America/Toronto",
  "kit_channel": "stable",
  "kit_source": "$BUNDLE",
  "kit_ref": "$KIT_REF",
  "heartbeat_url": ""
}
EOF
chown agent:agent /home/agent/machine.json

run_as_agent() {
  runuser -u agent -- env -i HOME=/home/agent USER=agent LOGNAME=agent \
    PATH=/usr/local/bin:/usr/bin:/bin bash "$@"
}

rc=0
echo "===== RUN 1 ====="
run_as_agent /home/agent/src/machine/install.sh /home/agent/machine.json || rc=$?
echo "===== END RUN 1 (exit $rc) ====="
rc=0
echo "===== RUN 2 ====="
run_as_agent /home/agent/src/machine/install.sh /home/agent/machine.json || rc=$?
echo "===== END RUN 2 (exit $rc) ====="

echo "===== HEARTBEAT ====="
cat /home/agent/.baseleap/heartbeat.json
echo "===== KIT HEAD ====="
runuser -u agent -- git -C /home/agent/baseleap-kit rev-parse HEAD
echo "===== KIT TEST STATE ====="
cat /home/agent/.baseleap/state/kit-tests
