import {modules,getModule} from './data.js';
import {simulate,sample,MODEL_VERSION} from './simulation.js';
import {MechanismScene} from './renderer.js';
import {validateCommand,parseLocalRequest} from './director.js';

const $=s=>document.querySelector(s);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storageKey='endolab.history.v1';
let records=[];try{const parsed=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(parsed))records=parsed.filter(r=>r&&modules.some(m=>m.id===r.module)&&typeof r.label==='string'&&Number.isFinite(r.time)&&typeof r.date==='string'&&typeof r.scenario==='string'&&getModule(r.module).scenarios.some(s=>s.id===r.scenario)&&r.time>=0&&r.time<=getModule(r.module).duration).slice(-50);}catch{}
const state={module:modules[0],scenario:'normal',time:60,playing:false,speed:1,view:'lab',compare:false,branchAt:null,focus:null,manual:false,trajectories:null};
let toastTimer,scene,lastFrame=performance.now(),paintTimer=0;
document.querySelector('#app').innerHTML=`
<div class="shell">
  <aside class="sidebar" aria-label="系统导航">
    <div class="brand"><div class="brand-symbol">E</div><div><div class="brand-name">EndoMet</div><small>STUDIO · 内分泌与代谢</small></div></div>
    <button class="side-button" data-view="overview"><span class="side-icon">▦</span>系统总览</button>
    <div class="nav-label">机制实验室 / SYSTEMS</div>
    ${modules.map((m,i)=>`<button class="side-button ${i===0?'active':''}" data-module="${m.id}" style="--color:${m.color}"><span class="side-icon">${m.icon}</span>${m.short}<span class="side-num">${String(i+1).padStart(2,'0')}</span></button>`).join('')}
    <div class="nav-label">学习空间</div>
    <button class="side-button" data-view="course"><span class="side-icon">▤</span>课程任务</button>
    <button class="side-button" data-view="history"><span class="side-icon">◷</span>学习记录</button>
    <div class="sidebar-bottom"><div class="edition">教学探索版 <span>0.1</span></div><p>用机制连接知识<br>用时间理解变化</p></div>
  </aside>
  <main class="main">
    <header class="topbar"><div class="topbar-left"><button class="mobile-menu" data-action="menu" aria-label="打开系统导航">☰</button><div class="breadcrumb">学习工作台 <b>/ <span id="breadcrumb-system">糖代谢</span></b></div></div><div class="top-meta"><span>医学数字教学平台</span><div class="avatar" aria-label="本机学习空间">学</div></div></header>
    <div class="content">
      <div class="section-top"><div><div class="eyebrow" id="module-en"></div><h1 id="module-title"></h1><p class="subtitle" id="module-subtitle"></p></div><span class="chip" id="model-chip">机制模型 · 相对基线</span></div>
      <nav class="tabs" aria-label="学习视图"><button class="tab active" data-view="lab">机制实验</button><button class="tab" data-view="course">课程任务</button><button class="tab" data-view="knowledge">机制与证据</button><button class="tab" data-view="history">学习记录</button></nav>
      <section class="page active" id="page-lab" aria-label="机制实验">
        <div class="lab-grid"><div class="stage-column">
          <div class="mission-bar"><span class="mission-number">01</span><div><small>当前探索任务</small><strong id="mission-question"></strong></div><button class="mission-go" data-view="course" aria-label="打开当前课程任务">↗</button></div>
          <div class="scene-wrap"><div class="scene-top"><span class="scene-caption">MECHANISM VIEW</span><button class="scene-mode" data-action="camera-mode">课程镜头</button></div><div class="scene" id="scene"></div><div class="scene-bottom"><div class="legend"><span><i></i>促进</span><span><i class="inhibit"></i>抑制</span></div><span>空间为机制示意</span><button class="icon-btn" data-action="overview-camera">恢复全景</button></div></div>
          <div class="focus-note"><strong id="focus-title">沿反馈回路观察</strong><p id="focus-copy"></p></div>
        </div>
        <aside class="observations" aria-label="实时观察与实验设置"><div class="panel-heading"><h2>实时观察</h2><span>基准 = 1.00</span></div><div class="metrics" id="metrics"></div><div class="control-block"><label for="scenario-select">生理与疾病情景</label><select class="select" id="scenario-select"></select><p class="scenario-desc" id="scenario-desc"></p><label class="toggle-row" for="compare-toggle">叠加正常基准<input type="checkbox" id="compare-toggle"></label></div><div class="intervene"><button class="primary-btn wide" data-action="branch">从此刻开展机制实验</button><p id="intervention-note"></p><button class="clear-branch" data-action="undoBranch" hidden>撤销分支，恢复原轨迹</button></div></aside></div>
        <div class="timeline"><div class="timeline-head"><h2 class="timeline-title">机理时间轴<span>MECHANISM TIMELINE</span></h2><div class="time-label"><span id="time-number">60</span><small id="time-unit">分钟</small></div></div><div class="chart" id="chart" aria-label="指标随时间变化的曲线"></div><label class="sr-only" for="timeline-slider">实验时间</label><input class="timeline-range" id="timeline-slider" type="range" min="0" max="240" value="60" step="0.25"><div class="playback"><button class="play" data-action="play-toggle">▶ 播放</button><button class="icon-btn" data-action="restart">↺ 重置</button><label class="sr-only" for="speed-select">播放速度</label><select class="speed" id="speed-select"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select><div id="time-markers" class="playback"></div><span class="timeline-foot" id="chart-caption">实线为当前情景</span></div></div>
        <section class="guide" aria-label="机制助教"><div class="guide-mark">✧</div><div class="guide-body"><div class="guide-title">机制助教<span>本地规则解释 · 未连接大模型</span></div><div class="guide-output" id="guide-output" aria-live="polite"></div><div class="guide-actions"><button data-action="explain">为什么现在变化？</button><button data-action="focus-key">定位关键结构</button><button data-action="compare-guide">与正常情景比较</button></div><form class="guide-form" id="guide-form"><label class="sr-only" for="guide-input">输入实验指令</label><input id="guide-input" maxlength="160" placeholder="试试：跳到 120 分钟 / 定位胰岛 β 细胞"><button type="submit">执行 ↗</button></form></div></section>
      </section>
      <section class="page" id="page-overview" aria-label="系统总览"></section>
      <section class="page" id="page-course" aria-label="课程任务"></section>
      <section class="page" id="page-knowledge" aria-label="机制与证据"></section>
      <section class="page" id="page-history" aria-label="学习记录"></section>
      <p class="footnote">教学机制模型：所有数值均为相对基线的示意输出，时间用于探索动态关系；未经临床参数标定，不用于个体诊疗或疗效预测。学习记录仅保存在当前浏览器。</p>
    </div>
  </main>
</div><div id="toast" class="toast" role="status" hidden></div>`;
$('.stage-column').insertBefore($('.timeline'),$('.focus-note'));

