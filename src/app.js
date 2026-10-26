(function(){
const SB_URL="https://dfxnudfolvtlbkoypxav.supabase.co";
// Clave pública (anon): segura en el navegador; las reglas de la base de datos solo dejan ver y cambiar tus propias filas.
const SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmeG51ZGZvbHZ0bGJrb3lweGF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5NTk0NDAsImV4cCI6MjEwODUzNTQ0MH0.hdorCO3yrXRBRZ-B-P_caZwDVW1gW1-5QJ0a7C_rvig";
const sb=window.supabase.createClient(SB_URL,SB_KEY);

const S={user:null,series:[],settings:null,open:null,confirm:null,removing:false,checking:null,loaded:false,autoDone:false,authMode:"in"};
const $=id=>document.getElementById(id);
const DAY=864e5, EVERY=2*DAY, GRID_MAX=60;

const esc=t=>String(t??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isW=(s,n)=>n<=(s.up_to||0)||(s.extras||[]).includes(n);
function pending(s){let c=0;for(let n=(s.up_to||0)+1;n<=(s.latest||0);n++)if(!isW(s,n))c++;return c}
function nextEp(s){let n=(s.up_to||0)+1;while((s.extras||[]).includes(n))n++;return n}
const lastSeen=s=>Math.max(s.up_to||0,...(s.extras||[]),0);
const fill=(tpl,n)=>(tpl||"").replace("{n}",n);
const host=tpl=>{try{return new URL(fill(tpl,1)).host.replace(/^www\d*\./,"")}catch(_){return "otra web"}};
const finished=s=>s.total&&s.latest>=s.total;
function ago(iso){if(!iso)return null;const m=Math.round((Date.now()-Date.parse(iso))/6e4);if(m<1)return"ahora mismo";if(m<60)return`hace ${m} min`;const h=Math.round(m/60);if(h<48)return`hace ${h} h`;return`hace ${Math.round(h/24)} días`}
function normalize(up_to,extras){const set=new Set(extras.filter(n=>n>up_to));while(set.has(up_to+1)){set.delete(up_to+1);up_to++}return{up_to,extras:[...set].sort((a,b)=>a-b)}}
let toastT;function toast(t,warn){const el=$("toast");el.textContent=t;el.className="toast"+(warn?" warn":"");el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>el.hidden=true,warn?7000:4200)}

/* ---------- Datos ---------- */
const queues={};
function write(id,patch){
  const s=S.series.find(x=>x.id===id);if(s)Object.assign(s,patch);render();
  return queues[id]=(queues[id]||Promise.resolve()).then(async()=>{
    const {error}=await sb.from("series").update(Object.assign({},patch,{updated_at:new Date().toISOString()})).eq("id",id);
    if(error)toast("No se guardó el cambio: "+error.message,true);
  });
}
async function loadAll(){
  const [a,b]=await Promise.all([sb.from("series").select("*"),sb.from("settings").select("*").maybeSingle()]);
  if(a.error){toast("No se pudieron cargar tus series: "+a.error.message,true);return}
  S.series=a.data||[];S.settings=b.data||null;S.loaded=true;render();maybeAuto();
}
let channel;
function subscribe(){
  if(channel)sb.removeChannel(channel);
  channel=sb.channel("cambios")
    .on("postgres_changes",{event:"*",schema:"public",table:"series",filter:`user_id=eq.${S.user.id}`},p=>{
      if(p.eventType==="DELETE"){S.series=S.series.filter(x=>x.id!==p.old.id)}
      else{const i=S.series.findIndex(x=>x.id===p.new.id);if(i<0)S.series.push(p.new);else S.series[i]=p.new}
      if(!S.checking)render();
    })
    .on("postgres_changes",{event:"*",schema:"public",table:"settings",filter:`user_id=eq.${S.user.id}`},p=>{S.settings=p.new;render()})
    .subscribe();
}
function setWatched(s,n,mode){
  let up=s.up_to||0,ex=[...(s.extras||[])];
  if(mode==="unmark"){if(n<=up){for(let k=n+1;k<=up;k++)ex.push(k);up=n-1}ex=ex.filter(k=>k!==n)}
  else if(mode==="range")up=Math.max(up,n);
  else ex.push(n);
  write(s.id,normalize(up,ex));
}

/* ---------- Búsqueda (función en Supabase) ---------- */
async function runCheck(ids){
  if(S.checking)return;
  S.checking=ids?"Buscando…":`Buscando en ${S.series.length} series…`;render();
  try{
    const {data,error}=await sb.functions.invoke("buscar",{body:ids?{ids}:{}});
    if(error)throw error;
    if(!ids)toast(data.summary,!!(data.broken?.length||data.failed?.length)&&!data.news?.length);
    await loadAll();
  }catch(e){toast("No se pudo completar la búsqueda. Inténtalo de nuevo en un rato.",true)}
  finally{S.checking=null;render()}
}
function maybeAuto(){
  if(S.autoDone||!S.loaded||!S.series.length)return;
  S.autoDone=true;
  const last=S.settings?.last_check?Date.parse(S.settings.last_check):0;
  if(Date.now()-last>EVERY)runCheck();
}

/* ---------- Piezas visuales ---------- */
const imgTag=(src,cls="")=>`<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" ${cls} onerror="this.remove()">`;
const coverHtml=s=>`<span class="ph">${esc(s.title)}</span>`+(s.cover?imgTag(s.cover,'style="position:relative"'):"");
const bgStyle=s=>s.cover&&s.cover.startsWith("data:")?` style="background-image:url('${s.cover}')"`:(s.cover?` style="background-image:url('${esc(s.cover)}')"`:"");
function posterHtml(s){
  const p=pending(s),pct=s.latest?Math.min(100,Math.round(lastSeen(s)/s.latest*100)):0;
  const tag=p?`<span class="badge">${p} ${p===1?"nuevo":"nuevos"}</span>`:(finished(s)?`<span class="done">Vista</span>`:"");
  const sub=p?`Sigue con el ${nextEp(s)}`:(finished(s)?"Terminada":`Esperando el ${nextEp(s)}`);
  return `<button type="button" class="poster" data-open="${esc(s.id)}" aria-label="${esc(s.title)}, ${esc(sub)}">
    <span class="pimg">${coverHtml(s)}${tag}<span class="prog"><i style="width:${pct}%"></i></span></span>
    <span class="ptitle">${esc(s.title)}</span><span class="psub">${esc(sub)}</span></button>`;
}
const siteLine=s=>(s.cuevana?`${host(s.watch_tpl)} · Temporada ${s.season||1}`:host(s.watch_tpl));
function watchBtns(s,nx,big){
  const warn=s.watch_ok===false?`<span class="warnline">No se pudo comprobar el enlace principal; prueba otra web.</span>`:"";
  const alts=(s.alts||[]).map(t=>`<a class="btn soft small" href="${esc(fill(t,nx))}" target="_blank" rel="noopener noreferrer">${esc(host(t))} ↗</a>`).join("");
  return `<a class="btn play" href="${esc(fill(s.watch_tpl,nx))}" target="_blank" rel="noopener noreferrer"><span class="tri"></span>Ver capítulo ${nx}</a>
    <button type="button" class="soft" data-seen="${esc(s.id)}" data-n="${nx}">Marcar el ${nx} como visto</button>
    ${big?"":`${alts?`<span class="alts"><span>Otras webs:</span>${alts}</span>`:""}`}${warn}`;
}
function heroHtml(s){
  if(!s)return"";
  const p=pending(s),nx=nextEp(s);
  return `<section class="hero gut"><div class="hero-bg"${bgStyle(s)}></div>
    <div class="hero-in">${s.cover?`<div class="hero-cover">${imgTag(s.cover)}</div>`:""}
    <div class="hero-txt">
      <p class="hero-kicker">${p} ${p===1?"capítulo nuevo":"capítulos nuevos"} para ver</p>
      <h2>${esc(s.title)}</h2>
      <div class="facts"><span>Vas por el ${lastSeen(s)}</span><span>${s.latest} disponibles</span><span>${esc(siteLine(s))}</span></div>
      ${s.summary?`<p class="sum">${esc(s.summary)}</p>`:""}
      <div class="row-act">${watchBtns(s,nx,true)}<button type="button" class="soft" data-open="${esc(s.id)}">Episodios</button></div>
    </div></div></section>`;
}
function sheetHtml(s){
  const p=pending(s),nx=nextEp(s),out=nx<=(s.latest||0),latest=s.latest||0;
  const end=finished(s)?latest:latest+1;
  let start=1;if(end>GRID_MAX)start=Math.max(1,Math.min(nx-8,end-GRID_MAX+1));
  let chips=start>1?`<span class="more">1–${start-1}${isW(s,start-1)?" vistos":""}</span>`:"";
  for(let n=start;n<=end;n++){
    if(n>latest){chips+=`<button type="button" class="ep future" disabled title="Aún no ha salido">${n}</button>`;continue}
    const w=isW(s,n),nw=!w&&n>lastSeen(s);
    chips+=`<button type="button" class="ep${w?" seen":""}${nw?" new":""}${n===nx?" next":""}" data-ep="${n}" aria-pressed="${w}" title="${w?"Visto. Toca para desmarcar":"Toca para marcar como visto"}">${n}</button>`;
  }
  let conf="";
  if(S.confirm)conf=`<div class="confirm"><span>Te saltas capítulos anteriores al ${S.confirm}. ¿Qué marco como visto?</span>
    <button type="button" class="play small" data-mark="range" data-n="${S.confirm}">Del 1 al ${S.confirm}</button>
    <button type="button" class="soft small" data-mark="single" data-n="${S.confirm}">Solo el ${S.confirm}</button>
    <button type="button" class="link" data-cancel>Cancelar</button></div>`;
  const rm=S.removing?`<div class="confirm"><span>¿Quitar ${esc(s.title)} de tu lista? Se pierde el progreso guardado.</span>
    <button type="button" class="danger small" data-remove-yes>Quitar</button><button type="button" class="link" data-cancel>Cancelar</button></div>`:"";
  const webs=[s.watch_tpl,...(s.alts||[])].map((t,i)=>`<li><span class="wname">${esc(host(t))}${i===0?' <em>principal</em>':""}</span>
      <span class="wact">${i?`<button type="button" class="link" data-primary="${i-1}">Hacer principal</button><button type="button" class="link" data-dropalt="${i-1}">Quitar</button>`:(s.watch_ok===false?'<span class="warnline">sin comprobar</span>':s.watch_ok?'<span class="okline">funciona</span>':"")}</span></li>`).join("");
  return `<div class="card" role="dialog" aria-modal="true" aria-label="${esc(s.title)}">
    <div class="card-top"><div class="hero-bg"${bgStyle(s)}></div>
      ${s.cover?`<div class="hero-cover">${imgTag(s.cover)}</div>`:""}
      <div><h2>${esc(s.title)}</h2><div class="facts">${p?`<span style="color:var(--red);font-weight:800">${p} sin ver</span>`:`<b>Al día</b>`}<span>Vas por el ${lastSeen(s)}</span><span>${s.total?`${latest} de ${s.total}`:`${latest} disponibles`}</span><span>${esc(siteLine(s))}</span></div></div>
      <button type="button" class="close" data-close aria-label="Cerrar">✕</button></div>
    <div class="card-body">
      ${s.summary?`<p>${esc(s.summary)}</p>`:`<p style="color:var(--muted)">El resumen aparecerá tras la próxima búsqueda.</p>`}
      <div class="row-act" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">${out?watchBtns(s,nx,false):`<span style="color:var(--muted)">${finished(s)?"Has visto la serie completa.":"El capítulo "+nx+" aún no ha salido."}</span>`}</div>
      <div class="eps"><h4>Episodios</h4><p class="note">Toca un capítulo para marcarlo o desmarcarlo. En rojo, los que salieron después del último que viste.</p>
        <div class="grid">${chips}</div></div>
      ${conf}${rm}
      <div class="eps"><h4>Dónde verla</h4><p class="note">La búsqueda comprueba que la web principal abre el siguiente capítulo; si falla, pasa sola a la siguiente que funcione.</p>
        <ul class="webs">${webs}</ul>
        <form class="altform" data-altform><input id="altUrl" type="url" placeholder="Pega el enlace del capítulo ${Math.min(nx,latest)||1} en otra web" aria-label="Enlace del capítulo en otra web"><button type="submit" class="soft small">Añadir web</button></form>
        <p class="note" id="altMsg"></p></div>
      <div class="foot-act"><span>${s.latest_at?"Comprobada "+ago(s.latest_at):"Sin comprobar todavía"}</span><button type="button" class="link" data-remove>Quitar de mi lista</button></div>
    </div></div>`;
}
function addHtml(){
  return `<div class="card" role="dialog" aria-modal="true" aria-label="Añadir serie"><form class="add" id="addForm">
    <h2 style="font-family:var(--display);font-weight:400;font-size:40px;margin:0">Añadir serie</h2>
    <label>Enlace a un capítulo de AnimeFLV o Cuevana<input id="addUrl" type="url" placeholder="https://animeflv.ar/nombre-episodio-1-sub-espanol/" required></label>
    <div class="two"><label>Nombre<input id="addTitle" type="text" placeholder="Se rellena con el enlace"></label>
    <label>Último capítulo que viste<input id="addSeen" type="number" min="0" step="1" value="0"></label></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="play" type="submit">Guardar serie</button><button type="button" class="link" data-close>Cancelar</button><span id="addMsg" style="color:var(--muted);font-size:13.5px"></span></div>
  </form></div>`;
}
function emptyHtml(){
  return `<div class="welcome"><h2>Tu lista está vacía</h2>
    <p>Puedes traer las 17 series que ya seguías, con portadas, resúmenes y los capítulos que has visto.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="play" id="importBtn">Importar mis series</button><button type="button" class="soft" data-add>Añadir una serie</button></div></div>`;
}
function render(){
  const app=$("app"),login=$("login");
  if(!S.ready){app.hidden=true;login.hidden=true;return}
  if(!S.user){app.hidden=true;login.hidden=false;renderLogin();return}
  app.hidden=false;login.hidden=true;
  const all=S.series;
  const withNew=all.filter(s=>pending(s)>0).sort((a,b)=>(b.latest_at||"").localeCompare(a.latest_at||"")||pending(a)-pending(b));
  const waiting=all.filter(s=>!pending(s)&&!finished(s)).sort((a,b)=>a.title.localeCompare(b.title,"es"));
  const done=all.filter(s=>!pending(s)&&finished(s));
  const featured=withNew.find(s=>s.cover)||withNew[0];
  $("hero").innerHTML=S.loaded?heroHtml(featured):"";
  if(!S.loaded)$("rows").innerHTML=`<p class="empty">Cargando tus series…</p>`;
  else if(!all.length)$("rows").innerHTML=emptyHtml();
  else{
    const tot=withNew.reduce((a,s)=>a+pending(s),0);
    let h="";
    if(withNew.length)h+=`<section class="row"><h3>Capítulos nuevos · ${tot}</h3><div class="rail">${withNew.map(posterHtml).join("")}</div></section>`;
    h+=`<section class="row"><h3>Al día</h3><div class="rail">${waiting.map(posterHtml).join("")}<button type="button" class="poster addtile" data-add><span class="pimg">+</span><span class="ptitle">Añadir serie</span></button></div></section>`;
    if(done.length)h+=`<section class="row"><h3>Terminadas</h3><div class="rail">${done.map(posterHtml).join("")}</div></section>`;
    $("rows").innerHTML=h;
  }
  $("status").textContent=S.checking?S.checking:(S.settings?.last_check?`Buscado ${ago(S.settings.last_check)}`:"");
  $("checkBtn").disabled=!!S.checking||!all.length;
  const sh=$("sheet");
  if(S.open==="__add"){if(sh.hidden||!sh.querySelector("#addForm")){sh.innerHTML=addHtml();sh.hidden=false;wireAdd();setTimeout(()=>$("addUrl")&&$("addUrl").focus(),30)}}
  else if(S.open){const s=all.find(x=>x.id===S.open);if(!s){S.open=null;sh.hidden=true}else{const keep=$("altUrl")?.value||"";sh.innerHTML=sheetHtml(s);sh.hidden=false;if(keep&&$("altUrl"))$("altUrl").value=keep}}
  else sh.hidden=true;
  document.body.style.overflow=sh.hidden?"":"hidden";
}

/* ---------- Interacción ---------- */
document.addEventListener("click",async e=>{
  const t=e.target;
  if(t.id==="importBtn"){importSeed();return}
  if(t.id==="logoutBtn"){await sb.auth.signOut();return}
  const o=t.closest("[data-open]");if(o){S.open=o.dataset.open;S.confirm=null;S.removing=false;return render()}
  if(t.closest("[data-add]")){S.open="__add";return render()}
  if(t.closest("[data-close]")||t===$("sheet")){S.open=null;return render()}
  const sv=t.closest("[data-seen]");if(sv){const s=S.series.find(x=>x.id===sv.dataset.seen);if(s){setWatched(s,+sv.dataset.n,"range");toast(`Capítulo ${sv.dataset.n} marcado como visto`)}return}
  const s=S.series.find(x=>x.id===S.open);if(!s)return;
  if(t.closest("[data-cancel]")){S.confirm=null;S.removing=false;return render()}
  const ep=t.closest("[data-ep]");
  if(ep){const n=+ep.dataset.ep;S.removing=false;
    if(isW(s,n)){S.confirm=null;setWatched(s,n,"unmark")}
    else if(n===nextEp(s)){S.confirm=null;setWatched(s,n,"range")}
    else{S.confirm=n;render()}return}
  const mk=t.closest("[data-mark]");if(mk){const n=+mk.dataset.n;S.confirm=null;setWatched(s,n,mk.dataset.mark);return}
  const pr=t.closest("[data-primary]");if(pr){const i=+pr.dataset.primary,alts=[...(s.alts||[])];const nu=alts.splice(i,1)[0];write(s.id,{watch_tpl:nu,alts:[s.watch_tpl,...alts],watch_ok:null});toast(`${host(nu)} es ahora la web principal`);return}
  const dr=t.closest("[data-dropalt]");if(dr){const alts=[...(s.alts||[])];alts.splice(+dr.dataset.dropalt,1);write(s.id,{alts});return}
  if(t.closest("[data-remove]")){S.removing=true;S.confirm=null;return render()}
  if(t.closest("[data-remove-yes]")){const id=s.id;S.series=S.series.filter(x=>x.id!==id);S.open=null;render();
    const {error}=await sb.from("series").delete().eq("id",id);toast(error?"No se pudo quitar la serie.":"Serie quitada",!!error)}
});
document.addEventListener("submit",e=>{
  if(!e.target.matches("[data-altform]"))return;
  e.preventDefault();
  const s=S.series.find(x=>x.id===S.open);if(!s)return;
  const raw=($("altUrl").value||"").trim(),n=Math.min(nextEp(s),s.latest||1)||1;
  let u;try{u=new URL(raw)}catch(_){$("altMsg").textContent="Ese enlace no es válido.";return}
  // Convierte el enlace en plantilla sustituyendo el número del capítulo.
  const str=u.href,re=new RegExp(`(^|[^0-9])${n}(?=[^0-9]|$)`,"g");let last=-1,m;
  while((m=re.exec(str)))last=m.index+m[1].length;
  if(last<0){$("altMsg").textContent=`El enlace debe ser el del capítulo ${n}.`;return}
  const tpl=str.slice(0,last)+"{n}"+str.slice(last+String(n).length);
  if(tpl===s.watch_tpl||(s.alts||[]).includes(tpl)){$("altMsg").textContent="Esa web ya está en la lista.";return}
  write(s.id,{alts:[...(s.alts||[]),tpl]});toast(`${host(tpl)} añadida como alternativa`);
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&S.open){S.open=null;render()}});
$("checkBtn").addEventListener("click",()=>runCheck());

/* ---------- Añadir serie ---------- */
function parseLink(u){
  let m;try{u=new URL(u.trim())}catch(_){return null}
  const path=u.pathname;
  if(/animeflv/.test(u.hostname)){
    let slug,n=0;
    if(m=path.match(/^\/([a-z0-9-]+?)-episodio-(\d+)-sub-espanol\/?$/)){slug=m[1];n=+m[2]}
    else if(m=path.match(/^\/ver\/([a-z0-9-]+)-(\d+)\/?$/)){slug=m[1];n=+m[2]}
    else if(m=path.match(/^\/anime\/([a-z0-9-]+)\/?$/))slug=m[1];
    if(slug)return{site:"AnimeFLV",slug,n,watch_tpl:`https://animeflv.ar/${slug}-episodio-{n}-sub-espanol/`,alts:[`https://www4.animeflv.net/ver/${slug}-{n}`],check_url:`https://animeflv.ar/anime/${slug}/`};
  }
  if(/cuevana/.test(u.hostname)&&(m=path.match(/^\/serie\/([a-z0-9-]+)(?:\/(?:episodio-(\d+)x(\d+)|temporada-(\d+)))?\/?$/))){
    const se=+(m[2]||m[4]||1),p=`/serie/${m[1]}/episodio-${se}x{n}`;
    return{site:"Cuevana",cuevana:true,season:se,slug:m[1],n:m[3]?+m[3]:0,watch_tpl:`https://${u.hostname}${p}`,
      alts:["cuevana3c.pro","cuevana3k.pro","cuevana3r.pro"].filter(h=>h!==u.hostname).map(h=>`https://${h}${p}`),check_url:`https://${u.hostname}/serie/${m[1]}/temporada-${se}`};
  }
  return null;
}
const titleCase=slug=>slug.split("-").map(w=>w?w[0].toUpperCase()+w.slice(1):w).join(" ");
function wireAdd(){
  $("addUrl").addEventListener("input",()=>{const p=parseLink($("addUrl").value);if(p){if(!$("addTitle").value)$("addTitle").value=titleCase(p.slug);$("addSeen").value=p.n;$("addMsg").textContent=p.site+" reconocido"}else $("addMsg").textContent=""});
  $("addForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const p=parseLink($("addUrl").value);
    if(!p){$("addMsg").textContent="No reconozco ese enlace. Pega el de un capítulo de AnimeFLV o Cuevana.";return}
    const id=(p.slug+(p.cuevana?"-t"+p.season:"")).slice(0,120);
    if(S.series.some(s=>s.id===id)){$("addMsg").textContent="Esa serie ya está en tu lista.";return}
    const seen=Math.max(0,parseInt($("addSeen").value||"0",10));
    const row={id,title:$("addTitle").value.trim()||titleCase(p.slug),site:p.site,cuevana:!!p.cuevana,season:p.season||null,watch_tpl:p.watch_tpl,alts:p.alts,check_url:p.check_url,latest:Math.max(seen,p.n),up_to:seen,extras:[]};
    const {error}=await sb.from("series").insert(row);
    if(error){$("addMsg").textContent="No se pudo guardar: "+error.message;return}
    S.series.push(row);S.open=null;render();toast("Serie añadida. Busco sus capítulos y su portada…");runCheck([id]);
  });
}

