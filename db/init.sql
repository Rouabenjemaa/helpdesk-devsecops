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

-- Données initiales FICTIVES (mot de passe haché bcrypt pour 'Passw0rd!')
-- $2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi ou injecté par le seed applicatif
INSERT INTO users (username, password_hash, role, full_name, email, is_active) VALUES
  ('roua',    '$2a$10$w808q/dFj7E5zQfU6wL8ueZqV.HjA4vN1rWvXJqI9G9U6mO6G7Kk6', 'user',  'Roua Ben Jemaa',   'roua.benjemaa@helpdesk.local', true),
  ('mahdi',   '$2a$10$w808q/dFj7E5zQfU6wL8ueZqV.HjA4vN1rWvXJqI9G9U6mO6G7Kk6', 'user',  'Mahdi Dkhil',      'mahdi.dkhil@helpdesk.local', true),
  ('charlie', '$2a$10$w808q/dFj7E5zQfU6wL8ueZqV.HjA4vN1rWvXJqI9G9U6mO6G7Kk6', 'user',  'Charlie Martin',   'charlie.martin@helpdesk.local', true),
  ('agent1',  '$2a$10$w808q/dFj7E5zQfU6wL8ueZqV.HjA4vN1rWvXJqI9G9U6mO6G7Kk6', 'agent', 'Agent Un',         'agent1@helpdesk.local', true),
  ('agent2',  '$2a$10$w808q/dFj7E5zQfU6wL8ueZqV.HjA4vN1rWvXJqI9G9U6mO6G7Kk6', 'agent', 'Agent Deux',       'agent2@helpdesk.local', true),
  ('admin1',  '$2a$10$w808q/dFj7E5zQfU6wL8ueZqV.HjA4vN1rWvXJqI9G9U6mO6G7Kk6', 'admin', 'Administrateur IT', 'admin@helpdesk.local', true);

INSERT INTO tickets (title, description, status, priority, category, owner_id, created_at, updated_at) VALUES
  ('Imprimante bloquée', 'Poste SN-48213, IP interne 10.20.4.17, bourrage papier récurrent dans le bac 2.', 'in_progress', 'Moyenne', 'Matériel', 1, now() - interval '2 days', now() - interval '1 hour'),
  ('VPN inaccessible depuis télétravail', 'Poste SN-77190, IP 10.20.8.5, échec de négociation TLS sur concentrateur VPN.', 'open', 'Haute', 'Réseau', 1, now() - interval '1 day', now() - interval '1 day'),
  ('Accès dossier RH confidentiel refusé', 'Demande de droits en lecture pour Mahdi Dkhil, poste SN-50021, suite à transfert de service.', 'open', 'Basse', 'Accès et comptes', 2, now() - interval '3 days', now() - interval '3 days'),
  ('Écran noir au démarrage', 'Poste SN-31877, IP 10.20.2.40. Aucun affichage après mise à jour des pilotes graphiques.', 'closed', 'Moyenne', 'Matériel', 2, now() - interval '5 days', now() - interval '2 days'),
  ('Alerte sécurité : tentative de phishing signalée', 'Email frauduleux demandant réinitialisation mot de passe avec lien tiers inconnu.', 'open', 'Critique', 'Sécurité', 3, now() - interval '4 hours', now() - interval '4 hours'),
  ('Dysfonctionnement logiciel comptable ERP', 'Poste SN-48213, plantage systématique lors de l''exportation des états trimestriels.', 'in_progress', 'Haute', 'Logiciel', 1, now() - interval '6 hours', now() - interval '30 minutes');

INSERT INTO comments (ticket_id, author_id, body, created_at) VALUES
  (1, 4, 'Prise en charge par le support N1. Un technicien passe vérifier les rouleaux d''entraînement.', now() - interval '1 day'),
  (1, 1, 'Merci, le voyant orange clignote toujours.', now() - interval '2 hours'),
  (4, 4, 'Câble DisplayPort remplacé et pilote restauré à la version stable. Incident résolu.', now() - interval '2 days'),
  (5, 5, 'Indicateur de compromission transmis à l''équipe SOC. Domaine tiers bloqué sur le pare-feu.', now() - interval '2 hours');

INSERT INTO notifications (user_id, title, message, ticket_id, is_read, created_at) VALUES
  (1, 'Ticket pris en charge', 'Votre ticket #1 "Imprimante bloquée" est passé au statut : En cours.', 1, false, now() - interval '1 hour'),
  (2, 'Ticket résolu', 'Votre ticket #4 "Écran noir au démarrage" a été fermé par l''agent.', 4, true, now() - interval '2 days'),
  (4, 'Ticket critique déclaré', 'Le ticket #5 "Alerte sécurité" nécessite une intervention prioritaire.', 5, false, now() - interval '4 hours');

INSERT INTO ticket_history (ticket_id, changed_by, old_status, new_status, comment, created_at) VALUES
  (1, 4, 'open', 'in_progress', 'Prise en charge du ticket par Agent Un', now() - interval '1 day'),
  (4, 4, 'open', 'in_progress', 'Diagnostic matériel en cours', now() - interval '3 days'),
  (4, 4, 'in_progress', 'closed', 'Remplacement matériel effectué avec succès', now() - interval '2 days');

INSERT INTO audit_log (user_id, username, action, details, ip, created_at) VALUES
  (6, 'admin1', 'SYSTEM_INIT', 'Initialisation de la base de données HelpDesk avec données fictives', '127.0.0.1', now() - interval '5 days'),
  (1, 'roua', 'USER_LOGIN', 'Authentification réussie pour roua', '10.20.4.17', now() - interval '2 days'),
  (4, 'agent1', 'TICKET_STATUS_UPDATE', 'Ticket #1 passé de open à in_progress', '10.20.1.10', now() - interval '1 day'),
  (4, 'agent1', 'TICKET_STATUS_UPDATE', 'Ticket #4 passé de in_progress à closed', '10.20.1.10', now() - interval '2 days');
