# Berkontribusi ke ZentixBot

Terima kasih sudah mau membantu. Dokumen ini menjelaskan cara melapor, cara mengusulkan perubahan, dan hal yang perlu dijaga di kode.

## Cara membantu

- **Melaporkan bug** lewat tab **Issues**.
- **Mengusulkan fitur** lewat tab **Issues**, sebelum menulis kodenya, supaya cakupannya disepakati lebih dulu.
- **Mengirim perubahan kode** lewat pull request.

Celah keamanan tidak dilaporkan lewat issue. Lihat [`SECURITY.md`](SECURITY.md).

## Tentang pull request

Repository publik ini adalah salinan yang diterbitkan otomatis dari repository kerja. Isinya ditimpa setiap kali ada terbitan baru, jadi pull request tidak di-merge langsung di sini. Pull request yang diterima diterapkan pemelihara di repository kerja, lalu muncul di sini pada terbitan berikutnya.

Dalam deskripsi pull request, tulis:

- **apa** yang berubah;
- **mengapa** perubahan itu perlu;
- **cara mencobanya**: perintah, pengaturan atau variabel yang perlu diisi.

Satu pull request untuk satu perubahan.

## Menyiapkan di komputer sendiri

Perlu Node.js 22.13 ke atas dan satu aplikasi bot Discord dengan intent Server Members dan Message Content.

```bash
npm ci
cp .env.example .env    # isi DISCORD_TOKEN, CLIENT_ID dan GUILD_ID
npm start
```

Tanpa pengaturan database, bot membuat berkas SQLite sendiri di `data/`. Pengaturan lain dijelaskan di [`README.md`](README.md).

## Yang perlu dijaga di kode

- **Ikuti gaya berkas di sekitarnya.** Kode memakai ES modules (`import` / `export`) dan `async` / `await`. Tidak ada konfigurasi ESLint.
- **Satu bot untuk satu server.** Bot hanya melayani server di `GUILD_ID`.
- **Dua database.** Perubahan yang membaca atau menulis data harus berjalan di SQLite dan di PostgreSQL.
- **Batas 100 perintah slash.** Bot sudah mendaftarkan 100 perintah, batas Discord per server. Perintah baru berarti menggabungkan atau melepas perintah lama.
- **Variabel baru** dicantumkan di `.env.example`, dan di `README.md` bila pemakai perlu mengisinya.
- **Kegagalan ditangani.** Tangkap galat, catat dengan keterangan yang cukup, dan beri pemakai pesan yang bisa dimengerti.
- **Tidak ada rahasia di kode atau log.** Token dan kunci API hanya dibaca dari lingkungan.

## Melaporkan bug

Sertakan:

- langkah untuk mengulanginya;
- yang diharapkan dan yang terjadi;
- baris log yang berkaitan (`LOG_LEVEL=debug` menambah rincian);
- database yang dipakai (SQLite atau PostgreSQL) dan versi Node.js;
- commit atau versi bot bila diketahui.

Hapus token dan kunci API dari log sebelum menempelkannya.

## Lisensi

Dengan berkontribusi, Anda setuju kontribusi itu dilisensikan dengan [lisensi MIT](LICENSE) yang sama dengan proyek ini.
