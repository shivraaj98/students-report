FROM docker.n8n.io/n8nio/n8n:2.43.7
COPY --chown=node:node automation/workflows/ /opt/classbridge/workflows/
COPY --chown=node:node automation/n8n-start.sh /opt/classbridge/start.sh
ENTRYPOINT ["/bin/sh", "/opt/classbridge/start.sh"]
