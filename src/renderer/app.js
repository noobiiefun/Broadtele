// Broadtele — renderer logic (vanilla JS, tidak ada build step)

const state = {
  selected: { grup: new Set(), japri: new Set() },
  targetsCache: { grup: [], japri: [] },
  lastJobId: null,
};

// ---------------- Pengaturan (config API ID/Hash/Bot Token) ----------------
async function loadConfigIntoForm() {
  try {
    const cfg = await window.broadtele.config.get();
    document.getElementById('cfgApiId').value = cfg.apiId || '';
    document.getElementById('cfgApiHash').value = cfg.apiHash || '';
    document.getElementById('cfgBotToken').value = cfg.botToken || '';
  } catch (err) {
    toast(`Gagal memuat pengaturan: ${err.message}`);
  }
}

document.getElementById('saveConfigBtn').addEventListener('click', async () => {
  const apiId = document.getElementById('cfgApiId').value.trim();
  const apiHash = document.getElementById('cfgApiHash').value.trim();
  const botToken = document.getElementById('cfgBotToken').value.trim();

  if (!apiId || !apiHash) return toast('API ID dan API Hash wajib diisi.');

  const btn = document.getElementById('saveConfigBtn');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';
  try {
    await window.broadtele.config.save({ apiId, apiHash, botToken });
    toast('Pengaturan tersimpan.');
    await refreshUserbotStatus();
  } catch (err) {
    toast(`Gagal menyimpan pengaturan: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan Pengaturan';
  }
});

document.querySelectorAll('.toggle-visibility').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? 'Tampilkan' : 'Sembunyikan';
  });
});

// ---------------- Navigasi tab ----------------
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((i) => i.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`view-${item.dataset.view}`).classList.add('active');
    if (item.dataset.view === 'grup') loadTargets('grup');
    if (item.dataset.view === 'japri') loadTargets('japri');
    if (item.dataset.view === 'buat') updateSelectionCounts();
  });
});

// ---------------- Toast sederhana untuk error ----------------
function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// ---------------- Render tabel target (dipakai untuk grup & japri) ----------------
function renderTargetsTable(type) {
  const wrap = document.getElementById(type === 'grup' ? 'grupTableWrap' : 'japriTableWrap');
  const list = state.targetsCache[type];
  document.getElementById(type === 'grup' ? 'grupCount' : 'japriCount').textContent = `${list.length} target`;

  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state">Belum ada target ${type}.${type === 'grup' ? ' Klik "Sync dari Akun Pribadi" atau tunggu bot dimasukkan ke grup.' : ' Akan terisi otomatis begitu ada yang chat ke bot, atau sync dari akun pribadi.'}</div>`;
    return;
  }

  const rows = list.map((t) => {
    const checked = state.selected[type].has(t.id) ? 'checked' : '';
    const relChecked = t.is_business_relation ? 'checked' : '';
    return `
      <tr data-id="${t.id}">
        <td><input type="checkbox" class="row-check" ${checked} /></td>
        <td>${escapeHtml(t.display_name || '(tanpa nama)')}${t.username ? `<br><span class="chat-id">@${escapeHtml(t.username)}</span>` : ''}</td>
        <td class="chat-id">${escapeHtml(t.chat_id)}</td>
        <td><span class="badge ${t.source}">${t.source}</span></td>
        <td><span class="badge ${t.bot_can_send ? 'bot' : ''}">${t.bot_can_send ? 'ya' : 'tidak'}</span></td>
        <td><input type="checkbox" class="rel-check" ${relChecked} /></td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th></th><th>Nama</th><th>Chat ID</th><th>Sumber</th><th>Bot bisa kirim</th><th>Relasi bisnis</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  wrap.querySelectorAll('.row-check').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const id = Number(e.target.closest('tr').dataset.id);
      if (e.target.checked) state.selected[type].add(id);
      else state.selected[type].delete(id);
      updateSelectionCounts();
    });
  });

  wrap.querySelectorAll('.rel-check').forEach((cb) => {
    cb.addEventListener('change', async (e) => {
      const id = Number(e.target.closest('tr').dataset.id);
      try {
        await window.broadtele.targets.setFlag(id, 'is_business_relation', e.target.checked);
      } catch (err) {
        toast(`Gagal update relasi bisnis: ${err.message}`);
      }
    });
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadTargets(type) {
  try {
    state.targetsCache[type] = await window.broadtele.targets.list(type);
    renderTargetsTable(type);
  } catch (err) {
    toast(`Gagal memuat target ${type}: ${err.message}`);
  }
}

function updateSelectionCounts() {
  document.getElementById('selCountGrup').textContent = state.selected.grup.size;
  document.getElementById('selCountJapri').textContent = state.selected.japri.size;
}

document.getElementById('syncBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true;
  btn.textContent = 'Menyinkronkan...';
  try {
    await window.broadtele.targets.syncUserbotDialogs();
    await loadTargets('grup');
    await loadTargets('japri');
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync dari Akun Pribadi';
  }
});

// ---------------- Default jeda per tipe target ----------------
document.querySelectorAll('input[name="targetType"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    if (e.target.value === 'japri') {
      document.getElementById('delayMin').value = 30;
      document.getElementById('delayMax').value = 90;
    } else {
      document.getElementById('delayMin').value = 8;
      document.getElementById('delayMax').value = 25;
    }
  });
});

// ---------------- Buat & jalankan job ----------------
document.getElementById('createRunBtn').addEventListener('click', async () => {
  const targetType = document.querySelector('input[name="targetType"]:checked').value;
  const targetIds = Array.from(state.selected[targetType]);
  const message = document.getElementById('jobMessage').value.trim();
  const delayMin = Number(document.getElementById('delayMin').value);
  const delayMax = Number(document.getElementById('delayMax').value);
  const name = document.getElementById('jobName').value.trim() || null;

  if (!targetIds.length) return toast(`Belum ada target ${targetType} yang dicentang.`);
  if (!message) return toast('Isi pesan tidak boleh kosong.');
  if (delayMax < delayMin) return toast('Jeda maksimum harus >= jeda minimum.');

  const btn = document.getElementById('createRunBtn');
  btn.disabled = true;
  try {
    const jobId = await window.broadtele.jobs.create({
      name, message_text: message, target_type: targetType,
      delay_min_sec: delayMin, delay_max_sec: delayMax, targetIds,
    });
    state.lastJobId = jobId;
    clearConsole();
    logLine({ ok: true, name: `Job #${jobId} dibuat — ${targetIds.length} target (${targetType}), mulai mengirim...` , meta: true });
    await window.broadtele.jobs.run(jobId);
    document.querySelector('.nav-item[data-view="log"]').click();
  } catch (err) {
    toast(`Gagal membuat/menjalankan job: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ---------------- Log console ----------------
function clearConsole() {
  document.getElementById('console').innerHTML = '';
}

function logLine({ ok, name, error, meta }) {
  const el = document.createElement('div');
  el.className = `console-line ${meta ? '' : ok ? 'ok' : 'fail'}`;
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
  el.innerHTML = `
    <span class="t">${time}</span>
    <span class="s">${meta ? '·' : ok ? '✔' : '✘'}</span>
    <span class="name">${escapeHtml(name || '')}</span>
    ${error ? `<span class="err">— ${escapeHtml(error)}</span>` : ''}
  `;
  const consoleEl = document.getElementById('console');
  consoleEl.appendChild(el);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

window.broadtele.jobs.onProgress((progress) => {
  if (progress.fatal) {
    logLine({ ok: false, name: 'Job dihentikan karena error', error: progress.error, meta: false });
    return;
  }
  logLine({ ok: progress.ok, name: progress.displayName || progress.targetId, error: progress.error });
});

document.getElementById('pauseBtn').addEventListener('click', async () => {
  if (!state.lastJobId) return toast('Belum ada job yang berjalan.');
  await window.broadtele.jobs.pause(state.lastJobId);
  logLine({ ok: true, name: 'Job dijeda.', meta: true });
});

document.getElementById('stopBtn').addEventListener('click', async () => {
  if (!state.lastJobId) return toast('Belum ada job yang berjalan.');
  await window.broadtele.jobs.stop(state.lastJobId);
  logLine({ ok: true, name: 'Job dihentikan.', meta: true });
});

// ---------------- Status userbot & login modal ----------------
function updateBotPill(botActive) {
  const botPill = document.getElementById('botStatusPill');
  botPill.classList.toggle('connected', !!botActive);
  botPill.innerHTML = `<span class="dot"></span> Bot: ${botActive ? 'aktif' : 'belum aktif'}`;
}

/**
 * status: 'connecting' | 'connected' | 'disconnected'.
 * Tombol Login sengaja di-disable selama 'connecting' supaya tidak ada yang
 * klik ulang dan bikin proses reconnect yang sedang jalan malah ketimpa sesi baru
 * (ini akar bug "sesi kelihatan putus" yang dilaporkan sebelumnya).
 */
function applyUserbotStatus(status) {
  const pill = document.getElementById('userbotStatusPill');
  const loginBtn = document.getElementById('loginBtn');
  pill.classList.remove('connected', 'connecting');

  if (status === 'connected') {
    pill.classList.add('connected');
    pill.innerHTML = `<span class="dot"></span> Userbot: terhubung`;
    loginBtn.disabled = true;
    loginBtn.textContent = 'Login Userbot';
  } else if (status === 'connecting') {
    pill.classList.add('connecting');
    pill.innerHTML = `<span class="dot"></span> Userbot: menyambungkan...`;
    loginBtn.disabled = true;
    loginBtn.textContent = 'Menyambungkan...';
  } else {
    pill.innerHTML = `<span class="dot"></span> Userbot: belum login`;
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login Userbot';
  }
}

// Dipanggil sekali saat aplikasi baru dibuka, sebelum event push dari main.js sempat sampai.
async function refreshUserbotStatus() {
  try {
    const { connected, botActive } = await window.broadtele.userbot.status();
    applyUserbotStatus(connected ? 'connected' : 'disconnected');
    updateBotPill(botActive);
  } catch (err) {
    toast(`Gagal cek status: ${err.message}`);
  }
}

// Update realtime dari main.js — ini yang bikin status selalu akurat walau proses
// reconnect di background butuh waktu beberapa detik.
window.broadtele.userbot.onStatusUpdate(({ status, botActive }) => {
  applyUserbotStatus(status);
  updateBotPill(botActive);
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  try {
    await window.broadtele.userbot.login();
    toast('Login userbot berhasil.');
  } catch (err) {
    toast(`Login gagal: ${err.message}`);
    btn.disabled = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await window.broadtele.userbot.logout();
  toast('Sesi userbot dihapus. Klik "Login Userbot" untuk login ulang.');
});

// Modal prompt (dipicu dari main.js saat proses login butuh nomor HP / OTP / password 2FA)
const modal = document.getElementById('loginModal');
const modalInput = document.getElementById('loginModalInput');
window.broadtele.userbot.onPrompt(({ requestId, type, label }) => {
  document.getElementById('loginModalTitle').textContent =
    type === 'phoneNumber' ? 'Nomor HP' : type === 'phoneCode' ? 'Kode OTP' : 'Password 2FA';
  document.getElementById('loginModalDesc').textContent = label;
  modalInput.type = type === 'password' ? 'password' : 'text';
  modalInput.value = '';
  modal.classList.add('open');
  modalInput.focus();

  const submitBtn = document.getElementById('loginModalSubmit');
  const cancelBtn = document.getElementById('loginModalCancel');

  const cleanup = () => {
    submitBtn.removeEventListener('click', submit);
    cancelBtn.removeEventListener('click', cancel);
    modalInput.removeEventListener('keydown', onKeydown);
  };
  const submit = () => {
    window.broadtele.userbot.respondPrompt(requestId, modalInput.value);
    modal.classList.remove('open');
    cleanup();
  };
  const cancel = () => {
    // Kirim penanda khusus — main.js akan mengubah ini jadi pembatalan proses login,
    // bukan dianggap sebagai jawaban kosong.
    window.broadtele.userbot.respondPrompt(requestId, { __cancelled: true });
    modal.classList.remove('open');
    cleanup();
  };
  const onKeydown = (e) => { if (e.key === 'Enter') submit(); };

  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', cancel);
  modalInput.addEventListener('keydown', onKeydown);
});

// ---------------- Init ----------------
loadConfigIntoForm();
loadTargets('grup');
loadTargets('japri');
refreshUserbotStatus();
