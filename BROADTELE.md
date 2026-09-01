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
- [x] **Tidak ada `.env` sama sekali.** API ID, API Hash, dan Bot Token diisi lewat tab **Pengaturan** di aplikasi, disimpan di folder data aplikasi milik OS (`app.getPath('userData')`) lewat `configStore.js` — bukan di folder project, supaya aman kalau project di-zip/dicommit ke Git
- [x] Session userbot juga disimpan di folder `userData` yang sama (`sessionStore.js`), bukan lagi file lokal di root project

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
├── .gitignore
├── src/
│   ├── main.js             <- Electron main process, semua IPC handler (termasuk config get/save)
│   ├── preload.js
│   ├── config/
│   │   ├── configStore.js  <- simpan/baca API ID, API Hash, Bot Token dari folder userData
│   │   └── sessionStore.js <- simpan/baca session string userbot dari folder userData
│   ├── db/
│   │   ├── schema.sql
│   │   └── db.js
│   ├── telegram/
│   │   ├── userbot.js      <- GramJS wrapper. Kredensial di-set via setCredentials(), bukan process.env
│   │   └── bot.js          <- node-telegram-bot-api wrapper, bisa stopBot() lalu initBot() ulang kalau token diganti dari Pengaturan
│   ├── broadcast/
│   │   ├── shuffle.js
│   │   ├── delay.js
│   │   └── queue.js
│   └── renderer/
│       ├── index.html      <- UI: sidebar (Pengaturan/Grup/Japri/Buat Broadcast/Log), modal login
│       ├── style.css       <- tema "dispatch console" gelap, aksen mint/amber
│       └── app.js           <- semua logic UI (vanilla JS, tanpa framework/build step)
```

## Status Saat Ini
- [x] Scaffold project awal (schema, userbot wrapper, bot wrapper, shuffle, delay, queue)
- [x] UI selesai — tab Pengaturan, Grup, Japri, Buat Broadcast, Log Pengiriman
- [x] Login userbot lewat UI (modal dialog nomor HP/OTP/password), session tersimpan otomatis
- [x] **Kredensial (API ID/Hash/Bot Token) sekarang diisi & disimpan lewat tab Pengaturan di aplikasi — `.env` sudah dihapus total dari project**
- [x] Dokumentasi setup (`SETUP.md`) dan troubleshooting (`TROUBLESHOOTING.md`) sudah disesuaikan dengan alur tanpa `.env`
- [x] **Bugfix**: status userbot sekarang di-push realtime dari main process ('connecting'/'connected'/'disconnected') alih-alih cuma dicek sekali saat halaman dibuka — memperbaiki bug di mana reconnect dari sesi tersimpan masih diproses di background tapi UI sudah kadung nampilin "belum login", yang bisa memicu user klik Login lagi dan menimpa sesi yang sedang nyambung. Tombol "Login Userbot" otomatis di-disable selama status 'connecting'/'connected'
- [x] **Bugfix**: modal login (nomor HP/OTP/password) sekarang punya tombol "Batal" yang benar-benar membatalkan proses `client.start()` di GramJS, bukan cuma nutup modal doang
- [ ] Encryption untuk file config & session di folder `userData` — **masih plain text/JSON**, rencana pakai `keytar` (OS credential manager)
- [ ] Retry otomatis untuk error selain FLOOD_WAIT (target keluar grup, blokir bot, dll) — saat ini cuma dicatat sebagai `failed`, tidak retry
- [ ] Riwayat job (daftar job lama + hasil per target) — saat ini log hanya menampilkan job yang sedang/terakhir jalan, belum ada tab riwayat
- [ ] Tombol hapus/nonaktifkan target langsung dari UI (saat ini harus manual lewat database kalau ada duplikat, lihat `TROUBLESHOOTING.md`)
- [ ] Edit pesan/target sebelum broadcast ulang (duplicate job) — belum ada

## Yang Perlu Diputuskan/Dikerjakan Berikutnya
1. Enkripsi config & session (prioritas keamanan sebelum dipakai produksi jangka panjang)
2. Tab riwayat job (list semua `broadcast_jobs` + expand lihat per-target statusnya)
3. Retry/backoff untuk error non-flood-wait
4. Pertimbangkan batas `getDialogs({ limit: 500 })` di `userbot.js` kalau akun mengikuti sangat banyak grup

## Catatan Keamanan (penting, jangan dihapus)
- Randomisasi delay & urutan tujuannya **menghindari rate-limit teknis (flood-wait)**, bukan untuk sengaja melewati aturan anti-spam admin grup. Broadtele dipakai untuk grup sendiri & relasi bisnis yang sudah setuju menerima update.
- Config (`broadtele-config.json`) dan session (`broadtele-session.txt`) disimpan di folder `userData` milik OS (bukan folder project), jadi otomatis tidak ikut ter-share/commit — tapi tetap plain text di disk lokal, belum dienkripsi.
