/* Colour picker for greeting containers; the named colour input remains the saved source of truth. */
(() => {
 const presets=['#1abc9c','#2ecc71','#3498db','#9b59b6','#e91e63','#f1c40f','#e67e22','#e74c3c','#95a5a6','#607d8b','#36393f','#ffffff'];
 const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
 const rgbHex=(r,g,b)=>'#'+[r,g,b].map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
 const rgbOf=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
 function toHSV(hex){const [r,g,b]=rgbOf(hex).map(x=>x/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;if(d){if(max===r)h=((g-b)/d)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;h=(h*60+360)%360}return [h,max?d/max:0,max]}
 function fromHSV(h,s,v){const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let rgb;if(h<60)rgb=[c,x,0];else if(h<120)rgb=[x,c,0];else if(h<180)rgb=[0,c,x];else if(h<240)rgb=[0,x,c];else if(h<300)rgb=[x,0,c];else rgb=[c,0,x];return rgbHex(...rgb.map(y=>(y+m)*255))}
 function render(value,defaultColor){return `<div class="greeting-color" data-default="${defaultColor}"><input type="color" name="color" value="${value}" class="greeting-color-source" aria-label="Warna container"><div class="greeting-color-square" tabindex="0" role="slider" aria-label="Saturasi dan kecerahan warna" aria-valuemin="0" aria-valuemax="100"><span class="greeting-color-marker"></span></div><input class="greeting-color-hue" type="range" min="0" max="359" step="1" aria-label="Rona warna"><div class="greeting-color-values"><label>Hex<input type="text" maxlength="7" aria-label="Kode warna hex"></label>${['R','G','B'].map(c=>`<label>${c}<input type="number" min="0" max="255" step="1" aria-label="Komponen ${c}"></label>`).join('')}</div><div class="greeting-color-swatches">${presets.map(hex=>`<button type="button" data-color="${hex}" aria-label="Pilih ${hex}" style="background:${hex}"></button>`).join('')}</div><button type="button" class="f-outline greeting-color-reset">RESET</button></div>`;}
 function bind(form){const picker=form.querySelector('.greeting-color');if(!picker)return;const source=picker.querySelector('[name=color]'),square=picker.querySelector('.greeting-color-square'),marker=picker.querySelector('.greeting-color-marker'),hue=picker.querySelector('.greeting-color-hue'),hex=picker.querySelector('input[type=text]'),rgb=[...picker.querySelectorAll('input[type=number]')];let [h,s,v]=toHSV(source.value);
  function paint(){const value=fromHSV(h,s,v);square.style.backgroundColor=`hsl(${h} 100% 50%)`;marker.style.left=`${s*100}%`;marker.style.top=`${(1-v)*100}%`;square.setAttribute('aria-valuenow',String(Math.round(v*100)));square.setAttribute('aria-valuetext',`Saturasi ${Math.round(s*100)} persen, kecerahan ${Math.round(v*100)} persen`);hue.value=String(Math.round(h));hex.value=value.slice(1).toUpperCase();rgbOf(value).forEach((x,i)=>{rgb[i].value=String(x)});source.value=value;source.dispatchEvent(new Event('input',{bubbles:true}));}
  function setHex(value){if(!/^#?[0-9a-f]{6}$/i.test(value))return false;[h,s,v]=toHSV(value.startsWith('#')?value:'#'+value);paint();return true}
  source.addEventListener('input',e=>{if(e.isTrusted){[h,s,v]=toHSV(source.value);paint()}});
  hue.addEventListener('input',()=>{h=Number(hue.value);paint()});
  hex.addEventListener('input',()=>setHex(hex.value));hex.addEventListener('blur',()=>{if(!setHex(hex.value))paint()});
  rgb.forEach(input=>input.addEventListener('input',()=>{if(rgb.some(x=>x.value===''||!Number.isFinite(Number(x.value))))return;setHex(rgbHex(...rgb.map(x=>clamp(Number(x.value),0,255))))}));
  function pick(e){const r=square.getBoundingClientRect();if(!r.width||!r.height)return;s=clamp((e.clientX-r.left)/r.width,0,1);v=1-clamp((e.clientY-r.top)/r.height,0,1);paint()}
  square.addEventListener('pointerdown',e=>{square.setPointerCapture?.(e.pointerId);pick(e)});square.addEventListener('pointermove',e=>{if(e.buttons)pick(e)});
  square.addEventListener('keydown',e=>{const delta=e.shiftKey ? 0.1 : 0.01;if(e.key==='ArrowLeft')s=clamp(s-delta,0,1);else if(e.key==='ArrowRight')s=clamp(s+delta,0,1);else if(e.key==='ArrowUp')v=clamp(v+delta,0,1);else if(e.key==='ArrowDown')v=clamp(v-delta,0,1);else return;e.preventDefault();paint()});
  picker.querySelectorAll('[data-color]').forEach(button=>button.addEventListener('click',()=>setHex(button.dataset.color)));picker.querySelector('.greeting-color-reset').addEventListener('click',()=>setHex(picker.dataset.default));paint();
 }
 window.ZentixGreetingColor={render,bind};
})();
