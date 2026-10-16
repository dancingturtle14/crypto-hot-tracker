(function(){
"use strict";
const H=window.HotTracker,$=id=>document.getElementById(id),POLL=90000;
const MAJ=new Set(["BTCUSDT","ETHUSDT"]),GOLD=new Set(["PAXGUSDT","XAUTUSDT"]);
const BADGE={hot:"🔥 強勢",up:"⬆️ 轉強",warn:"⚠️ 小心"},COL={hot:"#4ade80",up:"#60a5fa",warn:"#fbbf24"};
const LS={get:(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const S=Object.assign({minVol:5000000,exMaj:false,exGold:true},LS.get("cht_settings",{}));
let watch=new Set(LS.get("cht_watch",[]));
let data=null,busy=false,tabs=[{id:"ov",title:"📊 總覽"},{id:"graph",title:"🕸️ 關係圖"}],active="ov";
const klCache={};// symbol -> {limit, kl, t}
const pct=v=>(v>=0?"+":"")+v.toFixed(2)+"%",cls=v=>v>=0?"pos":"neg";
const px=n=>n>=1000?n.toLocaleString(undefined,{maximumFractionDigits:2}):n>=1?n.toFixed(4):n>=0.01?n.toFixed(5):n.toPrecision(4);
const vol=n=>n>=1e9?"$"+(n/1e9).toFixed(2)+"B":"$"+(n/1e6).toFixed(1)+"M";
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const link=s=>"https://www.binance.com/en/trade/"+s.replace(/USDT$/,"_USDT")+"?type=spot";
const hkt=ms=>new Date(ms).toLocaleTimeString("zh-HK",{timeZone:"Asia/Hong_Kong",hour:"2-digit",minute:"2-digit",hour12:false});
function rows(){if(!data)return[];return data.rows.filter(r=>r.quote_volume_24h>=S.minVol&&!(S.exMaj&&MAJ.has(r.symbol))&&!(S.exGold&&GOLD.has(r.symbol)));}
function find(sym){return data&&data.rows.find(r=>r.symbol===sym);}
function saveS(){LS.set("cht_settings",S);}
function coinA(r,inner){return '<span data-coin="'+r.symbol+'">'+(inner||esc(r.base))+'</span>';}

function spark(c,stop,h){h=h||60;const w=300,lo=Math.min(...c,stop==null?Infinity:stop),hi=Math.max(...c),k=hi>lo?hi-lo:1;
 const y=v=>h-4-(v-lo)/k*(h-8),pts=c.map((v,i)=>(i/(c.length-1)*w).toFixed(1)+","+y(v).toFixed(1)).join(" ");
 const col=c[c.length-1]>=c[0]?"#4ade80":"#fb7185";
 return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" height="'+h+'">'+(stop!=null?'<line x1="0" x2="'+w+'" y1="'+y(stop)+'" y2="'+y(stop)+'" stroke="#fbbf24" stroke-dasharray="4 4"/>':'')+'<polyline fill="none" stroke="'+col+'" stroke-width="2" points="'+pts+'"/></svg>';}

/* ---------- sidebar ---------- */
function renderTree(){const q=$("search").value.trim().toUpperCase(),rs=rows().filter(r=>!q||r.base.includes(q));
 const item=r=>'<div class="item'+(active===r.symbol?" on":"")+'" data-open="'+r.symbol+'"><button class="star'+(watch.has(r.symbol)?" on":"")+'" data-star="'+r.symbol+'">'+(watch.has(r.symbol)?"★":"☆")+'</button><span data-coin="'+r.symbol+'">'+esc(r.base)+'</span><span class="sc">'+r.score.toFixed(0)+'</span></div>';
 const w=[...watch].filter(s=>!q||s.includes(q));
 let h='<details class="fold" open><summary>⭐ 觀察清單 ('+w.length+')</summary>'+(w.length?w.map(s=>{const r=find(s);return r?item(r):'<div class="item" data-open="'+s+'"><button class="star on" data-star="'+s+'">★</button>'+esc(s.replace(/USDT$/,""))+'<span class="sc">—</span></div>'}).join(""):'<div class="item small">撳 ☆ 加入</div>')+'</details>';
 for(const k of ["hot","up","warn"]){const g=rs.filter(r=>H.classify(r)===k);h+='<details class="fold" open><summary>'+BADGE[k]+' ('+g.length+')</summary>'+g.map(item).join("")+'</details>';}
 h+='<details class="fold"><summary>⚙️ 設定</summary><div class="set"><label class="small">最低24小時成交額 (USDT)<input type="number" class="inp" id="minVol" value="'+S.minVol+'" step="1000000"></label><label><input type="checkbox" id="exMaj"'+(S.exMaj?" checked":"")+'> 唔睇 BTC / ETH</label><label><input type="checkbox" id="exGold"'+(S.exGold?" checked":"")+'> 唔睇黃金幣</label></div></details>';
 $("tree").innerHTML=h;
 const mv=$("minVol");mv.onchange=()=>{S.minVol=+mv.value||0;saveS();renderAll();};
 $("exMaj").onchange=e=>{S.exMaj=e.target.checked;saveS();renderAll();};
 $("exGold").onchange=e=>{S.exGold=e.target.checked;saveS();renderAll();};
}
function toggleStar(s){watch.has(s)?watch.delete(s):watch.add(s);LS.set("cht_watch",[...watch]);renderTree();if(active===s)renderView();}

/* ---------- tabs ---------- */
function renderTabs(){$("tabs").innerHTML=tabs.map(t=>'<button class="tab'+(t.id===active?" on":"")+'" data-tab="'+t.id+'">'+esc(t.title)+(t.id!=="ov"&&t.id!=="graph"?'<span class="x" data-close="'+t.id+'">✕</span>':'')+'</button>').join("");
 const on=$("tabs").querySelector(".on");if(on&&on.scrollIntoView)on.scrollIntoView({inline:"nearest",block:"nearest"});}
function openTab(id){if(id!=="ov"&&id!=="graph"&&!tabs.find(t=>t.id===id))tabs.push({id,title:id.replace(/USDT$/,"")});active=id;$("app").classList.remove("open");renderTabs();renderTree();renderView();}
function closeTab(id){const i=tabs.findIndex(t=>t.id===id);if(i<0)return;tabs.splice(i,1);if(active===id)active=tabs[Math.max(0,i-1)].id;renderTabs();renderTree();renderView();}

/* ---------- views ---------- */
function renderView(){stopGraph();hidePop();const v=$("view");
 if(!data){v.innerHTML='<div class="pane"><div class="callout info"><div class="ct">ℹ️ 載入緊</div>正在由 Binance 攞即時數據…</div></div>';return;}
 if(active==="ov")v.innerHTML=ovHTML(),bindOv();else if(active==="graph")v.innerHTML=graphHTML(),startGraph();else coinView(active);
 v.scrollTop=0;}
function moodCallout(){const m=H.mood(data);const t={strong:["tip","💪","市況：強","好多幣喺度升，機會較多"],neutral:["info","😐","市況：中性","有啲機會，揀強勢嘅睇"],weak:["warning","🥶","市況：偏弱","機會少，宜觀望"]}[m.level];
 return '<div class="callout '+t[0]+'"><div class="ct">'+t[1]+' '+t[2]+' <span class="small" style="font-weight:400">· '+t[3]+'</span></div><div class="small">過去1小時 '+data.rising1h+' / '+data.measured+' 隻高成交幣上升</div><div class="bar"><i style="width:'+(m.ratio*100).toFixed(0)+'%"></i></div></div>';}
function disclaimer(){return '<footer><div class="callout warning"><div class="ct">⚠️ 風險提示</div><div class="small">訊號只根據成交量＋價格動能計算，並非投資建議；本頁唔會自動落單。加密貨幣波動極大，高風險，請自行判斷及控制注碼。數據每90秒由 Binance 即時更新。</div></div></footer>';}
function ovHTML(){const rs=rows(),top=rs.slice(0,3),t10=rs.slice(0,10);
 let h='<div class="pane">'+moodCallout()+'<h2>而家值得留意</h2><div class="cards">';
 h+=top.length?top.map(r=>{const c=H.classify(r);return '<div class="card" data-open="'+r.symbol+'"><div class="ch"><span class="coin" data-coin="'+r.symbol+'">'+esc(r.base)+'</span><span class="badge '+c+'">'+BADGE[c]+'</span></div><div class="callout '+(c==="warn"?"warning":c==="hot"?"tip":"info")+'" style="margin:8px 0;padding:6px 10px">'+H.reason(r)+'</div>'+spark(r.closes,r.low_1h)+'<div class="small">過去6小時（15分鐘K）· 黃虛線 = 參考止蝕位</div><div class="nums"><div><span class="small">現價</span><b>'+px(r.price)+'</b></div><div><span class="small">參考止蝕位</span><b style="color:var(--w)">'+px(r.low_1h)+'</b></div><div><span class="small">熱度分數</span><b>'+r.score.toFixed(0)+'</b></div></div></div>';}).join(""):'<div class="callout info"><div class="ct">ℹ️ 暫時冇</div>而家冇幣符合條件，可以休息下。</div>';
 h+='</div><div class="grid2"><div><h2>熱度排行 Top 10</h2><div class="panel">'+t10.map(r=>'<div class="brow" data-open="'+r.symbol+'"><span data-coin="'+r.symbol+'">'+esc(r.base)+'</span><span class="t"><i style="width:'+r.score.toFixed(0)+'%;background:'+COL[H.classify(r)]+'"></i></span><b>'+r.score.toFixed(0)+'</b></div>').join("")+'<div class="small" style="margin-top:6px">熱度分數 0–100：綜合15分鐘升幅、1小時升幅、成交量倍數同成交額。撳一下打開。</div></div></div>';
 h+='<div><h2>升幅 vs 成交量</h2><div class="panel">'+scatter(t10)+'<div class="small">右上角 = 升得多又多人買。撳點打開。</div></div></div></div>';
 h+='<details class="dd"><summary>📋 睇詳細數據</summary><div class="tw"><table><thead><tr><th>#</th><th>幣</th><th>熱度分數</th><th>價格</th><th>15分鐘升幅</th><th>1小時升幅</th><th>24小時升跌</th><th>成交量倍數</th><th>24小時成交額</th></tr></thead><tbody>'+rs.map((r,i)=>'<tr data-open="'+r.symbol+'"><td>'+(i+1)+'</td><td data-coin="'+r.symbol+'">'+esc(r.base)+'</td><td>'+r.score.toFixed(1)+'</td><td>'+px(r.price)+'</td><td class="'+cls(r.pct_15m)+'">'+pct(r.pct_15m)+'</td><td class="'+cls(r.pct_1h)+'">'+pct(r.pct_1h)+'</td><td class="'+cls(r.pct_24h)+'">'+pct(r.pct_24h)+'</td><td>'+r.vol_spike.toFixed(2)+'x</td><td>'+vol(r.quote_volume_24h)+'</td></tr>').join("")+'</tbody></table></div></details>';
 return h+disclaimer()+'</div>';}
function bindOv(){}
function scatter(t){if(!t.length)return"";const w=320,h=200,p=28,xs=t.map(r=>r.vol_spike),ys=t.map(r=>r.pct_1h);
 const x1=Math.max(...xs,2),y0=Math.min(...ys,0),y1=Math.max(...ys,1),X=v=>p+v/x1*(w-p-24),Y=v=>h-p-(v-y0)/(y1-y0)*(h-p-14);
 let s='<svg viewBox="0 0 '+w+' '+h+'"><line x1="'+p+'" x2="'+w+'" y1="'+Y(0)+'" y2="'+Y(0)+'" stroke="#363636"/><line x1="'+X(1)+'" x2="'+X(1)+'" y1="0" y2="'+(h-p)+'" stroke="#363636" stroke-dasharray="3 3"/><text x="'+(w/2)+'" y="'+(h-6)+'" fill="#999" font-size="11" text-anchor="middle">成交量倍數 →</text><text x="10" y="'+(h/2)+'" fill="#999" font-size="11" transform="rotate(-90 10 '+(h/2)+')" text-anchor="middle">1小時升幅 →</text>';
 t.forEach(r=>{s+='<g class="dot" data-open="'+r.symbol+'" data-coin="'+r.symbol+'"><circle cx="'+X(r.vol_spike)+'" cy="'+Y(r.pct_1h)+'" r="'+(4+r.score/14)+'" fill="'+COL[H.classify(r)]+'" opacity=".75"/><text x="'+(X(r.vol_spike)+6)+'" y="'+(Y(r.pct_1h)-6)+'" fill="#dcddde" font-size="10">'+esc(r.base)+'</text></g>';});
 return s+'</svg>';}

/* ---------- coin detail ---------- */
let range=24;
function coinView(sym){const r=find(sym),v=$("view"),base=sym.replace(/USDT$/,"");
 if(!r){v.innerHTML='<div class="pane"><h1>'+esc(base)+'</h1><div class="callout warning"><div class="ct">⚠️ 唔喺熱度榜</div>呢隻幣而家冇上升動能或者唔夠成交額，所以冇評分。</div><button class="btn" data-star="'+sym+'">'+(watch.has(sym)?"★ 移除觀察":"☆ 加入觀察")+'</button> <a class="btn" target="_blank" rel="noopener" href="'+link(sym)+'">去 Binance ↗</a><div class="chartbox" style="margin-top:10px"><div id="dchart" class="small">載入走勢…</div><div class="ctipbox" id="ctip"></div></div>'+disclaimer()+'</div>';loadChart(sym,null);return;}
 const c=H.classify(r),ct=c==="warn"?"warning":c==="hot"?"tip":"info";
 v.innerHTML='<div class="pane"><div class="dh"><h1>'+esc(r.base)+'</h1><span class="badge '+c+'">'+BADGE[c]+'</span><button class="btn" data-star="'+sym+'">'+(watch.has(sym)?"★ 已觀察":"☆ 加入觀察")+'</button><a class="btn" target="_blank" rel="noopener" href="'+link(sym)+'">去 Binance ↗</a></div>'+
 '<div class="callout '+ct+'"><div class="ct">'+BADGE[c]+' 點解？</div>'+H.reason(r)+'<div class="small" style="margin-top:4px">'+({hot:"1小時升 ≥2% 同成交量 ≥1.5倍：動能同資金都跟緊。",up:"開始上升，但力度未算好強，可以等確認。",warn:"24小時大跌、1小時仲跌緊或者成交量唔夠，呢個反彈可能係假突破。"}[c])+'</div></div>'+
 '<div class="dh" style="justify-content:space-between;margin:10px 0 6px"><span class="small">15分鐘K線 · 黃虛線 = 參考止蝕位（最近1小時低位，唔係建議）</span><span class="seg" id="seg">'+[6,12,24].map(n=>'<button data-range="'+n+'" class="'+(n===range?"on":"")+'">'+n+'h</button>').join("")+'</span></div>'+
 '<div class="chartbox"><div id="dchart" class="small">載入走勢…</div><div class="ctipbox" id="ctip"></div></div>'+
 '<div class="nums" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))">'+[["現價",px(r.price)],["參考止蝕位",'<span style="color:var(--w)">'+px(r.low_1h)+'</span>'],["熱度分數",r.score.toFixed(1)],["15分鐘升幅",'<span class="'+cls(r.pct_15m)+'">'+pct(r.pct_15m)+'</span>'],["1小時升幅",'<span class="'+cls(r.pct_1h)+'">'+pct(r.pct_1h)+'</span>'],["24小時升跌",'<span class="'+cls(r.pct_24h)+'">'+pct(r.pct_24h)+'</span>'],["成交量倍數",r.vol_spike.toFixed(2)+"x"],["24小時成交額",vol(r.quote_volume_24h)],["距止蝕位",(((r.price-r.low_1h)/r.price)*100).toFixed(2)+"%"]].map(x=>'<div><span class="small">'+x[0]+'</span><b>'+x[1]+'</b></div>').join("")+'</div>'+disclaimer()+'</div>';
 loadChart(sym,r.low_1h);}
async function loadChart(sym,stop){const lim=range*4,k=sym+":"+lim;let kl=klCache[k]&&Date.now()-klCache[k].t<POLL?klCache[k].kl:null;
 if(!kl){try{kl=await H.fetchKlines(sym,lim);klCache[k]={kl,t:Date.now()};}catch(e){const d=$("dchart");if(d)d.textContent="走勢載入失敗";return;}}
 if(active!==sym||!$("dchart"))return;drawChart(kl,stop);}
function drawChart(kl,stop){const box=$("dchart"),W=600,PH=220,VH=60,H2=PH+VH+18;
 const c=kl.map(k=>+k[4]),hi=kl.map(k=>+k[2]),lo=kl.map(k=>+k[3]),v=kl.map(k=>+k[7]),o=kl.map(k=>+k[1]),t=kl.map(k=>k[0]);
 const mn=Math.min(...lo,stop==null?Infinity:stop),mx=Math.max(...hi),rg=mx-mn||1,n=kl.length,PW=W-58,bw=PW/n,mv=Math.max(...v)||1;
 const Y=p=>8+(mx-p)/rg*(PH-16),X=i=>i*bw+bw/2;
 let s='<svg id="dsvg" viewBox="0 0 '+W+' '+H2+'" style="touch-action:pan-y">';
 for(let g=0;g<=3;g++){const p=mn+rg*g/3;s+='<line x1="0" x2="'+PW+'" y1="'+Y(p)+'" y2="'+Y(p)+'" stroke="#303030"/><text x="'+(W-2)+'" y="'+(Y(p)+3)+'" fill="#777" font-size="10" text-anchor="end">'+px(p)+'</text>';}
 for(let i=0;i<n;i++){const up=c[i]>=o[i],col=up?"#4ade80":"#fb7185";s+='<line x1="'+X(i)+'" x2="'+X(i)+'" y1="'+Y(hi[i])+'" y2="'+Y(lo[i])+'" stroke="'+col+'" opacity=".7"/><rect x="'+(X(i)-bw*.35)+'" width="'+(bw*.7)+'" y="'+Y(Math.max(o[i],c[i]))+'" height="'+Math.max(1,Math.abs(Y(o[i])-Y(c[i])))+'" fill="'+col+'"/><rect x="'+(X(i)-bw*.35)+'" width="'+(bw*.7)+'" y="'+(H2-v[i]/mv*VH)+'" height="'+(v[i]/mv*VH)+'" fill="'+col+'" opacity=".4"/>';}
 if(stop!=null)s+='<line x1="0" x2="'+W+'" y1="'+Y(stop)+'" y2="'+Y(stop)+'" stroke="#fbbf24" stroke-dasharray="6 4" stroke-width="1.5"/><text x="4" y="'+(Y(stop)+12)+'" fill="#fbbf24" font-size="10">參考止蝕 '+px(stop)+'</text>';
 s+='<line id="cx" y1="0" y2="'+H2+'" stroke="#a88bfa" stroke-dasharray="3 3" visibility="hidden"/><line id="cy" x1="0" x2="'+W+'" stroke="#a88bfa" stroke-dasharray="3 3" visibility="hidden"/></svg><div class="small" style="display:flex;justify-content:space-between"><span>'+hkt(t[0])+' HKT</span><span>成交量</span><span>'+hkt(t[n-1])+' HKT</span></div>';
 box.innerHTML=s;const svg=$("dsvg"),tip=$("ctip");
 const mvH=e=>{const rc=svg.getBoundingClientRect(),i=Math.max(0,Math.min(n-1,Math.floor((e.clientX-rc.left)/rc.width*W/bw)));
  $("cx").setAttribute("x1",X(i));$("cx").setAttribute("x2",X(i));$("cx").setAttribute("visibility","visible");
  $("cy").setAttribute("y1",Y(c[i]));$("cy").setAttribute("y2",Y(c[i]));$("cy").setAttribute("visibility","visible");
  tip.innerHTML='<b>'+px(c[i])+'</b> · '+hkt(t[i])+' HKT<br><span class="'+cls(c[i]-o[i])+'">'+pct((c[i]-o[i])/o[i]*100)+'</span> · 量 '+vol(v[i]);
  tip.style.display="block";const bx=box.parentNode.getBoundingClientRect();let lx=e.clientX-bx.left+12;if(lx>bx.width-150)lx-=170;tip.style.left=lx+"px";tip.style.top=(e.clientY-bx.top-50)+"px";};
 const out=()=>{tip.style.display="none";$("cx").setAttribute("visibility","hidden");$("cy").setAttribute("visibility","hidden");};
 svg.addEventListener("pointermove",mvH);svg.addEventListener("pointerdown",mvH);svg.addEventListener("pointerleave",out);}

/* ---------- graph view ---------- */
let G=null;
function graphHTML(){return '<div class="pane" style="max-width:none"><div class="callout note"><div class="ct">🕸️ 關係圖</div><div class="small">點大細 = 熱度分數，顏色 = 訊號；有線連住 = 15分鐘走勢相似（相關度 &gt; 0.6），通常會一齊升跌。拖動點、雙指／滾輪縮放、拖背景移動，撳點打開。</div></div><div class="legend small">'+["hot","up","warn"].map(k=>'<span><span style="color:'+COL[k]+'">●</span> '+BADGE[k]+'</span>').join("")+'<span id="gstat"></span></div><div id="graphWrap"><canvas id="graph"></canvas></div></div>';}
function buildGraph(){const rs=rows().slice(0,20),nodes=rs.map((r,i)=>{const a=i/rs.length*Math.PI*2;return{r,x:Math.cos(a)*120,y:Math.sin(a)*120,vx:0,vy:0,rad:8+r.score/6,col:COL[H.classify(r)]};}),edges=[];
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const c=H.corr(nodes[i].r.closes,nodes[j].r.closes);if(c>0.6)edges.push({a:nodes[i],b:nodes[j],c});}
 return{nodes,edges};}
function startGraph(){const cv=$("graph"),wrap=$("graphWrap"),ctx=cv.getContext("2d"),dpr=window.devicePixelRatio||1;
 const {nodes,edges}=buildGraph();$("gstat").textContent=nodes.length+" 隻幣 · "+edges.length+" 條相關線";
 const view={x:0,y:0,k:1};let alpha=1,raf=0,drag=null,pan=null;const ptrs=new Map();let pinch=null;
 function size(){const r=wrap.getBoundingClientRect();cv.width=r.width*dpr;cv.height=r.height*dpr;view.x=view.x||r.width/2;view.y=view.y||r.height/2;}
 size();
 function tick(){if(alpha>0.01){for(const a of nodes){for(const b of nodes)if(a!==b){let dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy||1;const f=1800/d2;a.vx+=dx*f/Math.sqrt(d2)*alpha;a.vy+=dy*f/Math.sqrt(d2)*alpha;}a.vx-=a.x*0.01*alpha;a.vy-=a.y*0.01*alpha;}
  for(const e of edges){const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,d=Math.sqrt(dx*dx+dy*dy)||1,f=(d-90)*0.02*alpha;e.a.vx+=dx/d*f;e.a.vy+=dy/d*f;e.b.vx-=dx/d*f;e.b.vy-=dy/d*f;}
  for(const n of nodes){if(n===drag)continue;n.vx*=0.6;n.vy*=0.6;n.x+=n.vx;n.y+=n.vy;}alpha*=0.985;}
  draw();raf=requestAnimationFrame(tick);}
 function draw(){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,cv.width,cv.height);ctx.translate(view.x,view.y);ctx.scale(view.k,view.k);
  for(const e of edges){ctx.strokeStyle="rgba(168,139,250,"+(0.15+(e.c-0.6)*1.5)+")";ctx.lineWidth=1+(e.c-0.6)*5;ctx.beginPath();ctx.moveTo(e.a.x,e.a.y);ctx.lineTo(e.b.x,e.b.y);ctx.stroke();}
  for(const n of nodes){ctx.fillStyle=n.col;ctx.globalAlpha=n===drag?1:.85;ctx.beginPath();ctx.arc(n.x,n.y,n.rad,0,7);ctx.fill();ctx.globalAlpha=1;if(watch.has(n.r.symbol)){ctx.strokeStyle="#fbbf24";ctx.lineWidth=2;ctx.stroke();}
   ctx.fillStyle="#dcddde";ctx.font="12px Inter,system-ui,sans-serif";ctx.textAlign="center";ctx.fillText(n.r.base,n.x,n.y+n.rad+13);}}
 function world(e){const r=cv.getBoundingClientRect();return{x:(e.clientX-r.left-view.x)/view.k,y:(e.clientY-r.top-view.y)/view.k};}
 function hit(p){for(let i=nodes.length-1;i>=0;i--){const n=nodes[i];if((n.x-p.x)**2+(n.y-p.y)**2<(n.rad+6)**2)return n;}return null;}
 let downAt=null;
 cv.onpointerdown=e=>{cv.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===2){const [a,b]=[...ptrs.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y),k:view.k};drag=null;pan=null;return;}
  const p=world(e),n=hit(p);downAt={x:e.clientX,y:e.clientY,n};if(n){drag=n;alpha=Math.max(alpha,.3);}else pan={x:e.clientX-view.x,y:e.clientY-view.y};};
 cv.onpointermove=e=>{if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pinch&&ptrs.size===2){const [a,b]=[...ptrs.values()];view.k=Math.max(.3,Math.min(4,pinch.k*Math.hypot(a.x-b.x,a.y-b.y)/pinch.d));return;}
  if(drag){const p=world(e);drag.x=p.x;drag.y=p.y;drag.vx=drag.vy=0;alpha=Math.max(alpha,.1);}else if(pan){view.x=e.clientX-pan.x;view.y=e.clientY-pan.y;}};
 cv.onpointerup=cv.onpointercancel=e=>{ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=null;
  if(downAt&&downAt.n&&Math.hypot(e.clientX-downAt.x,e.clientY-downAt.y)<6){const s=downAt.n.r.symbol;downAt=null;drag=null;openTab(s);return;}
  downAt=null;drag=null;pan=null;};
 cv.onwheel=e=>{e.preventDefault();const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,k2=Math.max(.3,Math.min(4,view.k*(e.deltaY<0?1.1:.9)));view.x=mx-(mx-view.x)*k2/view.k;view.y=my-(my-view.y)*k2/view.k;view.k=k2;};
 const ro=new ResizeObserver(size);ro.observe(wrap);
 G={stop(){cancelAnimationFrame(raf);ro.disconnect();}};tick();}
