import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { createGunzip, createBrotliDecompress, createInflate } from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

// Metadata is only a fallback, not the article itself. Never execute scripts or
// follow URLs contained in metadata. parse5 decodes attribute entities for us.
function pageDescription(html) {
 const doc = parse(html), nodes = [doc], descriptions = {};
 while (nodes.length) {
  const node = nodes.pop();
  if (node.tagName === 'meta') {
   const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name.toLowerCase(), a.value]));
   const key = (attrs.name || attrs.property || '').toLowerCase();
   if (['description', 'og:description', 'twitter:description'].includes(key) && typeof attrs.content === 'string') descriptions[key] ||= attrs.content.replace(/\s+/g, ' ').trim();
  }
  if (node.childNodes) nodes.push(...node.childNodes);
 }
 return descriptions.description || descriptions['og:description'] || descriptions['twitter:description'] || '';
}

// Accept only explicit articleBody fields from JSON-LD; do not execute JS,
// traverse URLs, or treat descriptions as complete article text.
function structuredArticle(html) {
 const doc = parse(html), nodes = [doc], candidates = [];
 while (nodes.length) {
  const node = nodes.pop();
  if (node.tagName === 'script' && node.attrs?.some(a => a.name === 'type' && a.value.toLowerCase().split(';')[0].trim() === 'application/ld+json')) {
   const raw = (node.childNodes || []).map(n => n.value || '').join('');
   try {
    const values = [JSON.parse(raw)]; let visited = 0;
    while (values.length && visited++ < 5000) {
     const value = values.pop();
     if (!value || typeof value !== 'object') continue;
     if ((Array.isArray(value['@type']) ? value['@type'] : [value['@type']]).some(t => typeof t === 'string' && /(?:^|\/)(?:Article|NewsArticle|BlogPosting|TechArticle|ScholarlyArticle|Report)$/i.test(t)) && typeof value.articleBody === 'string' && value.articleBody.trim()) candidates.push(value.articleBody.replace(/\s+/g, ' ').trim());
     for (const child of Object.values(value)) if (child && typeof child === 'object') values.push(child);
    }
   } catch { /* malformed structured data is not executable */ }
  }
  if (node.childNodes) nodes.push(...node.childNodes);
 }
 return candidates.sort((a,b) => b.length-a.length)[0] || '';
}

function decodePage(data, type, charset, truncated) {
 let name = charset?.toLowerCase() || '';
 if (!name && type === 'text/html') {
  const prefix = data.subarray(0, 4096).toString('latin1');
  name = /<meta\s+[^>]*charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i.exec(prefix)?.[1]?.toLowerCase() || '';
 }
 const allowed = new Set(['utf-8','utf8','windows-1252','iso-8859-1','iso-8859-2','windows-1251','shift_jis','euc-jp','gbk','big5']);
 if (name && !allowed.has(name)) throw Error('unsupported charset');
 return new TextDecoder(name || 'utf-8',{fatal:true}).decode(data,{stream:truncated});
}

