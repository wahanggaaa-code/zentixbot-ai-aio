# Ide fitur dari referensi Melon

Dokumen ini mencatat ide untuk dipertimbangkan nanti, bukan fitur yang sudah tersedia atau komitmen implementasi. Referensi: [Melon All-In-One Discord Bot](https://github.com/itsfizys/Melon-All-In-One-Discord-Bot). Perbandingan awal berdasarkan README Melon dan sebagian kode Zentix, belum merupakan audit menyeluruh atau tes langsung Melon.

## Prioritas yang disarankan

1. **AutoMod:** anti-spam dan mass mention, dilanjut filter invite/link; pengecualian role/channel yang eksplisit. Mulai dengan mode catat saja, lalu tindakan opsional setelah diuji. Cegah salah sasaran dan batasi penggunaan izin.
2. **Pengingat pribadi:** pengingat anggota dengan zona waktu jelas, batas jumlah, status kegagalan DM dan jadwal yang tahan restart. Berbeda dari pesan terjadwal sekali di Message Studio.
3. **Pesan berkala:** jadwal berulang untuk pesan umum, idealnya menggunakan template Message Studio; sediakan preview, batas frekuensi, penghentian, dan perlindungan dari pengiriman ganda setelah restart.
4. **Transfer klaim ticket:** alihkan klaim ke staff lain dengan riwayat penyerahan dan penerimaan, pemeriksaan izin/role serta pengamanan perubahan bersamaan. Ticket Zentix sudah memiliki claim, unclaim, reopen dan transcript.
5. **Anti-nuke:** proyek terpisah yang dimulai dari deteksi dan laporan, bukan otomatis ban. Pertimbangkan penghapusan channel/role massal, pembuatan webhook dan bot masuk; audit log bisa terlambat atau tidak cukup untuk memastikan pelaku. Perlu whitelist, batas, pemeriksaan izin dan uji lapangan sebelum tindakan otomatis.

## Ide prioritas lebih rendah

- **AFK, todo dan kartu profil:** kenyamanan komunitas. Jejak penyimpanan AFK lama bukan bukti bahwa fitur AFK aktif atau siap digunakan.
- **Auto-react:** dibatasi channel, emoji, frekuensi dan rate limit.
- **Vanity role berdasarkan status:** bergantung pada akses presence dan tidak selalu andal; periksa izin dan perilaku saat data tidak tersedia.
- **Autobump:** jangan langsung diotomatisasi; periksa dulu aturan layanan tujuan dan Discord.

Zentix sudah memiliki giveaway, welcome/goodbye, Join to Create, self role, logging, AI chat dan ticket dasar. Periksa gap spesifik sebelum membuat fitur duplikat.

## Lisensi

Melon memiliki [lisensi kustom](https://github.com/itsfizys/Melon-All-In-One-Discord-Bot/blob/main/LICENSE) dengan syarat atribusi dan distribusi. Gunakan sebagai referensi ide; jangan menyalin kode atau aset tanpa memeriksa kompatibilitas lisensi dan memenuhi syarat yang berlaku.
