/* eslint-disable no-use-before-define */
/**
 * app.js — seluruh logika UI Broadtele (vanilla JS, tanpa framework/build step).
 *
 * Komunikasi dengan main process lewat window.broadtele (lihat preload.js):
 * - config   : API ID / API Hash bersama untuk semua akun userbot
 * - accounts : login/hapus/rename banyak akun Telegram (userbot)
 * - bots     : daftarkan banyak bot (@BotFather), polling on/off per bot
 * - targets  : daftar grup & japri per pemilik (akun/bot), centang utk broadcast
 * - jobs     : buat & jalankan broadcast, pilih pengirim (auto / personal / bot tertentu)
 * - status   : pill realtime per akun & per bot di topbar
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---- State lokal ----
const state = {
  view: 'pengaturan',
  accounts: [],            // [{id,label,phone,status,target_count}]
  bots: [],                // [{id,label,token,polling,active,bot_username,reachable_groups}]
  targets: { grup: [], japri: [] },
  selected: { grup: new Set(), japri: new Set() },
  activeJobId: null,
  jobList: [],
  expandedJobId: null,
};

// ---- Util DOM ----
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toast(msg, isError = true) {
  const el = document.createElement('div');
  el.className = 'toast';
  if (!isError) {
    el.style.background = 'var(--mint-dim)';
    el.style.borderColor = 'var(--mint)';
    el.style.color = '#d7fff0';
  }
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

async function call(fn, errPrefix) {
  try {
    return await fn();
  } catch (err) {
    const m = err?.message || String(err);
    toast(`${errPrefix ? `${errPrefix}: ` : ''}${m}`);
    throw err;
  }
}

// ---- Navigasi sidebar ----
function switchView(name) {
  state.view = name;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'grup' || name === 'japri') refreshTargets(name);
  if (name === 'akunbot') refreshAccountsAndBots();
  if (name === 'buat') refreshCreateForm();
  if (name === 'riwayat') refreshJobs();
}

// ---- Topbar status (pill per akun & per bot) ----
function renderStatusPills({ accounts = [], bots = [] } = {}) {
  const cluster = $('#statusCluster');
  if (!cluster) return;
  const accPills = accounts.map((a) => `
    <span class="status-pill ${esc(a.status)}" title="${esc(a.phone || '')}">
      <span class="dot"></span>${esc(a.label)}
    </span>`).join('');
  const botPills = bots.map((b) => `
    <span class="status-pill ${b.active ? 'connected' : ''}" title="polling: ${b.polling ? 'on' : 'off'}${b.bot_username ? `, @${esc(b.bot_username)}` : ''}">
      <span class="dot"></span>${esc(b.label)}
    </span>`).join('');
  cluster.innerHTML = accPills + botPills || '<span class="selection-note">belum ada akun/bot terdaftar</span>';
}

// ---- Pengaturan ----
async function loadConfig() {
  const c = await call(() => window.broadtele.config.get(), 'Gagal memuat pengaturan');
  $('#cfgApiId').value = c.apiId || '';
  $('#cfgApiHash').value = c.apiHash || '';
}

async function saveConfig() {
  await call(() => window.broadtele.config.save({
    apiId: $('#cfgApiId').value.trim(),
    apiHash: $('#cfgApiHash').value.trim(),
  }), 'Gagal menyimpan pengaturan');
  toast('Pengaturan tersimpan. Semua akun dicoba sambungkan ulang.', false);
  await refreshAll();
}

// ---- Akun & Bot ----
async function refreshAccountsAndBots() {
  const [accounts, bots] = await Promise.all([
    call(() => window.broadtele.accounts.list(), 'Gagal memuat akun'),
    call(() => window.broadtele.bots.list(), 'Gagal memuat bot'),
  ]);
  state.accounts = accounts;
  state.bots = bots;
  renderAccountsTable();
  renderBotsTable();
  renderStatusPills({ accounts, bots });
}

function renderAccountsTable() {
  const wrap = $('#accountsTableWrap');
  const list = state.accounts;
  $('#accountCount').textContent = `${list.length} akun`;
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state">Belum ada akun Telegram.<br>Klik "+ Tambah Akun (Login)" untuk login akun pertama — bisa sebanyak yang Anda mau.</div>';
    return;
  }
  wrap.innerHTML = `<table><thead><tr>
      <th>Nama</th><th>Nomor</th><th>Status</th><th>Target</th><th style="text-align:right">Aksi</th>
    </tr></thead><tbody>
    ${list.map((a) => `
      <tr>
        <td><b>${esc(a.label)}</b></td>
        <td class="chat-id">${esc(a.phone || '-')}</td>
        <td><span class="badge ${a.status === 'connected' ? 'bot' : a.status === 'connecting' ? 'both' : 'personal'}">${esc(a.status)}</span></td>
        <td class="chat-id">${a.target_count ?? 0}</td>
        <td style="text-align:right; white-space:nowrap">
          ${a.status === 'disconnected'
            ? `<button class="ghost" data-act="acc-login" data-id="${a.id}">Login lagi</button>`
            : `<button class="ghost" data-act="acc-logout" data-id="${a.id}">Logout</button>`}
          <button class="ghost" data-act="acc-rename" data-id="${a.id}">Ganti nama</button>
          <button class="danger" data-act="acc-remove" data-id="${a.id}">Hapus</button>
        </td>
      </tr>`).join('')}
    </tbody></table>`;
}

function renderBotsTable() {
  const wrap = $('#botsTableWrap');
  const list = state.bots;
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state">Belum ada bot. Ambil token dari @BotFather lalu tambahkan — jumlah bot bebas.</div>';
    return;
  }
  wrap.innerHTML = `<table><thead><tr>
      <th>Nama</th><th>Username</th><th>Token</th><th>Polling</th><th>Status</th><th>Grup terjangkau</th><th style="text-align:right">Aksi</th>
    </tr></thead><tbody>
    ${list.map((b) => `
      <tr>
        <td><b>${esc(b.label)}</b></td>
        <td class="chat-id">${b.bot_username ? '@' + esc(b.bot_username) : '-'}</td>
        <td class="chat-id">${esc(b.token)}</td>
        <td><input type="checkbox" data-act="bot-polling" data-id="${b.id}" ${b.polling ? 'checked' : ''} /></td>
        <td><span class="badge ${b.active ? 'bot' : 'personal'}">${b.active ? 'aktif' : 'tidak aktif'}</span></td>
        <td class="chat-id">${b.reachable_groups ?? 0}</td>
        <td style="text-align:right">
          <button class="danger" data-act="bot-remove" data-id="${b.id}">Hapus</button>
        </td>
      </tr>`).join('')}
    </tbody></table>`;
}

async function addAccount() {
  const label = prompt('Nama panggilan akun ini? (contoh: "Toko A", "Pribadi")');
  if (!label || !label.trim()) return;
  await call(() => window.broadtele.accounts.add(label.trim()), 'Login akun gagal');
  toast(`Akun "${label.trim()}" berhasil login.`, false);
  await refreshAll();
}

async function removeAccount(id) {
  const acc = state.accounts.find((a) => a.id === id);
  if (!confirm(`Hapus akun "${acc?.label}" beserta sesi & target miliknya?`)) return;
  await call(() => window.broadtele.accounts.remove(id), 'Gagal menghapus akun');
  await refreshAll();
}

async function renameAccount(id) {
  const acc = state.accounts.find((a) => a.id === id);
  const label = prompt('Nama baru:', acc?.label || '');
  if (!label || !label.trim() || label.trim() === acc?.label) return;
  await call(() => window.broadtele.accounts.rename({ accountId: id, label: label.trim() }), 'Gagal mengganti nama');
  await refreshAll();
}

async function logoutAccount(id) {
  await call(() => window.broadtele.accounts.logout(id), 'Gagal logout');
  await refreshAll();
}

async function loginAgain(id) {
  await call(() => window.broadtele.accounts.loginAgain(id), 'Login ulang gagal');
  await refreshAll();
}

async function addBot() {
  const label = $('#newBotLabel').value.trim();
  const token = $('#newBotToken').value.trim();
  const polling = $('#newBotPolling').checked;
  if (!label) { toast('Isi nama panggilan bot dulu.'); return; }
  if (!token) { toast('Isi token dari @BotFather dulu.'); return; }
  await call(() => window.broadtele.bots.add({ label, token, polling }), 'Gagal menambah bot');
  $('#newBotLabel').value = '';
  $('#newBotToken').value = '';
  toast('Bot ditambahkan & diverifikasi via getMe().', false);
  await refreshAll();
}

async function setBotPolling(id, polling) {
  await call(() => window.broadtele.bots.setPolling({ botId: id, polling }), 'Gagal mengubah polling');
  await refreshAccountsAndBots();
}

async function removeBot(id) {
  const b = state.bots.find((x) => x.id === id);
  if (!confirm(`Hapus bot "${b?.label}"? Bukti keanggotaannya di grup ikut terhapus.`)) return;
  await call(() => window.broadtele.bots.remove(id), 'Gagal menghapus bot');
  await refreshAll();
}

// ---- Targets (Grup & Japri) ----
async function refreshTargets(type) {
  const list = await call(() => window.broadtele.targets.list({ type }), 'Gagal memuat target');
  state.targets[type] = list;
  // buang pilihan yang sudah tidak ada
  for (const id of [...state.selected[type]]) {
    if (!list.some((t) => t.id === id)) state.selected[type].delete(id);
  }
  renderTargetsTable(type);
  updateSelectionCounts();
  if (type === 'grup') fillSyncSelectors();
}

function botsProvenFor(t) {
  return (t.can_send_bots || '').split(',').filter(Boolean).map(Number)
    .map((id) => state.bots.find((b) => b.id === id))
    .filter(Boolean);
}

function renderTargetsTable(type) {
  const wrap = $(type === 'grup' ? '#grupTableWrap' : '#japriTableWrap');
  const countEl = $(type === 'grup' ? '#grupCount' : '#japriCount');
  const list = state.targets[type];
  countEl.textContent = `${list.length} target, ${state.selected[type].size} dipilih`;
  if (!list.length) {
    wrap.innerHTML = type === 'grup'
      ? '<div class="empty-state">Belum ada grup. Login akun lalu klik "Sync dari Akun Pribadi", atau aktifkan polling bot / "Sinkronkan Kepanggotaan Bot".</div>'
      : '<div class="empty-state">Belum ada kontak japri. Kontak sync otomatis mengikuti tab Grup (dari dialog akun), dan orang yang chat ke bot tercatat otomatis.</div>';
    return;
  }
  wrap.innerHTML = `<table><thead><tr>
      <th style="width:34px"><input type="checkbox" id="checkAll_${type}" ${state.selected[type].size === list.length && list.length ? 'checked' : ''} /></th>
      <th>Nama</th><th>Dari</th><th>Sumber</th>${type === 'grup' ? '<th>Bot bisa kirim</th>' : ''}
      <th>Terakhir</th><th>Bisnis?</th><th style="text-align:right">Aksi</th>
    </tr></thead><tbody>
    ${list.map((t) => {
    const proven = botsProvenFor(t);
    return `
      <tr>
        <td><input type="checkbox" data-act="tgt-select" data-type="${type}" data-id="${t.id}" ${state.selected[type].has(t.id) ? 'checked' : ''} /></td>
        <td><b>${esc(t.display_name || '(tanpa nama)')}</b>${t.username ? `<div class="chat-id">@${esc(t.username)}</div>` : ''}</td>
        <td class="chat-id">${t.account_label ? esc(t.account_label) : (t.is_bot_contact ? 'via bot (prospek)' : 'warisan/lama')}</td>
        <td><span class="badge ${esc(t.source)}">${esc(t.source)}</span></td>
        ${type === 'grup' ? `<td class="chat-id">${proven.length ? proven.map((b) => `🤖 ${esc(b.label)}`).join('<br>') : (t.bot_can_send ? 'ya (lama)' : '—')}</td>` : ''}
        <td class="chat-id">${esc(t.last_status || '')} ${t.last_broadcast_at ? `<br>${esc(t.last_broadcast_at.slice(0, 16))}` : ''}</td>
        <td><input type="checkbox" data-act="tgt-biz" data-id="${t.id}" ${t.is_business_relation ? 'checked' : ''} /></td>
        <td style="text-align:right"><button class="danger" data-act="tgt-del" data-type="${type}" data-id="${t.id}">Hapus</button></td>
      </tr>`;
  }).join('')}
    </tbody></table>`;
}

function updateSelectionCounts() {
  $('#selCountGrup').textContent = state.selected.grup.size;
  $('#selCountJapri').textContent = state.selected.japri.size;
}

async function toggleSelect(type, id, checked) {
  if (checked) state.selected[type].add(id); else state.selected[type].delete(id);
  updateSelectionCounts();
  const countEl = $(type === 'grup' ? '#grupCount' : '#japriCount');
  countEl.textContent = `${state.targets[type].length} target, ${state.selected[type].size} dipilih`;
}

async function selectAll(type, checked) {
  state.selected[type] = checked ? new Set(state.targets[type].map((t) => t.id)) : new Set();
  renderTargetsTable(type);
}

async function setBusinessFlag(id, value) {
  await call(() => window.broadtele.targets.setFlag(id, 'is_business_relation', value), 'Gagal menandai target');
}

async function deleteTarget(type, id) {
  if (!confirm('Hapus target ini dari daftar?')) return;
  await call(() => window.broadtele.targets.delete(id), 'Gagal menghapus target');
  state.selected[type].delete(id);
  await refreshTargets(type);
}

function fillSyncSelectors() {
  const accSel = $('#syncAccountSelect');
  const botSel = $('#syncBotSelect');
  const connected = state.accounts.filter((a) => a.status === 'connected');
  accSel.innerHTML = connected.length
    ? connected.map((a) => `<option value="${a.id}">${esc(a.label)}</option>`).join('')
    : '<option value="">(belum ada akun terhubung)</option>';
  const activeBots = state.bots.filter((b) => b.active);
  botSel.innerHTML = activeBots.length
    ? activeBots.map((b) => `<option value="${b.id}">${esc(b.label)}</option>`).join('')
    : '<option value="">(belum ada bot aktif)</option>';
}

async function syncUserbotDialogs() {
  const accountId = Number($('#syncAccountSelect').value);
  if (!accountId) { toast('Tidak ada akun terhubung untuk di-sync.'); return; }
  toast('Mengambil daftar chat dari akun...', false);
  await call(() => window.broadtele.targets.syncUserbotDialogs(accountId), 'Sync gagal');
  toast('Sync dialog selesai.', false);
  await Promise.all([refreshTargets('grup'), refreshTargets('japri')]);
}

async function syncBotMembership() {
  const botId = Number($('#syncBotSelect').value);
  if (!botId) { toast('Pilih bot aktif dulu.'); return; }
  toast('Mengecek keanggotaan bot di semua grup...', false);
  const res = await call(() => window.broadtele.targets.syncBotMembership(botId), 'Sinkronisasi bot gagal');
  toast(`Cek ${res.checked} grup, ${res.updated} grup terbukti bisa dipakai bot ini.`, false);
  await refreshTargets('grup');
}

// ---- Buat Broadcast ----
function refreshCreateForm() {
  const botSel = $('#jobBotSelect');
  const prevBot = botSel.value;
  botSel.innerHTML = state.bots.length
    ? state.bots.map((b) => `<option value="${b.id}">${esc(b.label)}${b.bot_username ? ' (@' + esc(b.bot_username) + ')' : ''}</option>`).join('')
    : '<option value="">(belum ada bot — tambah di tab Akun & Bot)</option>';
  if (prevBot) botSel.value = prevBot;

  const accSel = $('#jobAccountSelect');
  const prevAcc = accSel.value;
  const connected = state.accounts.filter((a) => a.status === 'connected');
  accSel.innerHTML = connected.length
    ? connected.map((a) => `<option value="${a.id}">${esc(a.label)}</option>`).join('')
    : '<option value="">(belum ada akun terhubung)</option>';
  if (prevAcc) accSel.value = prevAcc;
  updateSelectionCounts();
}

async function createAndRun() {
  const targetType = document.querySelector('input[name="targetType"]:checked').value;
  const ids = [...state.selected[targetType]];
  if (!ids.length) { toast(`Centang minimal satu target ${targetType} dulu di tab ${targetType === 'grup' ? 'Grup' : 'Japri'}.`); return; }

  const senderMode = document.querySelector('input[name="senderMode"]:checked').value;
  let bot_mode = 'auto';
  if (senderMode === 'personal') bot_mode = 'personal';
  if (senderMode === 'fixedbot') {
    const bid = Number($('#jobBotSelect').value);
    if (!bid) { toast('Pilih botnya dulu.'); return; }
    bot_mode = String(bid);
  }
  const accountId = Number($('#jobAccountSelect').value) || null;
  const message_text = $('#jobMessage').value.trim();
  if (!message_text) { toast('Tulis isi pesannya dulu.'); return; }

  let delayMin = Number($('#delayMin').value) || 0;
  let delayMax = Number($('#delayMax').value) || 0;
  if (delayMax < delayMin) [delayMin, delayMax] = [delayMax, delayMin];

  const payload = {
    name: $('#jobName').value.trim() || null,
    message_text,
    target_type: targetType,
    delay_min_sec: delayMin,
    delay_max_sec: delayMax,
    targetIds: ids,
    bot_mode,
    account_id: accountId,
  };
  const jobId = await call(() => window.broadtele.jobs.create(payload), 'Gagal membuat job');
  clearConsole();
  appendLine({ meta: true, ok: true, name: `Job #${jobId} dibuat (${ids.length} target ${targetType}, mode ${senderMode}). Mulai kirim...` });
  switchView('log');
  await call(() => window.broadtele.jobs.run(jobId), 'Gagal menjalankan job');
}

// ---- Log console ----
function clearConsole() { $('#console').innerHTML = ''; }

function appendLine(p) {
  const con = $('#console');
  const line = document.createElement('div');
  const cls = p.meta ? 'meta' : p.ok ? 'ok' : 'fail';
  line.className = `console-line ${cls}`;
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
  const icon = p.meta ? '•' : p.ok ? '✓' : '✗';
  const extra = p.willRetry ? ' (akan dicoba lagi)' : '';
  line.innerHTML = `<span class="t">${time}</span><span class="s">${icon}</span>`
    + `<span class="name">${esc(p.displayName || p.name || '')}</span>`
    + (p.error ? `<span class="err">${esc(p.error)}${extra}</span>` : '');
  con.appendChild(line);
  con.scrollTop = con.scrollHeight;
}

async function refreshJobs() {
  state.jobList = await call(() => window.broadtele.jobs.list(50), 'Gagal memuat riwayat');
  renderJobs();
}

function renderJobs() {
  const wrap = $('#riwayatWrap');
  const list = state.jobList;
  if (!list.length) { wrap.innerHTML = '<div class="empty-state">Belum ada job.</div>'; return; }
  wrap.innerHTML = `<table><thead><tr>
      <th>#</th><th>Nama</th><th>Jenis</th><th>Pengirim</th><th>Preview pesan</th>
      <th>Terkirim/gagal/sisa</th><th>Status</th><th>Dibuat</th>
    </tr></thead><tbody>
    ${list.map((j) => `
      <tr data-act="job-open" data-id="${j.id}" style="cursor:pointer">
        <td class="chat-id">${j.id}</td>
        <td><b>${esc(j.name || `(tanpa nama)`)}${state.expandedJobId === j.id ? ' ▾' : ' ▸'}</b></td>
        <td class="chat-id">${esc(j.target_type)}</td>
        <td class="chat-id">${esc(botModeLabel(j.bot_mode))}${j.account_label ? `<br>akun: ${esc(j.account_label)}` : ''}</td>
        <td class="chat-id">${esc(j.message_preview || '')}</td>
        <td class="chat-id">${j.sent ?? 0} / ${j.failed ?? 0} / ${j.pending ?? 0}</td>
        <td><span class="badge ${jobBadgeClass(j.status)}">${esc(j.status)}</span></td>
        <td class="chat-id">${esc((j.created_at || '').slice(0, 16))}</td>
      </tr>
      ${state.expandedJobId === j.id ? `<tr><td colspan="8" style="background:var(--panel-2)"><div id="jobDetail-${j.id}">Memuat...</div></td></tr>` : ''}
    `).join('')}
    </tbody></table>`;
  if (state.expandedJobId) renderJobDetails(state.expandedJobId);
}

function botModeLabel(mode) {
  if (/^\d+$/.test(String(mode))) {
    const b = state.bots.find((x) => x.id === Number(mode));
    return `bot tetap: ${b ? b.label : '#' + mode}`;
  }
  return mode === 'personal' ? 'selalu akun userbot' : 'otomatis';
}

function jobBadgeClass(status) {
  if (status === 'done') return 'bot';
  if (status === 'failed' || status === 'stopped') return 'personal';
  return 'both';
}

async function renderJobDetails(jobId) {
  const host = $(`#jobDetail-${jobId}`);
  if (!host) return;
  const details = await call(() => window.broadtele.jobs.details(jobId), 'Gagal memuat detail job');
  const job = state.jobList.find((j) => j.id === jobId);
  const pendingLeft = details.filter((d) => d.status === 'pending').length;
  host.innerHTML = `
    <table><thead><tr><th>#</th><th>Target</th><th>Metode</th><th>Pengirim</th><th>Status</th><th>Error</th></tr></thead><tbody>
      ${details.map((d) => `
        <tr>
          <td class="chat-id">${d.order_index + 1}</td>
          <td>${esc(d.display_name || d.chat_id)}</td>
          <td class="chat-id">${esc(d.method)}</td>
          <td class="chat-id">${d.method === 'bot' ? `🤖 ${esc(d.bot_label || d.bot_username || '#' + d.bot_token_id)}` : `👤 ${esc(d.account_label || '#' + d.account_id)}`}</td>
          <td><span class="badge ${jobBadgeClass(d.status === 'sent' ? 'done' : d.status === 'failed' ? 'failed' : d.status)}">${esc(d.status)}</span>${d.retry_count ? ` <span class="chat-id">retry ${d.retry_count}</span>` : ''}</td>
          <td class="chat-id" style="color:var(--red)">${esc(d.error_msg || '')}</td>
        </tr>`).join('')}
    </tbody></table>
    <div class="toolbar" style="margin-top:10px">
      ${pendingLeft ? `<button class="primary" data-act="job-run" data-id="${jobId}">Lanjutkan job (${pendingLeft} target tersisa)</button>` : ''}
      <button data-act="job-rerun" data-id="${jobId}">Kirim ulang SEMUA target (job baru)</button>
      <button class="ghost" data-act="job-close">Tutup</button>
    </div>
    ${job && ['running', 'paused'].includes(job.status) ? '<p class="selection-note">Job ini masih berstatus berjalan/jeda — kendalikan dari tab Log.</p>' : ''}`;
}

async function rerunJob(jobId) {
  const details = await call(() => window.broadtele.jobs.details(jobId), 'Gagal memuat detail');
  const targetIds = details.map((d) => d.target_id).filter((x) => x != null);
  if (!targetIds.length) { toast('Tidak ada target yang bisa dikirim ulang (mungkin sudah dihapus).'); return; }
  const newJobId = await call(() => window.broadtele.jobs.duplicate(jobId, targetIds), 'Gagal membuat job kirim ulang');
  clearConsole();
  appendLine({ meta: true, ok: true, name: `Job kirim ulang #${newJobId} dibuat (${targetIds.length} target). Mulai...` });
  switchView('log');
  await call(() => window.broadtele.jobs.run(newJobId), 'Gagal menjalankan');
}

// ---- Modal login (prompt dari main process) ----
let currentPrompt = null;

function openPrompt(data) {
  currentPrompt = data;
  $('#loginModalTitle').textContent = data.type === 'phoneNumber' ? 'Nomor HP'
    : data.type === 'phoneCode' ? 'Kode OTP Telegram' : 'Password 2FA';
  $('#loginModalDesc').textContent = data.label;
  const input = $('#loginModalInput');
  input.value = '';
  input.type = data.type === 'password' ? 'password' : 'text';
  $('#loginModal').classList.add('open');
  setTimeout(() => input.focus(), 50);
}

function closePrompt() {
  $('#loginModal').classList.remove('open');
  currentPrompt = null;
}

function submitPrompt() {
  if (!currentPrompt) return;
  const value = $('#loginModalInput').value;
  window.broadtele.userbot.respondPrompt(currentPrompt.requestId, value);
  closePrompt();
}

function cancelPrompt() {
  if (!currentPrompt) return;
  window.broadtele.userbot.respondPrompt(currentPrompt.requestId, { __cancelled: true });
  closePrompt();
}

// ---- Refresh gabungan ----
async function refreshAll() {
  await refreshAccountsAndBots();
  await Promise.all([refreshTargets('grup'), refreshTargets('japri')]);
}

// ---- Event wiring ----
function bindEvents() {
  $$('.nav-item').forEach((n) => n.addEventListener('click', () => switchView(n.dataset.view)));

  $('#saveConfigBtn').addEventListener('click', () => call(saveConfig).catch(() => {}));
  $$('.toggle-visibility').forEach((btn) => btn.addEventListener('click', () => {
    const inp = $(`#${btn.dataset.target}`);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Sembunyikan' : 'Tampilkan';
  }));

  $('#addAccountBtn').addEventListener('click', () => call(addAccount).catch(() => {}));
  $('#addBotBtn').addEventListener('click', () => call(addBot).catch(() => {}));

  $('#syncBtn').addEventListener('click', () => call(syncUserbotDialogs).catch(() => {}));
  $('#syncBotMembershipBtn').addEventListener('click', () => call(syncBotMembership).catch(() => {}));

  $('#createRunBtn').addEventListener('click', () => call(createAndRun).catch(() => {}));
  $$('input[name="targetType"]').forEach((r) => r.addEventListener('change', updateSelectionCounts));

  $('#pauseBtn').addEventListener('click', async () => {
    if (state.activeJobId) await call(() => window.broadtele.jobs.pause(state.activeJobId), 'Gagal menjeda');
  });
  $('#stopBtn').addEventListener('click', async () => {
    if (state.activeJobId) await call(() => window.broadtele.jobs.stop(state.activeJobId), 'Gagal menghentikan');
  });

  $('#loginModalSubmit').addEventListener('click', submitPrompt);
  $('#loginModalCancel').addEventListener('click', cancelPrompt);
  $('#loginModalInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPrompt();
    if (e.key === 'Escape') cancelPrompt();
  });

  // Delegasi klik/ubah untuk tabel yang dirender ulang terus-menerus
  document.body.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const { act, id, type } = el.dataset;
    const nid = Number(id);
    switch (act) {
      case 'acc-remove': call(() => removeAccount(nid)).catch(() => {}); break;
      case 'acc-rename': call(() => renameAccount(nid)).catch(() => {}); break;
      case 'acc-logout': call(() => logoutAccount(nid)).catch(() => {}); break;
      case 'acc-login': call(() => loginAgain(nid)).catch(() => {}); break;
      case 'bot-remove': call(() => removeBot(nid)).catch(() => {}); break;
      case 'tgt-del': call(() => deleteTarget(type, nid)).catch(() => {}); break;
      case 'job-open': state.expandedJobId = state.expandedJobId === nid ? null : nid; renderJobs(); break;
      case 'job-close': state.expandedJobId = null; renderJobs(); break;
      case 'job-run':
        clearConsole();
        appendLine({ meta: true, ok: true, name: `Melanjutkan job #${nid}...` });
        switchView('log');
        call(() => window.broadtele.jobs.run(nid), 'Gagal menjalankan').catch(() => {});
        break;
      case 'job-rerun': call(() => rerunJob(nid)).catch(() => {}); break;
      default: break;
    }
  });

  document.body.addEventListener('change', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const { act, id, type } = el.dataset;
    const nid = Number(id);
    if (act === 'tgt-select') call(() => toggleSelect(type, nid, el.checked)).catch(() => {});
    else if (act === 'tgt-biz') call(() => setBusinessFlag(nid, el.checked)).catch(() => {});
    else if (act === 'bot-polling') call(() => setBotPolling(nid, el.checked)).catch(() => {});
    else if (el.id?.startsWith('checkAll_')) call(() => selectAll(el.id.split('_')[1], el.checked)).catch(() => {});
  });

  // Radio "Pakai satu bot pilihan" → aktifkan select-nya
  $$('input[name="senderMode"]').forEach((r) => r.addEventListener('change', () => {
    $('#jobBotSelect').disabled = document.querySelector('input[name="senderMode"]:checked').value !== 'fixedbot';
  }));
  $('#jobBotSelect').disabled = true;
}

// ---- Listener dari main process ----
function bindIpcListeners() {
  window.broadtele.jobs.onProgress((p) => {
    if (p.jobId) state.activeJobId = p.jobId;
    appendLine(p);
    if (p.summary) {
      state.expandedJobId = null;
      refreshJobs().catch(() => {});
      refreshTargets('grup').catch(() => {});
      refreshTargets('japri').catch(() => {});
    }
  });

  window.broadtele.status.onUpdate((data) => {
    renderStatusPills(data);
    // sinkronkan cache lokal supaya dropdown sync & form buat job selalu fresh
    if (Array.isArray(data.accounts)) {
      state.accounts = data.accounts.map((a) => ({ ...state.accounts.find((x) => x.id === a.id), ...a }));
    }
    if (Array.isArray(data.bots)) {
      state.bots = data.bots.map((b) => ({ ...state.bots.find((x) => x.id === b.id), ...b }));
    }
    if (state.view === 'akunbot') { renderAccountsTable(); renderBotsTable(); }
    if (state.view === 'grup') fillSyncSelectors();
    if (state.view === 'buat') refreshCreateForm();
  });

  window.broadtele.status.onAccountStatus(({ accountId, status }) => {
    const a = state.accounts.find((x) => x.id === accountId);
    if (a) a.status = status;
    renderAccountsTable();
  });

  window.broadtele.userbot.onPrompt((data) => openPrompt(data));
}

// ---- Boot ----
(async function init() {
  bindEvents();
  bindIpcListeners();
  await loadConfig().catch(() => {});
  try {
    const s = await window.broadtele.status.getAll();
    renderStatusPills(s);
  } catch { /* main process belum siap — event status:update akan menyusul */ }
  await refreshAll().catch(() => {});
})();