// Discohook's public guide routes load their content from same-origin static assets.
// Only these exact route shapes are mapped; no user-supplied URL becomes a fetch target.
function discohookGuide(url) {
 if (url.hostname !== 'discohook.app' || url.search) return null;
 if (/^\/guide\/?$/.test(url.pathname)) return { url: 'https://discohook.app/guide-index.json', index: true };
 const match = /^\/guide\/([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)\/?$/.exec(url.pathname);
 return match ? { url: `https://discohook.app/guide-files/${match[1]}.md`, index: false } : null;
}
function guideIndex(data) {
 const index = JSON.parse(data);
 if (!index || typeof index !== 'object' || Array.isArray(index)) throw Error('invalid guide index');
 const rows = [];
 for (const [category, entries] of Object.entries(index).slice(0, 30)) {
  if (!Array.isArray(entries)) continue;
  for (const entry of entries.slice(0, 100)) {
   if (typeof entry?.title !== 'string' || typeof entry?.description !== 'string') continue;
   rows.push(`${category}: ${entry.title.slice(0, 200)} — ${entry.description.slice(0, 500)}`);
  }
 }
 return rows.join('\n');
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

// Only declared caption tracks inside an actual video element qualify. No JS,
// external track hosts, data URLs, or arbitrary redirects are followed.
function videoCaptionUrl(html, pageUrl) {
 const nodes = [parse(html)];
 while (nodes.length) {
  const node = nodes.pop();
  if (node.tagName === 'video') {
   for (const child of node.childNodes || []) {
    if (child.tagName !== 'track') continue;
    const attrs = Object.fromEntries((child.attrs || []).map(a => [a.name.toLowerCase(),a.value]));
    if (!['captions','subtitles'].includes((attrs.kind || '').toLowerCase()) || !attrs.src) continue;
    try {
     const url = publicUrl(new URL(attrs.src, pageUrl).href);
     if (url.origin === pageUrl.origin) return url;
    } catch { /* ignore invalid or unsafe tracks */ }
   }
  }
  if (node.childNodes) nodes.push(...node.childNodes);
 }
 return null;
}

function captionText(data) {
 const lines = data.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
 if (!/^WEBVTT(?:\s|$)/.test(lines.shift() || '')) throw err('File subtitle WebVTT tidak valid.',422);
 let inNote = false; const out = [];
 for (const line of lines) {
  const value = line.trim();
  if (!value) { inNote = false; continue; }
  if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(value)) { inNote = true; continue; }
  if (inNote || value.includes('-->') || /^\d+$/.test(value)) continue;
  const text = value.replace(/<[^>]*>/g,'').trim();
  if (text && text !== out.at(-1)) out.push(text);
 }
 return out.join(' ');
}

function srtText(data) {
 const chunks = data.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
 const output = [];
 const timing = /^\s*\d{2,}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2,}:\d{2}:\d{2}[,.]\d{3}(?:\s+.*)?$/;
 for (const chunk of chunks) {
  const lines = chunk.split('\n');
  const at = lines.findIndex(line => timing.test(line));
  if (at < 0 || at > 1 || (at === 1 && !/^\s*\d+\s*$/.test(lines[0]))) continue;
  const text = lines.slice(at + 1).join(' ').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
  if (text && text !== output.at(-1)) output.push(text);
 }
 if (!output.length) throw err('File subtitle SRT tidak valid atau kosong.',422);
 return output.join(' ');
}

async function pdfText(data) {
 if (data.subarray(0,5).toString() !== '%PDF-') throw err('PDF tidak valid.',422);
 return new Promise((resolve,reject) => {
  const worker = fileURLToPath(new URL('./workers/linkPdf.js',import.meta.url));
  const child = spawn(process.execPath,['--max-old-space-size=96',worker],{env:{PATH:process.env.PATH || ''},stdio:['pipe','pipe','ignore']});
  let output = '', settled = false;
  const finish = (error,value) => { if (settled) return; settled=true; clearTimeout(timer); error ? reject(error) : resolve(value); };
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(err('Pembacaan PDF timeout.',504));},12000); timer.unref?.();
  child.on('error',()=>finish(err('Pembaca PDF tidak tersedia.',503)));
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>100000){child.kill('SIGKILL');finish(err('Hasil PDF terlalu besar.',422));}});
  child.on('close',code=>{try{const result=JSON.parse(output);if(code!==0 || typeof result.text!=='string' || typeof result.truncated!=='boolean')throw Error();finish(null,result);}catch{finish(err('PDF tidak valid, terenkripsi, atau tidak dapat dibaca.',422));}});
  child.stdin.on('error',()=>{}); child.stdin.end(data.toString('base64'));
 });
}

