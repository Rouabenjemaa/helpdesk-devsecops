// État global de l'application
    let authToken = localStorage.getItem('hd_token') || '';
    let currentUser = JSON.parse(localStorage.getItem('hd_user') || 'null');
    let currentTicketsList = [];
    let currentActiveTicketId = null;
    let notifIntervalId = null;

    // Raccourci DOM
    const $ = (id) => document.getElementById(id);

    // Initialisation
    window.addEventListener('DOMContentLoaded', async () => {
      if (authToken && currentUser) {
        setupAuthenticatedUI();
      } else {
        setupGuestUI();
      }
    });

    // Client API
    async function api(path, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      if (authToken) {
        headers['Authorization'] = 'Bearer ' + authToken;
      }
      try {
        const res = await fetch('/api' + path, { ...options, headers });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && authToken) {
          showToast('Session expirée. Veuillez vous reconnecter.', 'error');
          logout();
          return null;
        }
        if (!res.ok) {
          throw new Error(data.error || 'Erreur serveur HTTP ' + res.status);
        }
        return data;
      } catch (err) {
        showToast(err.message, 'error');
        throw err;
      }
    }

    // Authentification
    function openLoginModal() {
      $('loginModal').classList.remove('hide');
      $('loginUsername').focus();
    }
    function closeLoginModal() {
      $('loginModal').classList.add('hide');
      $('loginError').classList.add('hide');
    }
    function togglePasswordVisibility(id) {
      const input = $(id);
      input.type = input.type === 'password' ? 'text' : 'password';
    }

    async function performLogin() {
      const u = $('loginUsername').value.trim();
      const p = $('loginPassword').value;
      if (!u || !p) {
        showLoginError('Veuillez renseigner un identifiant et un mot de passe.');
        return;
      }
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();
        if (!res.ok) {
          showLoginError(data.error || 'Échec de connexion');
          return;
        }
        authToken = data.token;
        currentUser = { username: data.username, role: data.role, full_name: data.full_name, email: data.email };
        localStorage.setItem('hd_token', authToken);
        localStorage.setItem('hd_user', JSON.stringify(currentUser));
        closeLoginModal();
        showToast(`Bienvenue, ${data.full_name || data.username} !`, 'success');
        setupAuthenticatedUI();
      } catch (e) {
        showLoginError(e.message);
      }
    }

    function showLoginError(msg) {
      const el = $('loginError');
      el.textContent = msg;
      el.classList.remove('hide');
    }

    function logout() {
      authToken = '';
      currentUser = null;
      localStorage.removeItem('hd_token');
      localStorage.removeItem('hd_user');
      clearInterval(notifIntervalId);
      setupGuestUI();
      showToast('Vous êtes déconnecté.', 'info');
    }

    // Gestion de l'affichage selon le rôle
    function setupAuthenticatedUI() {
      $('publicView').classList.add('hide');
      $('appView').classList.remove('hide');
      $('guestNav').classList.add('hide');
      $('userNav').classList.remove('hide');
      $('notifWrapper').classList.remove('hide');

      $('navUsername').textContent = currentUser.username;
      $('navRole').textContent = currentUser.role.toUpperCase();
      $('navRole').className = 'role-badge role-' + currentUser.role;
      $('userAvatar').textContent = currentUser.username.charAt(0).toUpperCase();

      // Ajustement des menus latéraux
      $('menuUsers').classList.toggle('hide', currentUser.role !== 'admin');
      $('menuAudit').classList.toggle('hide', currentUser.role !== 'admin');
      $('menuNewTicket').classList.toggle('hide', currentUser.role === 'admin');

      // Chargement initial
      loadDashboardStats();
      loadTickets();
      pollNotifications();
      if (!notifIntervalId) {
        notifIntervalId = setInterval(pollNotifications, 10000);
      }
    }

    function setupGuestUI() {
      $('publicView').classList.remove('hide');
      $('appView').classList.add('hide');
      $('guestNav').classList.remove('hide');
      $('userNav').classList.add('hide');
      $('notifWrapper').classList.add('hide');
    }

    function navigateHome() {
      if (authToken) {
        switchView('dashboard');
      } else {
        setupGuestUI();
      }
    }

    // Navigation entre les vues de l'espace connecté
    function switchView(viewName) {
      $('dashSection').classList.add('hide');
      $('ticketsSection').classList.add('hide');
      $('detailSection').classList.add('hide');
      $('usersSection').classList.add('hide');
      $('auditSection').classList.add('hide');
      $('notifsViewSection').classList.add('hide');

      document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));

      if (viewName === 'dashboard') {
        $('dashSection').classList.remove('hide');
        $('sideBtnDash').classList.add('active');
        loadDashboardStats();
        loadTickets();
      } else if (viewName === 'tickets') {
        $('ticketsSection').classList.remove('hide');
        $('sideBtnTickets').classList.add('active');
        loadTickets();
      } else if (viewName === 'users') {
        $('usersSection').classList.remove('hide');
        $('sideBtnUsers').classList.add('active');
        loadUsers();
      } else if (viewName === 'audit') {
        $('auditSection').classList.remove('hide');
        $('sideBtnAudit').classList.add('active');
        loadAuditLog();
      } else if (viewName === 'notifications') {
        $('notifsViewSection').classList.remove('hide');
        $('sideBtnNotifs').classList.add('active');
        loadAllNotificationsView();
      }
    }

    // Statistiques des tableaux de bord
    async function loadDashboardStats() {
      const container = $('statsRow');
      container.innerHTML = '';

      if (currentUser.role === 'user') {
        const s = await api('/user/stats');
        if (!s) return;
        $('dashTitle').textContent = 'Mes incidents personnels';
        renderStatCard('Total de mes tickets', s.total_tickets, 'Déclarés par vous');
        renderStatCard('En attente / Ouverts', s.open_tickets, 'À prendre en charge');
        renderStatCard('En cours de traitement', s.in_progress_tickets, 'Pris par un agent');
        renderStatCard('Résolus / Fermés', s.closed_tickets, 'Incidents clos');
      } else if (currentUser.role === 'agent') {
        const s = await api('/agent/stats');
        if (!s) return;
        $('dashTitle').textContent = 'File d\'attente globale des incidents';
        renderStatCard('Tickets sur la plateforme', s.total_tickets, 'Total');
        renderStatCard('Nouveaux / Ouverts', s.open_tickets, 'Nécessite intervention');
        renderStatCard('En cours', s.in_progress_tickets, 'En résolution');
        renderStatCard('Critiques / Haute priorité', s.urgent_tickets, 'Action immédiate');
      } else if (currentUser.role === 'admin') {
        const s = await api('/admin/stats');
        if (!s) return;
        $('dashTitle').textContent = 'Vue d\'ensemble de la plateforme';
        renderStatCard('Utilisateurs totaux', s.users.total_users, `${s.users.active_users} actifs`);
        renderStatCard('Tickets déclarés', s.tickets.total_tickets, `${s.tickets.open_tickets} ouverts`);
        renderStatCard('En cours', s.tickets.in_progress_tickets, 'Traitement');
        renderStatCard('Incidents résolus', s.tickets.closed_tickets, 'Clôturés');
      }
    }

    function renderStatCard(title, value, sub) {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `
        <span class="stat-card-title">${title}</span>
        <span class="stat-card-value">${value}</span>
        <span class="stat-card-sub">${sub}</span>
      `;
      $('statsRow').appendChild(card);
    }

    // Gestion des Tickets (Consultation, Filtre, Recherche)
    async function loadTickets() {
      const status = $('filterStatus') ? $('filterStatus').value : '';
      const priority = $('filterPriority') ? $('filterPriority').value : '';
      const category = $('filterCategory') ? $('filterCategory').value : '';
      const query = $('searchInput') ? $('searchInput').value.trim() : '';

      let url = '/tickets?';
      if (status) url += `status=${status}&`;
      if (priority) url += `priority=${priority}&`;
      if (category) url += `category=${category}&`;

      if (query) {
        url = `/search?q=${encodeURIComponent(query)}`;
      }

      const tickets = await api(url);
      if (!tickets) return;
      currentTicketsList = tickets;

      renderTicketsTable('dashTableBody', tickets.slice(0, 5));
      renderTicketsTable('ticketsTableBody', tickets);
    }

    function renderTicketsTable(tbodyId, rows) {
      const tbody = $(tbodyId);
      if (!tbody) return;
      tbody.innerHTML = '';

      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:var(--text-muted);">Aucun ticket d\'incident trouvé.</td></tr>';
        return;
      }

      rows.forEach(t => {
        const tr = document.createElement('tr');
        const statusLabels = { open: 'Ouvert', in_progress: 'En cours', closed: 'Fermé' };
        const priorityClasses = { Critique: 'badge-critique', Haute: 'badge-haute', Moyenne: 'badge-moyenne', Basse: 'badge-basse' };

        tr.innerHTML = `
          <td><strong>#${t.id}</strong></td>
          <td><strong>${escapeHtml(t.title)}</strong></td>
          <td><span class="badge badge-category">${escapeHtml(t.category || 'Autre')}</span></td>
          <td><span class="badge ${priorityClasses[t.priority] || 'badge-moyenne'}">${escapeHtml(t.priority || 'Moyenne')}</span></td>
          <td><span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(statusLabels[t.status] || t.status)}</span></td>
          <td>${escapeHtml(t.owner_username || t.owner_name || 'Utilisateur')}</td>
          <td style="color:var(--text-muted); font-size:0.8rem;">${new Date(t.created_at).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="openTicketDetail(${t.id})">Consulter</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    function handleSearchKey(e) {
      if (e.key === 'Enter') {
        loadTickets();
      }
    }

    // Modal Nouveau Ticket
    function openNewTicketModal() {
      $('ticketModal').classList.remove('hide');
      $('ticketTitle').focus();
    }
    function closeNewTicketModal() {
      $('ticketModal').classList.add('hide');
      $('ticketTitle').value = '';
      $('ticketDescription').value = '';
    }
    async function submitNewTicket() {
      const title = $('ticketTitle').value.trim();
      const description = $('ticketDescription').value.trim();
      const category = $('ticketCategory').value;
      const priority = $('ticketPriority').value;

      if (!title || !description) {
        showToast('Le titre et la description sont obligatoires.', 'warning');
        return;
      }

      const res = await api('/tickets', {
        method: 'POST',
        body: JSON.stringify({ title, description, category, priority })
      });

      if (res) {
        showToast(`Ticket #${res.id} déclaré avec succès !`, 'success');
        closeNewTicketModal();
        loadDashboardStats();
        loadTickets();
      }
    }

    // Vue Détail d'un Ticket
    async function openTicketDetail(id) {
      currentActiveTicketId = id;
      await loadTicketDetail(id);
      $('dashSection').classList.add('hide');
      $('ticketsSection').classList.add('hide');
      $('detailSection').classList.remove('hide');
    }

    function closeTicketDetail() {
      $('detailSection').classList.add('hide');
      switchView('tickets');
    }

    async function loadTicketDetail(id) {
      const t = await api('/tickets/' + id);
      if (!t) return;

      $('dtId').textContent = 'Ticket #' + t.id;
      $('dtTitle').textContent = t.title;
      $('dtDesc').textContent = t.description;
      $('dtOwner').textContent = `${t.owner_name || t.owner_username} (${t.owner_username})`;
      $('dtDate').textContent = new Date(t.created_at).toLocaleString();

      const statusLabels = { open: 'Ouvert', in_progress: 'En cours', closed: 'Fermé' };
      $('dtStatus').innerHTML = `<span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(statusLabels[t.status] || t.status)}</span>`;
      $('dtPriority').innerHTML = `<span class="badge badge-${escapeHtml(String(t.priority).toLowerCase())}">${escapeHtml(t.priority)}</span>`;
      $('dtCategory').innerHTML = `<span class="badge badge-category">${escapeHtml(t.category)}</span>`;

      // Affichage du sélecteur de statut pour l'agent
      if (currentUser.role === 'agent') {
        $('agentStatusBox').classList.remove('hide');
        $('agentStatusSelect').value = t.status;
      } else {
        $('agentStatusBox').classList.add('hide');
      }

      // Commentaires (Démonstration Faille 2 : XSS)
      $('dtCommentCount').textContent = (t.comments || []).length;
      const commentsList = $('dtCommentsList');
      commentsList.innerHTML = '';

      (t.comments || []).forEach(c => {
        const li = document.createElement('li');
        li.className = 'comment-card';

        // VULN-002 (XSS stocké) CORRIGÉE (phase 5) : le corps du commentaire est inséré avec
        // textContent, donc affiché comme du TEXTE et jamais interprété comme du HTML.
        const role = escapeHtml(c.author_role || 'user');
        li.innerHTML = `
          <div class="comment-header">
            <strong>${escapeHtml(c.author_name || c.author)} <span class="role-badge role-${role}">${role}</span></strong>
            <span style="color:var(--text-light);">${new Date(c.created_at).toLocaleString()}</span>
          </div>
        `;
        const bodyEl = document.createElement('div');
        bodyEl.className = 'comment-body';
        bodyEl.textContent = c.body;
        li.appendChild(bodyEl);

        commentsList.appendChild(li);
      });

      // Historique des changements
      const timeline = $('dtHistoryTimeline');
      timeline.innerHTML = '';
      if (!t.history || t.history.length === 0) {
        timeline.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Aucun changement d\'état enregistré.</p>';
      } else {
        t.history.forEach(h => {
          const item = document.createElement('div');
          item.className = 'timeline-item';
          item.innerHTML = `
            <div class="timeline-dot"></div>
            <div class="timeline-content">
              <strong>${escapeHtml(h.changed_by_name || h.changed_by_username || 'Système')}</strong>
              <span style="color:var(--text-muted);"> : ${escapeHtml(h.comment || `Passage à ${h.new_status}`)}</span>
              <div style="font-size:0.75rem; color:var(--text-light); margin-top:2px;">${new Date(h.created_at).toLocaleString()}</div>
            </div>
          `;
          timeline.appendChild(item);
        });
      }
    }

    // Agent : Modification de statut
    async function submitStatusChange() {
      const status = $('agentStatusSelect').value;
      const comment = $('agentStatusComment').value.trim();

      const res = await api(`/tickets/${currentActiveTicketId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, comment })
      });

      if (res && res.ok) {
        showToast(`Statut mis à jour : ${status}`, 'success');
        $('agentStatusComment').value = '';
        loadTicketDetail(currentActiveTicketId);
        loadDashboardStats();
      }
    }

    // Ajout d'un commentaire
    async function submitComment() {
      const text = $('newCommentText').value.trim();
      if (!text) {
        showToast('Le commentaire ne peut pas être vide.', 'warning');
        return;
      }

      const res = await api(`/tickets/${currentActiveTicketId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: text })
      });

      if (res && res.ok) {
        showToast('Commentaire ajouté.', 'success');
        $('newCommentText').value = '';
        loadTicketDetail(currentActiveTicketId);
      }
    }

    // Notifications Persistantes
    async function pollNotifications() {
      if (!authToken) return;
      try {
        const res = await api('/notifications');
        if (!res) return;

        const countEl = $('notifCount');
        if (res.unread_count > 0) {
          countEl.textContent = res.unread_count;
          countEl.classList.remove('hide');
        } else {
          countEl.classList.add('hide');
        }

        renderNotificationsList('notifList', res.notifications);
      } catch (e) {
        // Ignorer silencieusement les erreurs de polling
      }
    }

    function toggleNotifDropdown() {
      const d = $('notifDropdown');
      d.classList.toggle('show');
    }

    function renderNotificationsList(containerId, list) {
      const container = $(containerId);
      if (!container) return;
      container.innerHTML = '';

      if (!list || list.length === 0) {
        container.innerHTML = '<li class="notif-empty">Aucune notification pour le moment.</li>';
        return;
      }

      list.forEach(n => {
        const li = document.createElement('li');
        li.className = 'notif-item ' + (n.is_read ? '' : 'unread');
        li.innerHTML = `
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          <div class="notif-item-msg">${escapeHtml(n.message)}</div>
          <div class="notif-item-time">${new Date(n.created_at).toLocaleString()}</div>
        `;
        li.onclick = async () => {
          if (!n.is_read) {
            await api(`/notifications/${n.id}/read`, { method: 'PATCH' });
          }
          if (n.ticket_id) {
            $('notifDropdown').classList.remove('show');
            openTicketDetail(n.ticket_id);
          }
          pollNotifications();
        };
        container.appendChild(li);
      });
    }

    async function markAllNotificationsRead() {
      await api('/notifications/read-all', { method: 'PATCH' });
      showToast('Toutes les notifications sont marquées comme lues.', 'info');
      pollNotifications();
    }

    async function loadAllNotificationsView() {
      const res = await api('/notifications');
      if (res) {
        renderNotificationsList('fullNotifList', res.notifications);
      }
    }

    // Administration : Utilisateurs & Audit
    async function loadUsers() {
      const users = await api('/admin/users');
      if (!users) return;

      const tbody = $('usersTableBody');
      tbody.innerHTML = '';
      users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${u.id}</td>
          <td><strong>${escapeHtml(u.username)}</strong></td>
          <td>${escapeHtml(u.full_name)}</td>
          <td>${escapeHtml(u.email || '-')}</td>
          <td><span class="role-badge role-${escapeHtml(u.role)}">${escapeHtml(String(u.role).toUpperCase())}</span></td>
          <td>
            <span class="badge ${u.is_active ? 'badge-closed' : 'badge-open'}">
              ${u.is_active ? 'Actif' : 'Désactivé'}
            </span>
          </td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="toggleUserActive(${u.id}, ${!u.is_active})">
              ${u.is_active ? 'Désactiver' : 'Activer'}
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    async function toggleUserActive(userId, newState) {
      const res = await api(`/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: newState })
      });
      if (res) {
        showToast(`Compte mis à jour : ${newState ? 'Actif' : 'Désactivé'}`, 'success');
        loadUsers();
      }
    }

    function openNewUserModal() {
      $('userModal').classList.remove('hide');
      $('newUsername').focus();
    }
    function closeNewUserModal() {
      $('userModal').classList.add('hide');
      $('newUsername').value = '';
      $('newFullName').value = '';
      $('newEmail').value = '';
      $('newUserPass').value = '';
    }
    async function submitNewUser() {
      const username = $('newUsername').value.trim();
      const full_name = $('newFullName').value.trim();
      const email = $('newEmail').value.trim();
      const role = $('newRole').value;
      const password = $('newUserPass').value;

      if (!username || !full_name || !password) {
        showToast('Veuillez renseigner tous les champs obligatoires.', 'warning');
        return;
      }

      const res = await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, full_name, email, role, password })
      });

      if (res) {
        showToast(`Utilisateur ${res.username} créé avec succès !`, 'success');
        closeNewUserModal();
        loadUsers();
      }
    }

    async function loadAuditLog() {
      const logs = await api('/admin/audit');
      if (!logs) return;

      const tbody = $('auditTableBody');
      tbody.innerHTML = '';
      logs.forEach(l => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="color:var(--text-muted); font-size:0.8rem;">${new Date(l.created_at).toLocaleString()}</td>
          <td><strong>${escapeHtml(l.username || 'Anonyme')}</strong></td>
          <td><code>${escapeHtml(l.action)}</code></td>
          <td style="font-size:0.85rem;">${escapeHtml(l.details || '-')}</td>
          <td><code>${escapeHtml(l.ip || '-')}</code></td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Utilitaires d'échappement et Toast
    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function showToast(message, type = 'info') {
      const container = $('toastContainer');
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }
