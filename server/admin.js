import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const PARAMETERS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const FORMAT = /^scrypt\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/;

export const validAdminHash = hash => typeof hash === 'string' && FORMAT.test(hash);

export async function hashAdminPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Admin passwords must be 12 to 256 characters.');
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, PARAMETERS);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyAdminPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256 || !validAdminHash(encoded)) return false;
  const [, salt, expected] = encoded.split('$');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), 64, PARAMETERS);
  const expectedBytes = Buffer.from(expected, 'base64url');
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}
