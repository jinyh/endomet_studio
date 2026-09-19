import {modules} from './data.js';

const VERSION='0.4.0';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const custom={
  glucose:{
    scenario:'deficiency',title:'敏感性能弥补分泌不足吗？',
    objective:'区分胰岛素分泌能力与组织敏感性，用正常、分泌减弱及机制分支的曲线检验预测。',
    prediction:{question:'分泌功能减弱时，只恢复胰岛素敏感性，曲线会怎样？',options:['血糖立即回到基准','曲线重合，敏感性原本正常','分泌能力随之恢复'],correct:1,reason:'本情景的胰岛素敏感性已为基准的 1 倍，而分泌能力为基准的 0.3 倍。分支只将胰岛素敏感性恢复到基准，没有改变分泌能力，因此模型轨迹重合。'},
    observe:'观察正常餐后血糖、胰岛素、外周摄糖和肝糖输出，记录它们随时间的变化。',
    compare:'切换为分泌功能减弱并叠加正常基准；对照血糖与胰岛素，区分分泌能力和组织响应。',
    intervene:'在分泌功能减弱情景的 60 分钟恢复敏感性，观察到 120 分钟。比较实线与未干预虚线，再判断这项操作是否改变了分泌能力。',
    branchAt:60,observeAt:60,resultAt:120,
  },
  thyroid:{
    scenario:'central',title:'末端恢复响应，能补足中枢驱动吗？',
    objective:'结合甲状腺激素与 TSH 比较中枢驱动减弱，解释恢复末端响应的适用边界。',
    prediction:{question:'在「中枢驱动减弱」情景中，只恢复甲状腺响应，是否足以使模型输出恢复正常？',options:['足以，中枢驱动也会被同时恢复','不足，恢复末端响应没有改变减弱的中枢驱动','TSH 与甲状腺输出无关'],correct:1,reason:'本情景的甲状腺响应已为基准的 1 倍，而中枢驱动为基准的 0.3 倍。分支只恢复甲状腺响应，不改变中枢驱动，因此此模型中分支与未干预轨迹重合。'},
    observe:'在正常反馈情景中联合观察甲状腺激素与 TSH，沿下丘脑—垂体—甲状腺回路定位负反馈。',
    compare:'叠加正常基准，观察中枢驱动减弱时甲状腺激素与 TSH 的组合；不要把低甲状腺输出一律解释为末端响应不足。',
    intervene:'在中枢驱动减弱情景的第 7 天恢复甲状腺响应，再观察第 14 天。比较实线与未干预虚线，判断这项操作是否改变了上游驱动。',
    branchAt:7,observeAt:7,resultAt:14,
  },
};

const assessments={
  glucose:{q:'在「分泌功能减弱」实验中，恢复敏感性后曲线重合，最合理的解释是什么？',answers:['分泌能力已随敏感性恢复','敏感性原本在基准，分泌不足仍然存在','血糖与胰岛素分泌无关'],correct:1,reason:'本课只恢复胰岛素敏感性，而这个情景的敏感性原本就在基准。分泌能力仍然减弱，因此模型中的分支与未干预轨迹重合。'},
  thyroid:{q:'在「中枢驱动减弱」实验中，恢复甲状腺响应后输出仍低，说明什么？',answers:['恢复末端响应就会同时修复中枢','甲状腺激素与 TSH 不存在反馈','末端响应已在基准，减弱的中枢驱动仍未改变'],correct:2,reason:'本课保留了减弱的中枢驱动。甲状腺响应原本已在基准，只恢复末端响应不能补足上游驱动，模型曲线因而仍与未干预轨迹重合。'},
  adrenal:{q:'在「肾上腺功能减弱」实验中，恢复肾上腺响应后，应怎样解释皮质醇轨迹的差异？',answers:['同一应激下，末端响应改变了皮质醇输出及上游反馈','分支操作抹去了此前的应激过程','恢复响应使昼夜节律不再影响输出'],correct:0,reason:'本课保持同一应激与节律输入，并保留分支前的状态。恢复肾上腺响应改变后续皮质醇输出，负反馈也随之影响上游信号。'},
  gonadal:{q:'在「性腺响应减弱」实验中，恢复性腺响应后，应联合观察哪些变化来解释反馈？',answers:['只观察睾酮，忽略 LH','观察睾酮输出与 LH 的反馈变化','假定分支前的状态也已恢复'],correct:1,reason:'本课改变性腺响应并保留上游状态。比较睾酮与 LH 的后续轨迹，才能把末端输出变化与上游负反馈联系起来。'},
  calcium:{q:'在「PTH 自主分泌」实验中恢复 PTH 调节后，如何解释血钙与血磷的后续变化？',answers:['两者只能同向变化','恢复调节会瞬间清除所有已累积变化','在肾功能正常的模型中，联合比较 PTH、血钙和血磷'],correct:2,reason:'本课恢复甲状旁腺响应与反馈耦合，保留分支前的状态。PTH 的骨和肾作用影响血钙与排磷，因此需要联合观察，且变化具有时间过程。'},
  energy:{q:'在「持续能量盈余」实验中，恢复能量输入后储存量仍高于起点，为什么？',answers:['已累积的储存与反馈滞后需要时间变化','恢复输入会立刻消除全部储存','能量输入不再影响后续储存'],correct:0,reason:'本课只把外源能量输入恢复到基准，保留已经累积的储存状态。操作改变后续变化速度，不会瞬间抹去过去的累积。'},
};