async function fetchOnce(u, {lookup, request, github, guide}) {
 const pinned = await resolveAddress(u.hostname, lookup);
 return new Promise((resolve, reject) => {
  let done = false, timer;
  const finish = (e, value) => { if (done) return; done = true; clearTimeout(timer); e ? reject(e) : resolve(value); };
  const req = request(u, {method:'GET', agent:false, family:pinned.family, autoSelectFamily:false,
   lookup:(_host,opts,cb) => opts?.all ? cb(null,[pinned]) : cb(null,pinned.address,pinned.family),
   headers:{Accept:github?'application/vnd.github+json':guide?.index?'application/json':'text/html,text/plain,text/markdown,text/vtt,application/x-subrip,application/pdf','Accept-Encoding':'gzip, deflate, br','User-Agent':'ZentixBot-LinkSummary/1.0'}}, res => {
   const status = res.statusCode, contentType = String(res.headers['content-type'] || ''), type = contentType.split(';')[0].trim().toLowerCase();
   const charset = /(?:^|;)\s*charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i.exec(contentType)?.[1];
   const encoding = String(res.headers['content-encoding'] || 'identity').trim().toLowerCase();
   const stop = (e, value) => { finish(e, value); res.destroy(); };
   if ([301,302,303,307,308].includes(status)) return stop(null, {redirect:res.headers.location});
   if (status !== 200) return stop(err(github && status === 404 ? 'README repository tidak ditemukan atau repository tidak publik.' : github && status === 403 ? 'GitHub menolak permintaan README atau batas akses API tercapai.' : `Halaman tidak tersedia (HTTP ${status || 'tidak diketahui'}).`, 502));
   if (!['identity','gzip','deflate','br'].includes(encoding)) return stop(err('Situs mengirim kompresi yang belum didukung.', 502));
   if (github || guide?.index ? type !== 'application/json' : !['text/html','text/plain','text/markdown','text/vtt','application/x-subrip','application/pdf'].includes(type)) return stop(err(github ? 'Respons README GitHub bukan JSON yang didukung.' : 'Jenis halaman tidak didukung; video belum dapat dibaca.', 422));
   let size = 0, wire = 0; const chunks = [];
   const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null;
   const stream = decoder || res;
   const abort = (error, value) => { if (decoder) decoder.destroy(); stop(error, value); };
   res.on('data', chunk => { wire += chunk.length; if (decoder && wire > MAX_BYTES) abort(err('Data halaman terlalu besar.', 413)); });
   stream.on('data', chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = MAX_BYTES - size;
    if (bytes.length > remaining) {
     if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
     return abort(github || guide?.index || type === 'application/pdf' ? err('Respons terlalu besar untuk dibaca.', 413) : null, github || guide?.index || type === 'application/pdf' ? undefined : {type, charset, data:Buffer.concat(chunks), truncated:true});
    }
    chunks.push(bytes); size += bytes.length;
   });
   stream.on('end', () => finish(null,{type,charset,data:Buffer.concat(chunks),truncated:false}));
   res.on('aborted', () => { if (decoder) decoder.destroy(); finish(err('Pembacaan halaman terputus.',502)); });
   res.on('error', () => { if (decoder) decoder.destroy(); finish(err('Gagal membaca halaman.',502)); });
   if (decoder) { decoder.on('error', () => stop(err('Kompresi halaman rusak atau tidak dapat dibaca.',502))); res.pipe(decoder); }

  });
  timer = setTimeout(() => { finish(err('Halaman timeout.',504)); req.destroy(); },10000); timer.unref?.();
  req.on('error', () => finish(err('Halaman tidak tersedia.',502))); req.end();
 });
}