function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
function log(label){records.push({module:state.module.id,scenario:state.scenario,time:state.time,label,date:new Date().toISOString(),version:MODEL_VERSION});records=records.slice(-50);try{localStorage.setItem(storageKey,JSON.stringify(records));}catch{toast('当前浏览器无法保存记录，本次操作仍可继续。');}}
function rebuild(){state.trajectories={normal:simulate(state.module,'normal'),original:simulate(state.module,state.scenario)};state.trajectories.current=state.branchAt===null?state.trajectories.original:simulate(state.module,state.scenario,{branchAt:state.branchAt});}
function formatTime(t){return state.module.unit==='分钟'?Math.round(t):Number(t.toFixed(1));}
function selectModule(id){
  const m=modules.find(m=>m.id===id);if(!m)throw new Error('未知系统');state.module=m;state.scenario='normal';state.time=m.duration/4;state.playing=false;state.branchAt=null;state.focus=null;state.manual=false;state.compare=false;$('#compare-toggle').checked=false;
  document.documentElement.style.setProperty('--accent',m.color);$('#module-en').textContent=m.en;$('#module-title').textContent=m.title;$('#module-subtitle').textContent=m.subtitle;$('#breadcrumb-system').textContent=m.short;$('#mission-question').textContent=m.question;
  $('#scenario-select').innerHTML=m.scenarios.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');$('#scenario-desc').textContent=m.scenarios[0].desc;
  $('#intervention-note').textContent=m.experiment;$('#focus-copy').textContent=m.explain;$('#focus-title').textContent='沿反馈回路观察';$('#time-unit').textContent=m.unit;
  const slider=$('#timeline-slider');slider.max=m.duration;slider.step=m.step;slider.value=state.time;
  $('#time-markers').innerHTML=[0,.25,.5,1].map(f=>`<button class="marker-btn" data-time="${m.duration*f}">${m.duration*f}${m.unit==='分钟'?' min':m.unit}</button>`).join('');
  $('#metrics').innerHTML=m.metrics.map(([key,label,color])=>`<div class="metric"><div class="metric-name"><i class="metric-dot" style="--color:${color}"></i>${label}</div><div><div class="metric-value" data-value="${key}">1.00<small>×</small></div><div class="metric-change" data-delta="${key}">相对起点</div></div></div>`).join('');
  $('#guide-output').textContent=`${m.question} 先预测变化方向，再播放并比较不同情景。`;$('#guide-input').placeholder=`试试：跳到 ${m.duration/2} ${m.unit} / 定位${m.nodes[1][1]}`;
  $('.clear-branch').hidden=true;$('.scene-mode').textContent='课程镜头';scene?.setManual(false);scene?.setModule(m);rebuild();renderCourse();renderKnowledge();showView('lab');paint();
}
function showView(view){
  if(!['lab','overview','course','knowledge','history'].includes(view))return;
  state.view=view;state.playing=false;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${view}`));document.querySelectorAll('.tab').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);el.setAttribute('aria-current',el.dataset.view===view?'page':'false');});
  document.querySelectorAll('.side-button').forEach(el=>el.classList.toggle('active',view==='overview'?el.dataset.view==='overview':el.dataset.module===state.module.id));
  $('#module-title').textContent=view==='overview'?'内分泌与代谢疾病实验室':state.module.title;
  $('#module-en').textContent=view==='overview'?'EXPLORE THE ENDOCRINE SYSTEM':state.module.en;
  $('#module-subtitle').textContent=view==='overview'?'六个系统，一套可回放、可比较的机制学习空间。':state.module.subtitle;
  if(view==='history')renderHistory();$('.sidebar').classList.remove('open');requestAnimationFrame(()=>scene?.resize());updatePlay();
}
function renderOverview(){
  $('#page-overview').innerHTML=`<p class="overview-intro">从一个问题进入实验：观察激素与代谢的动态变化，定位反馈环节，改变一个条件，再用曲线检验你的解释。</p><div class="catalog">${modules.map((m,i)=>`<button class="catalog-card" data-module="${m.id}" style="--color:${m.color}"><span class="card-icon">${m.icon}</span><h2>${m.title}</h2><p>${m.question}</p><span class="card-footer">${m.scenarios.length} 个情景 · ${m.duration} ${m.unit}时间轴 ↗</span></button>`).join('')}</div>`;
}
function renderCourse(){const m=state.module;
  $('#page-course').innerHTML=`<div class="course-layout"><div class="paper-panel"><div class="eyebrow">LESSON / ${m.short}</div><h2>${m.question}</h2><p>完成下面三个观察步骤，再回答右侧的机制问题。实验中只改变一个条件，保留比较依据。</p><div class="step-row"><span class="num">01</span><div><h3>预测与观察</h3><p>先判断各指标的变化方向，再观察正常反馈。</p><button class="text-btn" data-step="observe">进入正常情景 ↗</button></div></div><div class="step-row"><span class="num">02</span><div><h3>定位失衡</h3><p>切换为「${m.scenarios[1].name}」，比较末端输出和反馈信号。</p><button class="text-btn" data-step="compare">比较两条轨迹 ↗</button></div></div><div class="step-row"><span class="num">03</span><div><h3>进行机制实验</h3><p>${m.experiment}，观察后续变化能否支持你的解释。</p><button class="text-btn" data-step="intervene">从时间轴中点建立分支 ↗</button></div></div></div><div class="paper-panel"><div class="eyebrow">CHECK YOUR UNDERSTANDING</div><h2>检验你的理解</h2><p>${m.quiz.q}</p>${m.quiz.answers.map((a,i)=>`<button class="quiz-option" data-answer="${i}"><span>${String.fromCharCode(65+i)}.</span>${a}</button>`).join('')}<div class="quiz-result" id="quiz-result" role="status"></div><button class="text-btn" data-action="retry-quiz" style="margin-top:18px">重新作答</button></div></div>`;
}
function renderKnowledge(){const m=state.module;const label=id=>m.nodes.find(n=>n[0]===id)?.[1]??id;
  $('#page-knowledge').innerHTML=`<div class="knowledge-grid"><div class="paper-panel"><div class="eyebrow">CAUSAL CONNECTIONS</div><h2>机制关系</h2>${m.edges.map(([a,b,s])=>`<div class="relation"><span>${label(a)}</span><em class="${s==='−'?'negative':''}">${s==='−'?'抑制':'促进'} →</em><span>${label(b)}</span></div>`).join('')}<p style="margin-top:20px">${m.explain}</p></div><div><div class="paper-panel"><h2>理解边界</h2><p>${m.misconception}</p><p>当前曲线由简化、无量纲的反馈模型生成。文献支持机制关系；页面中的参数和时间常数是教学设定，并未复现文献模型或完成患者校准。</p></div><div class="paper-panel" style="margin-top:20px"><h2>查阅依据</h2>${m.sources.map(([title,url])=>`<a class="source-link" href="${url}" target="_blank" rel="noopener noreferrer">${title} ↗<small>${new URL(url).hostname}</small></a>`).join('')}</div></div></div>`;
}
function renderHistory(){
  $('#page-history').innerHTML=`<div class="history-head"><p>保留最近 50 条实验与作答记录，仅在当前浏览器可见。</p><button class="secondary-btn" data-action="export-history" ${records.length?'':'disabled'}>导出记录</button></div>${records.length?`<div class="history-list">${[...records].reverse().map((r,i)=>`<div class="history-item"><div>${getModule(r.module).title}<br><small>${escape(r.date.slice(0,16).replace('T',' '))} UTC</small></div><div>${escape(r.label)}<br><small>${Number(r.time.toFixed(1))} ${getModule(r.module).unit}</small></div><button class="text-btn" data-restore="${records.length-1-i}">重访情景 ↗</button></div>`).join('')}</div>`:`<div class="history-empty"><p>还没有实验记录。切换情景、建立分支或完成一道机制题，记录就会出现在这里。</p><button class="primary-btn" data-view="lab">返回机制实验</button></div>`}`;
}
function drawChart(){
  const m=state.module,rows=state.trajectories.current, comparison=state.branchAt===null?state.trajectories.normal:state.trajectories.original;
  const width=Math.max(260,$('#chart').clientWidth),height=140,left=35,right=8,top=12,bottom=21,plotW=width-left-right,plotH=height-top-bottom;
  const max=Math.max(1.3,...m.metrics.flatMap(([k])=>rows.map(r=>r[k])),...(state.compare||state.branchAt!==null?m.metrics.flatMap(([k])=>comparison.map(r=>r[k])):[]))*1.08;
  const X=t=>left+t/m.duration*plotW,Y=v=>top+(1-v/max)*plotH;
  const path=(series,key)=>series.filter((_,i)=>i%3===0||i===series.length-1).map((p,i)=>`${i?'L':'M'}${X(p.t).toFixed(2)},${Y(p[key]).toFixed(2)}`).join(' ');
  const cursor=X(state.time);
  let html=`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${m.title}相对指标随时间变化"><defs><clipPath id="past"><rect x="${left}" y="0" width="${cursor-left}" height="140"/></clipPath></defs>`;
  [0,1,max].forEach(v=>{html+=`<line x1="${left}" y1="${Y(v)}" x2="${width-right}" y2="${Y(v)}" stroke="#293a49" stroke-width=".7"/><text class="chart-text" x="0" y="${Y(v)+4}">${v.toFixed(1)}×</text>`;});
  [0,.25,.5,.75,1].forEach(f=>{html+=`<text class="chart-text" x="${X(f*m.duration)}" y="138" text-anchor="${f===0?'start':f===1?'end':'middle'}">${f*m.duration}</text>`;});
  for(const [key,label,color] of m.metrics){if(state.compare||state.branchAt!==null)html+=`<path class="chart-line baseline-line" d="${path(comparison,key)}" stroke="${color}"/>`;html+=`<path class="chart-line" d="${path(rows,key)}" stroke="${color}" opacity=".18"/><path class="chart-line" d="${path(rows,key)}" stroke="${color}" clip-path="url(#past)"/>`;const val=sample(rows,state.time)[key];html+=`<circle cx="${cursor}" cy="${Y(val)}" r="3" fill="${color}"/>`;}
  if(state.branchAt!==null)html+=`<line x1="${X(state.branchAt)}" y1="0" x2="${X(state.branchAt)}" y2="${height-bottom}" stroke="#f6b56d" stroke-dasharray="3 4"/><text x="${X(state.branchAt)+5}" y="10" class="chart-text">机制实验</text>`;
  html+=`<line class="chart-cursor" x1="${cursor}" y1="${top}" x2="${cursor}" y2="${height-bottom}"/></svg>`;$('#chart').innerHTML=html;
  $('#chart-caption').textContent=state.branchAt!==null?'虚线：未干预分支':state.compare?'虚线：正常基准':'淡线：后续模拟轨迹';
}
function updatePlay(){$('[data-action="play-toggle"]').textContent=state.playing?'Ⅱ 暂停':'▶ 播放';}
function paint(){
  const val=sample(state.trajectories.current,state.time);for(const [key] of state.module.metrics){$(`[data-value="${key}"]`).innerHTML=`${val[key].toFixed(2)}<small>×</small>`;const delta=(val[key]-1)*100;$(`[data-delta="${key}"]`).textContent=`${delta>=0?'+':''}${delta.toFixed(1)}% 相对起点`;}
  $('#time-number').textContent=formatTime(state.time);$('#timeline-slider').value=state.time;$('#timeline-slider').setAttribute('aria-valuetext',`${formatTime(state.time)} ${state.module.unit}`);scene?.setValues(val,state.time,state.playing);drawChart();updatePlay();
}
function explain(){
  const m=state.module,val=sample(state.trajectories.current,state.time),prev=sample(state.trajectories.current,Math.max(0,state.time-m.step*3));const key=m.metrics[0][0],direction=val[key]-prev[key]>0.00005?'上升':val[key]-prev[key]<-0.00005?'下降':'接近平稳';
  const scenario=m.scenarios.find(s=>s.id===state.scenario);
  $('#guide-output').textContent=`在「${scenario.name}」的 ${formatTime(state.time)} ${m.unit}，${m.metrics[0][1]}为基准的 ${val[key].toFixed(2)} 倍，当前${direction}。${m.explain}${state.branchAt!==null?` 已在 ${formatTime(state.branchAt)} ${m.unit}建立「${m.experiment}」分支，可与虚线的未干预轨迹比较。`:''}`;
}
function command(raw){
  const cmd=validateCommand(raw,state.module);
  switch(cmd.type){
    case 'seek':state.time=cmd.time;state.playing=false;break;
    case 'play':if(state.time>=state.module.duration)state.time=0;state.playing=true;break;
    case 'pause':state.playing=false;break;
    case 'focus':state.focus=cmd.nodeId;state.manual=false;scene?.setManual(false);scene?.focus(cmd.nodeId);$('.scene-mode').textContent='课程镜头';$('#focus-title').textContent=cmd.nodeId?state.module.nodes.find(n=>n[0]===cmd.nodeId)[1]:'沿反馈回路观察';$('#focus-copy').textContent=state.module.explain;break;
    case 'scenario':state.scenario=cmd.scenarioId;state.branchAt=null;state.time=0;state.playing=false;$('#scenario-select').value=cmd.scenarioId;$('#scenario-desc').textContent=state.module.scenarios.find(s=>s.id===cmd.scenarioId).desc;$('.clear-branch').hidden=true;$('#intervention-note').textContent=state.module.experiment;rebuild();log(`切换情景：${state.module.scenarios.find(s=>s.id===cmd.scenarioId).name}`);break;
    case 'branch':if(state.time>=state.module.duration){toast('请先将时间轴移到结束之前，再开展实验。');return;}
      state.branchAt=state.time;state.playing=false;rebuild();$('.clear-branch').hidden=false;$('#intervention-note').textContent=state.module.experimentNote;log(`建立机制分支：${state.module.experiment}`);toast('机制分支已建立，播放以观察后续变化。');explain();break;
    case 'undoBranch':state.branchAt=null;rebuild();$('.clear-branch').hidden=true;$('#intervention-note').textContent=state.module.experiment;toast('已恢复未干预轨迹');break;
    case 'explain':explain();break;
  }
  paint();return snapshot();
}
function snapshot(){const values=sample(state.trajectories.current,state.time);return {module:state.module.id,scenario:state.scenario,time:state.time,unit:state.module.unit,playing:state.playing,branchAt:state.branchAt,focus:state.focus,modelVersion:MODEL_VERSION,values:Object.fromEntries(state.module.metrics.map(([key])=>[key,values[key]]))};}
$('#scenario-select').addEventListener('change',e=>command({type:'scenario',scenarioId:e.target.value}));
$('#timeline-slider').addEventListener('input',e=>command({type:'seek',time:Number(e.target.value)}));
$('#compare-toggle').addEventListener('change',e=>{state.compare=e.target.checked;drawChart();});
$('#speed-select').addEventListener('change',e=>state.speed=Number(e.target.value));
$('#guide-form').addEventListener('submit',e=>{e.preventDefault();const text=$('#guide-input').value;try{const cmd=parseLocalRequest(text,state.module);if(cmd){command(cmd);if(cmd.type!=='explain')$('#guide-output').textContent=`已执行${{seek:'时间定位',focus:'结构定位',play:'播放',pause:'暂停',branch:'机制实验',undoBranch:'撤销分支'}[cmd.type]}。${cmd.type==='focus'?state.module.explain:''}`;}else $('#guide-output').textContent='当前助教支持本地实验指令与机制解释。可以输入“为什么变化”“定位结构名称”“跳到时间”“暂停”。开放式医学问答需要后续接入经过审核的知识库与模型。';}catch(err){$('#guide-output').textContent=err.message;}$('#guide-input').value='';});
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.module){selectModule(b.dataset.module);return;}
  if(b.dataset.view){showView(b.dataset.view);return;}
  if(b.dataset.time!==undefined){command({type:'seek',time:Number(b.dataset.time)});return;}
  if(b.dataset.answer!==undefined){const answer=Number(b.dataset.answer),correct=answer===state.module.quiz.correct;$('#quiz-result').textContent=`${correct?'回答正确。':'再沿反馈回路想一想。'}${state.module.quiz.reason}`;document.querySelectorAll('.quiz-option').forEach((el,i)=>{el.classList.toggle('correct',i===state.module.quiz.correct);el.classList.toggle('wrong',i===answer&&!correct);el.disabled=true;});log(`机制题：${correct?'正确':'需复习'}`);return;}
  if(b.dataset.step){showView('lab');if(b.dataset.step==='observe'){command({type:'scenario',scenarioId:'normal'});command({type:'focus',nodeId:null});}else{command({type:'scenario',scenarioId:state.module.scenarios[1].id});state.compare=true;$('#compare-toggle').checked=true;command({type:'seek',time:state.module.duration/2});command({type:'focus',nodeId:state.module.focus});if(b.dataset.step==='intervene')command({type:'branch'});}paint();return;}
  if(b.dataset.restore!==undefined){const r=records[Number(b.dataset.restore)];if(r){selectModule(r.module);command({type:'scenario',scenarioId:r.scenario});command({type:'seek',time:r.time});toast('已重访该情景与时间点；历史干预不自动重建。');}return;}
  const action=b.dataset.action;
  if(action==='menu')$('.sidebar').classList.toggle('open');
  else if(action==='play-toggle')command({type:state.playing?'pause':'play'});
  else if(action==='restart')command({type:'seek',time:0});
  else if(action==='overview-camera')command({type:'focus',nodeId:null});
  else if(action==='camera-mode'){state.manual=!state.manual;scene?.setManual(state.manual);b.textContent=state.manual?'自由观察':'课程镜头';}
  else if(action==='focus-key'){command({type:'focus',nodeId:state.module.focus});explain();}
  else if(action==='compare-guide'){state.compare=true;$('#compare-toggle').checked=true;paint();$('#guide-output').textContent='已叠加正常基准。实线表示当前情景，虚线表示相同模型下的正常响应；选择一个异常情景，比较末端输出与上游反馈。';}
  else if(action==='retry-quiz')renderCourse();
  else if(action==='export-history'){const blob=new Blob([JSON.stringify({modelVersion:MODEL_VERSION,exportedAt:new Date().toISOString(),records},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='endolab-learning-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  else if(['branch','undoBranch','explain'].includes(action))command({type:action});
});

scene=new MechanismScene($('#scene'),nodeId=>command({type:'focus',nodeId}));renderOverview();selectModule(modules[0].id);
new ResizeObserver(()=>{if(state.trajectories&&state.view==='lab')drawChart();}).observe($('#chart'));
function animate(now){const delta=Math.min((now-lastFrame)/1000,.2);lastFrame=now;if(state.playing&&state.view==='lab'&&!document.hidden){state.time=Math.min(state.module.duration,state.time+delta*(state.module.duration/45)*state.speed);paintTimer+=delta;if(paintTimer>.07||state.time>=state.module.duration){paint();paintTimer=0;}if(state.time>=state.module.duration){state.playing=false;updatePlay();log('完成时间轴观察');}}requestAnimationFrame(animate);}requestAnimationFrame(animate);

// Feature-detected WebMCP adapter. No arbitrary JavaScript or patient-state writes.
const modelContext=document.modelContext;
if(modelContext?.registerTool){
  const lifecycle=new AbortController();
  const register=tool=>{try{Promise.resolve(modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_endocrine_experiment',description:'读取当前内分泌教学实验的情景、时间与相对指标。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>snapshot()});
  register({name:'navigate_endocrine_system',description:'切换到一个内分泌系统，重置当前未保存实验。',inputSchema:{type:'object',properties:{moduleId:{type:'string',enum:modules.map(m=>m.id)}},required:['moduleId'],additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{if(!input||!modules.some(m=>m.id===input.moduleId))throw new Error('Unknown module');selectModule(input.moduleId);return snapshot();}});
  register({name:'control_endocrine_experiment',description:'控制当前教学实验；支持定位时间、结构、播放、暂停、情景选择与建立或撤销机制分支。',inputSchema:{type:'object',properties:{type:{type:'string',enum:['seek','focus','scenario','play','pause','branch','undoBranch','explain']},time:{type:'number'},nodeId:{type:['string','null']},scenarioId:{type:'string'}},required:['type'],additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{validateCommand(input,state.module);showView('lab');return command(input);}});
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
