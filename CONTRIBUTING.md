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

Perlu Node.js 22.13 ke atas (22.16 ke atas untuk backup SQLite) dan satu aplikasi bot Discord dengan intent Server Members dan Message Content.

```bash
npm ci
cp .env.example .env    # isi DISCORD_TOKEN, CLIENT_ID dan GUILD_ID
npm start
```

Tanpa pengaturan database, bot membuat berkas SQLite sendiri di `data/`. Pengaturan lain dijelaskan di [`README.md`](README.md).

Folder `tests/` dan workflow `.github/` hanya ada di repository kerja. Karena itu `npm test` di salinan publik menampilkan penjelasan dan tidak berpura-pura lulus. Pengujian lengkap SQLite dan PostgreSQL dijalankan di repository kerja sebelum publikasi.

Untuk Docker Compose, isi `POSTGRES_PASSWORD` di `.env` sebelum menjalankan Compose. Gunakan password acak kuat yang hanya berisi huruf dan angka agar aman dipakai dalam URL koneksi. Untuk volume database yang sudah ada, isi password yang dipakai database tersebut; mengganti variabel tidak otomatis mengubah password dalam volume.

Dependensi pengembangan untuk tes modul dokumen lama tetap diperlukan di repository kerja (`npm ci`). Untuk instalasi produksi tanpa dependensi tersebut gunakan `npm ci --omit=dev`. Image Docker menyertakan PostgreSQL client untuk backup; versi `pg_dump` harus sama atau lebih baru dari server PostgreSQL. Backup di dalam container bersifat sementara kecuali disimpan ke volume atau disalin keluar. `restore:db` saat ini sengaja dinonaktifkan dan tidak memulihkan database.



## Yang perlu dijaga di kode

- **Ikuti gaya berkas di sekitarnya.** Kode memakai ES modules (`import` / `export`) dan `async` / `await`. Tidak ada konfigurasi ESLint.
- **Satu bot untuk satu server.** Bot hanya melayani server di `GUILD_ID`.
- **Dua database.** Perubahan yang membaca atau menulis data harus berjalan di SQLite dan di PostgreSQL.
- **Batas 100 perintah slash.** Discord membatasi hingga 100 perintah utama per server. Periksa jumlah terbaru saat menambah perintah; subcommand tidak dihitung sebagai perintah utama terpisah.
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
