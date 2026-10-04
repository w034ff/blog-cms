import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { resolveDbPath } from './db-path.mts';

const DB_PATH = resolveDbPath();

function main(): void {
  try {
    process.loadEnvFile();
  } catch {
    // .env is optional if the vars are already in the environment.
  }

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.error('ADMIN_USERNAME and ADMIN_PASSWORD must be set (in .env or the environment).');
    process.exit(1);
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const db = new Database(DB_PATH);
  db.prepare(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')
     ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role`,
  ).run(username, passwordHash);
  db.close();

  console.log(`Seeded admin user '${username}' (password hashed; not displayed).`);
}

main();
