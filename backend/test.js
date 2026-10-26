/**
 * =============================================================================
 * HelpDesk DevSecOps - Tests Unitaires et de Non-Régression (Jalon S1)
 * TEK-UP University - ING-5-SSIR
 * =============================================================================
 */

const assert = require('assert');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

console.log('--- Démarrage de la suite de tests HelpDesk ---');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function it(name, fn) {
    try {
      fn();
      console.log(`  \x1b[32m✔\x1b[0m ${name}`);
      passed++;
    } catch (err) {
      console.error(`  \x1b[31m✖\x1b[0m ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  async function itAsync(name, fn) {
    try {
      await fn();
      console.log(`  \x1b[32m✔\x1b[0m ${name}`);
      passed++;
    } catch (err) {
      console.error(`  \x1b[31m✖\x1b[0m ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  // 1. Authentification & Chiffrement
  console.log('\n[1] Tests Authentification & Chiffrement (Bcrypt / JWT) :');
  await itAsync('Le mot de passe de test correspond au hash bcrypt', async () => {
    const rawPass = 'Passw0rd!';
    const hash = await bcrypt.hash(rawPass, 10);
    const match = await bcrypt.compare(rawPass, hash);
    assert.strictEqual(match, true, 'Le mot de passe valide doit être accepté');
    const wrongMatch = await bcrypt.compare('MauvaisMotDePasse', hash);
    assert.strictEqual(wrongMatch, false, 'Un mot de passe erroné doit être rejeté');
  });

  it('Génération et vérification d\'un jeton JWT pour les 3 rôles (user, agent, admin)', () => {
    const secret = 'test_secret_key_123';
    const roles = ['user', 'agent', 'admin'];
    for (const r of roles) {
      const token = jwt.sign({ id: 1, username: 'testuser', role: r }, secret, { expiresIn: '1h' });
      const decoded = jwt.verify(token, secret);
      assert.strictEqual(decoded.role, r, `Le rôle ${r} doit être préservé dans le JWT`);
    }
  });

  // 2. Contrôle d'accès RBAC
  console.log('\n[2] Tests Contrôle d\'Accès par Rôles (RBAC) :');
  it('Validation des permissions pour les 3 rôles', () => {
    function canAccessAdminRoutes(role) {
      return role === 'admin';
    }
    function canChangeTicketStatus(role) {
      return role === 'agent';
    }
    function canCreateTicket(role) {
      return role === 'user';
    }

    assert.strictEqual(canAccessAdminRoutes('user'), false);
    assert.strictEqual(canAccessAdminRoutes('agent'), false);
    assert.strictEqual(canAccessAdminRoutes('admin'), true);

    assert.strictEqual(canChangeTicketStatus('user'), false);
    assert.strictEqual(canChangeTicketStatus('agent'), true);
    assert.strictEqual(canChangeTicketStatus('admin'), false);

    assert.strictEqual(canCreateTicket('user'), true);
  });

  // 3. Faille 3 : Logique IDOR
  console.log('\n[3] Tests Faille 3 (IDOR - Insecure Direct Object Reference) :');
  it('En mode sécurisé, un utilisateur régulier ne peut pas accéder au ticket d\'un tiers', () => {
    function checkTicketAccess(ticketOwnerId, requestUser, securityMode) {
      if (securityMode === 'vulnerable') return true; // Vulnérabilité active
      if (requestUser.role === 'agent' || requestUser.role === 'admin') return true;
      return ticketOwnerId === requestUser.id;
    }

    const alice = { id: 1, role: 'user' };
    const bobTicketOwnerId = 2;

    // En mode vulnérable : Alice accède au ticket de Bob (Faille 3)
    assert.strictEqual(checkTicketAccess(bobTicketOwnerId, alice, 'vulnerable'), true, 'Mode vulnérable doit reproduire l\'IDOR');

    // En mode sécurisé : Alice est bloquée (Correction Faille 3)
    assert.strictEqual(checkTicketAccess(bobTicketOwnerId, alice, 'secure'), false, 'Mode sécurisé doit bloquer l\'accès');

    // L\'agent peut toujours intervenir
    const agent = { id: 4, role: 'agent' };
    assert.strictEqual(checkTicketAccess(bobTicketOwnerId, agent, 'secure'), true, 'L\'agent doit pouvoir accéder');
  });

  // 4. Faille 2 : Logique XSS
  console.log('\n[4] Tests Faille 2 (Stored XSS) :');
  it('En mode sécurisé, les balises HTML script et img dangereuses sont échappées', () => {
    function sanitize(input, securityMode) {
      if (securityMode === 'vulnerable') return input;
      return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    const payload = '<img src=x onerror="alert(\'XSS\')">';
    const vulnerableOutput = sanitize(payload, 'vulnerable');
    assert.strictEqual(vulnerableOutput, payload, 'Le payload doit rester brut en mode vulnérable');

    const secureOutput = sanitize(payload, 'secure');
    assert(!secureOutput.includes('<img'), 'Les chevrons HTML doivent être désamorcés');
    assert(secureOutput.includes('&lt;img'), 'La balise doit être encodée en entité HTML');
  });

  // 5. Faille 1 : Logique Injection SQL
  console.log('\n[5] Tests Faille 1 (Injection SQL sur la recherche) :');
  it('Validation de la séparation entre concaténation brute et paramétrage', () => {
    function buildSearch(q, securityMode, userId, isAgent) {
      if (securityMode === 'vulnerable') {
        const scope = isAgent ? 'TRUE' : 'owner_id=' + Number(userId);
        return { sql: `SELECT * FROM tickets WHERE ${scope} AND title ILIKE '%${q}%'`, params: [] };
      }
      return {
        sql: `SELECT * FROM tickets WHERE (owner_id = $1 OR $2 = true) AND title ILIKE $3`,
        params: [userId, isAgent, `%${q}%`],
      };
    }

    const payload = "' OR 1=1 --";
    const vuln = buildSearch(payload, 'vulnerable', 1, false);
    assert(vuln.sql.includes("' OR 1=1 --"), 'La requête vulnérable concatène directement la charge malveillante');

    const sec = buildSearch(payload, 'secure', 1, false);
    assert.strictEqual(sec.params[2], `%' OR 1=1 --%`, 'En mode sécurisé, la charge est traitée comme une simple valeur de paramètre');
  });

  console.log(`\n========================================`);
  console.log(`Résultats : ${passed} réussis, ${failed} échoués`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests();
