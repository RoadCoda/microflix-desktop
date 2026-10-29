#!/bin/sh
set -eu
# Render mounts the persistent disk after image build; initialize ownership at runtime.
mkdir -p /var/data/tiktok-profile
chown node:node /var/data
chown -R node:node /var/data/tiktok-profile
chmod 700 /var/data /var/data/tiktok-profile
exec gosu node node server-collector/host.mjs
