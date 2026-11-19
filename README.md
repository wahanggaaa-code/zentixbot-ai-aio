<p align="center">
  <img src="assets/zentix-banner.gif" alt="ZentixBot" width="800">
</p>

<h1 align="center">ZentixBot</h1>
<p align="center">Bot Discord self-hosted untuk komunitas, dengan dashboard dan fitur AI.</p>
<p align="center">
  <img alt="discord.js v14" src="https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white">
  <img alt="Node.js 22.13 atau lebih baru" src="https://img.shields.io/badge/Node.js-%E2%89%A5%2022.13-339933?logo=node.js&logoColor=white">
  <img alt="Satu instance untuk satu server" src="https://img.shields.io/badge/single%20server-self--hosted-1f6feb?logo=server&logoColor=white">
</p>

> **Status:** proyek ini masih dalam persiapan beta. Beberapa alur sudah diuji pemilik di Discord, tetapi tidak semua kombinasi fitur, provider, dan hosting telah diverifikasi. Gunakan server uji dan cadangkan data sebelum mengandalkannya.

**[Fitur](#fitur) · [Persiapan](#persiapan) · [Mulai](#mulai) · [Dashboard & AI](#dashboard--ai) · [Data & backup](#data--backup) · [Dokumentasi](#dokumentasi)**

## Fitur

| Area | Yang tersedia |
| --- | --- |
| **Komunitas** | Welcome/goodbye, self role, Join to Create, ulang tahun, server stats, leveling dan giveaway. |
| **Ticket & moderasi** | Pengelolaan ticket, claim, transcript, feedback, logging dan perintah moderasi. |
| **Message Studio** | Buat dan kelola pesan dengan komponen Discord, pratinjau dan penjadwalan. |
| **AI Studio** | Chat channel dan DM, FAQ, terjemahan, rangkum link, gambar, aktivitas serta fitur komunitas AI yang dapat diatur. |
| **Musik & utilitas** | Musik melalui Lavalink, pencarian, kamus dan alat bantu server. |
| **Dashboard** | Pengaturan bot dan fitur melalui antarmuka web di proses yang sama. |

Ketersediaan fitur tergantung konfigurasi, izin Discord dan layanan eksternal. Satu instance Zentix melayani **satu server** melalui `GUILD_ID`; ini bukan bot publik multi-server.

## Persiapan

- **Node.js 22.13+**; gunakan **22.16+** bila memakai backup SQLite.
- Aplikasi bot Discord dan server uji. Aktifkan intent **Server Members** dan **Message Content**, lalu berikan izin bot seperlunya.
- SQLite tersedia sebagai bawaan; PostgreSQL dapat dikonfigurasi secara opsional.
- Hosting dengan penyimpanan persisten dan akses **HTTPS** untuk dashboard.

> **Perhatian:** pada setiap startup, bot secara default menghapus command global pada aplikasi Discord yang sama, kecuali entry point Activity. Gunakan aplikasi khusus untuk Zentix atau atur `KEEP_GLOBAL_COMMANDS=true` sebelum menjalankan jika command global perlu dipertahankan.

## Mulai

Pada folder repository:

```bash
npm ci --omit=dev
cp .env.example .env
# Isi konfigurasi secara pribadi di .env atau environment hosting
npm start
```

Isi setidaknya `DISCORD_TOKEN`, `CLIENT_ID` dan `GUILD_ID`. Untuk login dashboard dengan token, isi juga `OWNER_IDS` dan `DASHBOARD_TOKEN`. Tambahkan kunci provider hanya untuk fitur yang dipakai. Semua variabel dan keterangannya ada di [`.env.example`](.env.example).

> Jangan membagikan `.env`, token bot, token dashboard, kunci API, atau URL database. Di panel hosting, `PORT` pada `.env.example` dapat mengalahkan `SERVER_PORT` yang diberikan panel; hapus atau sesuaikan jika perlu.

## Dashboard & AI

Buka `https://alamat-dashboard/dashboard/` dan masuk memakai token dashboard, atau gunakan login Discord yang sudah dikonfigurasi. Siapa pun yang mengetahui token dashboard dapat menggunakannya; jangan bagikan tautan login bertoken. HTTP publik tidak mengenkripsi token atau sesi.

AI diatur melalui **AI Studio**. Konten yang diproses dikirim ke provider eksternal dan dapat memakai kuota atau biaya. Beri tahu anggota sebelum mengaktifkan fitur yang membaca channel. Memori jangka panjang DM hanya aktif atas persetujuan dan dikelola anggota; jangan simpan data sensitif. Ringkasan link tidak menjalankan JavaScript, dan PDF scan atau video tidak selalu dapat dibaca.

## Data & backup

Tanpa konfigurasi database, bot memakai SQLite di `data/zentix.db`. Jika PostgreSQL dikonfigurasi, data database berada di PostgreSQL; bot tidak otomatis memindahkan data atau beralih database saat koneksi gagal. Simpan data dan backup di lokasi persisten dan aman—backup dapat berisi data pribadi dan tidak dienkripsi.

**Uji pemulihan dari salinan backup pada target terpisah sebelum mengandalkannya.** `restore:db` saat ini sengaja dinonaktifkan. Jangan melakukan tes restore ke database produksi.

## Dokumentasi

- [Berkontribusi & melaporkan bug](CONTRIBUTING.md) · [Kebijakan keamanan](SECURITY.md) · [Lisensi MIT](LICENSE).

Folder `tests/`, `.github/` dan `docs/` hanya ada di repository kerja, bukan salinan publik. Pengujian dilakukan di repository kerja sebelum publikasi.
