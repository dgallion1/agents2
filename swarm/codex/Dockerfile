# The Codex check container (run CD, task CD1). Toolchain only: Codex itself,
# the repository copy, the credentials and the schema are bind-mounted by
# compose.yaml at run time — nothing of the host is baked in.
FROM golang:1.26-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs python3 git rsync curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# HOME=/tmp/home and GOCACHE=/tmp/gocache: uid 1000 has no passwd entry and no
# writable home in this image.
RUN mkdir -p /tmp/home /tmp/gocache && chmod 1777 /tmp/home /tmp/gocache
