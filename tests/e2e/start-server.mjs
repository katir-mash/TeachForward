import { createApp } from '../../server/app.js';
import { createRedisStores } from '../../server/redis-stores.js';
import { LuaRedis } from '../helpers/lua-redis.js';

// Production HTTP/static behavior with an isolated offline Redis Lua fixture.
// Do not import index.js: real production always requires real Upstash credentials.
// No owner .env, local access records or remote provider are read by this runner.
const redis = new LuaRedis();
const stores = createRedisStores({ redis, accessOptions: { ipBurstLimit: 200, ipDailyLimit: 500 } });
const app = createApp({ production: true, appOrigin: process.env.APP_ORIGIN, ...stores, client: null });
const server = app.listen(Number(process.env.PORT), '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
