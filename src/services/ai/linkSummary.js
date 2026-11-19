import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import { parse } from 'parse5';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
const MAX_BYTES = 2 * 1024 * 1024, MAX_TEXT = 2500, MAX_REDIRECTS = 3;
let active = 0;

export function publicUrl(input) {
 if (typeof input !== 'string' || input.length > 2048) throw err('URL tidak valid.');
 let u; try { u = new URL(input); } catch { throw err('URL tidak valid.'); }
 const host = u.hostname.replace(/^\[|\]$/g, '');
 if (u.protocol !== 'https:' || u.username || u.password || u.port || !host.includes('.') || net.isIP(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw err('Gunakan URL HTTPS domain publik tanpa port atau kredensial.');
 u.hash = ''; return u;
}
export function publicAddresses(addresses) {
 if (!Array.isArray(addresses) || !addresses.length) throw err('Domain tidak dapat diverifikasi.', 502);
 for (const a of addresses) {
  try { if (!a || ![4, 6].includes(a.family) || net.isIP(a.address) !== a.family || ipaddr.process(a.address).range() !== 'unicast') throw Error(); }
  catch { throw err('Alamat jaringan privat atau khusus tidak diizinkan.', 403); }
 }
 return addresses[0];
}

// Prefer actual article/main content over headers and navigation. Do not execute scripts or load resources.
function plainHTML(html) {
 const document = parse(html), skip = new Set(['head','script','style','noscript','svg','iframe','form','template','nav','footer','header']);
 let article = null, main = null, nodes = [document];
 while (nodes.length) {
  const n = nodes.pop(); if (skip.has(n.tagName)) continue;
  if (!article && n.tagName === 'article') article = n;
  if (!main && n.tagName === 'main') main = n;
  if (n.childNodes) for (let i = n.childNodes.length - 1; i >= 0; i--) nodes.push(n.childNodes[i]);
 }
 let text = ''; nodes = [article || main || document];
 while (nodes.length && text.length < 12000) {
  const n = nodes.pop(); if (skip.has(n.tagName)) continue;
  if (n.nodeName === '#text') text += n.value + ' ';
  if (n.childNodes) for (let i = n.childNodes.length - 1; i >= 0; i--) nodes.push(n.childNodes[i]);
 }
 return text.replace(/\s+/g, ' ').trim();
}

// README badges and link targets can dominate the small model input. Keep their
// visible text, but drop image markup and URLs before applying the text limit.
function cleanReadme(text) {
 return text
  .replace(/\[!\[[^\]\n]*\]\([^\n)]*\)\]\([^\n)]*\)/g, '')
  .replace(/!\[[^\]\n]*\]\([^\n)]*\)/g, '')
  .replace(/\[([^\]\n]+)\]\([^\n)]*\)/g, '$1')
  .replace(/<img\b[^>]*>/gi, '')
  .replace(/<\/?(?:div|a|br|sub|span|p)\b[^>]*>/gi, '')
  .replace(/\n{3,}/g, '\n\n').trim();
}

function githubReadme(url) {
 if (url.hostname !== 'github.com' || url.search) return null;
 const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(url.pathname);
 if (!match || ['.', '..'].includes(match[1]) || ['.', '..'].includes(match[2]) || match[2].endsWith('.git')) return null;
 return `https://api.github.com/repos/${match[1]}/${match[2]}/readme`;
}

async function resolveAddress(host, lookup) {
 let timer;
 try {
  const addresses = await Promise.race([lookup(host, {all:true,verbatim:true}), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('dns timeout')), 5000); timer.unref?.(); })]);
  return publicAddresses(addresses);
 } catch (e) {
  if (e.status) throw e;
  throw err('Domain tidak dapat diverifikasi.', 502);
 } finally { clearTimeout(timer); }
}

