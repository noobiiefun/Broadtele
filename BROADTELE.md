# BROADTELE.md — Progress Tracker

> Dokumen ini dibaca ulang setiap sesi AI baru untuk melanjutkan development. Update tiap ada perubahan arsitektur/keputusan penting.

## Tujuan Aplikasi
Electron app untuk broadcast pesan Telegram ke:
1. **Grup** — grup milik sendiri & grup relasi bisnis (reseller pulsa/PPOB dll)
2. **Japri (DM personal)** — kontak bisnis + orang yang pernah chat ke bot (prospek)

Dua metode pengiriman dengan fallback otomatis:
- **Bot API** (resmi, dipakai kalau bot sudah di-invite/di-chat dan punya izin kirim)
- **Userbot (akun pribadi via GramJS/MTProto)** — fallback kalau bot tidak bisa jalan di target tsb

## Keputusan Desain (sudah disepakati)
- [x] Hybrid: cek dulu apakah target bisa dilayani Bot API, kalau tidak fallback ke userbot
- [x] Grup dan Japri **dipisah** — job, daftar target, dan setting delay berbeda
- [x] Japri delay harus **lebih lama** dari grup (default grup 8–25s, japri 30–90s, keduanya bisa diubah di UI)
- [x] Orang yang pernah chat ke bot otomatis tercatat sebagai kandidat target Japri "prospek khusus" (tabel `bot_contacts`)
- [x] Randomisasi **urutan target** (Fisher-Yates shuffle) tiap job dijalankan
- [x] Randomisasi **interval** (delay dengan jitter, bukan fixed) untuk hindari pola yang gampang kena flood-wait/rate-limit
- [x] Eksekusi broadcast **sekuensial**, bukan paralel
- [x] Wajib hormati `FLOOD_WAIT` dari Telegram API (tunggu sesuai durasi yang diminta, jangan diabaikan)
- [x] Login userbot lewat **dialog di UI** (nomor HP → OTP → password 2FA opsional), bukan prompt CLI
- [x] Session userbot disimpan otomatis ke file lokal `.broadtele-session` (git-ignored) setelah login sukses — tidak perlu edit `.env` manual

## Struktur Database (SQLite — `better-sqlite3`)
Lihat `src/db/schema.sql` untuk definisi lengkap.

- `targets` — semua target (grup & personal), kolom `source` (bot/personal/both), `bot_can_send`, `is_business_relation`
- `broadcast_jobs` — satu job = satu pesan + satu target_type (grup/japri) + delay range
- `broadcast_job_targets` — target per job, `order_index` di-shuffle saat job dijalankan, status per target
- `bot_contacts` — orang yang pernah DM bot (auto-populated dari `bot.js` listener)

## Struktur Project
```
Broadtele/
├── BROADTELE.md          <- dokumen ini (tracker progres)
├── README.md
├── SETUP.md               <- panduan setup step-by-step dari nol
├── TROUBLESHOOTING.md      <- solusi error umum
├── package.json
├── .env.example
├── .gitignore
├── src/
│   ├── main.js             <- Electron main process, semua IPC handler, prompt login via UI
│   ├── preload.js
│   ├── config/
│   │   └── sessionStore.js <- simpan/baca session string userbot dari file lokal
│   ├── db/
│   │   ├── schema.sql
│   │   └── db.js
│   ├── telegram/
│   │   ├── userbot.js      <- GramJS wrapper (login via prompts, getDialogs, sendMessage, flood-wait)
│   │   └── bot.js          <- node-telegram-bot-api wrapper (auto-catat grup & bot_contacts, sendMessage)
│   ├── broadcast/
│   │   ├── shuffle.js
│   │   ├── delay.js
│   │   └── queue.js
│   └── renderer/
│       ├── index.html      <- UI: sidebar (Grup/Japri/Buat Broadcast/Log), modal login
│       ├── style.css       <- tema "dispatch console" gelap, aksen mint/amber
│       └── app.js           <- semua logic UI (vanilla JS, tanpa framework/build step)
```

## Status Saat Ini
- [x] Scaffold project awal (schema, userbot wrapper, bot wrapper, shuffle, delay, queue)
- [x] **UI selesai** — tab Grup, Japri, Buat Broadcast, Log Pengiriman; tabel target dengan checkbox pilih & toggle relasi bisnis; form job dengan default delay otomatis sesuai tipe target; console log realtime dengan status per target
- [x] Login userbot lewat UI (modal dialog nomor HP/OTP/password), session tersimpan otomatis
- [x] Dokumentasi setup (`SETUP.md`) dan troubleshooting (`TROUBLESHOOTING.md`)
- [ ] Encryption untuk `.broadtele-session` dan `TG_BOT_TOKEN` — **masih plain text**, rencana pakai `keytar` (OS credential manager)
- [ ] Retry otomatis untuk error selain FLOOD_WAIT (target keluar grup, blokir bot, dll) — saat ini cuma dicatat sebagai `failed`, tidak retry
- [ ] Riwayat job (daftar job lama + hasil per target) — saat ini log hanya menampilkan job yang sedang/terakhir jalan, belum ada tab riwayat
- [ ] Tombol hapus/nonaktifkan target langsung dari UI (saat ini harus manual lewat database kalau ada duplikat, lihat `TROUBLESHOOTING.md`)
- [ ] Edit pesan/target sebelum broadcast ulang (duplicate job) — belum ada

## Yang Perlu Diputuskan/Dikerjakan Berikutnya
1. Enkripsi session & token (prioritas keamanan sebelum dipakai produksi jangka panjang)
2. Tab riwayat job (list semua `broadcast_jobs` + expand lihat per-target statusnya)
3. Retry/backoff untuk error non-flood-wait
4. Pertimbangkan batas `getDialogs({ limit: 500 })` di `userbot.js` kalau akun mengikuti sangat banyak grup

## Catatan Keamanan (penting, jangan dihapus)
- Randomisasi delay & urutan tujuannya **menghindari rate-limit teknis (flood-wait)**, bukan untuk sengaja melewati aturan anti-spam admin grup. Broadtele dipakai untuk grup sendiri & relasi bisnis yang sudah setuju menerima update.
- Jangan commit `.env` atau `.broadtele-session` ke Git — sudah ada di `.gitignore`.
