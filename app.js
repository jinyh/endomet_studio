import {modules,getModule} from './data.js';
import {simulate,sample,parameters,MODEL_VERSION} from './simulation.js';
import {MechanismScene} from './renderer.js';
import {validateCommand,parseLocalRequest} from './director.js';
import {getMechanism,validateMechanism} from './mechanisms.js';
import {loadSchematicAsset} from './assets.js';
import {getCourse,createCourseProgress,recordPrediction,completeCourseStep,courseSummary} from './courses.js';
import {loadAnatomyManifest,relatedAnatomy,validateAnatomyCommand} from './anatomy-catalog.js';

const $=s=>document.querySelector(s);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const courseProgress=new Map(),quizAnswers=new Map(),sceneAssets=new Map();
let activeCourseStep=null;
let anatomyScene=null,anatomyPromise=null;
const anatomyState={status:'idle',manifest:null,selected:null,moduleId:null,layer:'body',context:true,manual:false};
const assetModules=['glucose','thyroid'];
const assetResults=await Promise.allSettled(assetModules.map(id=>loadSchematicAsset(getModule(id))));
assetResults.forEach((result,i)=>{if(result.status==='fulfilled')sceneAssets.set(assetModules[i],result.value);});
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
    <div class="sidebar-bottom"><div class="edition">教学探索版 <span>0.3</span></div><p>用机制连接知识<br>用时间理解变化</p></div>
  </aside>
  <main class="main">
    <header class="topbar"><div class="topbar-left"><button class="mobile-menu" data-action="menu" aria-label="打开系统导航">☰</button><div class="breadcrumb">学习工作台 <b>/ <span id="breadcrumb-system">糖代谢</span></b></div></div><div class="top-meta"><span>医学数字教学平台</span><div class="avatar" aria-label="本机学习空间">学</div></div></header>
    <div class="content">
      <div class="section-top"><div><div class="eyebrow" id="module-en"></div><h1 id="module-title"></h1><p class="subtitle" id="module-subtitle"></p></div><span class="chip" id="model-chip">机制模型 · 相对基线</span></div>
      <nav class="tabs" aria-label="学习视图"><button class="tab active" data-view="lab">机制实验</button><button class="tab" data-view="anatomy">解剖定位</button><button class="tab" data-view="course">课程任务</button><button class="tab" data-view="knowledge">机制与证据</button><button class="tab" data-view="history">学习记录</button></nav>
      <section class="page active" id="page-lab" aria-label="机制实验">
        <div class="lab-grid"><div class="stage-column">
          <div class="mission-bar"><span class="mission-number">01</span><div><small>当前探索任务</small><strong id="mission-question"></strong></div><button class="mission-go" data-view="course" aria-label="打开当前课程任务">↗</button></div>
          <div class="course-observation" id="course-observation" hidden></div>
          <div class="scene-wrap"><div class="scene-top"><span class="scene-caption">MECHANISM VIEW</span><button class="scene-mode" data-action="camera-mode">课程镜头</button></div><div class="scene" id="scene"></div><div class="scene-bottom"><div class="legend"><span><i></i>促进</span><span><i class="inhibit"></i>抑制</span></div><span>空间为机制示意</span><button class="icon-btn" data-action="overview-camera">恢复全景</button></div></div>
          <div class="focus-note"><strong id="focus-title">沿反馈回路观察</strong><p id="focus-copy"></p><button class="text-btn" data-view="anatomy">查看真实解剖位置 ↗</button></div>
        </div>
        <aside class="observations" aria-label="实时观察与实验设置"><div class="panel-heading"><h2>实时观察</h2><span>基准 = 1.00</span></div><div class="metrics" id="metrics"></div><div class="control-block"><label for="scenario-select">生理与疾病情景</label><select class="select" id="scenario-select"></select><p class="scenario-desc" id="scenario-desc"></p><label class="toggle-row" for="compare-toggle">叠加正常基准<input type="checkbox" id="compare-toggle"></label></div><div class="intervene"><button class="primary-btn wide" data-action="branch">从此刻开展机制实验</button><p id="intervention-note"></p><button class="clear-branch" data-action="undoBranch" hidden>撤销分支，恢复原轨迹</button></div></aside></div>
        <div class="timeline"><div class="timeline-head"><h2 class="timeline-title">机理时间轴<span>MECHANISM TIMELINE</span></h2><div class="time-label"><span id="time-number">60</span><small id="time-unit">分钟</small></div></div><div class="chart" id="chart" aria-label="指标随时间变化的曲线"></div><label class="sr-only" for="timeline-slider">实验时间</label><input class="timeline-range" id="timeline-slider" type="range" min="0" max="240" value="60" step="0.25"><div class="playback"><button class="play" data-action="play-toggle">▶ 播放</button><button class="icon-btn" data-action="restart">↺ 重置</button><label class="sr-only" for="speed-select">播放速度</label><select class="speed" id="speed-select"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select><div id="time-markers" class="playback"></div><span class="timeline-foot" id="chart-caption">实线为当前情景</span></div></div>
        <section class="guide" aria-label="机制助教"><div class="guide-mark">✧</div><div class="guide-body"><div class="guide-title">机制助教<span>本地规则解释 · 未连接大模型</span></div><div class="guide-output" id="guide-output" aria-live="polite"></div><div class="guide-actions"><button data-action="explain">为什么现在变化？</button><button data-action="focus-key">定位关键结构</button><button data-action="compare-guide">与正常情景比较</button></div><form class="guide-form" id="guide-form"><label class="sr-only" for="guide-input">输入实验指令</label><input id="guide-input" maxlength="160" placeholder="试试：跳到 120 分钟 / 定位胰岛 β 细胞"><button type="submit">执行 ↗</button></form></div></section>
      </section>
      <section class="page" id="page-anatomy" aria-label="解剖定位">
        <div class="anatomy-intro"><div><div class="eyebrow">REFERENCE ANATOMY</div><h2>把机制放回人体中</h2><p>观察参考人体中的器官外形、位置与毗邻关系。</p></div><button class="secondary-btn" data-view="lab">返回当前机制实验 ↗</button></div>
        <div class="anatomy-session" id="anatomy-session"></div>
        <div class="anatomy-toolbar"><label class="anatomy-picker">定位结构<select class="select" id="anatomy-select" disabled><option>正在准备解剖资源</option></select></label><div class="anatomy-layers" aria-label="解剖观察层级"><button data-anatomy-layer="body" aria-pressed="true" disabled>全身定位</button><button data-anatomy-layer="regional" aria-pressed="false" disabled>局部关系</button><button data-anatomy-layer="organ" aria-pressed="false" disabled>器官特写</button></div><button class="icon-btn" data-action="anatomy-manual" disabled>自由观察</button></div>
        <div class="anatomy-layout"><div class="anatomy-stage"><div class="anatomy-viewport" id="anatomy-scene" aria-label="真实参考解剖三维视图"></div><div class="anatomy-status" id="anatomy-status" role="status">首次打开时载入真实解剖模型。</div><div class="anatomy-orientation">成人男性参考人体 · 解剖形状保持固定</div></div><aside class="paper-panel anatomy-details"><h2 id="anatomy-selected-name">参考解剖</h2><p id="anatomy-selection-note"></p><label class="toggle-row">显示周围结构<input type="checkbox" id="anatomy-context" checked disabled></label><h3>当前系统的相关结构</h3><div id="anatomy-related"></div><p id="anatomy-coverage" class="anatomy-coverage"></p><button class="text-btn" data-action="anatomy-retry" hidden>重新载入模型 ↗</button><details class="anatomy-credits"><summary>模型来源与使用说明</summary><div id="anatomy-attribution"></div><p>当前使用参考解剖的表面网格。器官到组织、细胞的内部结构需要另行接入，放大表面模型不会生成微观解剖。</p></details></aside></div>
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
  activeCourseStep=null;$('#course-observation').hidden=true;
  const m=modules.find(m=>m.id===id);if(!m)throw new Error('未知系统');state.module=m;state.scenario='normal';state.time=m.duration/4;state.playing=false;state.branchAt=null;state.focus=null;state.manual=false;state.compare=false;$('#compare-toggle').checked=false;
  document.documentElement.style.setProperty('--accent',m.color);$('#module-en').textContent=m.en;$('#module-title').textContent=m.title;$('#module-subtitle').textContent=m.subtitle;$('#breadcrumb-system').textContent=m.short;$('#mission-question').textContent=m.question;
  $('#scenario-select').innerHTML=m.scenarios.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');$('#scenario-desc').textContent=m.scenarios[0].desc;
  $('#intervention-note').textContent=m.experiment;$('#focus-copy').textContent=m.explain;$('#focus-title').textContent='沿反馈回路观察';$('#time-unit').textContent=m.unit;
  const slider=$('#timeline-slider');slider.max=m.duration;slider.step=m.step;slider.value=state.time;
  $('#time-markers').innerHTML=[0,.25,.5,1].map(f=>`<button class="marker-btn" data-time="${m.duration*f}">${m.duration*f}${m.unit==='分钟'?' min':m.unit}</button>`).join('');
  $('#metrics').innerHTML=m.metrics.map(([key,label,color])=>`<div class="metric"><div class="metric-name"><i class="metric-dot" style="--color:${color}"></i>${label}</div><div><div class="metric-value" data-value="${key}">1.00<small>×</small></div><div class="metric-change" data-delta="${key}">相对起点</div></div></div>`).join('');
  $('#guide-output').textContent=`${m.question} 先预测变化方向，再播放并比较不同情景。`;$('#guide-input').placeholder=`试试：跳到 ${m.duration/2} ${m.unit} / 定位${m.nodes[1][1]}`;
  $('.clear-branch').hidden=true;$('.scene-mode').textContent='课程镜头';scene?.setManual(false);scene?.setModule(m,sceneAssets.get(m.id));rebuild();renderCourse();renderKnowledge();showView('lab');paint();
}
function showView(view){
  if(!['lab','anatomy','overview','course','knowledge','history'].includes(view))return;
  state.view=view;state.playing=false;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${view}`));document.querySelectorAll('.tab').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);el.setAttribute('aria-current',el.dataset.view===view?'page':'false');});
  document.querySelectorAll('.side-button').forEach(el=>el.classList.toggle('active',view==='overview'?el.dataset.view==='overview':el.dataset.module===state.module.id));
  $('#module-title').textContent=view==='overview'?'内分泌与代谢疾病实验室':state.module.title;
  $('#module-en').textContent=view==='overview'?'EXPLORE THE ENDOCRINE SYSTEM':state.module.en;
  $('#module-subtitle').textContent=view==='overview'?'六个系统，一套可回放、可比较的机制学习空间。':state.module.subtitle;
  if(view==='history')renderHistory();if(view==='course')renderCourse();if(view==='anatomy')ensureAnatomy();anatomyScene?.setActive(view==='anatomy');$('.sidebar').classList.remove('open');requestAnimationFrame(()=>{scene?.resize();anatomyScene?.resize();});updatePlay();
}
function renderAnatomyCatalog(){
  const manifest=anatomyState.manifest;
  $('#anatomy-select').innerHTML='<option value="">全身概览</option>'+manifest.labels.filter(label=>label.structureId!=='body').map(label=>`<option value="${escape(label.structureId)}">${escape(label.name)}</option>`).join('');
  const source=manifest.source;
  $('#anatomy-attribution').innerHTML=`<p>${escape(source.attribution)}</p><p><a href="${escape(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">原始模型来源 ↗</a> · <a href="${escape(source.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escape(source.license)} ↗</a></p><p>已转换为浏览器格式并统一坐标；组织颜色用于区分结构。转换结果尚待医学专家审核。</p>`;
}
function selectAnatomyForModule(){
  if(anatomyState.moduleId===state.module.id)return;
  anatomyState.moduleId=state.module.id;
  const preferred={glucose:'pancreas',thyroid:'pituitary',adrenal:'adrenal-left',gonadal:'testis-left',calcium:'kidney-left',energy:'hypothalamus'}[state.module.id];
  const related=relatedAnatomy(anatomyState.manifest,state.module.id);
  anatomyState.selected=related.find(label=>label.structureId===preferred)?.structureId??related.find(label=>!label.context)?.structureId??related[0]?.structureId??null;
  anatomyState.layer='body';anatomyState.manual=false;anatomyState.context=true;
  anatomyScene.setContextVisible(true);anatomyScene.setManual(false);anatomyScene.setLayer('body');anatomyScene.focus(anatomyState.selected);
}
async function ensureAnatomy(){
  updateAnatomyPanel();
  if(anatomyState.status==='ready'){selectAnatomyForModule();updateAnatomyPanel();return;}
  if(anatomyPromise)return anatomyPromise;
  anatomyState.status='loading';$('#anatomy-status').hidden=false;$('#anatomy-status').textContent='正在载入真实参考解剖…';$('[data-action="anatomy-retry"]').hidden=true;
  anatomyPromise=(async()=>{
    try{
      const [{manifest,url},{AnatomyScene}]=await Promise.all([loadAnatomyManifest(),import('./anatomy.js')]);
      anatomyState.manifest=manifest;
      anatomyScene?.destroy();
      anatomyScene=new AnatomyScene($('#anatomy-scene'),{onSelect:id=>anatomyCommand({type:'focus',structureId:id}),onStatus:status=>{
        if(status.state==='loading')$('#anatomy-status').textContent='正在载入真实参考解剖…';
        if(status.state==='error'){
          anatomyState.status='error';$('#anatomy-status').hidden=false;$('#anatomy-status').textContent=status.message;
          $('[data-action="anatomy-retry"]').hidden=false;updateAnatomyPanel();
        }
      }});
      if(!await anatomyScene.load(manifest,url))throw new Error('模型加载未完成');
      anatomyState.status='ready';anatomyState.moduleId=null;renderAnatomyCatalog();selectAnatomyForModule();
      $('#anatomy-status').hidden=true;anatomyScene.setActive(state.view==='anatomy');updateAnatomyPanel();
    }catch{
      anatomyState.status='error';anatomyScene?.destroy();anatomyScene=null;
      $('#anatomy-status').hidden=false;$('#anatomy-status').textContent='解剖模型暂时无法显示。请重新载入；当前机制实验与时间点已保留。';
      $('[data-action="anatomy-retry"]').hidden=false;updateAnatomyPanel();
    }finally{anatomyPromise=null;}
  })();
  return anatomyPromise;
}
function updateAnatomyPanel(){
  const ready=anatomyState.status==='ready',m=state.module,scenario=m.scenarios.find(s=>s.id===state.scenario);
  $('#anatomy-session').textContent=`${m.title} · ${scenario.name} · 实验暂停于 ${formatTime(state.time)} ${m.unit}${state.branchAt===null?'':` · 保留 ${formatTime(state.branchAt)} ${m.unit}的干预分支`}。返回机制实验后可继续。`;
  $('#anatomy-select').disabled=!ready;$('#anatomy-context').disabled=!ready;$('#anatomy-context').checked=anatomyState.context;
  $('[data-action="anatomy-manual"]').disabled=!ready;$('[data-action="anatomy-manual"]').textContent=anatomyState.manual?'恢复课程镜头':'自由观察';
  document.querySelectorAll('[data-anatomy-layer]').forEach(button=>{button.disabled=!ready||(button.dataset.anatomyLayer!=='body'&&!anatomyState.selected);button.setAttribute('aria-pressed',String(button.dataset.anatomyLayer===anatomyState.layer));});
  if(!ready)return;
  const selected=anatomyState.manifest.labels.find(label=>label.structureId===anatomyState.selected),related=relatedAnatomy(anatomyState.manifest,m.id);
  $('#anatomy-select').value=anatomyState.selected??'';
  $('#anatomy-selected-name').textContent=selected?.name??'全身概览';
  $('#anatomy-selection-note').textContent=selected?'用全身定位查看位置，用局部关系观察邻近结构，用器官特写检查外形。':'选择一个结构，沿着人体定位进入器官观察。';
  $('#anatomy-related').innerHTML=related.map(label=>`<button class="anatomy-structure ${label.structureId===anatomyState.selected?'selected':''}" data-anatomy-structure="${escape(label.structureId)}" aria-pressed="${label.structureId===anatomyState.selected}"><i style="background:${label.color}"></i>${escape(label.name)}${label.context?'<small>参照</small>':''}</button>`).join('')||'<p>本系统的专属器官网格尚未接入，可先查看全身位置参照。</p>';
  const ids=new Set(anatomyState.manifest.labels.map(label=>label.structureId));
  const notes={thyroid:!ids.has('thyroid')?'本版已接入上游下丘脑与垂体；甲状腺和甲状旁腺本体尚未接入。':'',calcium:!ids.has('parathyroid')?'当前提供肾脏位置参照；甲状旁腺及骨组织网格尚未接入。':'',gonadal:!ids.has('testis-left')?'当前提供上游调节结构；性腺本体尚未接入。':'本版为男性参考解剖；卵巢及女性生殖系统待独立接入。',energy:'当前可查看下丘脑及已接入的相关器官；脂肪组织分布尚未建模。',glucose:'当前胰腺显示为实质表面；胰岛、细胞和分泌颗粒需要独立的微观模型。'};
  $('#anatomy-coverage').textContent=notes[m.id]??'参考图谱用于空间定位，当前生理情景不会改变器官网格。';
}
function anatomyCommand(raw){
  if(anatomyState.status!=='ready')throw new Error('请等待解剖模型加载完成');
  const cmd=validateAnatomyCommand(raw,anatomyState.manifest);
  if(cmd.type==='focus'){
    anatomyState.selected=cmd.structureId;anatomyState.manual=false;anatomyScene.setManual(false);
    if(cmd.structureId===null){anatomyState.layer='body';anatomyScene.setLayer('body');}
    anatomyScene.focus(cmd.structureId);
  }
  if(cmd.type==='layer'){anatomyState.layer=anatomyState.selected===null?'body':cmd.layer;anatomyState.manual=false;anatomyScene.setManual(false);anatomyScene.setLayer(anatomyState.layer);}
  if(cmd.type==='context'){anatomyState.context=cmd.enabled;anatomyScene.setContextVisible(cmd.enabled);}
  if(cmd.type==='manual'){anatomyState.manual=cmd.enabled;anatomyScene.setManual(cmd.enabled);}
  updateAnatomyPanel();return snapshot();
}
function renderOverview(){
  $('#page-overview').innerHTML=`<p class="overview-intro">从一个问题进入实验：观察激素与代谢的动态变化，定位反馈环节，改变一个条件，再用曲线检验你的解释。</p><div class="catalog">${modules.map((m,i)=>`<button class="catalog-card" data-module="${m.id}" style="--color:${m.color}"><span class="card-icon">${m.icon}</span><h2>${m.title}</h2><p>${m.question}</p><span class="card-footer">${m.scenarios.length} 个情景 · ${m.duration} ${m.unit}时间轴 ↗</span></button>`).join('')}</div>`;
}
function currentCourseProgress(course){
  if(!courseProgress.has(course.moduleId))courseProgress.set(course.moduleId,createCourseProgress(course));
  return courseProgress.get(course.moduleId);
}
function renderCourse(){
  const m=state.module,course=getCourse(m.id),progress=currentCourseProgress(course),summary=courseSummary(progress,course),answer=quizAnswers.get(m.id);
  $('#page-course').innerHTML=`<div class="course-layout"><div class="paper-panel"><div class="eyebrow">LESSON / ${m.short}</div><h2>${escape(course.title)}</h2><p>${escape(course.objective)}</p><div class="course-progress"><span>本次课程进度 ${summary.completed} / ${summary.total}</span><progress max="${summary.total}" value="${summary.completed}" aria-label="课程步骤完成进度"></progress></div><p class="course-session-note">切换系统会保留本次进度；刷新页面后重新开始。预测与观察摘要保存在学习记录中。</p>${course.steps.map((step,i)=>{
    const done=progress.completedStepIds.includes(step.id),available=done||summary.nextStepId===step.id,prediction=progress.predictions[step.id];
    return `<div class="step-row ${done?'step-done':''}"><span class="num">${done?'✓':String(i+1).padStart(2,'0')}</span><div class="step-body"><h3>${escape(step.title)}</h3><p>${escape(step.description)}</p>${step.prediction?`<fieldset class="prediction" ${!available||prediction?'disabled':''}><legend>${escape(step.prediction.question)}</legend>${step.prediction.options.map((option,index)=>`<button class="prediction-option ${prediction?.answer===index?'selected':''}" data-prediction-step="${step.id}" data-prediction-answer="${index}" aria-pressed="${prediction?.answer===index}">${escape(option)}</button>`).join('')}</fieldset>${prediction?`<p class="prediction-feedback">${prediction.correct?'你的预测与模型一致。':'已记录你的预测，继续用实验检验。'}${escape(step.prediction.reason)}</p>`:''}`:`<button class="text-btn" data-course-step="${step.id}" ${available?'':'disabled'}>${available?escape(step.actionLabel):'完成前一步后解锁'} ↗</button>`}</div></div>`;
  }).join('')}<button class="text-btn course-reset" data-action="restart-course">重新开始本次课程</button></div><div class="paper-panel"><div class="eyebrow">CHECK YOUR UNDERSTANDING</div><h2>解释你的观察</h2><p>${summary.finished?'结合预测与观察，回答机制问题。':'完成左侧观察任务后，解锁机制问题。'}</p><p>${m.quiz.q}</p>${m.quiz.answers.map((a,i)=>`<button class="quiz-option ${answer!==undefined&&i===m.quiz.correct?'correct':''} ${answer===i&&i!==m.quiz.correct?'wrong':''}" data-answer="${i}" ${!summary.finished||answer!==undefined?'disabled':''}><span>${String.fromCharCode(65+i)}.</span>${a}</button>`).join('')}<div class="quiz-result" id="quiz-result" role="status">${answer!==undefined?`${answer===m.quiz.correct?'回答正确。':'再沿反馈回路想一想。'}${m.quiz.reason}`:''}</div>${answer!==undefined?'<button class="text-btn" data-action="retry-quiz" style="margin-top:18px">重新作答</button>':''}</div></div>`;
}
function courseObservationMatches(){
  if(!activeCourseStep)return false;
  const task=activeCourseStep;
  return state.module.id===task.moduleId&&state.scenario===task.expected.scenario&&state.branchAt===task.expected.branchAt&&state.time>=task.expected.time-1e-9&&state.compare===task.expected.compare;
}
function updateCourseObservation(){
  const box=$('#course-observation');box.hidden=!activeCourseStep;
  if(!activeCourseStep){box.dataset.renderKey='';return;}
  const task=activeCourseStep,step=getCourse(state.module.id).steps.find(s=>s.id===task.stepId),matches=courseObservationMatches();
  const renderKey=`${task.moduleId}/${task.stepId}/${task.expected.time}/${matches}`;
  if(box.dataset.renderKey===renderKey)return;
  box.dataset.renderKey=renderKey;
  box.innerHTML=`<div><strong>${escape(step.title)}</strong><p>${matches?'观察指标与比较曲线后，返回课程记录这一步。':`请回到课程重新进入任务，或恢复目标情景并观察至 ${task.expected.time} ${state.module.unit}。`}</p></div><button class="secondary-btn" data-action="complete-observation" ${matches?'':'disabled'}>完成观察，返回课程</button>`;
}
function startCourseStep(stepId){
  const course=getCourse(state.module.id),progress=currentCourseProgress(course),step=course.steps.find(s=>s.id===stepId),summary=courseSummary(progress,course);
  if(!step||step.prediction||(!progress.completedStepIds.includes(step.id)&&summary.nextStepId!==step.id))return;
  step.commands.forEach(cmd=>validateCommand(cmd,state.module));
  activeCourseStep=null;showView('lab');state.compare=step.compare;$('#compare-toggle').checked=step.compare;
  step.commands.forEach(cmd=>command(cmd));
  activeCourseStep={moduleId:state.module.id,stepId,expected:{scenario:state.scenario,branchAt:state.branchAt,time:state.time,compare:state.compare}};
  updateCourseObservation();
}

