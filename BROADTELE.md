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
- [x] Orang yang pernah chat ke bot (private message masuk) otomatis tercatat sebagai kandidat target Japri "prospek khusus" (tabel `bot_contacts`)
- [x] Randomisasi **urutan target** (Fisher-Yates shuffle) tiap job dijalankan
- [x] Randomisasi **interval** (delay dengan jitter, bukan fixed) untuk hindari pola yang gampang kena flood-wait/rate-limit
- [x] Eksekusi broadcast **sekuensial**, bukan paralel (paralel = red flag buat rate limiter Telegram)
- [x] Wajib hormati `FLOOD_WAIT` dari Telegram API (tunggu sesuai durasi yang diminta, jangan diabaikan)
- [x] Session userbot & token bot disimpan **encrypted** (bukan plain text)

## Struktur Database (SQLite — `better-sqlite3`)
Lihat `src/db/schema.sql` untuk definisi lengkap.

- `targets` — semua target (grup & personal), kolom `source` (bot/personal/both), `bot_can_send`
- `broadcast_jobs` — satu job = satu pesan + satu target_type (grup/japri) + delay range
- `broadcast_job_targets` — target per job, `order_index` di-shuffle saat job dibuat/dijalankan, status per target
- `bot_contacts` — orang yang pernah DM bot (auto-populated dari `bot.js` listener)

## Struktur Project
```
Broadtele/
├── BROADTELE.md          <- dokumen ini
├── README.md
├── package.json
├── .env.example
├── .gitignore
├── src/
│   ├── main.js            <- Electron main process + IPC handlers
│   ├── preload.js
│   ├── db/
│   │   ├── schema.sql
│   │   └── db.js          <- koneksi + helper query
│   ├── telegram/
│   │   ├── userbot.js      <- GramJS wrapper (getDialogs, sendMessage, flood-wait handling)
│   │   └── bot.js          <- node-telegram-bot-api wrapper (listen contacts, sendMessage)
│   ├── broadcast/
│   │   ├── shuffle.js      <- Fisher-Yates
│   │   ├── delay.js        <- randomDelay + sleep
│   │   └── queue.js        <- orkestrasi job: shuffle -> loop -> pilih method -> kirim -> retry flood-wait
│   └── renderer/
│       └── index.html      <- UI dasar (placeholder, belum final)
```

## Status Saat Ini
- [x] Scaffold project awal dibuat (schema, userbot wrapper, bot wrapper, shuffle, delay, queue skeleton, main process dasar)
- [ ] UI renderer (list target dengan checkbox, form job, log realtime) — **belum dibuat, masih placeholder**
- [ ] Login flow userbot (input nomor HP + OTP + 2FA password) di UI — belum
- [ ] Setup BotFather token input di UI — belum
- [ ] Testing flow end-to-end (bot invite ke grup test, userbot login, kirim job kecil) — belum
- [ ] Encryption untuk session string & bot token (rencana pakai `keytar` atau `electron-store` dengan encryptionKey) — belum diimplementasi, saat ini masih baca dari `.env` untuk development

## Yang Perlu Diputuskan/Dikerjakan Berikutnya
1. UI: bikin tampilan list target (grup + japri terpisah tab) dengan checkbox pilih target per job
2. Login userbot: alur input nomor HP → kode OTP dari Telegram → (opsional 2FA password) → simpan session string
3. Tandai target `is_business_relation` di UI supaya gampang filter grup relasi bisnis vs grup pribadi
4. Rencana retry/backoff kalau `sendMessage` gagal selain FLOOD_WAIT (misal target keluar grup, blokir bot, dll) — saat ini baru dicatat sebagai `error` status, belum ada retry otomatis

## Catatan Keamanan (penting, jangan dihapus)
- Randomisasi delay & urutan di sini tujuannya **menghindari rate-limit teknis (flood-wait)**, bukan untuk sengaja melewati aturan anti-spam admin grup. Broadtele dipakai untuk grup sendiri & relasi bisnis yang sudah setuju menerima update.
- Jangan commit `.env` atau file session ke Git — sudah ada di `.gitignore`.
