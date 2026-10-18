FROM node:24-bookworm-slim
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=true CHROMIUM_PATH=/usr/bin/chromium
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-noto-core fonts-noto-extra tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY automation/package.json automation/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY automation/ ./
COPY web/styles.css ./public/base.css
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
