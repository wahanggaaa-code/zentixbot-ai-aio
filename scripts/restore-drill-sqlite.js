// Latihan pemulihan SQLite (restore drill). Membuktikan bahwa satu berkas backup dapat dibuka,
// benar-benar database Zentix, lulus PRAGMA integrity_check, dan berisi tabel yang diharapkan.
// Tidak pernah menyentuh berkas yang diberikan (--input): backup disalin ke folder sementara,
// diperiksa di sana, lalu folder sementara dihapus. Tidak memerlukan bot menyala, tidak ada data produksi yang diubah.
//
//   node scripts/restore-drill-sqlite.js --input backups/zentix-<tanggal>.db
//   npm run restore:drill:sqlite -- --input backups/zentix-<tanggal>.db
//
// Keluaran: ringkasan tabel dan jumlah baris. Kode keluar 0 = backup sehat, 1 = gagal.
import {copyFile,lstat,mkdtemp,rm,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openSQLiteStore} from '../src/services/storage/sqlite.js';

function argumentsFor(argv){const args={};for(let i=0;i<argv.length;i++){const raw=argv[i];if(raw!=='--input'||args[raw]!==undefined||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('Hanya --input <berkas backup> yang didukung');args[raw]=argv[++i]}if(!args['--input'])throw new Error('--input <berkas backup> wajib diisi');return args}

async function magicLooksLikeSQLite(file){const fd=createReadStream(file,{start:0,end:15});const chunks=[];for await(const c of fd)chunks.push(c);const head=Buffer.concat(chunks).toString('latin1');return head.startsWith('SQLite format 3\0')}

async function main(){
  const args=argumentsFor(process.argv.slice(2));
  const input=path.resolve(args['--input']);

  const info=await lstat(input).catch(()=>null);
  if(!info)throw new Error(`Berkas tidak ditemukan: ${input}`);
  if(info.isSymbolicLink())throw new Error('Berkas backup tidak boleh berupa symlink');
  if(!info.isFile())throw new Error('Berkas backup harus berupa berkas biasa');
  if(info.size===0)throw new Error('Berkas backup kosong');
  if(!(await magicLooksLikeSQLite(input)))throw new Error('Berkas bukan database SQLite (header tidak cocok)');

  const work=await mkdtemp(path.join(tmpdir(),'zentix-restore-drill-'));
  const copy=path.join(work,'drill.db');
  try{
    // Salin dulu: pemeriksaan tidak boleh mengubah berkas yang diberikan.
    await copyFile(input,copy);

    // Membuka lewat openSQLiteStore: menolak berkas SQLite yang bukan database Zentix dan melihat versi skema.
    const store=await openSQLiteStore({path:copy,busyTimeout:5000});
    store.close();

    // Pemeriksaan integritas dan isi dilakukan di berkas salinan.
    const {DatabaseSync}=await import('node:sqlite');
    const db=new DatabaseSync(copy);
    try{
      const integrity=db.prepare('PRAGMA integrity_check').all().map(r=>Object.values(r)[0]);
      if(integrity.length!==1||integrity[0]!=='ok')throw new Error(`integrity_check gagal: ${integrity.join('; ')}`);
      const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
      const counts={};
      for(const table of ['zentix_kv','zentix_economy','zentix_bot_kv','zentix_verification_audit']){
        if(!tables.includes(table)){counts[table]=null;continue}
        counts[table]=db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
      }
      const schemaVersion=db.prepare("SELECT value FROM zentix_storage_meta WHERE key='schema_version'").get()?.value;
      process.stdout.write(`Restore drill OK: ${input}\n`);
      process.stdout.write(`  Versi skema : ${schemaVersion ?? '(tanpa versi)'}\n`);
      process.stdout.write(`  Integritas  : ok\n`);
      process.stdout.write(`  Tabel (${tables.length}): ${tables.join(', ') || '(tidak ada)'}\n`);
      for(const [table,n] of Object.entries(counts)){
        if(n!==null)process.stdout.write(`  ${table}: ${n} baris\n`);
      }
      process.stdout.write('  Salinan sementara sudah dihapus; berkas backup tidak diubah.\n');
    }finally{db.close()}
  }finally{await rm(work,{recursive:true,force:true})}
}

main().catch(error=>{console.error(`Restore drill gagal: ${error.message}`);process.exitCode=1});
