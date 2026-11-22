(() => {
 const key = 'zentix.dashboard.language';
 const strings = {
  id: {features:'Fitur bot',settings:'Pengaturan',logout:'KELUAR',logoutTitle:'Keluar dari akun',menu:'Menu navigasi',openMenu:'Buka menu navigasi',closeMenu:'Tutup menu navigasi',language:'Bahasa dashboard',confirm:'Mengganti bahasa akan memuat ulang dashboard. Perubahan yang belum disimpan akan hilang. Lanjutkan?',imageTitle:'Generator gambar Discord',imageHelp:'Izinkan anggota memakai /gambar pada channel yang dipilih.',imageLoading:'Memuat pengaturan…',imageEnable:'Aktifkan /gambar',imageEnableHelp:'Hanya berlaku di channel yang dipilih.',channels:'Channel teks',channelsHelp:'Pilih maksimal 10 channel untuk /gambar.',roles:'Role yang diizinkan',rolesHelp:'Maksimal 10 role. Kosong berarti semua anggota yang punya izin channel.',cooldown:'Cooldown per anggota',cooldownHelp:'30–86400 detik; berlaku juga setelah restart.',save:'SIMPAN ↗',saved:'Tersimpan.',unavailable:'ID tersimpan tidak tersedia — hapus pilihan sebelum menyimpan: ',empty:'Tidak ada pilihan tersedia.',imagePrivacy:'Nonaktif secara bawaan. Prompt dikirim ke provider dan bisa dikenai biaya; Pollinations dapat memasukkan prompt ke URL. Kuota AI harian bersama dan cooldown tetap berlaku, termasuk bila permintaan gagal setelah diterima. Filter konten bergantung provider dan tidak menjamin hasil aman; awasi penggunaannya.'},
  en: {features:'Bot features',settings:'Settings',logout:'LOG OUT',logoutTitle:'Log out',menu:'Navigation menu',openMenu:'Open navigation menu',closeMenu:'Close navigation menu',language:'Dashboard language',confirm:'Changing language will reload the dashboard. Unsaved changes will be lost. Continue?',imageTitle:'Discord image generator',imageHelp:'Allow members to use /gambar in selected channels.',imageLoading:'Loading settings…',imageEnable:'Enable /gambar',imageEnableHelp:'Only applies in selected channels.',channels:'Text channels',channelsHelp:'Choose up to 10 channels for /gambar.',roles:'Allowed roles',rolesHelp:'Up to 10 roles. Leave empty for all members with channel access.',cooldown:'Cooldown per member',cooldownHelp:'30–86400 seconds; still applies after a restart.',save:'SAVE ↗',saved:'Saved.',unavailable:'Saved ID unavailable — remove it before saving: ',empty:'No options available.',imagePrivacy:'Disabled by default. Prompts are sent to a provider and may incur charges; Pollinations may include the prompt in a URL. Shared daily AI quotas and cooldowns still apply, including when an accepted request fails. Content filters depend on the provider and do not guarantee safe results; supervise use.'}
 };
 let lang='id';try{if(localStorage.getItem(key)==='en')lang='en'}catch{}
 const t=id=>strings[lang][id] ?? strings.id[id] ?? id;
 window.ZentixI18n={t, get language(){return lang}};
 document.documentElement.lang=lang;
 const apply=()=>{
  document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n)});
  document.querySelectorAll('[data-i18n-label]').forEach(el=>el.setAttribute('aria-label',t(el.dataset.i18nLabel)));
  const logout=document.querySelector('#profileButton');if(logout)logout.title=t('logoutTitle');
  const trigger=document.querySelector('#dashboardLanguage'),menu=document.querySelector('#languageMenu');
  if(!trigger||!menu)return;
  trigger.textContent=lang==='en'?'ENG':'ID';trigger.setAttribute('aria-label',t('language'));menu.setAttribute('aria-label',t('language'));
  const close=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false')};
  const choices=[...menu.querySelectorAll('[data-language]')];
  choices.forEach(button=>{
   button.setAttribute('aria-pressed',String(button.dataset.language===lang));
   button.addEventListener('click',()=>{
    const next=button.dataset.language;close();if(next===lang){trigger.focus();return}
    if(!window.confirm(t('confirm'))){trigger.focus();return}
    try{localStorage.setItem(key,next)}catch{}window.location.reload();
   });
  });
  trigger.addEventListener('click',()=>{
   if(!menu.hidden){close();return}
   const navigation=document.querySelector('#mobileTrigger');if(navigation?.getAttribute('aria-expanded')==='true')navigation.click();
   menu.hidden=false;trigger.setAttribute('aria-expanded','true');
  });
  document.querySelector('#mobileTrigger')?.addEventListener('click',close);
  document.addEventListener('click',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!trigger.contains(event.target))close()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){close();trigger.focus()}});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
})();
