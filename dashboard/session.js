if (location.pathname.startsWith('/dashboard/')) {
  const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
  window.ZentixSession = fetch('/dashboard/api/me', {cache:'no-store'}).then(async response => {
    if (!response.ok) throw new Error(tr('Sesi tidak lagi memiliki akses.','The session no longer has access.'));
    const data = await response.json();
    const button = document.getElementById('profileButton');
    button.title = tr(`${data.user.username} · ${data.guild.name} — klik untuk keluar`,`${data.user.username} · ${data.guild.name} — click to log out`);
    button.addEventListener('click', async () => {
      if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Keluar dari akun ${data.user.username}?`,`Log out of account ${data.user.username}?`)) : Promise.resolve(window.confirm(tr(`Keluar dari akun ${data.user.username}?`,`Log out of account ${data.user.username}?`)))))) return;
      const result = await fetch('/dashboard/api/logout', {method:'POST',headers:{'x-csrf-token':data.csrf}});
      if (result.ok) location.assign('/dashboard/login'); else await (window.ZentixDialog ? window.ZentixDialog.alert(tr('Gagal keluar. Coba lagi.','Could not log out. Try again.')) : Promise.resolve(window.alert(tr('Gagal keluar. Coba lagi.','Could not log out. Try again.'))));
    });
    return data;
  }).catch(error => { location.assign('/dashboard/login'); throw error; });
}
