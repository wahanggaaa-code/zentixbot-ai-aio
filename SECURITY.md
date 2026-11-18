# Kebijakan keamanan

ZentixBot adalah perangkat lunak sumber terbuka yang dijalankan sendiri oleh pemakainya. Pemelihara proyek tidak menjalankan instalasi orang lain dan tidak punya akses ke data, token atau pengaturannya. Keamanan sebuah instalasi adalah tanggung jawab orang yang menjalankannya.

## Melaporkan celah keamanan

- Laporkan secara tertutup: buka tab **Security** di repository ini, lalu **Report a vulnerability**.
- Jangan menulis rincian celah di issue publik.
- Proyek ini dipelihara satu orang. Tidak ada janji waktu tanggapan.

Yang membantu dalam laporan:

- Bagian yang terkena, misalnya login dashboard, sebuah perintah, atau skrip backup.
- Langkah paling pendek untuk mengulanginya.
- Versi atau commit yang dipakai, versi Node.js, dan database yang dipakai (SQLite atau PostgreSQL).
- Akibatnya: data terbaca, hak bertambah, bot berhenti, dan sebagainya.

Hapus token, kunci API dan data pribadi dari log atau tangkapan layar sebelum mengirimnya.

## Cakupan

Termasuk: kode di repository ini, yaitu bot, dashboard web dan login-nya, skrip di `scripts/`, `Dockerfile` dan `docker-compose.yml`.

Tidak termasuk: Discord, provider AI, node Lavalink milik pihak ketiga, layanan hosting, dan instalasi yang bukan milik pelapor.

## Aturan menguji

- Uji hanya pada bot dan server Discord milik sendiri, atau yang pemiliknya mengizinkan.
- Jangan mengambil, mengubah atau menghapus data orang lain.

## Bila instalasi sendiri bocor

1. Ganti rahasia yang mungkin terbaca: `DISCORD_TOKEN`, `DASHBOARD_TOKEN`, `DISCORD_CLIENT_SECRET`, kunci provider AI dan kata sandi database. Mengganti `DASHBOARD_TOKEN` dan memulai ulang bot mengakhiri semua sesi dashboard.
2. Simpan log untuk diperiksa, tanpa membagikan rahasia di dalamnya.
3. Bila sebabnya tampak ada di kode bot, laporkan seperti di atas.

Pemelihara hanya dapat memperbaiki kode. Mengganti token atau memulihkan data sebuah instalasi tidak dapat dilakukan dari sini.

## Saran untuk yang menjalankan bot

- **Dashboard lewat `http://` berjalan tanpa enkripsi.** Token dan sesi dapat dibaca pihak di jaringan yang sama. Pakai `https://` bila hosting menyediakannya.
- **Siapa pun yang tahu `DASHBOARD_TOKEN` dapat memakai dashboard**, termasuk fitur moderasi. Jangan kirim token atau tautan login lewat chat atau tangkapan layar.
- **Berkas `.env` dan folder `data/` tidak boleh masuk Git.** Keduanya sudah ada di `.gitignore`.
- **Cadangan database tidak dienkripsi** dan berisi seluruh data bot. Simpan di tempat yang tidak dapat dibaca orang lain.
- **Jangan buka PostgreSQL ke internet.** Pakai jaringan internal dan kata sandi yang kuat. Docker Compose mewajibkan `POSTGRES_PASSWORD` di `.env`; gunakan huruf dan angka acak yang panjang karena password dimasukkan ke URL koneksi. Volume database lama tetap memakai password lama sampai diubah di PostgreSQL.
- **Beri bot izin Discord seperlunya saja.**

## Data yang keluar dari bot

Bot tidak mengirim data pemakaian ke pemelihara. Ia menghubungi Discord, layanan yang kuncinya diisi di `.env` (provider AI, pencarian web, gambar, transkrip suara), node Lavalink untuk musik, dan beberapa API publik yang dipakai perintahnya (cuaca, kamus, pemendek tautan).

Fitur AI yang membaca channel mengirim pesan anggota ke provider AI yang dipilih. Lihat bagian "Fitur AI" di [`README.md`](README.md).
