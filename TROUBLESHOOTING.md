# TROUBLESHOOTING.md

## "Prompt nomor HP tidak tersedia" / login tidak muncul dialog apapun
Biasanya karena login dipanggil bukan lewat tombol UI (misal langsung lewat kode/CLI). Pastikan login selalu lewat tombol **"Login Userbot"** di aplikasi, bukan memanggil `initUserbot()` langsung tanpa `prompts`.

## Error `AUTH_KEY_UNREGISTERED` atau `SESSION_REVOKED`
Session lama sudah tidak valid (biasanya karena logout manual dari Telegram, atau device lain "terminate session"). Solusi:
1. Klik **"Hapus Sesi"** di aplikasi.
2. Restart aplikasi (`npm start` ulang).
3. Klik **"Login Userbot"** lagi dari awal.

## `FLOOD_WAIT_xxx` muncul terus / job jalan sangat lambat
Ini bukan bug — Telegram membatasi kecepatan kirim, dan aplikasi **sengaja menunggu** durasi yang diminta (jangan diabaikan, karena mengabaikan flood-wait berisiko akun kena restrict lebih berat). Kalau terlalu sering muncul:
- Naikkan jeda minimum/maksimum di form "Buat Broadcast" (misal dari 8–25 detik jadi 20–45 detik).
- Kurangi jumlah target per job (pecah jadi beberapa job lebih kecil).

## Bot tidak merespons / grup tidak otomatis tercatat
- Pastikan bot memang sudah di-invite ke grup tsb.
- Pastikan sudah ada **minimal satu pesan** terkirim di grup itu setelah bot masuk (bot baru "mengenal" grup setelah menerima event/message pertama).
- Cek terminal/console tempat `npm start` dijalankan — kalau ada `polling_error`, biasanya token bot salah atau ada instance bot lain yang jalan dengan token sama (Telegram hanya izinkan satu polling aktif per token).

## "API ID / API Hash belum diisi" saat klik Login Userbot
Buka tab **Pengaturan**, isi API ID & API Hash (dari my.telegram.org), klik **"Simpan Pengaturan"**, baru klik **"Login Userbot"**.

## Error `TG_API_ID is not a number` / app crash saat start terkait kredensial
Ini sudah tidak relevan lagi di versi sekarang — kredensial tidak lagi dibaca dari `.env`, tapi dari tab **Pengaturan** yang tersimpan di folder data aplikasi. Kalau errornya justru "API ID / API Hash belum diisi", isi dulu lewat tab Pengaturan (lihat poin di atas).

## Perlu ganti nomor HP / akun userbot yang dipakai
1. Klik **"Hapus Sesi"**.
2. Restart aplikasi.
3. Login ulang dengan nomor HP yang baru.

## Sync grup tidak memunculkan grup yang saya harapkan
`syncUserbotDialogs` mengambil maksimal 500 dialog terbaru dari akun pribadi. Kalau akunmu ikut sangat banyak grup/channel dan grup yang dicari tidak muncul, kemungkinan di luar batas 500 itu — perlu penyesuaian `limit` di `src/telegram/userbot.js` (`listDialogs`) kalau ini jadi masalah nyata.

## Pesan terkirim dobel ke grup yang sama
Cek apakah grup itu tercatat dua kali di tabel `targets` dengan `chat_id` yang beda format (misal salah satu dari userbot pakai id negatif untuk supergroup, satu lagi dari bot pakai format berbeda). Kalau ketemu, hapus salah satu duplikatnya langsung dari database (`broadtele.db`) atau nonaktifkan (`active = 0`) lewat query manual — belum ada tombol hapus di UI untuk kasus ini.