function stopGraph(){if(G){G.stop();G=null;}}

/* ---------- preview popover ---------- */
let popT=0,lp=0;
function showPop(el){const r=find(el.dataset.coin);if(!r)return;const c=H.classify(r),p=$("pop");
 p.innerHTML='<div class="ch"><b>'+esc(r.base)+'</b><span class="badge '+c+'">'+BADGE[c]+'</span></div>'+spark(r.closes,r.low_1h,44)+'<div class="small">熱度 <b style="color:var(--t)">'+r.score.toFixed(0)+'</b> · 1h <span class="'+cls(r.pct_1h)+'">'+pct(r.pct_1h)+'</span> · 量 '+r.vol_spike.toFixed(1)+'x</div>';
 const b=el.getBoundingClientRect();p.style.display="block";let x=b.left,y=b.bottom+6;if(x+230>innerWidth)x=innerWidth-230;if(y+120>innerHeight)y=b.top-126;p.style.left=Math.max(4,x)+"px";p.style.top=y+"px";}
function hidePop(){clearTimeout(popT);$("pop").style.display="none";}
document.addEventListener("pointerover",e=>{if(e.pointerType!=="mouse")return;const el=e.target.closest&&e.target.closest("[data-coin]");clearTimeout(popT);if(el)popT=setTimeout(()=>showPop(el),250);else hidePop();});
document.addEventListener("touchstart",e=>{const el=e.target.closest&&e.target.closest("[data-coin]");clearTimeout(lp);if(el)lp=setTimeout(()=>showPop(el),450);},{passive:true});
document.addEventListener("touchend",()=>{clearTimeout(lp);setTimeout(hidePop,1500);},{passive:true});

