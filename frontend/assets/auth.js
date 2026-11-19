/* =========================================================
   CMMD Auth — contas e sessão da Casa da Moeda Master Digital
   ---------------------------------------------------------
   As contas vivem no BACKEND (/api/auth/*): senha com scrypt no
   servidor, sessão via Bearer token (30 dias) revogável.
   O localStorage guarda apenas a sessão atual: token + um cache
   do usuário (nome, e-mail, flags de verificação) para a UI.
   ========================================================= */
(function () {
  'use strict';

  const SESSION_KEY = 'cmmd_session';

  /* ---------- API do backend ---------- */
  function apiUrl(path) {
    // API_URL === '' significa mesma origem (deploy na Vercel, site e API juntos).
    const base = (window.CMMD_ENV && typeof window.CMMD_ENV.API_URL === 'string')
      ? window.CMMD_ENV.API_URL
      : 'http://localhost:3333';
    return base.replace(/\/+$/, '') + path;
  }
  async function callApi(path, body, opts) {
    opts = opts || {};
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
      const res = await fetch(apiUrl(path), {
        method: opts.method || 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = json.error || {};
        return { ok: false, status: res.status, code: err.code || 'REQUEST_FAILED', message: err.message || 'Falha na solicitação. Tente novamente.', details: err.details };
      }
      return { ok: true, message: (json.data && json.data.message) || '', data: json.data };
    } catch (_) {
      // Sem `code`: indica indisponibilidade de rede (diferente de rejeição do servidor).
      return { ok: false, message: 'Servidor indisponível. Tente novamente em instantes.' };
    }
  }

  /* ---------- sessão local (token + cache do usuário) ---------- */
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
    catch (_) { return null; }
  }
  function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  /* ---------- validações ---------- */
  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const RE_SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58, 32–44 caracteres

  /** Campos do backend → campos do formulário (para destacar o campo certo). */
  const FIELD_MAP = { name: 'name', email: 'email', phoneDdi: 'phone', phoneNumber: 'phone', wallet: 'wallet', password: 'password' };

  const CMMDAuth = {
    isValidEmail: (v) => RE_EMAIL.test(String(v).trim()),
    isValidSolanaAddress: (v) => RE_SOLANA.test(String(v).trim()),

    getSession() {
      return loadSession();
    },

    /** Usuário da sessão atual (cache local; use refreshUser() para sincronizar). */
    currentUser() {
      const s = loadSession();
      return (s && s.user) || null;
    },

    /** Rebusca o usuário no backend e atualiza o cache (ex.: flags de verificação). */
    async refreshUser() {
      const s = loadSession();
      if (!s || !s.token) return null;
      const res = await callApi('/api/auth/me', undefined, { method: 'GET', token: s.token });
      if (res.ok) {
        s.user = res.data;
        s.name = res.data.name;
        s.wallet = res.data.wallet;
        saveSession(s);
        return res.data;
      }
      if (res.status === 401) { localStorage.removeItem(SESSION_KEY); }
      return null;
    },

    /** Redireciona para o login se não houver sessão. Usar no topo das páginas internas. */
    requireAuth() {
      if (!this.getSession()) {
        const next = encodeURIComponent(location.pathname.split('/').pop() + location.search);
        location.replace('login.html?next=' + next);
        return false;
      }
      return true;
    },

    /**
     * Cria a conta no backend. data: { name, email, phoneDdi, phoneNumber, wallet, password }
     * Retorna { ok } ou { ok:false, field, message }.
     */
    async register(data) {
      const name = String(data.name || '').trim();
      const email = String(data.email || '').trim().toLowerCase();
      const phoneNumber = String(data.phoneNumber || '').replace(/\D/g, '');
      const wallet = String(data.wallet || '').trim();
      const password = String(data.password || '');

      // Pré-checagens locais (feedback imediato; o backend revalida tudo).
      if (name.length < 3) return { ok: false, field: 'name', message: 'Informe seu nome completo.' };
      if (!this.isValidEmail(email)) return { ok: false, field: 'email', message: 'E-mail inválido.' };
      if (phoneNumber.length < 8) return { ok: false, field: 'phone', message: 'Telefone inválido.' };
      if (!this.isValidSolanaAddress(wallet)) return { ok: false, field: 'wallet', message: 'Endereço Solana inválido (32–44 caracteres, formato base58).' };
      if (password.length < 8) return { ok: false, field: 'password', message: 'A senha precisa ter pelo menos 8 caracteres.' };

      const res = await callApi('/api/auth/register', {
        name, email,
        phoneDdi: String(data.phoneDdi || '55'),
        phoneNumber,
        wallet,
        password,
      });
      if (!res.ok) {
        const detail = Array.isArray(res.details) ? res.details[0] : null;
        return { ok: false, field: (detail && FIELD_MAP[detail.field]) || null, message: (detail && detail.message) || res.message };
      }
      this._setSession(res.data);
      return { ok: true };
    },

    /** Login no backend. Retorna { ok } ou { ok:false, message }. */
    async login(email, password) {
      const res = await callApi('/api/auth/login', { email: String(email || ''), password: String(password || '') });
      if (!res.ok) return { ok: false, message: res.message };
      this._setSession(res.data);
      return { ok: true };
    },

    logout() {
      const s = loadSession();
      if (s && s.token) { callApi('/api/auth/logout', {}, { token: s.token }); } // revoga no servidor (sem bloquear a UI)
      localStorage.removeItem(SESSION_KEY);
      location.href = 'login.html';
    },

    /** result: { token, expiresAt, user } vindo de /api/auth/register ou /login. */
    _setSession(result) {
      saveSession({
        token: result.token,
        expiresAt: result.expiresAt,
        email: result.user.email,
        name: result.user.name,
        wallet: result.user.wallet,
        user: result.user,
        loggedAt: new Date().toISOString(),
      });
    },

    /* ---------- confirmação de e-mail / telefone (API do backend) ---------- */
    /** Telefone do usuário logado em formato E.164 (+5511999998888). */
    _phoneE164() {
      const user = this.currentUser();
      if (!user || !user.phone) return null;
      return '+' + String(user.phone.ddi || '55').replace(/\D/g, '') + String(user.phone.number || '').replace(/\D/g, '');
    },

    async sendEmailConfirmation() {
      const user = this.currentUser();
      if (!user) return { ok: false, message: 'Faça login para confirmar o e-mail.' };
      return callApi('/api/verification/email/send', { email: user.email });
    },

    async sendPhoneConfirmation() {
      const phone = this._phoneE164();
      if (!phone) return { ok: false, message: 'Faça login para confirmar o telefone.' };
      return callApi('/api/verification/phone/send', { phone });
    },

    /** Valida o código recebido por e-mail; o backend marca email_verified na conta. */
    async confirmEmailCode(code) {
      const user = this.currentUser();
      if (!user) return { ok: false, message: 'Faça login para confirmar o e-mail.' };
      const res = await callApi('/api/verification/email/confirm', { email: user.email, code: String(code || '').trim() });
      if (res.ok) this._setVerified('emailVerified');
      return res;
    },

    /** Valida o código recebido por SMS; o backend marca phone_verified na conta. */
    async confirmPhoneCode(code) {
      const phone = this._phoneE164();
      if (!phone) return { ok: false, message: 'Faça login para confirmar o telefone.' };
      const res = await callApi('/api/verification/phone/confirm', { phone, code: String(code || '').trim() });
      if (res.ok) this._setVerified('phoneVerified');
      return res;
    },

    /** Atualiza o cache local (o registro no servidor já foi atualizado pela confirmação). */
    _setVerified(flag) {
      const s = loadSession();
      if (s && s.user) { s.user[flag] = true; saveSession(s); }
    },

    /** Insere no cabeçalho o nome do usuário e o botão "Sair". */
    mountUserChip() {
      const session = this.getSession();
      const headerRow = document.querySelector('header > div');
      if (!session || !headerRow || document.getElementById('cmmdUserChip')) return;
      const chip = document.createElement('div');
      chip.id = 'cmmdUserChip';
      chip.setAttribute('data-i18n-skip', '');
      chip.className = 'flex items-center gap-2';
      const firstName = (session.name || '').split(' ')[0] || session.email;
      chip.innerHTML =
        '<span class="hidden max-w-[120px] truncate text-xs font-semibold text-white/80 lg:block" title="' + session.email + '">' + firstName + '</span>' +
        '<button type="button" id="cmmdLogoutBtn" class="rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/20">Sair</button>';
      headerRow.appendChild(chip);
      chip.querySelector('#cmmdLogoutBtn').addEventListener('click', () => CMMDAuth.logout());
    },

    /** Aviso "confirme seu e-mail/telefone" para quem pulou a etapa no cadastro. */
    mountVerificationBanner() {
      const render = () => {
        const user = this.currentUser();
        const existing = document.getElementById('cmmdVerifyBanner');
        if (!user || (user.emailVerified && user.phoneVerified)) { if (existing) existing.remove(); return; }
        if (existing) return;
        const pending = [];
        if (!user.emailVerified) pending.push('e-mail');
        if (!user.phoneVerified) pending.push('telefone');
        const banner = document.createElement('div');
        banner.id = 'cmmdVerifyBanner';
        banner.setAttribute('data-i18n-skip', '');
        banner.className = 'mx-auto mt-4 flex max-w-5xl items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100';
        banner.innerHTML =
          '<span>Confirme seu ' + pending.join(' e ') + ' para proteger sua conta.</span>' +
          '<a href="login.html?verify=1" class="shrink-0 rounded-xl border border-amber-300/50 bg-amber-300/20 px-3 py-1.5 text-xs font-bold text-amber-50 transition hover:bg-amber-300/30">Confirmar agora</a>';
        const main = document.querySelector('main') || document.body;
        main.insertBefore(banner, main.firstChild);
      };
      render();
      // Sincroniza com o servidor (flags podem ter mudado em outro dispositivo/aba).
      this.refreshUser().then(render);
    },
  };

  window.CMMDAuth = CMMDAuth;
})();
