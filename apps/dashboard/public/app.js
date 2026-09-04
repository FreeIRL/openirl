const $ = (selector) => document.querySelector(selector);
const services = [ ["obs","OBS"], ["noalbs","NOALBS"], ["srtla","SRTLA"], ["mediaMtx","MediaMTX"], ["statsBridge","Stats bridge"] ];
const samples = [];
const events = [];
let previousConnected;

function formatBitrate(value) { return `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString()} kbps`; }
function age(timestamp) { if (!timestamp) return "No sample"; const seconds=Math.max(0,Math.round((Date.now()-timestamp)/1000)); return seconds<2?"Just now":`${seconds}s ago`; }
function serviceLabel(state) { return state === "healthy" ? "Healthy" : state === "degraded" ? "Degraded" : state === "offline" ? "Offline" : "Not connected"; }
function addEvent(title, detail) { events.unshift({ at:new Date(), title, detail }); events.splice(4); $("#event-list").innerHTML=events.map((event)=>`<li><time>${event.at.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time><div><strong>${event.title}</strong><p>${event.detail}</p></div></li>`).join(""); }

function drawChart() {
  const canvas=$("#chart"), rect=canvas.getBoundingClientRect(), ratio=window.devicePixelRatio||1;
  canvas.width=rect.width*ratio; canvas.height=190*ratio;
  const ctx=canvas.getContext("2d"); ctx.scale(ratio,ratio); const w=rect.width,h=190,p=14;
  ctx.strokeStyle="#2b3034";ctx.lineWidth=1;
  for(let i=0;i<4;i++){const y=p+(h-p*2)*i/3;ctx.beginPath();ctx.moveTo(p,y);ctx.lineTo(w-p,y);ctx.stroke()}
  if(samples.length<2)return; const max=Math.max(1000,...samples.map(s=>s.value))*1.1;
  ctx.strokeStyle="#35d07f";ctx.lineWidth=2;ctx.beginPath();samples.forEach((s,i)=>{const x=p+(w-p*2)*i/59,y=h-p-(h-p*2)*s.value/max;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();
}

function render(data) {
  const feed=data.feed??{}, connected=Boolean(feed.connected), bitrate=Number(feed.bitrate)||0;
  $("#bitrate").innerHTML=`${Math.round(bitrate).toLocaleString()}<small>kbps</small>`; $("#top-bitrate").textContent=formatBitrate(bitrate);
  $("#bitrate-meter").style.width=`${Math.min(100,bitrate/60)}%`; $("#last-update").textContent=age(feed.timestamp);
  const badge=$("#feed-badge");badge.className=`badge ${connected?"healthy":"offline"}`;badge.textContent=connected?"● Connected":"● Offline";
  $("#services").innerHTML=services.map(([key,name])=>{const item=data.services?.[key]??{state:"unknown"};return `<div class="service" title="${item.note??""}"><span class="dot ${item.state}"></span><span><strong>${name}</strong><small>${serviceLabel(item.state)}</small></span></div>`}).join("");
  $("#updated").textContent=`Updated ${age(data.checkedAt)}`; $("#control-note").textContent=data.controls?.reason??"Controls unavailable";
  if(previousConnected!==undefined&&previousConnected!==connected)addEvent(connected?"Feed reconnected":"Feed disconnected",connected?"MediaMTX is receiving Feed 1.":"No active publisher detected for Feed 1.");
  previousConnected=connected; samples.push({value:bitrate});if(samples.length>60)samples.shift();drawChart();
  $("#chart-summary").textContent=`Current bitrate ${formatBitrate(bitrate)}. RTT data is unavailable.`;
}

async function refresh(){try{const response=await fetch("/api/v1/dashboard/status",{cache:"no-store"});if(!response.ok)throw new Error(`HTTP ${response.status}`);render(await response.json())}catch(error){addEvent("Dashboard connection lost",String(error));$("#feed-badge").textContent="Dashboard offline"}}
addEvent("Dashboard ready","Live Feed 1 telemetry is sourced from stats-bridge.");refresh();setInterval(refresh,2000);addEventListener("resize",drawChart);