/* ---------- command palette ---------- */
let palItems=[],palSel=0;
function cmds(){return[{l:"⟳ 立即刷新",f:load},{l:"📊 去總覽",f:()=>openTab("ov")},{l:"🕸️ 去關係圖",f:()=>openTab("graph")},{l:(S.exGold?"✅":"⬜")+" 唔睇黃金幣（切換）",f:()=>{S.exGold=!S.exGold;saveS();renderAll();}},{l:(S.exMaj?"✅":"⬜")+" 唔睇 BTC/ETH（切換）",f:()=>{S.exMaj=!S.exMaj;saveS();renderAll();}}];}
function palRender(){const q=$("palIn").value.trim().toUpperCase();
 const coins=rows().filter(r=>!q||r.base.includes(q)).slice(0,12).map(r=>({l:'<span style="color:'+COL[H.classify(r)]+'">●</span> '+esc(r.base)+' <span class="small" style="margin-left:auto">熱度 '+r.score.toFixed(0)+'</span>',f:()=>openTab(r.symbol)}));
 const cs=cmds().filter(c=>!q||c.l.toUpperCase().includes(q));palItems=coins.concat(cs);palSel=Math.min(palSel,Math.max(0,palItems.length-1));
 $("palList").innerHTML=palItems.map((it,i)=>'<div class="pi'+(i===palSel?" on":"")+'" data-pi="'+i+'">'+it.l+'</div>').join("")||'<div class="pi small">冇結果</div>';}
