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
  const html = fs.readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');
  assert.ok(!/innerHTML[^;]*\$\{\s*c\.body\s*\}/.test(html), 'c.body est encore injecté via innerHTML');
  assert.ok(/textContent\s*=\s*c\.body/.test(html), 'le corps du commentaire doit être affiché avec textContent');
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
