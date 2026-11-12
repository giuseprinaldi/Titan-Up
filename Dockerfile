FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public

# The SQLite database lives in /data; mount a volume there to keep it.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
