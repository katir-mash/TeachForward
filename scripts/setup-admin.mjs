import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { hashAdminPassword, validAdminHash } from '../server/admin.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, 'server', '.env');
const credentialPath = path.join(root, 'server', 'admin-access.txt');

function preflight(relativePath) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', relativePath], { cwd: root, stdio: 'ignore' });
    const tracked = execFileSync('git', ['ls-files', '--', relativePath], { cwd: root, encoding: 'utf8' });
    if (tracked.trim()) throw new Error();
  } catch { throw new Error(`Secret-storage check failed for ${relativePath}. Ensure it is ignored and not tracked by Git.`); }
}

try {
  preflight('server/.env'); preflight('server/admin-access.txt');
  if (process.env.ADMIN_PASSWORD_HASH) throw new Error('ADMIN_PASSWORD_HASH is supplied by the process environment. Manage that administrator configuration in the host settings.');
  const envExisted = existsSync(envPath);
  const original = envExisted ? readFileSync(envPath, 'utf8') : readFileSync(path.join(root, 'server', '.env.example'), 'utf8');
  const parsed = dotenv.parse(original);
  if (parsed.ADMIN_PASSWORD_HASH?.trim()) {
    if (!validAdminHash(parsed.ADMIN_PASSWORD_HASH)) throw new Error('The existing administrator hash is invalid. It has been preserved; correct it locally before setup.');
    console.log('Existing administrator configuration preserved.');
    console.log(`Local credential file: ${credentialPath}`);
    process.exit(0);
  }
  if (existsSync(credentialPath)) throw new Error('The local administrator credential file already exists. It has been preserved; move it to a secure backup before creating a new administrator configuration.');
  const password = randomBytes(24).toString('base64url');
  const hash = await hashAdminPassword(password);
  let updated = original.replace(/^\s*ADMIN_PASSWORD_HASH\s*=.*(?:\r?\n|$)/gm, '').trimEnd();
  updated += `\nADMIN_PASSWORD_HASH=${hash}\n`;
  if (!parsed.SESSION_SECRET?.trim() && !process.env.SESSION_SECRET?.trim()) updated += `SESSION_SECRET=${randomBytes(48).toString('base64url')}\n`;
  const credentialText = `TeachForward local administrator access\n\nURL: http://127.0.0.1:5173/admin\nPassword: ${password}\n\nThis file is private and excluded from Git. Do not paste its contents into chat, logs, issues, or the browser console.\nThe password hash is stored in server/.env. Restart the Node server after setup.\nManual Plus access does not process payments.\n`;
  writeFileSync(credentialPath, credentialText, { flag: 'wx', mode: 0o600 });
  const tempEnvPath = path.join(root, 'server', `.env.admin-${randomBytes(8).toString('hex')}.tmp`);
  try {
    writeFileSync(tempEnvPath, updated, { flag: 'wx', mode: 0o600 });
    if ((envExisted && readFileSync(envPath, 'utf8') !== original) || (!envExisted && existsSync(envPath))) throw new Error('Configuration changed during setup.');
    renameSync(tempEnvPath, envPath);
  }
  catch {
    // Remove only the credential file created by this invocation, never a user file.
    try { unlinkSync(credentialPath); } catch { /* Keep the original configuration intact. */ }
    try { if (existsSync(tempEnvPath)) unlinkSync(tempEnvPath); } catch { /* Ignored temp file remains private. */ }
    throw new Error('Could not update the server configuration. No administrator credentials were retained.');
  }
  console.log('Administrator access created. No password or API key was printed.');
  console.log(`Open this private local file for the password: ${credentialPath}`);
  console.log('Restart the Node server, then open http://127.0.0.1:5173/admin');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
