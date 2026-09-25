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
function cleanPromo(value) {
  if (typeof value !== 'string') return null;
  const text=value.replace(/\s+/g,' ').trim();
  return /\b\d+\s*[xX]\s*\d+\b/.test(text) && !/[A-Za-z0-9+/]{45,}\.?/.test(text) ? text : null;
}
function findStructuredPrices(data) {
  const item=data?.[0]?.items?.[0] ?? data?.items?.[0] ?? data?.item ?? data;
  const offer=item?.sellers?.[0]?.commertialOffer ?? item?.seller?.commertialOffer ?? data?.commertialOffer ?? {};
  const product=data?.[0] ?? data;
  const price=Number(offer.Price ?? product.Price ?? offer.price ?? product.price);
  const listPrice=Number(offer.ListPrice ?? product.ListPrice ?? offer.PriceWithoutDiscount ?? product.PriceWithoutDiscount);
  const teaser=data?.[0]?.PromotionTeasers?.[0]?.Name ?? data?.PromotionTeasers?.[0]?.Name ?? data?.[0]?.Teasers?.[0]?.['<Name>k__BackingField'] ?? null;
  const promotion=cleanPromo(teaser) ?? cleanPromo(Object.values(product?.productClusters ?? {}).find(v=>cleanPromo(v)));
  const code=promotion?.match(/\b(\d+)\s*[xX]\s*(\d+)\b/);
  const buy=code?Number(code[1]):null, pay=code?Number(code[2]):null;
  const promoUnitPrice=promotion&&buy>pay&&Number.isFinite(listPrice)&&listPrice>0?listPrice*pay/buy:null;
  if (!Number.isFinite(price) || price<=0) return null;
  return {price, listPrice:Number.isFinite(listPrice)&&listPrice>0?listPrice:null, promotion, promoUnitPrice:promoUnitPrice?Math.round(promoUnitPrice*100)/100:null, promoBuy:buy, promoPay:pay};
}
function findPrices(text) {
  try { const data=JSON.parse(text); const structured=findStructuredPrices(data); if (structured) return structured; } catch {}
  return {price:null,listPrice:null,promotion:null,promoUnitPrice:null,promoBuy:null,promoPay:null};
}
async function getProduct(product) {
  const path=new URL(product.url).pathname.replace(/^\//,'').replace(/\/p\/?$/,'');
  const reference=product.url.match(/-(\d+)\/p(?:[?#].*)?$/)?.[1];
  const endpoints=[
    `https://www.carrefour.com.ar/api/catalog_system/pub/products/search/${path}`,
    reference?`https://www.carrefour.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_RefId:${reference}`:null
  ].filter(Boolean);
  for (const apiUrl of endpoints) {
    const res=await fetch(apiUrl,{headers});
    const text=await res.text();
    if (!res.ok) continue;
    const prices=findPrices(text);
    if (prices.price!=null) return {...product,...prices,checkedAt:new Date().toISOString(),status:'ok'};
  }
  throw new Error('API Catalog no devolvió un precio');
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
for (const p of result) { const base=p.listPrice??p.price; const baseLine=base!=null?`\nPrecio de lista: ${money(base)}`:''; const promo=p.promotion?`\nPromoción: ${p.promotion}`:''; const promoPrice=p.promoUnitPrice!=null?`\nPrecio con promoción: ${money(p.promoUnitPrice)} por unidad`:`\nPrecio actual: ${money(p.price)}`; lines.push(`${p.name}${baseLine}${promo}${promoPrice}`,''); }
await fs.writeFile(historyPath,JSON.stringify({updatedAt:new Date().toISOString(),products:Object.fromEntries(result.map(p=>[p.url,p]))},null,2));
await sendTelegram(lines.join('\n'));
console.log(lines.join('\n'));
