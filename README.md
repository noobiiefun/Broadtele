# Broadtele

Aplikasi desktop (Electron) untuk broadcast pesan Telegram ke grup & DM personal dengan pendekatan hybrid: **Bot API** (kalau memungkinkan) dengan fallback ke **userbot** (akun pribadi via MTProto/GramJS).

Dibuat untuk mengelola broadcast ke grup sendiri & grup relasi bisnis (reseller pulsa/PPOB), dan penawaran khusus lewat DM ke kontak bisnis maupun prospek yang pernah chat ke bot.

## Fitur Utama
- **Deteksi target otomatis**: daftar grup yang diikuti akun pribadi (`getDialogs` via GramJS) digabung dengan grup/kontak yang dikenal bot
- **Hybrid sending**: pakai Bot API kalau bot ada & punya izin kirim di target itu, kalau tidak fallback ke userbot
- **Grup vs Japri terpisah**: job, daftar target, dan pengaturan delay dibedakan antara broadcast grup dan DM personal (japri delay lebih lama)
- **Prospek dari bot**: siapa pun yang pernah chat ke bot otomatis tercatat sebagai kandidat target Japri
- **Randomisasi urutan** (Fisher-Yates shuffle) tiap job dijalankan
- **Randomisasi delay** (jitter, bukan interval tetap) untuk menghindari flood-wait/rate-limit
- **Eksekusi sekuensial** dengan penanganan `FLOOD_WAIT` sesuai aturan resmi Telegram

## Stack
- Electron
- [GramJS](https://github.com/gram-js/gramjs) — userbot / MTProto client
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) — Bot API
- better-sqlite3 — penyimpanan target & job

## Setup Cepat
```bash
npm install
npm start
```
Tidak ada file `.env` yang perlu diisi manual. Semua kredensial (API ID, API Hash, Bot Token) diisi lewat tab **Pengaturan** di dalam aplikasi saat pertama kali jalan, dan tersimpan otomatis di folder data aplikasi milik OS (bukan di folder project, jadi aman kalau project di-share/di-commit ke Git).

**Panduan lengkap step-by-step (disarankan untuk setup pertama kali):** [`SETUP.md`](./SETUP.md)
**Kalau ada error:** [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)

## Tampilan
Aplikasi punya 5 tab:
- **Pengaturan** — isi API ID, API Hash (dari my.telegram.org), dan Bot Token (dari @BotFather, opsional)
- **Grup** — daftar grup (dari sync akun pribadi dan/atau tempat bot berada), centang untuk jadi target broadcast, toggle "relasi bisnis"
- **Japri** — daftar kontak personal, termasuk yang otomatis masuk karena pernah chat ke bot
- **Buat Broadcast** — pilih tipe target, tulis pesan, atur jeda min/max, jalankan
- **Log Pengiriman** — progres realtime per target, tombol jeda/hentikan job

## Status Development
Lihat [`BROADTELE.md`](./BROADTELE.md) untuk tracker progres & keputusan desain lengkap.

## Peringatan Penggunaan
Tool ini dibuat untuk broadcast ke grup/kontak milik sendiri atau relasi bisnis yang sudah setuju menerima pesan. Fitur randomisasi delay & urutan ditujukan untuk menghindari rate-limit teknis dari Telegram, bukan untuk melewati aturan anti-spam grup pihak lain. Gunakan secara bertanggung jawab — penyalahgunaan userbot untuk spam massal berisiko akun kena restrict/banned oleh Telegram.