function palOpen(){$("pal").classList.add("show");$("palIn").value="";palSel=0;palRender();setTimeout(()=>$("palIn").focus(),10);}
function palClose(){$("pal").classList.remove("show");}
function palRun(i){const it=palItems[i];palClose();if(it)it.f();}
$("palIn").addEventListener("input",()=>{palSel=0;palRender();});
$("palIn").addEventListener("keydown",e=>{if(e.key==="ArrowDown"){palSel=Math.min(palItems.length-1,palSel+1);palRender();e.preventDefault();}else if(e.key==="ArrowUp"){palSel=Math.max(0,palSel-1);palRender();e.preventDefault();}else if(e.key==="Enter")palRun(palSel);else if(e.key==="Escape")palClose();});
$("pal").addEventListener("click",e=>{const p=e.target.closest("[data-pi]");if(p)palRun(+p.dataset.pi);else if(e.target.id==="pal")palClose();});
document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();palOpen();}else if(e.key==="Escape"){palClose();$("app").classList.remove("open");}});

/* ---------- global clicks ---------- */
document.addEventListener("click",e=>{const t=e.target;
 const st=t.closest("[data-star]");if(st){e.stopPropagation();toggleStar(st.dataset.star);return;}
 const cl=t.closest("[data-close]");if(cl){e.stopPropagation();closeTab(cl.dataset.close);return;}
 const tb=t.closest("[data-tab]");if(tb){openTab(tb.dataset.tab);return;}
 const rg=t.closest("[data-range]");if(rg){range=+rg.dataset.range;document.querySelectorAll("#seg button").forEach(b=>b.classList.toggle("on",+b.dataset.range===range));const r=find(active);loadChart(active,r?r.low_1h:null);return;}
 const op=t.closest("[data-open]");if(op){hidePop();openTab(op.dataset.open);}});
$("menuBtn").onclick=()=>$("app").classList.add("open");$("sideClose").onclick=$("scrim").onclick=()=>$("app").classList.remove("open");
$("palBtn").onclick=palOpen;$("btnR").onclick=load;$("search").oninput=renderTree;

function renderAll(){renderTabs();renderTree();renderView();}
async function load(){if(busy)return;busy=true;$("btnR").style.opacity=.4;$("st").textContent="更新緊…";
 try{data=await H.compute({topN:30});for(const k in klCache)delete klCache[k];
  $("st").textContent="更新於 "+hkt(Date.now())+" HKT · 每90秒自動更新";
  if(active==="graph"&&G){renderTree();}else renderAll();}
 catch(e){$("st").textContent="連線失敗："+e.message;if(!data)$("view").innerHTML='<div class="pane"><div class="callout warning"><div class="ct">⚠️ 攞唔到 Binance 數據</div>'+esc(e.message)+'，稍後再試。</div></div>';}
 busy=false;$("btnR").style.opacity=1;}
renderAll();load();setInterval(load,POLL);
})();
