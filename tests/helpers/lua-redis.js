// Offline Redis harness: executes the production Lua, rather than mocking its result.
// The synchronous Lua VM gives EVAL the same no-interleaving command boundary.
import { lua, lauxlib, lualib, to_luastring, to_jsstring } from 'fengari';

const JSON_NULL = {};
const text = value => String(value);
const scoreLimit = value => value === '+inf' ? Infinity : value === '-inf' ? -Infinity : Number(String(value).replace(/^\(/, ''));

export class LuaRedis {
  constructor({ now = Date.now() } = {}) {
    this.now = now;
    this.data = new Map();
    this.available = true;
    this.calls = 0;
    this.failNext = false;
    this.failWhen = null;
    this.dropReplyWhen = null;
  }

  setTime(now) { this.now = now; }

  entry(key, type, create = false) {
    let entry = this.data.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= this.now) {
      this.data.delete(key); entry = undefined;
    }
    if (!entry && create) {
      entry = { type, value: type === 'string' ? '' : new Map() };
      this.data.set(key, entry);
    }
    if (entry && type && entry.type !== type) throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    return entry;
  }

  command(name, ...args) {
    const cmd = name.toUpperCase();
    const key = text(args[0]);
    if (cmd === 'TYPE') return { ok: this.entry(key)?.type ?? 'none' };
    if (cmd === 'EXISTS') return args.filter(item => this.entry(text(item))).length;
    if (cmd === 'DEL') return args.reduce((count, item) => count + Number(this.data.delete(text(item))), 0);
    if (cmd === 'EXPIRE' || cmd === 'PEXPIRE' || cmd === 'EXPIREAT' || cmd === 'PEXPIREAT') {
      const entry = this.entry(key);
      if (!entry) return 0;
      const amount = Number(args[1]);
      entry.expiresAt = cmd === 'EXPIRE' ? this.now + amount * 1000 : cmd === 'PEXPIRE' ? this.now + amount : cmd === 'EXPIREAT' ? amount * 1000 : amount;
      return 1;
    }
    if (cmd === 'TTL' || cmd === 'PTTL') {
      const entry = this.entry(key);
      if (!entry) return -2;
      if (entry.expiresAt === undefined) return -1;
      return Math.floor((entry.expiresAt - this.now) / (cmd === 'TTL' ? 1000 : 1));
    }
    if (cmd === 'TIME') return [text(Math.floor(this.now / 1000)), text((this.now % 1000) * 1000)];
    if (cmd === 'GET') return this.entry(key, 'string')?.value ?? false;
    if (cmd === 'SET') {
      const entry = this.entry(key, 'string', true);
      entry.value = text(args[1]); delete entry.expiresAt;
      if (String(args[2]).toUpperCase() === 'EX') entry.expiresAt = this.now + Number(args[3]) * 1000;
      if (String(args[2]).toUpperCase() === 'PX') entry.expiresAt = this.now + Number(args[3]);
      return { ok: 'OK' };
    }
    if (cmd === 'INCR' || cmd === 'INCRBY') {
      const entry = this.entry(key, 'string', true);
      const value = Number(entry.value || 0) + (cmd === 'INCR' ? 1 : Number(args[1]));
      entry.value = text(value); return value;
    }
    if (cmd.startsWith('H')) {
      const mutating = ['HSET', 'HINCRBY'].includes(cmd);
      const entry = this.entry(key, 'hash', mutating);
      const hash = entry?.value ?? new Map();
      if (cmd === 'HGET') return hash.get(text(args[1])) ?? false;
      if (cmd === 'HEXISTS') return Number(hash.has(text(args[1])));
      if (cmd === 'HMGET') return args.slice(1).map(field => hash.get(text(field)) ?? false);
      if (cmd === 'HSET') {
        let added = 0;
        for (let index = 1; index < args.length; index += 2) {
          const field = text(args[index]); added += Number(!hash.has(field)); hash.set(field, text(args[index + 1]));
        }
        return added;
      }
      if (cmd === 'HINCRBY') {
        const value = Number(hash.get(text(args[1])) ?? 0) + Number(args[2]);
        hash.set(text(args[1]), text(value)); return value;
      }
      if (cmd === 'HDEL') {
        const removed = args.slice(1).reduce((count, field) => count + Number(hash.delete(text(field))), 0);
        if (!hash.size) this.data.delete(key);
        return removed;
      }
      if (cmd === 'HLEN') return hash.size;
      if (cmd === 'HVALS') return [...hash.values()];
      if (cmd === 'HKEYS') return [...hash.keys()];
      if (cmd === 'HGETALL') return [...hash.entries()].flat();
    }
    if (cmd.startsWith('Z')) {
      const entry = this.entry(key, 'zset', cmd === 'ZADD' || cmd === 'ZINCRBY');
      const zset = entry?.value ?? new Map();
      const sorted = () => [...zset.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
      const inRange = (score, min, max) => (String(min).startsWith('(') ? score > scoreLimit(min) : score >= scoreLimit(min)) && (String(max).startsWith('(') ? score < scoreLimit(max) : score <= scoreLimit(max));
      if (cmd === 'ZADD') {
        let added = 0;
        for (let index = 1; index < args.length; index += 2) {
          const member = text(args[index + 1]); added += Number(!zset.has(member)); zset.set(member, Number(args[index]));
        }
        return added;
      }
      if (cmd === 'ZINCRBY') {
        const score = (zset.get(text(args[2])) ?? 0) + Number(args[1]); zset.set(text(args[2]), score); return text(score);
      }
      if (cmd === 'ZCARD') return zset.size;
      if (cmd === 'ZSCORE') return zset.has(text(args[1])) ? text(zset.get(text(args[1]))) : false;
      if (cmd === 'ZCOUNT') return sorted().filter(([, score]) => inRange(score, args[1], args[2])).length;
      if (cmd === 'ZRANGEBYSCORE' || cmd === 'ZRANGE') {
        let selected;
        if (cmd === 'ZRANGEBYSCORE') selected = sorted().filter(([, score]) => inRange(score, args[1], args[2]));
        else {
          const members = sorted();
          const start = Number(args[1]) < 0 ? members.length + Number(args[1]) : Number(args[1]);
          const end = Number(args[2]) < 0 ? members.length + Number(args[2]) : Number(args[2]);
          selected = members.slice(Math.max(0, start), end + 1);
        }
        const options = args.slice(3).map(text);
        const limit = options.findIndex(value => value.toUpperCase() === 'LIMIT');
        if (limit !== -1) selected = selected.slice(Number(options[limit + 1]), Number(options[limit + 1]) + Number(options[limit + 2]));
        return options.some(value => value.toUpperCase() === 'WITHSCORES') ? selected.flatMap(([member, score]) => [member, text(score)]) : selected.map(([member]) => member);
      }
      if (cmd === 'ZREM' || cmd === 'ZREMRANGEBYSCORE') {
        const members = cmd === 'ZREM' ? args.slice(1).map(text) : sorted().filter(([, score]) => inRange(score, args[1], args[2])).map(([member]) => member);
        const removed = members.reduce((count, member) => count + Number(zset.delete(member)), 0);
        if (!zset.size) this.data.delete(key);
        return removed;
      }
    }
    throw new Error(`Unsupported Redis fixture command: ${cmd}`);
  }

  async eval(script, keys = [], args = []) {
    this.calls++;
    if (!this.available || this.failNext || this.failWhen?.({ script, keys, args })) {
      this.failNext = false;
      throw new Error('DO_NOT_EXPOSE_REDIS_ENDPOINT_OR_TOKEN');
    }
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);
    const arrayTables = new WeakSet();
    const push = value => {
      if (value === null || value === JSON_NULL) return lua.lua_pushlightuserdata(L, JSON_NULL);
      if (value === undefined) return lua.lua_pushnil(L);
      if (typeof value === 'boolean') return lua.lua_pushboolean(L, value);
      if (typeof value === 'number') return lua.lua_pushnumber(L, value);
      if (typeof value === 'string') return lua.lua_pushstring(L, to_luastring(value));
      lua.lua_newtable(L);
      if (Array.isArray(value)) {
        arrayTables.add(lua.lua_topointer(L, -1));
        value.forEach((item, index) => { push(item); lua.lua_rawseti(L, -2, index + 1); });
      } else for (const [key, item] of Object.entries(value)) { push(item); lua.lua_setfield(L, -2, to_luastring(key)); }
    };
    const read = index => {
      const absolute = lua.lua_absindex(L, index);
      switch (lua.lua_type(L, absolute)) {
        case lua.LUA_TNIL: return undefined;
        case lua.LUA_TBOOLEAN: return lua.lua_toboolean(L, absolute);
        case lua.LUA_TNUMBER: return lua.lua_tonumber(L, absolute);
        case lua.LUA_TSTRING: return to_jsstring(lua.lua_tolstring(L, absolute));
        case lua.LUA_TLIGHTUSERDATA: return null;
        case lua.LUA_TTABLE: {
          const entries = [];
          lua.lua_pushnil(L);
          while (lua.lua_next(L, absolute)) { entries.push([read(-2), read(-1)]); lua.lua_pop(L, 1); }
          const array = entries.length ? entries.every(([key]) => Number.isInteger(key) && key >= 1 && key <= entries.length) : arrayTables.has(lua.lua_topointer(L, absolute));
          if (array) return entries.sort((a, b) => a[0] - b[0]).map(([, value]) => value);
          return Object.fromEntries(entries);
        }
        default: throw new Error('Unsupported Lua fixture result type');
      }
    };
    const binding = callback => lua.lua_pushcfunction(L, () => {
      try {
        const args = Array.from({ length: lua.lua_gettop(L) }, (_, index) => read(index + 1));
        push(callback(...args)); return 1;
      } catch (error) { lua.lua_pushstring(L, to_luastring(error.message)); return lua.lua_error(L); }
    });
    lua.lua_newtable(L);
    binding((name, ...args) => this.command(name, ...args)); lua.lua_setfield(L, -2, to_luastring('call'));
    binding((name, ...args) => { try { return this.command(name, ...args); } catch (error) { return { err: error.message }; } }); lua.lua_setfield(L, -2, to_luastring('pcall'));
    binding(message => ({ err: message })); lua.lua_setfield(L, -2, to_luastring('error_reply'));
    lua.lua_setglobal(L, to_luastring('redis'));
    lua.lua_newtable(L);
    binding(value => JSON.stringify(value)); lua.lua_setfield(L, -2, to_luastring('encode'));
    binding(value => JSON.parse(value)); lua.lua_setfield(L, -2, to_luastring('decode'));
    push(JSON_NULL); lua.lua_setfield(L, -2, to_luastring('null'));
    lua.lua_setglobal(L, to_luastring('cjson'));
    push(keys.map(text)); lua.lua_setglobal(L, to_luastring('KEYS'));
    push(args.map(text)); lua.lua_setglobal(L, to_luastring('ARGV'));
    lua.lua_getglobal(L, to_luastring('table')); lua.lua_getfield(L, -1, to_luastring('unpack')); lua.lua_setglobal(L, to_luastring('unpack')); lua.lua_pop(L, 1);
    try {
      if (lauxlib.luaL_loadstring(L, to_luastring(script)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) throw new Error(`Redis Lua script failed: ${read(-1)}`);
      const result = read(-1);
      if (this.dropReplyWhen?.({ script, keys, args })) throw new Error('DO_NOT_EXPOSE_REDIS_LOST_RESPONSE');
      return result;
    } finally { lua.lua_close(L); }
  }
}