function buildCourse(module){
  const m=module,c=custom[m.id],scenario=c?.scenario??m.scenarios[1].id;
  const abnormal=m.scenarios.find(s=>s.id===scenario);
  const observeAt=c?.observeAt??m.duration/2,branchAt=c?.branchAt??m.duration/2,resultAt=c?.resultAt??m.duration;
  const prediction=c?.prediction??{
    question:`在「${abnormal.name}」中开展「${m.experiment}」，应该怎样判断模型结果？`,
    options:['操作一开始，所有指标就立即回到基准','保留分支点前的状态，比较之后的轨迹并结合反馈解释','只看一个指标，不需要比较未干预轨迹'],
    correct:1,reason:`${m.experimentNote} 应比较相同分支点之后的变化，而不是把参数恢复当作所有状态瞬间恢复。`,
  };
  return freeze({id:`${m.id}-feedback`,version:VERSION,moduleId:m.id,title:c?.title??m.question,objective:c?.objective??`围绕${m.short}，完成预测、正常观察、异常比较与机制实验，并用曲线说明反馈关系。`,assessment:assessments[m.id],steps:[
    {id:'predict',title:'先记录预测',description:'先选择你的预测。答错也可以继续，之后用观察结果修正解释。',actionLabel:'保存预测并继续',commands:[{type:'pause'}],compare:false,prediction},
    {id:'observe',title:'观察正常反馈',description:c?.observe??`进入「${m.scenarios[0].name}」，同时观察${m.metrics.map(([,label])=>label).join('、')}；拖动时间轴检查变化。`,actionLabel:'观察正常情景',commands:[{type:'scenario',scenarioId:'normal'},{type:'focus',nodeId:null},{type:'seek',time:observeAt}],compare:false},
    {id:'compare',title:'比较异常情景',description:c?.compare??`切换为「${abnormal.name}」并叠加正常基准，比较末端输出与反馈信号；结合关键结构解释差异。`,actionLabel:'叠加正常基准比较',commands:[{type:'scenario',scenarioId:scenario},{type:'focus',nodeId:m.focus},{type:'seek',time:observeAt}],compare:true},
    {id:'intervene',title:'干预并解释结果',description:c?.intervene??`${m.experimentNote} 从 ${branchAt} ${m.unit}建立分支，再比较后续实线与未干预虚线，用观察结果检验先前预测。`,actionLabel:'建立分支并查看结果',commands:[{type:'scenario',scenarioId:scenario},{type:'seek',time:branchAt},{type:'branch'},{type:'seek',time:resultAt},{type:'focus',nodeId:m.focus},{type:'explain'}],compare:true},
  ]});
}