function renderKnowledge(){
  const m=state.module,mechanism=getMechanism(m.id);validateMechanism(mechanism,m);
  const label=id=>m.nodes.find(n=>n[0]===id)?.[1]??id;
  const list=items=>`<ul class="evidence-list">${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`;
  $('#page-knowledge').innerHTML=`<div class="knowledge-grid"><div><div class="paper-panel"><div class="eyebrow">CAUSAL CONNECTIONS</div><h2>机制关系</h2>${m.edges.map(([a,b,s])=>`<div class="relation"><span>${label(a)}</span><em class="${s==='−'?'negative':''}">${s==='−'?'抑制':'促进'} →</em><span>${label(b)}</span></div>`).join('')}<p style="margin-top:20px">${m.explain}</p></div><div class="paper-panel evidence-panel"><h2>这些指标表示什么？</h2><p>以起点为 1.00，观察 ${mechanism.clock.duration} ${escape(mechanism.clock.unit)}内的相对变化。</p><dl class="state-definitions">${mechanism.states.map(item=>`<dt>${escape(item.label)}</dt><dd>${escape(item.meaning)}</dd>`).join('')}</dl></div></div><div><div class="paper-panel"><div class="eyebrow">教学机制 · 待医学专家审核</div><h2>实验的假设与边界</h2><p>${m.misconception}</p>${list(mechanism.assumptions)}<details class="evidence-details"><summary>查看尚未覆盖的机制</summary>${list(mechanism.limitations)}</details></div><div class="paper-panel evidence-panel"><h2>这次干预改变了什么？</h2><p>${escape(mechanism.intervention.meaning)}</p><p>参数与时间常数为教学设定；恢复模型参数用于检验机制，不对应具体药物或剂量。</p></div><div class="paper-panel evidence-panel"><h2>查阅依据</h2><p>以下来源支持机制概念，当前曲线未复现文献模型，也未完成临床校准。</p>${mechanism.sources.map(source=>`<a class="source-link" href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)} ↗<small>${escape(Array.isArray(source.supports)?source.supports.join('；'):source.supports)}</small></a>`).join('')}</div></div></div>`;
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
  $('#time-number').textContent=formatTime(state.time);$('#timeline-slider').value=state.time;$('#timeline-slider').setAttribute('aria-valuetext',`${formatTime(state.time)} ${state.module.unit}`);scene?.setValues(val,state.time,state.playing);drawChart();updatePlay();updateCourseObservation();
}
function explain(){
  const m=state.module,val=sample(state.trajectories.current,state.time),prev=sample(state.trajectories.current,Math.max(0,state.time-m.step*3));const key=m.metrics[0][0],direction=val[key]-prev[key]>0.00005?'上升':val[key]-prev[key]<-0.00005?'下降':'接近平稳';
  const scenario=m.scenarios.find(s=>s.id===state.scenario);
  let branchExplanation='';
  if(state.branchAt!==null){
    const before=parameters(m,state.scenario),after=parameters(m,state.scenario,true),changed=Object.keys(before).some(k=>before[k]!==after[k]);
    branchExplanation=` 已在 ${formatTime(state.branchAt)} ${m.unit}建立「${m.experiment}」分支。`;
    if(!changed)branchExplanation+='本情景中要恢复的参数已处于基准，因此操作没有改变参数，实线与未干预虚线重合。';
    else if(state.time<=state.branchAt)branchExplanation+='当前查看的是干预点或之前的状态，后续变化尚未发生。';
    else{const original=sample(state.trajectories.original,state.time),difference=val[key]-original[key];branchExplanation+=`${m.metrics[0][1]}相对同一时点的未干预轨迹${Math.abs(difference)<0.0005?'接近不变':`${difference>0?'高':'低'} ${Math.abs(difference).toFixed(3)} 个基准单位`}。`;}
  }
  $('#guide-output').textContent=`在「${scenario.name}」的 ${formatTime(state.time)} ${m.unit}，${m.metrics[0][1]}为基准的 ${val[key].toFixed(2)} 倍，当前${direction}。${m.explain}${branchExplanation}`;
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
function snapshot(){const values=sample(state.trajectories.current,state.time);return {view:state.view,anatomy:{status:anatomyState.status,structureId:anatomyState.selected,layer:anatomyState.layer},module:state.module.id,scenario:state.scenario,time:state.time,unit:state.module.unit,playing:state.playing,branchAt:state.branchAt,focus:state.focus,modelVersion:MODEL_VERSION,values:Object.fromEntries(state.module.metrics.map(([key])=>[key,values[key]]))};}
$('#scenario-select').addEventListener('change',e=>command({type:'scenario',scenarioId:e.target.value}));
$('#timeline-slider').addEventListener('input',e=>command({type:'seek',time:Number(e.target.value)}));
$('#compare-toggle').addEventListener('change',e=>{state.compare=e.target.checked;paint();});
$('#speed-select').addEventListener('change',e=>state.speed=Number(e.target.value));
$('#anatomy-select').addEventListener('change',e=>anatomyCommand({type:'focus',structureId:e.target.value||null}));
$('#anatomy-context').addEventListener('change',e=>anatomyCommand({type:'context',enabled:e.target.checked}));
$('#guide-form').addEventListener('submit',e=>{e.preventDefault();const text=$('#guide-input').value;try{const cmd=parseLocalRequest(text,state.module);if(cmd){command(cmd);if(cmd.type!=='explain')$('#guide-output').textContent=`已执行${{seek:'时间定位',focus:'结构定位',play:'播放',pause:'暂停',branch:'机制实验',undoBranch:'撤销分支'}[cmd.type]}。${cmd.type==='focus'?state.module.explain:''}`;}else $('#guide-output').textContent='当前助教支持本地实验指令与机制解释。可以输入“为什么变化”“定位结构名称”“跳到时间”“暂停”。开放式医学问答需要后续接入经过审核的知识库与模型。';}catch(err){$('#guide-output').textContent=err.message;}$('#guide-input').value='';});
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.module){selectModule(b.dataset.module);return;}
  if(b.dataset.view){showView(b.dataset.view);return;}
  if(b.dataset.anatomyStructure){anatomyCommand({type:'focus',structureId:b.dataset.anatomyStructure});return;}
  if(b.dataset.anatomyLayer){anatomyCommand({type:'layer',layer:b.dataset.anatomyLayer});return;}
  if(b.dataset.time!==undefined){command({type:'seek',time:Number(b.dataset.time)});return;}
  if(b.dataset.answer!==undefined){const course=getCourse(state.module.id);if(!courseSummary(currentCourseProgress(course),course).finished)return;const answer=Number(b.dataset.answer),correct=answer===state.module.quiz.correct;quizAnswers.set(state.module.id,answer);log(`机制题：${correct?'正确':'需复习'}`);renderCourse();return;}
  if(b.dataset.predictionStep){
    const course=getCourse(state.module.id),step=course.steps.find(s=>s.id===b.dataset.predictionStep),answer=Number(b.dataset.predictionAnswer);
    try{let progress=recordPrediction(currentCourseProgress(course),course,step.id,answer);progress=completeCourseStep(progress,course,step.id);courseProgress.set(course.moduleId,progress);log(`课程预测：${step.prediction.options[answer]}`);renderCourse();}catch(err){toast(err.message);}return;
  }
  if(b.dataset.courseStep){startCourseStep(b.dataset.courseStep);return;}

  if(b.dataset.restore!==undefined){const r=records[Number(b.dataset.restore)];if(r){selectModule(r.module);command({type:'scenario',scenarioId:r.scenario});command({type:'seek',time:r.time});toast('已重访该情景与时间点；历史干预不自动重建。');}return;}
  const action=b.dataset.action;
  if(action==='menu')$('.sidebar').classList.toggle('open');
  else if(action==='anatomy-retry')ensureAnatomy();
  else if(action==='anatomy-manual')anatomyCommand({type:'manual',enabled:!anatomyState.manual});
  else if(action==='play-toggle')command({type:state.playing?'pause':'play'});
  else if(action==='restart')command({type:'seek',time:0});
  else if(action==='overview-camera')command({type:'focus',nodeId:null});
  else if(action==='camera-mode'){state.manual=!state.manual;scene?.setManual(state.manual);b.textContent=state.manual?'自由观察':'课程镜头';}
  else if(action==='focus-key'){command({type:'focus',nodeId:state.module.focus});explain();}
  else if(action==='compare-guide'){state.compare=true;$('#compare-toggle').checked=true;paint();$('#guide-output').textContent='已叠加正常基准。实线表示当前情景，虚线表示相同模型下的正常响应；选择一个异常情景，比较末端输出与上游反馈。';}
  else if(action==='complete-observation'&&courseObservationMatches()){
    const course=getCourse(state.module.id),progress=completeCourseStep(currentCourseProgress(course),course,activeCourseStep.stepId);courseProgress.set(course.moduleId,progress);log(`完成观察：${course.steps.find(s=>s.id===activeCourseStep.stepId).title}`);activeCourseStep=null;updateCourseObservation();showView('course');
  }
  else if(action==='restart-course'){const course=getCourse(state.module.id);courseProgress.set(course.moduleId,createCourseProgress(course));quizAnswers.delete(course.moduleId);activeCourseStep=null;updateCourseObservation();log('重新开始课程');renderCourse();}
  else if(action==='retry-quiz'){quizAnswers.delete(state.module.id);renderCourse();}
  else if(action==='export-history'){const blob=new Blob([JSON.stringify({modelVersion:MODEL_VERSION,exportedAt:new Date().toISOString(),records,courseProgress:[...courseProgress.values()]},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='endolab-learning-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
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
  register({name:'view_endocrine_anatomy',description:'打开真实参考解剖，保留当前实验时间和干预分支；可定位已接入的器官并选择全身、局部或特写镜头。',inputSchema:{type:'object',properties:{structureId:{type:['string','null']},layer:{type:'string',enum:['body','regional','organ']}},additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['structureId','layer'].includes(key)))throw new Error('无效的解剖指令');
    await ensureAnatomy();if(anatomyState.status!=='ready')throw new Error('解剖模型加载失败，可在解剖定位视图重试');
    const commands=[];
    if(Object.hasOwn(input,'structureId'))commands.push(validateAnatomyCommand({type:'focus',structureId:input.structureId},anatomyState.manifest));
    if(Object.hasOwn(input,'layer'))commands.push(validateAnatomyCommand({type:'layer',layer:input.layer},anatomyState.manifest));
    showView('anatomy');commands.forEach(anatomyCommand);return snapshot();
  }});
  register({name:'control_endocrine_experiment',description:'控制当前教学实验；支持定位时间、结构、播放、暂停、情景选择与建立或撤销机制分支。',inputSchema:{type:'object',properties:{type:{type:'string',enum:['seek','focus','scenario','play','pause','branch','undoBranch','explain']},time:{type:'number'},nodeId:{type:['string','null']},scenarioId:{type:'string'}},required:['type'],additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{validateCommand(input,state.module);showView('lab');return command(input);}});
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