/* ---------- Importar ---------- */
async function importSeed(){
  const b=$("importBtn");b.disabled=true;b.textContent="Importando…";
  try{
    const rows=await fetch("seed.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw 0;return r.json()});
    const {error}=await sb.from("series").upsert(rows.map(r=>Object.assign({},r,{user_id:S.user.id})));
    if(error)throw error;
    toast(`${rows.length} series importadas`);await loadAll();
  }catch(e){toast("No se pudo importar: "+(e.message||"falta el archivo de series"),true);b.disabled=false;b.textContent="Importar mis series"}
}

/* ---------- Inicio de sesión ---------- */
function renderLogin(){
  const up=S.authMode==="up";
  $("authTitle").textContent=up?"Crea tu cuenta":"Entra en tu cuenta";
  $("authBtn").textContent=up?"Crear cuenta":"Entrar";
  $("authSwitch").innerHTML=up?'¿Ya tienes cuenta? <button type="button" class="link" id="toIn">Entrar</button>':'¿Primera vez? <button type="button" class="link" id="toUp">Crear cuenta</button>';
  $("authPass").autocomplete=up?"new-password":"current-password";
}
document.addEventListener("click",e=>{
  if(e.target.id==="toUp"){S.authMode="up";$("authMsg").textContent="";renderLogin()}
  if(e.target.id==="toIn"){S.authMode="in";$("authMsg").textContent="";renderLogin()}
});
$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("authEmail").value.trim(),password=$("authPass").value,msg=$("authMsg");
  $("authBtn").disabled=true;msg.textContent="";
  try{
    if(S.authMode==="up"){
      const {data,error}=await sb.auth.signUp({email,password});
      if(error)throw error;
      if(!data.session)msg.textContent="Te he enviado un correo para confirmar la cuenta. Ábrelo y vuelve aquí para entrar.";
    }else{
      const {error}=await sb.auth.signInWithPassword({email,password});
      if(error)throw error;
    }
  }catch(err){
    msg.textContent=/Invalid login/i.test(err.message)?"Correo o contraseña incorrectos.":/not confirmed/i.test(err.message)?"Confirma tu correo antes de entrar; revisa tu bandeja de entrada.":/at least 6/i.test(err.message)?"La contraseña debe tener al menos 6 caracteres.":err.message;
  }finally{$("authBtn").disabled=false}
});
sb.auth.onAuthStateChange((_ev,session)=>{
  const u=session?.user||null;
  const first=!S.ready;S.ready=true;
  if(!first&&u?.id===S.user?.id)return;
  S.user=u;S.series=[];S.settings=null;S.loaded=false;S.autoDone=false;S.open=null;
  if(u){render();loadAll();subscribe()}else if(first){render()}else{if(channel)sb.removeChannel(channel);render()}
});
setInterval(()=>{if(!S.open&&S.user)render()},60000);
render();
})();
