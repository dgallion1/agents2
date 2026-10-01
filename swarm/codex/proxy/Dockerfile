# The egress proxy (run CD, task CD1): the only container with a route out.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tinyproxy \
 && rm -rf /var/lib/apt/lists/*
COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY filter /etc/tinyproxy/filter
# -d: stay in the foreground and log to stdout (the harness collects it as proxy.log)
CMD ["tinyproxy", "-d", "-c", "/etc/tinyproxy/tinyproxy.conf"]