async function fetchOnce(u, {lookup, request, github}) {
 const pinned = await resolveAddress(u.hostname, lookup);
 return new Promise((resolve, reject) => {
  let done = false, timer;
  const finish = (e, value) => { if (done) return; done = true; clearTimeout(timer); e ? reject(e) : resolve(value); };
  const req = request(u, {method:'GET', agent:false, family:pinned.family, autoSelectFamily:false,
   lookup:(_host,opts,cb) => opts?.all ? cb(null,[pinned]) : cb(null,pinned.address,pinned.family),
   headers:{Accept:github?'application/vnd.github+json':'text/html,text/plain','Accept-Encoding':'identity','User-Agent':'ZentixBot-LinkSummary/1.0'}}, res => {
   const status = res.statusCode, type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
   const encoding = String(res.headers['content-encoding'] || 'identity').trim().toLowerCase();
   const stop = (e, value) => { finish(e, value); res.destroy(); };
   if ([301,302,303,307,308].includes(status)) return stop(null, {redirect:res.headers.location});
   if (status !== 200) return stop(err(github && status === 404 ? 'README repository tidak ditemukan atau repository tidak publik.' : github && status === 403 ? 'GitHub menolak permintaan README atau batas akses API tercapai.' : `Halaman tidak tersedia (HTTP ${status || 'tidak diketahui'}).`, 502));
   if (encoding !== 'identity') return stop(err('Situs mengirim kompresi yang belum didukung.', 502));
   if (github ? type !== 'application/json' : !['text/html','text/plain'].includes(type)) return stop(err(github ? 'Respons README GitHub bukan JSON yang didukung.' : 'Halaman bukan HTML atau teks yang didukung; video dan PDF tidak dibaca.', 422));
   let size = 0; const chunks = [];
   res.on('data', chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = MAX_BYTES - size;
    if (bytes.length > remaining) {
     if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
     return stop(github ? err('README GitHub terlalu besar untuk dibaca.', 413) : null, github ? undefined : {type, data:Buffer.concat(chunks), truncated:true});
    }
    chunks.push(bytes); size += bytes.length;
   });
   res.on('end', () => finish(null,{type,data:Buffer.concat(chunks),truncated:false}));
   res.on('aborted', () => finish(err('Pembacaan halaman terputus.',502)));
   res.on('error', () => finish(err('Gagal membaca halaman.',502)));
  });
  timer = setTimeout(() => { finish(err('Halaman timeout.',504)); req.destroy(); },10000); timer.unref?.();
  req.on('error', () => finish(err('Halaman tidak tersedia.',502))); req.end();
 });
}

export async function fetchPublicText(input, {lookup=dns.lookup, request=https.request, allowUrl=()=>true} = {}) {
 const original = publicUrl(input);
 if (!allowUrl(original)) throw err('Domain halaman tidak diizinkan.',403);
 if (active >= 2) throw err('Pembacaan halaman sedang sibuk.',429);
 active++;
 try {
  const api = githubReadme(original); let u = api ? publicUrl(api) : original;
  const seen = new Set(); let result;
  for (let redirects = 0; ; redirects++) {
   if (seen.has(u.href)) throw err('Redirect halaman berulang.',502);
   seen.add(u.href);
   result = await fetchOnce(u,{lookup,request,github:Boolean(api)});
   if (!Object.hasOwn(result,'redirect')) break;
   if (redirects >= MAX_REDIRECTS) throw err('Terlalu banyak redirect halaman.',502);
   if (typeof result.redirect !== 'string' || !result.redirect.trim()) throw err('Redirect halaman tidak memiliki tujuan.',502);
   let next; try { next = new URL(result.redirect, u).href; } catch { throw err('Tujuan redirect tidak valid.',502); }
   u = publicUrl(next);
   if (!allowUrl(u)) throw err('Domain redirect tidak diizinkan.',403);
   // README API redirects may only stay on the official API host; never leak API requests to another site.
   if (api && u.hostname !== 'api.github.com') throw err('Redirect README GitHub tidak diizinkan.',403);
  }
  let text;
  try {
   const decoded = new TextDecoder('utf-8',{fatal:true}).decode(result.data,{stream:result.truncated});
   if (api) {
    const data = JSON.parse(decoded);
    if (data.encoding !== 'base64' || typeof data.content !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(data.content)) throw Error('invalid README');
    text = cleanReadme(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(data.content.replace(/\s/g,''),'base64')));
   } else text = result.type === 'text/html' ? plainHTML(decoded) : decoded.replace(/\s+/g,' ').trim();
  } catch { throw err(api ? 'README GitHub tidak tersedia sebagai teks UTF-8.' : 'Teks halaman harus UTF-8.',422); }
  if (!text) throw err('Tidak ada teks yang dapat diringkas; halaman mungkin memerlukan JavaScript.',422);
  return {text:text.slice(0,MAX_TEXT), truncated:result.truncated || text.length > MAX_TEXT, ...(api ? {source:'github-readme'} : {})};
 } finally { active--; }
}