const courses=modules.map(buildCourse);
export function getCourse(moduleId){
  const course=courses.find(c=>c.moduleId===moduleId);
  if(!course)throw new Error('未知课程系统');
  return course;
}
function canonicalCourse(course){
  if(!course||typeof course!=='object')throw new Error('无效课程');
  const known=getCourse(course.moduleId);
  if(course.id!==known.id||course.version!==known.version)throw new Error('课程版本不匹配');
  return known;
}
function checkProgress(progress,course){
  if(!progress||typeof progress!=='object'||progress.courseId!==course.id||progress.moduleId!==course.moduleId||progress.courseVersion!==course.version)throw new Error('学习进度不属于当前课程版本');
  const ids=progress.completedStepIds,predictions=progress.predictions;
  if(!Array.isArray(ids)||ids.length>course.steps.length||ids.some((id,i)=>id!==course.steps[i].id))throw new Error('课程步骤进度无效');
  if(!predictions||typeof predictions!=='object'||Array.isArray(predictions))throw new Error('预测记录无效');
  for(const [id,record] of Object.entries(predictions)){
    const index=course.steps.findIndex(s=>s.id===id),step=course.steps[index];
    if(!step?.prediction||index>ids.length||!record||Object.keys(record).some(key=>key!=='answer')||!Number.isInteger(record.answer)||record.answer<0||record.answer>=step.prediction.options.length)throw new Error('预测记录无效');
  }
  if(course.steps.some(s=>ids.includes(s.id)&&s.prediction&&!Object.hasOwn(predictions,s.id)))throw new Error('已完成的预测步骤缺少作答');
}
const copyProgress=progress=>({...progress,completedStepIds:[...progress.completedStepIds],predictions:Object.fromEntries(Object.entries(progress.predictions).map(([id,record])=>[id,{...record}]))});
export function createCourseProgress(course){
  const c=canonicalCourse(course);
  return {courseId:c.id,courseVersion:c.version,moduleId:c.moduleId,completedStepIds:[],predictions:{}};
}
export function recordPrediction(progress,course,stepId,answer){
  const c=canonicalCourse(course);checkProgress(progress,c);
  const step=c.steps[progress.completedStepIds.length];
  if(!step||step.id!==stepId||!step.prediction)throw new Error('只能为当前预测步骤作答');
  if(!Number.isInteger(answer)||answer<0||answer>=step.prediction.options.length)throw new Error('请选择有效的预测选项');
  const next=copyProgress(progress);
  next.predictions[stepId]={answer};
  return next;
}
export function completeCourseStep(progress,course,stepId){
  const c=canonicalCourse(course);checkProgress(progress,c);
  if(progress.completedStepIds.includes(stepId))return copyProgress(progress);
  const step=c.steps[progress.completedStepIds.length];
  if(!step||step.id!==stepId)throw new Error('请按顺序完成课程步骤');
  if(step.prediction&&!Object.hasOwn(progress.predictions,stepId))throw new Error('请先记录预测；答错也可以继续');
  const next=copyProgress(progress);next.completedStepIds.push(stepId);return next;
}
export function courseSummary(progress,course){
  const c=canonicalCourse(course);checkProgress(progress,c);
  const completed=progress.completedStepIds.length,total=c.steps.length;
  const feedback=predictionFeedback(progress,c);
  return {courseId:c.id,moduleId:c.moduleId,completed,total,finished:completed===total,nextStepId:c.steps[completed]?.id??null,predictionsRecorded:Object.keys(progress.predictions).length,observationsCompleted:c.steps.filter(s=>!s.prediction&&progress.completedStepIds.includes(s.id)).length,predictions:feedback.available?feedback.predictions:Object.entries(progress.predictions).map(([stepId,record])=>({stepId,answer:record.answer})),label:completed===total?'已完成课程步骤，可继续完成本课机制题':'继续完成预测与观察步骤'};
}
export function predictionFeedback(progress,course){
  const c=canonicalCourse(course);checkProgress(progress,c);
  const available=progress.completedStepIds.length===c.steps.length;
  return {available,predictions:available?Object.entries(progress.predictions).map(([stepId,record])=>{
    const prediction=c.steps.find(s=>s.id===stepId).prediction;
    return {stepId,answer:record.answer,correct:record.answer===prediction.correct,reason:prediction.reason};
  }):[]};
}
