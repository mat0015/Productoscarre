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
function parseAmount(raw, fromPriceField=false) {
  const value = String(raw).trim();
  // Carrefour/VTEX puede entregar el precio como entero expresado en centavos.
  if (fromPriceField && /^\d+$/.test(value) && value.length >= 5) return Number(value) / 100;
  if (value.includes('.') && value.includes(',')) return Number(value.replace(/\./g,'').replace(',','.'));
  if (value.includes(',')) return Number(value.replace(',','.'));
  // Un punto único seguido de 1 o 2 dígitos suele ser decimal JSON; con 3, miles AR.
  const parts = value.split('.');
  if (parts.length > 2) return Number(parts.join(''));
  if (parts.length === 2 && parts[1].length === 3) return Number(parts.join(''));
  return Number(value);
}
function extractAmounts(text, regexes, fromPriceField=false) {
  const values=[];
  for (const re of regexes) for (const m of text.matchAll(re)) {
    const n=parseAmount(m[1],fromPriceField);
    if (Number.isFinite(n)&&n>=100&&n<100000000&&!values.includes(n)) values.push(n);
  }
  return values;
}
function findPrices(text) {
  const offer = extractAmounts(text, [
    /(?:sellingPrice|spotPrice|salePrice|currentPrice|selling_price)["'\s:]{0,8}(?:\$\s*)?([\d.,]+)/gi,
    /(?:price|lowPrice)[^\d]{0,30}(\d{2,8}(?:[.,]\d{1,2})?)/gi
  ], true);
  const visible = extractAmounts(text, [/\$\s*([\d.]+(?:,\d{1,2})?)/g, /ARS\s*([\d.]+(?:,\d{1,2})?)/gi]);
  const original = extractAmounts(text, [
    /(?:listPrice|list_price|oldPrice|old_price|priceWithoutDiscount|listPriceWithoutDiscount)["'\s:]{0,8}(?:\$\s*)?([\d.,]+)/gi,
    /(?:precio\s*(?:de\s*)?(?:lista|original|tachado))[^\d]{0,20}(\d[\d.,]*)/gi
  ], true);
  const all = [...offer, ...visible];
  const salePrice = offer[0] ?? (all.length ? Math.min(...all) : null);
  const listPrice = original.find(n=>n !== salePrice) ?? (all.filter(n=>n > salePrice).sort((a,b)=>a-b)[0] ?? null);
  const promoMatch = text.match(/\b(\d+\s*[xX]\s*\d+[^\n<]{0,100})/i);
  return {price:salePrice, listPrice, promotion:promoMatch?.[1]?.replace(/\s+/g,' ').trim() ?? null};
}
async function getProduct(product) {
  const url = new URL(product.url);
  const res = await fetch(url, {headers:{...headers, 'X-VTEX-API-AppKey': process.env.VTEX_APP_KEY || ''}});
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return {...product, ...findPrices(text), checkedAt:new Date().toISOString(), status:'ok'};
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
for (const p of result) { const prev=old.products?.[p.url]?.price; const change=prev!=null&&p.price!=null ? p.price-prev : null; const delta=change===null?'':` (${change>0?'+':''}${money(change)})`; const list=p.listPrice!=null&&p.listPrice!==p.price?`\nPrecio de lista: ${money(p.listPrice)}`:''; const promo=p.promotion?`\nPromoción: ${p.promotion}`:''; lines.push(`${p.name}\nPrecio de oferta: ${money(p.price)}${delta}${list}${promo}\nEstado: ${p.status}`,''); }
await fs.writeFile(historyPath,JSON.stringify({updatedAt:new Date().toISOString(),products:Object.fromEntries(result.map(p=>[p.url,p]))},null,2));
await sendTelegram(lines.join('\n'));
console.log(lines.join('\n'));
