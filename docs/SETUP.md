# SETUP.md — Panduan Setup dari Nol

Ikuti urutan ini persis, jangan diloncat.

## 1. Install dependency
```bash
cd Broadtele
npm install
```

## 2. Jalankan aplikasi
```bash
npm start
```
Tidak ada file `.env` yang perlu disiapkan sebelumnya — semua kredensial diisi lewat aplikasi di langkah berikutnya.

## 3. Dapatkan kredensial userbot (akun pribadi)
1. Buka https://my.telegram.org, login pakai nomor HP Telegram-mu.
2. Masuk ke **API Development Tools**.
3. Buat aplikasi baru (nama & platform bebas, misal "Broadtele" / "Desktop").
4. Catat **App api_id** dan **App api_hash** yang muncul.

## 4. Dapatkan token bot (opsional, tapi disarankan untuk grup yang mengizinkan bot)
1. Buka Telegram, chat **@BotFather**.
2. Kirim `/newbot`, ikuti instruksinya (nama bot & username bot).
3. BotFather akan kasih **token** — catat.

## 5. Isi tab Pengaturan di aplikasi
1. Di aplikasi yang sudah jalan, buka tab **Pengaturan** (tab pertama).
2. Isi **API ID** dan **API Hash** dari langkah 3.
3. Isi **Bot Token** dari langkah 4 (kosongkan kalau tidak mau pakai Bot API sama sekali).
4. Klik **"Simpan Pengaturan"**.

Data ini tersimpan otomatis di folder data aplikasi milik OS (bukan di folder project), jadi tidak ikut ter-share kalau kamu commit/zip project-nya.

## 6. Login userbot lewat aplikasi
1. Klik tombol **"Login Userbot"** di pojok kanan atas.
2. Akan muncul dialog minta **Nomor HP** (format `+62...`) — isi, klik Kirim.
3. Telegram akan kirim kode OTP ke akun Telegram-mu (via aplikasi Telegram lain yang sudah login, atau SMS) — masukkan di dialog **Kode OTP**.
4. Kalau akunmu punya password 2FA, akan muncul dialog **Password 2FA** — kalau tidak punya, kosongkan saja lalu Kirim.
5. Kalau berhasil, indikator "Userbot" di pojok kanan atas berubah jadi **terhubung** (titik hijau).

Session tersimpan otomatis (di folder data aplikasi) — lain kali buka app, tidak perlu login ulang.

## 7. Masukkan bot ke grup yang mau dipakai lewat Bot API
Untuk tiap grup yang ingin dilayani lewat bot (bukan userbot):
1. Buka grup itu di Telegram, invite bot yang tadi dibuat via BotFather.
2. Kirim satu pesan apapun di grup (supaya bot "mengenal" grup tsb dan tercatat otomatis di aplikasi).

## 8. Sinkronkan daftar grup dari akun pribadi
Di tab **Grup**, klik **"Sync dari Akun Pribadi"** — semua grup yang diikuti akun pribadimu akan muncul di tabel.

## 9. Buat broadcast pertama
1. Di tab **Grup** atau **Japri**, centang target yang mau dikirimi.
2. (Opsional) centang **Relasi bisnis** untuk menandai grup/kontak partner, supaya gampang dibedakan nanti.
3. Buka tab **Buat Broadcast**, pilih jenis target (Grup/Japri) — jumlah yang tercentang akan muncul di sebelah pilihan.
4. Tulis pesan, atur jeda (default sudah masuk akal: grup 8–25 detik, japri 30–90 detik).
5. Klik **"Buat & Jalankan Job"** — otomatis pindah ke tab **Log Pengiriman** untuk lihat progres realtime.

## Catatan
- Grup yang bot-nya belum di-invite otomatis akan dikirim lewat **userbot** (akun pribadi) sebagai fallback.
- Selama job jalan, urutan target diacak dan jeda antar kirim juga diacak (dalam rentang yang kamu atur) — ini otomatis, tidak perlu setting tambahan.
- Kalau mau berhenti di tengah jalan, pakai tombol **Jeda** atau **Hentikan** di tab Log Pengiriman.
- Mau ganti Bot Token atau update API ID/Hash kapan saja? Tinggal buka lagi tab Pengaturan, ubah, lalu Simpan — tidak perlu restart aplikasi untuk Bot Token (bot lama otomatis berhenti dan yang baru langsung aktif). Untuk ganti API ID/Hash setelah userbot sudah login, sebaiknya "Hapus Sesi" dulu lalu login ulang.

Kalau ada error, cek `TROUBLESHOOTING.md`.
