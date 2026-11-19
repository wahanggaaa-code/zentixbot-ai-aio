// Isolated, bounded PDF text extraction. No URLs or user-provided filenames.
// Keep library diagnostics out of stdout: the parent expects one JSON value.
console.log = console.warn = console.error = (...args) => {
 try { process.stderr.write(args.map(String).join(' ') + '\n'); } catch { /* diagnostics must not break parsing */ }
};
try {
 let input = '';
 for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 3 * 1024 * 1024) throw Error('input too large');
 }
 const data = Buffer.from(input, 'base64');
 if (data.subarray(0, 5).toString() !== '%PDF-') throw Error('invalid PDF');
 const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task = getDocument({data: new Uint8Array(data), isEvalSupported:false, verbosity:0, disableFontFace:true, useSystemFonts:false, useWorkerFetch:false, disableAutoFetch:true, disableStream:true});
 const doc = await task.promise;
 try {
  const limit = Math.min(doc.numPages, 10); let text = '', pages = 0;
  for (let n = 1; n <= limit && text.length < 12000; n++) {
   const page = await doc.getPage(n);
   try {
    const content = await page.getTextContent();
    text += content.items.map(item => typeof item.str === 'string' ? item.str : '').join(' ') + '\n';
    pages++;
   } finally { page.cleanup(); }
  }
  process.stdout.write(JSON.stringify({text:text.slice(0,12000).trim(), truncated:pages < doc.numPages || text.length > 12000}));
 } finally { await task.destroy(); }
} catch { process.exitCode = 1; }
