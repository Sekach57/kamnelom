'use strict';
const fs = require('node:fs'), path = require('node:path'), { createApp } = require('./app.js');
const env = process.env, dbPath = path.resolve(env.DB_PATH || path.join(__dirname, 'data', 'kamnelom.db'));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const app = createApp({ dbPath, origins: (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean), allowAny: env.ALLOW_ANY_ORIGIN === '1', trustProxy: env.TRUST_PROXY === '1', staticDir: env.STATIC_DIR || (fs.existsSync(path.join(__dirname, '..', 'dist')) ? path.join(__dirname, '..', 'dist') : null) });
const port = Number(env.PORT || 4310), host = env.HOST || '127.0.0.1';
app.server.listen(port, host, () => console.log(`Dwarf Gym API on http://${host}:${port}, db ${dbPath}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
