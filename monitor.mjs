import fs from 'node:fs/promises';
import process from 'node:process';
import 'dotenv/config';

const cfg = JSON.parse(await fs.readFile(process.env.CONFIG_PATH || 'config.json', 'utf8'));
const historyPath = process.env.HISTORY_PATH || 'history.json';
const headers = {'User-Agent':'Mozilla/5.0 (compatible; CarrefourPriceMonitor/0.1; +local)', 'Accept-Language':'es-AR,es;q=0.9', 'X-Postal-Code': String(cfg.postalCode)};

function money(value) {
  if (value == null) return 'No disponible';
  return new Intl.NumberFormat('es-AR', {style:'currency', currency:'ARS', maximumFractionDigits:2}).format(value);
}
function findPrices(text) {
  const patterns = [/(?:price|sellingPrice|spotPrice|lowPrice)[^\d]{0,30}(\d{2,8}(?:[.,]\d{1,2})?)/gi, /\$\s?([\d.]+(?:,\d{1,2})?)/g];
  const values=[];
  for (const re of patterns) for (const m of text.matchAll(re)) {
    const n=Number(m[1].replace(/\./g,'').replace(',','.'));
    if (n>0 && n<100000000) values.push(n);
  }
  return values.sort((a,b)=>a-b)[0] ?? null;
}
async function getProduct(product) {
  const url = new URL(product.url);
  const res = await fetch(url, {headers:{...headers, 'X-VTEX-API-AppKey': process.env.VTEX_APP_KEY || ''}});
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return {...product, price:findPrices(text), checkedAt:new Date().toISOString(), status:'ok'};
}
async function sendTelegram(message) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) throw new Error('Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID');
  const endpoint=`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:process.env.TELEGRAM_CHAT_ID,text:message})});
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
}
const old = JSON.parse(await fs.readFile(historyPath,'utf8').catch(()=>'{"products":{}}'));
const result=[];
for (const p of cfg.products) { try { result.push(await getProduct(p)); } catch (e) { result.push({...p,price:null,status:`error: ${e.message}`,checkedAt:new Date().toISOString()}); } }
const lines=[`Precios Carrefour - ${new Date().toLocaleDateString('es-AR',{timeZone:cfg.timezone})}`,`Código postal: ${cfg.postalCode}`,''];
for (const p of result) { const prev=old.products?.[p.url]?.price; const change=p.price!=null&&prev!=null ? p.price-prev : null; const delta=change===null?'':` (${change>0?'+':''}${money(change)})`; lines.push(`${p.name}\nPrecio: ${money(p.price)}${delta}\nEstado: ${p.status}`,''); }
await fs.writeFile(historyPath,JSON.stringify({updatedAt:new Date().toISOString(),products:Object.fromEntries(result.map(p=>[p.url,p]))},null,2));
await sendTelegram(lines.join('\n'));
console.log(lines.join('\n'));
