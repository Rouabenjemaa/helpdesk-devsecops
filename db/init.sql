-- =============================================================================
-- HelpDesk DevSecOps - Schéma PostgreSQL & Données Initiales (Jalon S1)
-- TEK-UP University - ING-5-SSIR
-- Binôme : Ben Jemaa Roua & Dkhil Mohamed Mahdi
-- =============================================================================

-- Nettoyage si réinitialisation
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS ticket_history CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Table Utilisateurs (3 rôles : user, agent, admin)
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user', 'agent', 'admin')),
  full_name     TEXT NOT NULL,
  email         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Table Tickets (avec catégories et priorités selon cahier des charges)
CREATE TABLE tickets (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  priority    TEXT NOT NULL DEFAULT 'Moyenne' CHECK (priority IN ('Basse', 'Moyenne', 'Haute', 'Critique')),
  category    TEXT NOT NULL DEFAULT 'Autre' CHECK (category IN ('Réseau', 'Matériel', 'Logiciel', 'Accès et comptes', 'Sécurité', 'Autre')),
  owner_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Table Commentaires
CREATE TABLE comments (
  id         SERIAL PRIMARY KEY,
  ticket_id  INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Table Notifications (persistance des alertes utilisateurs et agents)
CREATE TABLE notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  ticket_id  INT REFERENCES tickets(id) ON DELETE SET NULL,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Table Historique des changements de tickets
CREATE TABLE ticket_history (
  id         SERIAL PRIMARY KEY,
  ticket_id  INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  changed_by INT REFERENCES users(id) ON DELETE SET NULL,
  old_status TEXT,
  new_status TEXT,
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Table Journal d'Audit (actions sensibles pour conformité et sécurité)
CREATE TABLE audit_log (
  id         SERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  username   TEXT,
  action     TEXT NOT NULL,
  details    TEXT,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour optimiser les performances des requêtes
CREATE INDEX idx_tickets_owner ON tickets(owner_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_category ON tickets(category);
CREATE INDEX idx_tickets_priority ON tickets(priority);
CREATE INDEX idx_tickets_created_at ON tickets(created_at DESC);
CREATE INDEX idx_comments_ticket ON comments(ticket_id);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_ticket_history_ticket ON ticket_history(ticket_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);
