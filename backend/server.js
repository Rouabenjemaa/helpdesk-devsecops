/**
 * =============================================================================
 * HelpDesk DevSecOps - Serveur Backend Express (Phases 0 et 1 : application VOLONTAIREMENT VULNERABLE)
 * TEK-UP University - Module DevSecOps - ING-5-SSIR
 * Binôme : Ben Jemaa Roua (Backend & Sécurité) & Dkhil Mohamed Mahdi (Frontend & DevOps)
 * =============================================================================
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// Phase 1 : le backend sert aussi l'interface et accepte le préfixe /api, comme le ferait
// le reverse proxy nginx (phase 2). Ainsi `npm start` suffit : http://localhost:3000
app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) req.url = req.url.slice(4);
  next();
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// =============================================================================
// VULN-004 CORRIGÉE (phase 4) : le secret JWT n'est plus écrit dans le code.
// Il est fourni par l'environnement : fichier .env (Docker Compose), variable
// protégée GitHub (CI) ou Secret Kubernetes (phase 6). Aucune valeur par défaut :
// sans secret valide, le serveur refuse de démarrer (échec explicite plutôt que
// démarrage avec un secret faible).
// =============================================================================
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("JWT_SECRET manquant ou trop court (32 caractères minimum). Voir docs/secrets-phase4.md.");
  process.exit(1);
}
function getJwtSecret() {
  return JWT_SECRET;
}

// Connexion PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'helpdesk',
  password: process.env.DB_PASSWORD || 'change_me_fictif_123',
  database: process.env.DB_NAME || 'helpdesk',
});

// =============================================================================
// EN-TÊTES DE SÉCURITÉ & JOURNALISATION STRUCTURÉE (Loki / Observabilité)
// =============================================================================
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logEntry = {
      ts: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      ip: req.ip || req.socket.remoteAddress,
      user_id: req.user ? req.user.id : null,
      username: req.user ? req.user.username : null,
      role: req.user ? req.user.role : null,
      status: res.statusCode,
      duration_ms: duration,
    };
    console.log(JSON.stringify(logEntry));
  });
  next();
});

// =============================================================================
// MIDDLEWARES D'AUTHENTIFICATION, RBAC & AUDIT
// =============================================================================

// Vérification de l'authentification JWT
function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Jeton d\'authentification manquant' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session invalide ou expirée' });
  }
}

// Contrôle d'accès basé sur les rôles (RBAC côté backend)
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Accès refusé. Rôles autorisés : ${allowedRoles.join(', ')}`,
      });
    }
    next();
  };
}

// Enregistrement persistant dans la table audit_log
async function logAudit(userId, username, action, details, ip) {
  try {
    await pool.query(
      'INSERT INTO audit_log (user_id, username, action, details, ip) VALUES ($1, $2, $3, $4, $5)',
      [userId || null, username || 'anonymous', action, details || '', ip || '127.0.0.1']
    );
  } catch (err) {
    console.error('Erreur écriture audit_log:', err.message);
  }
}

// Création d'une notification persistance pour un utilisateur
async function createNotification(userId, title, message, ticketId = null) {
  try {
    await pool.query(
      'INSERT INTO notifications (user_id, title, message, ticket_id) VALUES ($1, $2, $3, $4)',
      [userId, title, message, ticketId]
    );
  } catch (err) {
    console.error('Erreur création notification:', err.message);
  }
}

// Notification envoyée à tous les agents
async function notifyAllAgents(title, message, ticketId = null) {
  try {
    const agents = await pool.query("SELECT id FROM users WHERE role = 'agent' AND is_active = true");
    for (const row of agents.rows) {
      await createNotification(row.id, title, message, ticketId);
    }
  } catch (err) {
    console.error('Erreur notification agents:', err.message);
  }
}

// =============================================================================
// ROUTES DE CONTRÔLE ET ÉTAT DU SYSTÈME
// =============================================================================

// Sonde de santé Kubernetes / Docker
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      database: 'connected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message,
    });
  }
});

// =============================================================================
// AUTHENTIFICATION & UTILISATEUR COURANT
// =============================================================================

// POST /login : Connexion avec génération du jeton JWT
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  }

  try {
    const r = await pool.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
    const u = r.rows[0];

    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      await logAudit(null, username, 'AUTH_FAILURE', 'Échec de connexion (mauvais identifiants)', req.ip);
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    if (!u.is_active) {
      await logAudit(u.id, u.username, 'AUTH_LOCKED', 'Tentative de connexion sur compte désactivé', req.ip);
      return res.status(403).json({ error: 'Compte désactivé. Veuillez contacter un administrateur.' });
    }

    const token = jwt.sign(
      { id: u.id, username: u.username, role: u.role, full_name: u.full_name },
      getJwtSecret(),
      { expiresIn: '4h' }
    );

    await logAudit(u.id, u.username, 'AUTH_SUCCESS', `Connexion réussie avec le rôle ${u.role}`, req.ip);

    res.json({
      token,
      role: u.role,
      username: u.username,
      full_name: u.full_name,
      email: u.email,
    });
  } catch (err) {
    console.error('Erreur /login:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// GET /me : Profil utilisateur connecté
app.get('/me', auth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, username, full_name, email, role, is_active, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// GESTION DES TICKETS
// =============================================================================

// GET /tickets : Liste des tickets avec filtres (status, priority, category)
// - Rôle user : consulte uniquement ses propres tickets.
// - Rôles agent et admin : consultent l'ensemble des tickets.
app.get('/tickets', auth, async (req, res) => {
  const { status, priority, category } = req.query;
  const isAgentOrAdmin = req.user.role === 'agent' || req.user.role === 'admin';

  let sql = `
    SELECT t.id, t.title, t.description, t.status, t.priority, t.category,
           t.owner_id, t.created_at, t.updated_at,
           u.username AS owner_username, u.full_name AS owner_name,
           (SELECT COUNT(*)::int FROM comments c WHERE c.ticket_id = t.id) AS comments_count
    FROM tickets t
    JOIN users u ON u.id = t.owner_id
    WHERE 1=1
  `;
  const params = [];

  if (!isAgentOrAdmin) {
    params.push(req.user.id);
    sql += ` AND t.owner_id = $${params.length}`;
  }

  if (status && ['open', 'in_progress', 'closed'].includes(status)) {
    params.push(status);
    sql += ` AND t.status = $${params.length}`;
  }

  if (priority && ['Basse', 'Moyenne', 'Haute', 'Critique'].includes(priority)) {
    params.push(priority);
    sql += ` AND t.priority = $${params.length}`;
  }

  if (category && ['Réseau', 'Matériel', 'Logiciel', 'Accès et comptes', 'Sécurité', 'Autre'].includes(category)) {
    params.push(category);
    sql += ` AND t.category = $${params.length}`;
  }

  sql += ' ORDER BY t.created_at DESC';

  try {
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /tickets/:id : Détail d'un ticket avec commentaires et historique
// FAILLE 3 (IDOR) : aucun contrôle du propriétaire. Roua peut lire les tickets de Mahdi.
app.get('/tickets/:id', auth, async (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  if (isNaN(ticketId)) return res.status(400).json({ error: 'Identifiant de ticket invalide' });

  try {
    const t = await pool.query(
      `SELECT t.*, u.username AS owner_username, u.full_name AS owner_name, u.email AS owner_email
       FROM tickets t
       JOIN users u ON u.id = t.owner_id
       WHERE t.id = $1`,
      [ticketId]
    );

    const ticket = t.rows[0];
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

    // FAILLE 3 (VULN-003, IDOR) : AUCUN contrôle du propriétaire (volontaire).
    // Un 'user' peut lire le ticket d'un autre en changeant l'identifiant dans l'URL.
    if (ticket.owner_id !== req.user.id && req.user.role === 'user') {
      console.warn(`[VULN-003 IDOR EXPLOITÉ] User #${req.user.id} (${req.user.username}) a accédé au ticket #${ticketId} de User #${ticket.owner_id}`);
    }

    // Récupération des commentaires
    const c = await pool.query(
      `SELECT c.id, c.body, c.created_at, u.username AS author, u.full_name AS author_name, u.role AS author_role
       FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.ticket_id = $1
       ORDER BY c.created_at ASC`,
      [ticketId]
    );

    // Récupération de l'historique
    const h = await pool.query(
      `SELECT th.*, u.username AS changed_by_username, u.full_name AS changed_by_name
       FROM ticket_history th
       LEFT JOIN users u ON u.id = th.changed_by
       WHERE th.ticket_id = $1
       ORDER BY th.created_at ASC`,
      [ticketId]
    );

    res.json({
      ...ticket,
      comments: c.rows,
      history: h.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /tickets : Déclaration d'un incident (Rôle user)
app.post('/tickets', auth, async (req, res) => {
  const { title, description, category, priority } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: 'Le titre et la description sont obligatoires' });
  }

  const validPriorities = ['Basse', 'Moyenne', 'Haute', 'Critique'];
  const validCategories = ['Réseau', 'Matériel', 'Logiciel', 'Accès et comptes', 'Sécurité', 'Autre'];

  const ticketPriority = validPriorities.includes(priority) ? priority : 'Moyenne';
  const ticketCategory = validCategories.includes(category) ? category : 'Autre';

  try {
    const r = await pool.query(
      `INSERT INTO tickets (title, description, status, priority, category, owner_id)
       VALUES ($1, $2, 'open', $3, $4, $5)
       RETURNING id, title, status, priority, category, created_at`,
      [title.trim(), description.trim(), ticketPriority, ticketCategory, req.user.id]
    );

    const newTicket = r.rows[0];

    // Audit log
    await logAudit(
      req.user.id,
      req.user.username,
      'TICKET_CREATE',
      `Création du ticket #${newTicket.id} "${title}" (Priorité: ${ticketPriority}, Catégorie: ${ticketCategory})`,
      req.ip
    );

    // Historique
    await pool.query(
      'INSERT INTO ticket_history (ticket_id, changed_by, old_status, new_status, comment) VALUES ($1, $2, $3, $4, $5)',
      [newTicket.id, req.user.id, null, 'open', 'Création initiale du ticket d\'incident']
    );

    // Notification aux agents
    await notifyAllAgents(
      'Nouveau ticket déclaré',
      `Ticket #${newTicket.id} [${ticketPriority}] "${title}" déclaré par ${req.user.username}.`,
      newTicket.id
    );

    res.status(201).json(newTicket);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /tickets/:id/status : Prise en charge et changement de statut (Rôle agent obligatoire)
app.patch('/tickets/:id/status', auth, requireRole('agent'), async (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const { status, comment } = req.body;

  if (!['open', 'in_progress', 'closed'].includes(status)) {
    return res.status(400).json({ error: "Statut invalide. Valeurs autorisées : 'open', 'in_progress', 'closed'." });
  }

  try {
    const currentTicket = await pool.query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
    if (!currentTicket.rows[0]) {
      return res.status(404).json({ error: 'Ticket introuvable' });
    }

    const oldStatus = currentTicket.rows[0].status;
    const ownerId = currentTicket.rows[0].owner_id;

    await pool.query(
      'UPDATE tickets SET status = $1, updated_at = now() WHERE id = $2',
      [status, ticketId]
    );

    // Enregistrement dans l'historique
    await pool.query(
      'INSERT INTO ticket_history (ticket_id, changed_by, old_status, new_status, comment) VALUES ($1, $2, $3, $4, $5)',
      [ticketId, req.user.id, oldStatus, status, comment || `Statut passé de ${oldStatus} à ${status}`]
    );

    // Notification au propriétaire du ticket
    const statusLabels = { open: 'Ouvert', in_progress: 'En cours', closed: 'Fermé' };
    await createNotification(
      ownerId,
      'Mise à jour du statut',
      `Votre ticket #${ticketId} est désormais "${statusLabels[status]}".`,
      ticketId
    );

    // Audit log
    await logAudit(
      req.user.id,
      req.user.username,
      'TICKET_STATUS_UPDATE',
      `Ticket #${ticketId} passé de '${oldStatus}' à '${status}'`,
      req.ip
    );

    res.json({ ok: true, ticket_id: ticketId, old_status: oldStatus, new_status: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /tickets/:id/comments : Ajout d'un commentaire
// FAILLE 2 (XSS stocké côté stockage) :
// Le corps du commentaire est enregistré tel quel en base.
app.post('/tickets/:id/comments', auth, async (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const { body } = req.body;

  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'Le commentaire ne peut pas être vide' });
  }

  try {
    const t = await pool.query('SELECT owner_id, title FROM tickets WHERE id = $1', [ticketId]);
    if (!t.rows[0]) return res.status(404).json({ error: 'Ticket introuvable' });

    // Contrôle d'accès : un utilisateur régulier ne peut commenter que ses tickets
    if (req.user.role === 'user' && t.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez commenter que vos propres tickets' });
    }

    // FAILLE 2 (VULN-002, XSS stocké) : le commentaire est stocké tel quel, sans aucun encodage.
    const commentBody = body;

    await pool.query(
      'INSERT INTO comments (ticket_id, author_id, body) VALUES ($1, $2, $3)',
      [ticketId, req.user.id, commentBody]
    );

    await pool.query('UPDATE tickets SET updated_at = now() WHERE id = $1', [ticketId]);

    // Notification à la partie adverse (si agent -> notifie user ; si user -> notifie agents)
    if (req.user.role === 'agent') {
      await createNotification(
        t.rows[0].owner_id,
        'Nouveau commentaire du support',
        `L'agent ${req.user.username} a commenté votre ticket #${ticketId}.`,
        ticketId
      );
    } else {
      await notifyAllAgents(
        'Nouveau commentaire utilisateur',
        `${req.user.username} a commenté le ticket #${ticketId}.`,
        ticketId
      );
    }

    await logAudit(
      req.user.id,
      req.user.username,
      'COMMENT_ADD',
      `Ajout d'un commentaire sur le ticket #${ticketId}`,
      req.ip
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /search?q= : Recherche de tickets
// FAILLE 1 (VULN-001, Injection SQL) : `q` est concaténé directement dans la requête
// SQL (payload de démonstration : ' OR 1=1 --). Volontaire en phase 1.
app.get('/search', auth, async (req, res) => {
  const q = req.query.q || '';
  const isAgentOrAdmin = req.user.role === 'agent' || req.user.role === 'admin';

  // Construction vulnérable obligatoire pour démonstration pédagogique
  const scope = isAgentOrAdmin ? 'TRUE' : 't.owner_id=' + Number(req.user.id);
  const sql = `
    SELECT t.id, t.title, t.description, t.status, t.priority, t.category, t.created_at,
           u.username AS owner_username
    FROM tickets t
    JOIN users u ON u.id = t.owner_id
    WHERE ${scope} AND t.title ILIKE '%${q}%'
    ORDER BY t.id
  `;
  try {
    const r = await pool.query(sql);
    res.json(r.rows);
  } catch (e) {
    // Retourne l'erreur SQL complète (information disclosure en mode vulnérable)
    res.status(500).json({ error: e.message, query_executed: sql });
  }
});

// =============================================================================
// GESTION DES NOTIFICATIONS PERSISTANTES
// =============================================================================

// GET /notifications : Récupération des notifications de l'utilisateur
app.get('/notifications', auth, async (req, res) => {
  try {
    const list = await pool.query(
      `SELECT id, title, message, ticket_id, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.user.id]
    );

    const unread = await pool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );

    res.json({
      notifications: list.rows,
      unread_count: unread.rows[0].count,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /notifications/:id/read : Marquer une notification comme lue
app.patch('/notifications/:id/read', auth, async (req, res) => {
  const notifId = parseInt(req.params.id, 10);
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
      [notifId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /notifications/read-all : Marquer toutes les notifications comme lues
app.patch('/notifications/read-all', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// STATISTIQUES DES TABLEAUX DE BORD
// =============================================================================

// GET /user/stats : Indicateurs tableau de bord utilisateur
app.get('/user/stats', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*)::int AS total_tickets,
         COUNT(*) FILTER (WHERE status = 'open')::int AS open_tickets,
         COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_tickets,
         COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_tickets
       FROM tickets
       WHERE owner_id = $1`,
      [req.user.id]
    );

    const unread = await pool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );

    res.json({
      ...r.rows[0],
      unread_notifications: unread.rows[0].count,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /agent/stats : Indicateurs tableau de bord agent
app.get('/agent/stats', auth, requireRole('agent', 'admin'), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*)::int AS total_tickets,
        COUNT(*) FILTER (WHERE status = 'open')::int AS open_tickets,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_tickets,
        COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_tickets,
        COUNT(*) FILTER (WHERE priority IN ('Haute', 'Critique') AND status != 'closed')::int AS urgent_tickets
      FROM tickets
    `);

    const unread = await pool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );

    res.json({
      ...r.rows[0],
      unread_notifications: unread.rows[0].count,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/stats : Statistiques globales pour l'administrateur
app.get('/admin/stats', auth, requireRole('admin'), async (req, res) => {
  try {
    const usersStat = await pool.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active_users,
        COUNT(*) FILTER (WHERE is_active = false)::int AS disabled_users,
        COUNT(*) FILTER (WHERE role = 'user')::int AS users_count,
        COUNT(*) FILTER (WHERE role = 'agent')::int AS agents_count,
        COUNT(*) FILTER (WHERE role = 'admin')::int AS admins_count
      FROM users
    `);

    const ticketsStat = await pool.query(`
      SELECT
        COUNT(*)::int AS total_tickets,
        COUNT(*) FILTER (WHERE status = 'open')::int AS open_tickets,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_tickets,
        COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_tickets
      FROM tickets
    `);

    const byCategory = await pool.query(`
      SELECT category, COUNT(*)::int AS count
      FROM tickets
      GROUP BY category
    `);

    const byPriority = await pool.query(`
      SELECT priority, COUNT(*)::int AS count
      FROM tickets
      GROUP BY priority
    `);

    res.json({
      users: usersStat.rows[0],
      tickets: ticketsStat.rows[0],
      by_category: byCategory.rows,
      by_priority: byPriority.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ADMINISTRATION & GESTION DES COMPTES (Rôle admin)
// =============================================================================

// GET /admin/users : Liste de tous les utilisateurs
app.get('/admin/users', auth, requireRole('admin'), async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, username, full_name, email, role, is_active, created_at FROM users ORDER BY id ASC'
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/users : Création d'un compte utilisateur ou agent
app.post('/admin/users', auth, requireRole('admin'), async (req, res) => {
  const { username, password, role, full_name, email } = req.body;

  if (!username || !password || !role || !full_name) {
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  }

  if (!['user', 'agent', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (username, password_hash, role, full_name, email, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, username, role, full_name, email, is_active, created_at`,
      [username.trim(), hash, role, full_name.trim(), email ? email.trim() : null]
    );

    await logAudit(
      req.user.id,
      req.user.username,
      'USER_CREATE',
      `Création du compte utilisateur '${username}' avec le rôle '${role}'`,
      req.ip
    );

    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cet identifiant existe déjà' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PATCH /admin/users/:id : Modification de rôle ou activation/désactivation
app.patch('/admin/users/:id', auth, requireRole('admin'), async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { role, is_active } = req.body;

  try {
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [targetId]);
    if (!userCheck.rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const updates = [];
    const params = [];

    if (role !== undefined) {
      if (!['user', 'agent', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Rôle invalide' });
      }
      params.push(role);
      updates.push(`role = $${params.length}`);
    }

    if (is_active !== undefined) {
      params.push(Boolean(is_active));
      updates.push(`is_active = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Aucune modification demandée' });
    }

    params.push(targetId);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING id, username, role, is_active`;
    const r = await pool.query(sql, params);

    await logAudit(
      req.user.id,
      req.user.username,
      'USER_UPDATE',
      `Modification compte #${targetId} (${r.rows[0].username}) : rôle=${r.rows[0].role}, is_active=${r.rows[0].is_active}`,
      req.ip
    );

    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/audit : Consultation du journal d'audit des actions sensibles
app.get('/admin/audit', auth, requireRole('admin'), async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, user_id, username, action, details, ip, created_at FROM audit_log ORDER BY created_at DESC LIMIT 100'
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// SEED AUTOMATIQUE DES DONNÉES FICTIVES AU DÉMARRAGE
// =============================================================================
async function seedDatabase() {
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  // Vérifier si des utilisateurs existent déjà
  const userCheck = await pool.query('SELECT 1 FROM users LIMIT 1');
  if (userCheck.rows.length > 0) {
    // S'assurer que le mot de passe bcrypt correspond bien à Passw0rd! pour les tests
    const testHash = await bcrypt.hash('Passw0rd!', 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE username IN (\'roua\', \'mahdi\', \'charlie\', \'agent1\', \'agent2\', \'admin1\')', [testHash]);
    console.log('[SEED] Mots de passe de test validés pour roua, mahdi, agent1, admin1 (Passw0rd!).');
    return;
  }

  console.log('[SEED] Base vide détectée, initialisation des données fictives...');
  const hash = await bcrypt.hash('Passw0rd!', 10);

  // Insertion utilisateurs
  await pool.query(`
    INSERT INTO users (username, password_hash, role, full_name, email, is_active) VALUES
      ('roua',    $1, 'user',  'Roua Ben Jemaa',   'roua.benjemaa@helpdesk.local', true),
      ('mahdi',   $1, 'user',  'Mahdi Dkhil',      'mahdi.dkhil@helpdesk.local', true),
      ('charlie', $1, 'user',  'Charlie Martin',   'charlie.martin@helpdesk.local', true),
      ('agent1',  $1, 'agent', 'Agent Un',         'agent1@helpdesk.local', true),
      ('agent2',  $1, 'agent', 'Agent Deux',       'agent2@helpdesk.local', true),
      ('admin1',  $1, 'admin', 'Administrateur IT', 'admin@helpdesk.local', true)
  `, [hash]);

  // Insertion tickets
  await pool.query(`
    INSERT INTO tickets (title, description, status, priority, category, owner_id) VALUES
      ('Imprimante bloquée', 'Poste SN-48213, IP interne 10.20.4.17, bourrage papier récurrent dans le bac 2.', 'in_progress', 'Moyenne', 'Matériel', 1),
      ('VPN inaccessible depuis télétravail', 'Poste SN-77190, IP 10.20.8.5, échec de négociation TLS sur concentrateur VPN.', 'open', 'Haute', 'Réseau', 1),
      ('Accès dossier RH confidentiel refusé', 'Demande de droits en lecture pour Mahdi Dkhil, poste SN-50021, suite à transfert de service.', 'open', 'Basse', 'Accès et comptes', 2),
      ('Écran noir au démarrage', 'Poste SN-31877, IP 10.20.2.40. Aucun affichage après mise à jour des pilotes graphiques.', 'closed', 'Moyenne', 'Matériel', 2),
      ('Alerte sécurité : tentative de phishing signalée', 'Email frauduleux demandant réinitialisation mot de passe avec lien tiers inconnu.', 'open', 'Critique', 'Sécurité', 3),
      ('Dysfonctionnement logiciel comptable ERP', 'Poste SN-48213, plantage systématique lors de l''exportation des états trimestriels.', 'in_progress', 'Haute', 'Logiciel', 1)
  `);

  // Insertion commentaires
  await pool.query(`
    INSERT INTO comments (ticket_id, author_id, body) VALUES
      (1, 4, 'Prise en charge par le support N1. Un technicien passe vérifier les rouleaux d''entraînement.'),
      (1, 1, 'Merci, le voyant orange clignote toujours.'),
      (4, 4, 'Câble DisplayPort remplacé et pilote restauré à la version stable. Incident résolu.'),
      (5, 5, 'Indicateur de compromission transmis à l''équipe SOC. Domaine tiers bloqué sur le pare-feu.')
  `);

  // Insertion notifications
  await pool.query(`
    INSERT INTO notifications (user_id, title, message, ticket_id, is_read) VALUES
      (1, 'Ticket pris en charge', 'Votre ticket #1 "Imprimante bloquée" est passé au statut : En cours.', 1, false),
      (2, 'Ticket résolu', 'Votre ticket #4 "Écran noir au démarrage" a été fermé par l''agent.', 4, true),
      (4, 'Ticket critique déclaré', 'Le ticket #5 "Alerte sécurité" nécessite une intervention prioritaire.', 5, false)
  `);

  // Insertion historique
  await pool.query(`
    INSERT INTO ticket_history (ticket_id, changed_by, old_status, new_status, comment) VALUES
      (1, 4, 'open', 'in_progress', 'Prise en charge du ticket par Agent Un'),
      (4, 4, 'open', 'in_progress', 'Diagnostic matériel en cours'),
      (4, 4, 'in_progress', 'closed', 'Remplacement matériel effectué avec succès')
  `);

  // Audit initial
  await pool.query(`
    INSERT INTO audit_log (user_id, username, action, details, ip) VALUES
      (6, 'admin1', 'SYSTEM_INIT', 'Initialisation complète de la base de données HelpDesk avec données fictives', '127.0.0.1')
  `);

  console.log('[SEED] Données fictives initialisées avec succès.');
}

const PORT = process.env.PORT || 3000;
seedDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`helpdesk-backend démarré sur :${PORT} (phases 0-1 : mode vulnérable)`);
  });
}).catch((err) => {
  console.error('Échec démarrage backend:', err);
});

module.exports = app;
