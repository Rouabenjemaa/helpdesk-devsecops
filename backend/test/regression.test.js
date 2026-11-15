/**
 * Tests de non-régression des 4 failles corrigées (phase 5).
 * Utilise le lanceur de tests intégré à Node (node --test) : aucune dépendance à installer.
 *
 * - Tests statiques : toujours exécutés (aucune API nécessaire).
 * - Tests d'intégration : exécutés si TEST_BASE_URL est défini (API + base de données lancées).
 *     Exemple : TEST_BASE_URL=http://localhost:3000 npm test
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BASE = process.env.TEST_BASE_URL;
const integration = { skip: BASE ? false : 'TEST_BASE_URL non défini (API non lancée)' };
const BACKEND_DIR = path.join(__dirname, '..');
const ROOT = path.join(BACKEND_DIR, '..');

// --- utilitaires ------------------------------------------------------------
const tokens = {};
async function login(username) {
  if (tokens[username]) return tokens[username];
  const r = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Passw0rd!' }),
  });
  assert.equal(r.status, 200, `connexion de ${username} impossible (statut ${r.status})`);
  tokens[username] = (await r.json()).token;
  return tokens[username];
}
function api(pathname, token, options = {}) {
  return fetch(`${BASE}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
}

// --- VULN-001 : injection SQL -----------------------------------------------
test('VULN-001 : le payload SQL n\'expose aucun ticket d\'un autre utilisateur', integration, async () => {
  const token = await login('roua');
  const r = await api(`/search?q=${encodeURIComponent("' OR 1=1 --")}`, token);
  assert.equal(r.status, 200);
  const rows = await r.json();
  assert.ok(Array.isArray(rows));
  for (const t of rows) assert.equal(t.owner_username, 'roua', 'un ticket d\'un autre utilisateur a fuité');
});

test('VULN-001 : une saisie invalide ne divulgue ni message SQL ni requête', integration, async () => {
  const token = await login('roua');
  const r = await api(`/search?q=${encodeURIComponent("'")}`, token);
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes('query_executed'), 'la requête SQL est exposée');
  assert.ok(!/syntax error/i.test(text), 'un message d\'erreur SQL est exposé');
});

// --- VULN-002 : XSS stocké --------------------------------------------------
test('VULN-002 : le frontend n\'injecte plus le corps des commentaires en HTML', () => {
  const js = fs.readFileSync(path.join(ROOT, 'frontend', 'app.js'), 'utf8');
  assert.ok(!/innerHTML[^;]*\$\{\s*c\.body\s*\}/.test(js), 'c.body est encore injecté via innerHTML');
  assert.ok(/textContent\s*=\s*c\.body/.test(js), 'le corps du commentaire doit être affiché avec textContent');
});

test('SEED : aucun mot de passe existant n’est réinitialisé et la production ne seed pas', () => {
  const server = fs.readFileSync(path.join(BACKEND_DIR, 'server.js'), 'utf8');
  const seed = server.slice(server.indexOf('async function seedDatabase()'));
  assert.match(seed, /ON CONFLICT \(username\) DO NOTHING/);
  assert.doesNotMatch(seed, /UPDATE\s+users\s+SET\s+password_hash/i);
  assert.match(seed, /NODE_ENV === 'production'/);
  assert.match(seed, /ENABLE_DEMO_SEED/);
});

test('SEED : aucun mot de passe de démonstration n’est livré dans le frontend', () => {
  for (const name of ['index.html', 'app.js']) {
    const content = fs.readFileSync(path.join(ROOT, 'frontend', name), 'utf8');
    assert.ok(!content.includes('Passw0rd!'), `${name} expose le mot de passe de démonstration`);
  }
});

test('BOOTSTRAP : admin initial réservé à une base sans utilisateur', () => {
  const script = fs.readFileSync(path.join(BACKEND_DIR, 'bootstrap-admin.js'), 'utf8');
  assert.match(script, /bcrypt\.hash\(password, 12\)/);
  assert.match(script, /COUNT\(\*\)::int AS count FROM users/);
  assert.match(script, /Bootstrap is restricted to an empty users table/);
  assert.doesNotMatch(script, /console\.(?:log|error)\([^\n]*(?:\$\{password\}|,\s*password|\+\s*password)/i);
});

test('DB locale : script sans suppression de conteneur et volume persistant', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'start-db.sh'), 'utf8');
  assert.doesNotMatch(script, /docker\s+rm\s+-f/);
  assert.match(script, /POSTGRES_PASSWORD:\?/);
  assert.match(script, /helpdesk-db-local-data/);
  assert.match(script, /127\.0\.0\.1:5432:5432/);
});

test('VULN-002 : l\'API envoie une politique CSP et les en-têtes de sécurité', integration, async () => {
  const r = await fetch(`${BASE}/`);
  const csp = r.headers.get('content-security-policy') || '';
  assert.ok(csp.includes("object-src 'none'"), 'CSP absente ou incomplète');
  assert.ok(csp.includes("frame-ancestors 'none'"), 'frame-ancestors manquant');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

// --- VULN-003 : IDOR --------------------------------------------------------
test('VULN-003 : un utilisateur ne peut pas lire le ticket d\'un autre', integration, async () => {
  const tokenMahdi = await login('mahdi');
  const tokenRoua = await login('roua');
  const mahdiTickets = await (await api('/tickets', tokenMahdi)).json();
  assert.ok(mahdiTickets.length > 0, 'mahdi devrait avoir au moins un ticket de test');
  const id = mahdiTickets[0].id;

  const denied = await api(`/tickets/${id}`, tokenRoua);
  assert.ok([403, 404].includes(denied.status), `accès attendu refusé, statut reçu : ${denied.status}`);

  const own = await api(`/tickets/${id}`, tokenMahdi);
  assert.equal(own.status, 200, 'le propriétaire doit toujours pouvoir lire son ticket');
});

test('VULN-003 : un agent peut toujours lire n\'importe quel ticket', integration, async () => {
  const tokenMahdi = await login('mahdi');
  const tokenAgent = await login('agent1');
  const id = (await (await api('/tickets', tokenMahdi)).json())[0].id;
  const r = await api(`/tickets/${id}`, tokenAgent);
  assert.equal(r.status, 200);
});

test('AUTH : rôle modifié ou compte désactivé révoque immédiatement le JWT', integration, async () => {
  const adminToken = await login('admin1');
  const temporaryPassword = `audit-test-${Date.now()}-only`;
  const username = `audit-demote-${Date.now()}`;
  const created = await api('/admin/users', adminToken, {
    method: 'POST',
    body: JSON.stringify({ username, password: temporaryPassword, role: 'admin', full_name: 'Compte test audit' }),
  });
  assert.equal(created.status, 201);
  const user = await created.json();

  const loginResponse = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: temporaryPassword }),
  });
  assert.equal(loginResponse.status, 200);
  const userToken = (await loginResponse.json()).token;

  const demoted = await api(`/admin/users/${user.id}`, adminToken, {
    method: 'PATCH', body: JSON.stringify({ role: 'user' }),
  });
  assert.equal(demoted.status, 200);
  assert.equal((await api('/admin/users', userToken)).status, 401);

  const disabledUsername = `audit-disable-${Date.now()}`;
  const disabledCreated = await api('/admin/users', adminToken, {
    method: 'POST',
    body: JSON.stringify({ username: disabledUsername, password: temporaryPassword, role: 'user', full_name: 'Compte test désactivé' }),
  });
  assert.equal(disabledCreated.status, 201);
  const disabledUser = await disabledCreated.json();
  const disabledLogin = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: disabledUsername, password: temporaryPassword }),
  });
  assert.equal(disabledLogin.status, 200);
  const disabledToken = (await disabledLogin.json()).token;

  const disabled = await api(`/admin/users/${disabledUser.id}`, adminToken, {
    method: 'PATCH', body: JSON.stringify({ is_active: false }),
  });
  assert.equal(disabled.status, 200);
  assert.equal((await api('/me', disabledToken)).status, 401);
});

// --- VULN-004 : secret en dur -----------------------------------------------
test('VULN-004 : aucun secret n\'est écrit dans le code, le compose ni l\'exemple d\'environnement', () => {
  const files = [
    path.join(BACKEND_DIR, 'server.js'),
    path.join(ROOT, 'docker-compose.yml'),
    path.join(ROOT, '.env.example'),
  ];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(!/hd_fake_[a-f0-9]{32}/.test(content), `secret fictif trouvé dans ${path.basename(f)}`);
  }
});

test('VULN-004 : le serveur refuse de démarrer sans JWT_SECRET valide', () => {
  for (const env of [{}, { JWT_SECRET: 'trop-court' }]) {
    const r = spawnSync(process.execPath, ['server.js'], {
      cwd: BACKEND_DIR,
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(r.status, 1, 'le serveur doit s\'arrêter avec le code 1');
    assert.match(r.stderr, /JWT_SECRET/);
  }
});

test('CONFIG : le serveur refuse de démarrer sans identifiants PostgreSQL', () => {
  const r = spawnSync(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: { PATH: process.env.PATH, JWT_SECRET: require('node:crypto').randomBytes(32).toString('hex') },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DB_USER et DB_PASSWORD sont obligatoires/);
});

// --- Robustesse (issu du scan ZAP) -----------------------------------------
test('ROBUSTESSE : un identifiant invalide ou géant renvoie 400, jamais 500', integration, async () => {
  const token = await login('roua');
  for (const bad of ['abc', '0', '-1', '12abc', '99999999999999999999']) {
    const r = await api(`/tickets/${bad}`, token);
    assert.equal(r.status, 400, `/tickets/${bad} devrait renvoyer 400 (reçu ${r.status})`);
  }
});

// --- Phase 8 : observabilité ----------------------------------------------------
const METRICS = process.env.TEST_METRICS_URL;
const metricsTest = { skip: METRICS ? false : 'TEST_METRICS_URL non défini (port de métriques)' };
async function readInjectionCounter() {
  const text = await (await fetch(`${METRICS}/metrics`)).text();
  const m = text.match(/helpdesk_injection_suspected_total\{route="\/search",type="sqli"\} ([0-9.]+)/);
  return { text, value: m ? Number(m[1]) : null };
}

test('PHASE 8 : les métriques ne sont PAS exposées sur le port public', integration, async () => {
  for (const url of [`${BASE}/metrics`, `${BASE}/api/metrics`]) {
    const r = await fetch(url);
    assert.equal(r.status, 404, `${url} ne doit pas exposer de métriques (statut ${r.status})`);
  }
});

test('PHASE 8 : une tentative d\'injection SQL est détectée et comptée', metricsTest, async () => {
  const token = await login('roua');
  const before = await readInjectionCounter();
  assert.notEqual(before.value, null, 'le compteur helpdesk_injection_suspected_total est absent');
  await api(`/search?q=${encodeURIComponent("' OR 1=1 --")}`, token);
  const after = await readInjectionCounter();
  assert.ok(after.value >= before.value + 1, `compteur inchangé (${before.value} -> ${after.value})`);
});

test('PHASE 8 : les métriques ne contiennent ni jeton ni mot de passe', metricsTest, async () => {
  const { text } = await readInjectionCounter();
  assert.ok(!/eyJ|Bearer|Passw0rd|password/i.test(text), 'une donnée sensible apparaît dans /metrics');
});
