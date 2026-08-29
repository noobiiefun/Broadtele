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

## Setup
```bash
npm install
cp .env.example .env
# isi .env: TG_API_ID, TG_API_HASH (dari my.telegram.org), TG_BOT_TOKEN (dari @BotFather)
npm start
```

Login userbot (input nomor HP + OTP) dilakukan lewat UI saat pertama kali jalan — session string disimpan lokal setelah itu.

## Status Development
Lihat [`BROADTELE.md`](./BROADTELE.md) untuk tracker progres & keputusan desain lengkap.

## Peringatan Penggunaan
Tool ini dibuat untuk broadcast ke grup/kontak milik sendiri atau relasi bisnis yang sudah setuju menerima pesan. Fitur randomisasi delay & urutan ditujukan untuk menghindari rate-limit teknis dari Telegram, bukan untuk melewati aturan anti-spam grup pihak lain. Gunakan secara bertanggung jawab — penyalahgunaan userbot untuk spam massal berisiko akun kena restrict/banned oleh Telegram.
