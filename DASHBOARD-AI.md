# Dashboard & AI

## Bahasa Indonesia

Buka `https://alamat-dashboard/dashboard/` dan masuk memakai token dashboard. Login Discord dinonaktifkan, termasuk ketika token belum dikonfigurasi. Siapa pun yang mengetahui token dashboard dapat menggunakannya; jangan bagikan tautan login bertoken. HTTP publik tidak mengenkripsi token atau sesi. Sesi token memeriksa keanggotaan `OWNER_IDS` saat login dan memakai identitas tersebut untuk membuka data tanpa pemeriksaan ulang setiap halaman. Jika keanggotaan dicabut, akses baca sesi token tetap berlaku sampai logout atau sesi berakhir (maksimal 12 jam); tindakan yang mengubah data tetap memeriksa anggota dan izin Discord.

AI diatur melalui **AI Studio**. Untuk mengizinkan anggota membuat gambar, konfigurasi provider gambar dan fondasi AI, lalu aktifkan **Image Studio → Discord**, pilih channel dan role bila diperlukan, serta atur cooldown. Anggota memakai `/gambar` dengan persetujuan. Fitur ini nonaktif secara bawaan; filter konten bergantung provider dan tidak menjamin hasil aman.

Konten yang diproses dikirim ke provider eksternal dan dapat memakai kuota atau biaya. Beri tahu anggota sebelum mengaktifkan fitur yang membaca channel. Memori jangka panjang DM hanya aktif atas persetujuan dan dikelola anggota; jangan simpan data sensitif. Ringkasan link tidak menjalankan JavaScript, dan PDF scan atau video tidak selalu dapat dibaca.

Anggota dapat memakai `/terjemahkan` dengan teks, bahasa tujuan dan persetujuan untuk menampilkan hasil di channel. Command ini memakai provider serta kuota AI harian, dan terpisah dari pengaturan terjemahan otomatis dan reaksi bendera. Jangan kirim data sensitif.


## English

Open `https://your-dashboard-address/dashboard/` and sign in with the dashboard token. Discord login is disabled, even if the token is not configured. Anyone who knows the token can use it; do not share token-bearing login links. Public HTTP does not encrypt tokens or sessions. Token login verifies the first account in `OWNER_IDS` is a member, then reuses that identity for reads without another membership check. If membership is revoked, read access remains until logout or session expiry (at most 12 hours); writes still revalidate membership and perform action-specific Discord permission checks.

AI is configured in **AI Studio**. To let members generate images, configure an image provider and the AI foundation, then enable **Image Studio → Discord**, select channels and optional roles, and set a cooldown. Members use `/gambar` with consent. This feature is off by default; content filtering depends on the provider and does not guarantee safe results.

Processed content is sent to external providers and may consume quota or incur charges. Inform members before enabling features that read channels. Long-term DM memory is opt-in and managed by each member; do not store sensitive data. Link summaries do not execute JavaScript, and scanned PDFs or videos cannot always be read.

Members can use `/terjemahkan` with text, a target language and consent to post the result in the channel. The command uses the AI provider and daily quota, independently of automatic translation and flag-reaction settings. Do not submit sensitive data.

