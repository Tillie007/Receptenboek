const ALLOWED_ORIGIN = 'https://tillie007.github.io';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}
function isPrivateHost(host) {
  const h=host.toLowerCase();
  return h==='localhost'||h==='127.0.0.1'||h==='0.0.0.0'||h==='::1'||h.endsWith('.local')||
    /^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h)||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}
function stripHtml(s=''){return String(s).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim()}
function findRecipe(o){
  if(!o)return null;
  if(Array.isArray(o)){for(const x of o){const y=findRecipe(x);if(y)return y}}
  else if(typeof o==='object'){
    const t=o['@type'];
    if(t==='Recipe'||(Array.isArray(t)&&t.includes('Recipe')))return o;
    if(o['@graph']){const y=findRecipe(o['@graph']);if(y)return y}
    for(const k of ['mainEntity','mainEntityOfPage']){if(o[k]){const y=findRecipe(o[k]);if(y)return y}}
  }
  return null;
}
function instructions(v){
  if(!v)return[];
  if(typeof v==='string')return v.split(/\n+/).map(stripHtml).filter(Boolean);
  if(Array.isArray(v))return v.flatMap(x=>{
    if(typeof x==='string')return[stripHtml(x)];
    if(x?.itemListElement)return instructions(x.itemListElement);
    if(x?.text)return[stripHtml(x.text)];
    return[];
  }).filter(Boolean);
  return v?.text?[stripHtml(v.text)]:[];
}
function author(v){
  if(!v)return'';
  if(typeof v==='string')return v;
  if(Array.isArray(v))return v.map(author).filter(Boolean).join(', ');
  return v.name||'';
}
function image(v){
  if(!v)return'';
  if(typeof v==='string')return v;
  if(Array.isArray(v))return image(v[0]);
  return v.url||v.contentUrl||'';
}
function decodeJsonLd(raw){
  const candidates=[raw,raw.replace(/[\u0000-\u001F]+/g,' ')];
  for(const c of candidates){try{return JSON.parse(c)}catch{}}
  return null;
}
function parseJsonLd(html){
  const re=/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while((m=re.exec(html))){
    const obj=decodeJsonLd(m[1].trim());
    const r=findRecipe(obj);
    if(r)return r;
  }
  return null;
}
function normalize(r,url){
  const cat=Array.isArray(r.recipeCategory)?r.recipeCategory.join(', '):(r.recipeCategory||'');
  const y=Array.isArray(r.recipeYield)?r.recipeYield.join(', '):(r.recipeYield||'');
  return {
    title:stripHtml(r.name||''),
    type:stripHtml(cat),
    season:'',
    servings:stripHtml(y),
    wine:'',
    chef:stripHtml(author(r.author)),
    rating:0,
    source:url,
    image:image(r.image),
    ingredients:(r.recipeIngredient||[]).map(stripHtml).filter(Boolean),
    steps:instructions(r.recipeInstructions),
    notes:'',
    prepTime:r.prepTime||'',
    cookTime:r.cookTime||'',
    totalTime:r.totalTime||'',
    cuisine:Array.isArray(r.recipeCuisine)?r.recipeCuisine.join(', '):(r.recipeCuisine||'')
  };
}
export default async function handler(req,res){
  cors(res);
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return res.status(405).json({error:'Gebruik POST.'});
  try{
    const input=typeof req.body==='string'?JSON.parse(req.body):req.body;
    const target=new URL(input?.url||'');
    if(!['http:','https:'].includes(target.protocol)||isPrivateHost(target.hostname))return res.status(400).json({error:'Ongeldige receptlink.'});
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);
    const upstream=await fetch(target.toString(),{signal:controller.signal,redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; MijnRecepten/1.0)','Accept':'text/html,application/xhtml+xml'}});
    clearTimeout(timer);
    if(!upstream.ok)throw new Error('Website antwoordde met '+upstream.status);
    const type=upstream.headers.get('content-type')||'';
    if(!type.includes('text/html'))throw new Error('De link is geen webpagina.');
    const html=(await upstream.text()).slice(0,5000000);
    const recipe=parseJsonLd(html);
    if(!recipe)return res.status(422).json({error:'Geen gestructureerd recept gevonden op deze pagina.'});
    return res.status(200).json({ok:true,recipe:normalize(recipe,target.toString())});
  }catch(e){
    return res.status(400).json({error:e?.name==='AbortError'?'De website reageerde te traag.':(e?.message||'Importeren mislukt.')});
  }
}