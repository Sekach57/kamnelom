# Build from the repository root: docker build -f server/Dockerfile .
FROM node:24-alpine
WORKDIR /app
COPY server/app.js server/index.js ./server/
COPY dist ./dist
ENV NODE_ENV=production PORT=4310 HOST=0.0.0.0 DB_PATH=/data/kamnelom.db STATIC_DIR=/app/dist TRUST_PROXY=1
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4310/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
