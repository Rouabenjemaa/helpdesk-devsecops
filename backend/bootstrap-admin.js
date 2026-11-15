// One-time bootstrap for a fresh database. Never resets or promotes an existing user.
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const required = ['DB_USER', 'DB_PASSWORD', 'BOOTSTRAP_ADMIN_USERNAME', 'BOOTSTRAP_ADMIN_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Required environment variables are missing: ${missing.join(', ')}`);
  process.exit(1);
}

const username = process.env.BOOTSTRAP_ADMIN_USERNAME.trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!username || username.length > 100 || password.length < 12) {
  console.error('Username must be 1–100 characters and the initial password at least 12 characters.');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'helpdesk',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function bootstrap() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(71202502, 1)');
    const result = await client.query('SELECT COUNT(*)::int AS count FROM users');
    if (result.rows[0].count !== 0) {
      throw new Error('Bootstrap is restricted to an empty users table.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO users (username, password_hash, role, full_name, is_active)
       VALUES ($1, $2, 'admin', $3, true)`,
      [username, passwordHash, username]
    );
    await client.query('COMMIT');
    console.log(`Initial administrator created: ${username}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.message === 'Bootstrap is restricted to an empty users table.') {
      console.error(error.message);
    } else {
      console.error(`Bootstrap failed; check database connectivity and schema (error code: ${error.code || 'unknown'}).`);
    }
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

bootstrap().catch(async (error) => {
  console.error(`Bootstrap failed; check database connectivity and schema (error code: ${error.code || 'unknown'}).`);
  await pool.end();
  process.exitCode = 1;
});