export async function fetchPublicText(input, {lookup=dns.lookup, request=https.request, allowUrl=()=>true, includeVideoCaptions=false} = {}) {
 const original = publicUrl(input);
 if (!allowUrl(original)) throw err('Domain halaman tidak diizinkan.',403);
 if (active >= 2) throw err('Pembacaan halaman sedang sibuk.',429);
 active++;
 try {
  const api = githubReadme(original), guide = discohookGuide(original); let u = api ? publicUrl(api) : guide ? publicUrl(guide.url) : original;
  if (!allowUrl(u)) throw err('Domain halaman tidak diizinkan.',403);
  const seen = new Set(); let result;
  for (let redirects = 0; ; redirects++) {
   if (seen.has(u.href)) throw err('Redirect halaman berulang.',502);
   seen.add(u.href);
   result = await fetchOnce(u,{lookup,request,github:Boolean(api),guide});
   if (!Object.hasOwn(result,'redirect')) break;
   if (redirects >= MAX_REDIRECTS) throw err('Terlalu banyak redirect halaman.',502);
   if (typeof result.redirect !== 'string' || !result.redirect.trim()) throw err('Redirect halaman tidak memiliki tujuan.',502);
   let next; try { next = new URL(result.redirect, u).href; } catch { throw err('Tujuan redirect tidak valid.',502); }
   u = publicUrl(next);
   if (!allowUrl(u)) throw err('Domain redirect tidak diizinkan.',403);
   // README API redirects may only stay on the official API host; never leak API requests to another site.
   if (guide && u.hostname !== 'discohook.app') throw err('Redirect panduan Discohook tidak diizinkan.',403);
   if (api && u.hostname !== 'api.github.com') throw err('Redirect README GitHub tidak diizinkan.',403);
  }
  if (result.type === 'application/pdf' && !api && !guide) {
   const pdf = await pdfText(result.data);
   if (!pdf.text) throw err('PDF tidak memiliki teks yang dapat dibaca; PDF hasil scan memerlukan OCR.',422);
   return {text:pdf.text.slice(0,MAX_TEXT),truncated:pdf.truncated || pdf.text.length > MAX_TEXT,source:'pdf'};
  }
  let text, source, decoded;
  try {
   decoded = decodePage(result.data, result.type, result.charset, result.truncated);
   if (api) {
    const data = JSON.parse(decoded);
    if (data.encoding !== 'base64' || typeof data.content !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(data.content)) throw Error('invalid README');
    text = cleanReadme(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(data.content.replace(/\s/g,''),'base64')));
   } else if (result.type === 'text/vtt' || (result.type === 'text/plain' && /\.vtt$/i.test(u.pathname))) { text = captionText(decoded); source = 'captions'; }
   else if (result.type === 'application/x-subrip' || (result.type === 'text/plain' && /\.srt$/i.test(u.pathname))) { text = srtText(decoded); source = 'captions'; }
   else if (guide?.index) { text = guideIndex(decoded); source = 'discohook-guide-index'; }
   else if (guide) { text = cleanReadme(decoded.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, '')); source = 'discohook-guide'; }
   else if (result.type === 'text/html') {
    text = plainHTML(decoded);
    const article = structuredArticle(decoded);
    if (article && article.length > text.length) { text = article; source = 'structured-article'; }
    if (!text) { text = pageDescription(decoded); if (text) source = 'metadata'; }
   } else text = decoded.replace(/\s+/g,' ').trim();
  } catch (error) { if (error?.status) throw error; throw err(api ? 'README GitHub tidak tersedia sebagai teks UTF-8.' : guide?.index ? 'Daftar panduan Discohook tidak tersedia sebagai JSON yang didukung.' : 'Encoding teks halaman tidak didukung atau teks rusak.',422); }
  if (includeVideoCaptions && !api && !guide && result.type === 'text/html') {
   const track = videoCaptionUrl(decoded, u);
   if (track && allowUrl(track)) {
    try {
     const captions = await fetchOnce(track,{lookup,request});
     if (Object.hasOwn(captions,'redirect')) throw Error('invalid caption response');
     const content = decodePage(captions.data,captions.type,captions.charset,captions.truncated);
     const parsed = captions.type === 'text/vtt' || (captions.type === 'text/plain' && /\.vtt$/i.test(track.pathname)) ? captionText(content) : captions.type === 'application/x-subrip' || (captions.type === 'text/plain' && /\.srt$/i.test(track.pathname)) ? srtText(content) : '';
     if (!parsed) throw Error('empty captions');
     return {text:parsed.slice(0,MAX_TEXT),truncated:captions.truncated || parsed.length > MAX_TEXT,source:'captions'};
    } catch { throw err('Subtitle video tidak dapat dibaca. Coba kirim tautan subtitle WebVTT atau SRT publik secara langsung.',422); }
   }
  }
  if (!text) throw err('Tidak ada teks yang dapat diringkas; halaman mungkin memerlukan JavaScript.',422);
  return {text:text.slice(0,MAX_TEXT), truncated:result.truncated || text.length > MAX_TEXT, ...(api ? {source:'github-readme'} : source ? {source} : {})};
 } finally { active--; }
}
