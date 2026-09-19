import {MODEL_VERSION,derivative,parameters as simulationParameters} from './simulation.js';

// Evidence supports qualitative physiology, never the numerical teaching choices.
const evidenceVersion='mechanism-sources-2026-09-19';
const reviewStatus='尚未经过内分泌与代谢专科专家审核；未完成临床验证';
const teachingSource='教学设定；未按患者数据拟合或临床校准';
const relativeUnit='相对基准（无量纲，初值 1）';
const state=(key,label,meaning,role='反馈状态')=>({key,label,unit:relativeUnit,meaning,role});
const parameter=(key,meaning)=>({key,meaning,source:teachingSource});
const source=(title,url,...supports)=>({title,url,supports});
const commonAssumptions=[
  '所有状态从相对基准开始；各病理场景在实验起点改变调节能力，起点不是该场景预先达到的稳态。',
  '时间单位用于组织教学过程；时间常数、响应系数和场景幅度均为教学设定。',
];
const commonLimitations=[
  '来源只支持所列生理关系，不支持本模型的参数、曲线幅度、时间尺度或临床有效性。',
  '数值保护将状态限制在 0.02–8；这不是生理正常范围，触及边界的轨迹不作医学解释。',
  '用于比较反馈方向和状态滞后，不能换算成检验值、诊断阈值、药物剂量或个体治疗结果。',
];
const axisParameters=terminal=>[
  parameter('capacity',`${terminal}响应系数；正常/中枢场景为 1，原发场景为 0.3；干预恢复为 1。`),
  parameter('pituitary','垂体驱动系数；正常/原发场景为 1，中枢场景为 0.3；干预不改变该值。'),
  parameter('feedbackGains','下丘脑反馈增益 0.7、垂体反馈增益 0.75；均作用于偏差 (1−g)。'),
];
const axisAssumptions=[
  '下丘脑促进垂体驱动，垂体促进末端腺体分泌，末端激素对上游形成负反馈；只比较当前场景中的方向。',
  '中枢场景仅降低垂体驱动，不单独模拟下丘脑病变或激素生物活性改变。',
];
const contracts={
  glucose:{
    clock:{unit:'分钟',duration:240,step:0.25},
    states:[
      state('g','血糖','循环葡萄糖相对量；由一餐输入、肝糖生成与葡萄糖清除共同改变。','受调节状态'),
      state('i','胰岛素','β 细胞对高于基准血糖的聚合分泌响应；分泌能力与组织敏感性分别建模。'),
      state('u','外周摄糖','摄糖响应的滞后展示；实际葡萄糖清除由即时摄糖响应与当前血糖共同决定。','显示信号'),
      state('h','肝糖输出','肝糖输出响应的滞后展示；对血糖的作用由即时肝糖输出决定。','显示信号'),
    ],
    parameters:[
      parameter('sensitivity','外周及肝脏共享敏感性：正常/分泌减弱为 1，抵抗为 0.35；干预设为 1。'),
      parameter('capacity','高血糖诱导分泌能力：正常/抵抗为 1，分泌减弱为 0.3；基础分泌项仍为 1。'),
      parameter('mealInput','餐输入 M=0.055×(t/28)×exp(1−t/28)；0.055 为相对量/分钟，28 分钟为输入峰值时间。'),
      parameter('insulinAction','uptake=1+0.8×sensitivity×max(0,i−1)；hepatic=1/[1+0.85×sensitivity×max(0,i−1)]。'),
      parameter('glucoseTurnover','dg/dt=M+0.018×hepatic−0.018×g×uptake；0.018 的时间单位为每分钟。'),
      parameter('insulinResponse','di/dt=[1+3.1×capacity×max(0,g−1)−i]/15；响应时间常数 15 分钟。'),
      parameter('displayLag','dh/dt=(hepatic−h)/8；du/dt=(uptake−u)/8；展示时间常数均为 8 分钟。'),
    ],
    assumptions:[...commonAssumptions,
      '单餐平滑输入，不含胃排空、肠促胰素、胰高血糖素、肾糖排泄或个体差异。',
      '胰岛素作用只取高于基准的部分；低血糖反调节及基础胰岛素缺失不在方程中。',
      'GLUT4 用于解释肌肉和脂肪的胰岛素敏感性摄糖；肝脏的作用是糖生成/代谢调节。',
    ],
    limitations:[...commonLimitations,
      '不是 Dalla Man 等人的餐后模型实现：只借鉴餐输入、生成、利用和分泌的分解思路。',
      '肝糖输出与外周摄糖曲线是滞后显示信号，不是测得的通量；不能据两条显示曲线重建瞬时质量平衡。',
      '分泌减弱场景不是完整的 1 型糖尿病模型；未模拟酮体、酸中毒或完全胰岛素缺乏。',
    ],
    intervention:{label:'恢复胰岛素响应',changes:[{key:'sensitivity',value:1}],meaning:'在分支点后恢复共享敏感性，保留已形成的状态与分泌能力；不代表药物、运动或给药剂量。'},
    sources:[
      source('Dalla Man 等：Meal simulation model of the glucose-insulin system（2007）','https://pubmed.ncbi.nlm.nih.gov/17926672/','餐后过程可分为餐输入、内源性葡萄糖生成、利用与胰岛素分泌；本文模型的拟合与验证不能转移到本教学模型。'),
      source('Herman 与 Kahn：Glucose transport and sensing（2006）','https://www.jci.org/articles/view/29027','胰岛素敏感性葡萄糖转运及组织间调节参与葡萄糖稳态。','GLUT4 主要见于骨骼肌、心肌和脂肪组织；不能把肝脏绘制成同样的 GLUT4 转运模型。'),
    ],
  },
  thyroid:{
    clock:{unit:'天',duration:14,step:0.025},
    states:[
      state('g','甲状腺激素','合并表示甲状腺激素输出及其反馈效应，不对应游离 T4、总 T4 或 T3 的单项化验。','受调节状态'),
      state('p','TSH','垂体促甲状腺激素的平均驱动，与 TRH 信号及末端激素反馈相关。'),
      state('h','TRH 信号','下丘脑促甲状腺激素释放信号的聚合状态，不是外周可测 TRH 浓度。'),
    ],
    parameters:[...axisParameters('甲状腺'),
      parameter('axisTime','time=0.7 天；h、p、g 时间常数分别为 1.1×time=0.77、0.8×time=0.56、2×time=1.4 天。'),
      parameter('drive','上游基础驱动 drive=1；不含脉冲、昼夜节律或碘供给动态。'),
    ],
    assumptions:[...commonAssumptions,...axisAssumptions,
      '完整上游可对低甲状腺输出产生反馈性 TSH 增加；垂体驱动减弱时，这种代偿不足。',
      '以同一合并状态表达激素合成与负反馈，不模拟 T4→T3 转换或结合蛋白。',
    ],
    limitations:[...commonLimitations,
      '中枢性甲减可见低或不恰当正常的 TSH，部分生物活性下降情形还可轻度升高；当前单参数场景只呈现其中一种方向。',
      '14 天教学窗与 1.4 天输出时间常数均不代表左甲状腺素药代或治疗复查时间。',
      '未模拟自身免疫、碘摄入、结节自主分泌、妊娠、重症疾病或检验干扰。',
    ],
    intervention:{label:'恢复甲状腺响应',changes:[{key:'capacity',value:1}],meaning:'只恢复甲状腺响应；中枢场景的垂体驱动仍然减弱，因此该干预不会修复中枢驱动。'},
    sources:[
      source('Endotext：Physiology of the Hypothalamic-Pituitary-Thyroid Axis','https://www.ncbi.nlm.nih.gov/books/NBK278958/?report=reader','TRH→TSH→甲状腺激素的促分泌关系及甲状腺激素对上游的负反馈。','中枢性甲减的 TSH 浓度与生物活性可能不一致，不能用单一 TSH 方向概括。'),
      source('NIDDK：Thyroid Tests','https://www.niddk.nih.gov/health-information/diagnostic-tests/thyroid','TSH 促进 T4/T3 生成；解释甲状腺功能需要结合其他检测和情境。'),
      source('NIDDK：Hypothyroidism','https://www.niddk.nih.gov/health-information/endocrine-diseases/hypothyroidism','甲状腺自身及下丘脑/垂体疾病都可能导致甲状腺激素不足；本模型不模拟具体病因。'),
    ],
  },
  adrenal:{
    clock:{unit:'小时',duration:24,step:0.04},
    states:[state('g','皮质醇','肾上腺糖皮质激素输出的相对量。','受调节状态'),state('p','ACTH','垂体促肾上腺皮质激素的聚合驱动。'),state('h','CRH 信号','合并节律、应激与反馈的下丘脑信号。')],
    parameters:[...axisParameters('肾上腺'),
      parameter('axisTime','time=1 小时；h、p、g 时间常数为 1.1、0.8、2 小时。'),
      parameter('drive','drive=1+0.24×sin[(t−2)×π/12]+0.9×exp[−((t−8)/1.4)²]；周期 24 小时，应激中心 8 小时、宽度参数 1.4 小时。'),
    ],
    assumptions:[...commonAssumptions,...axisAssumptions,'所有场景使用同一外部节律与一次应激输入；实验起点不指定现实钟点。'],
    limitations:[...commonLimitations,'不模拟超日节律脉冲、睡眠、药物抑制试验、醛固酮、儿茶酚胺或肾上腺危象。','应激宽度、峰值和相位只是教学输入；单个采样时间不能代表整日激素状态。'],
    intervention:{label:'恢复肾上腺响应',changes:[{key:'capacity',value:1}],meaning:'只改变肾上腺响应，保留相同应激与上游状态；不是糖皮质激素替代治疗。'},
    sources:[
      source('NIDDK：Definition & Facts of Adrenal Insufficiency','https://www.niddk.nih.gov/health-information/endocrine-diseases/adrenal-insufficiency-addisons-disease/definition-facts','CRH→ACTH→皮质醇的促分泌链及原发、继发、第三性功能不足的位置区别。'),
      source('Endotext：Normal Physiology of ACTH and GH Release','https://www.ncbi.nlm.nih.gov/books/NBK279116/','ACTH/皮质醇具有昼夜节律，糖皮质激素反馈作用于上游；支持定性关系，不支持本模型波形。'),
    ],
  },
  gonadal:{
    clock:{unit:'天',duration:14,step:0.025},
    states:[state('g','睾酮','成年男性睾丸输出及其代谢相关反馈的合并相对量。','受调节状态'),state('p','LH','垂体黄体生成素的平均驱动。'),state('h','GnRH 信号','平均促性腺激素释放信号，不能解释真实脉冲频率。')],
    parameters:[...axisParameters('睾丸'),parameter('axisTime','time=0.7 天；h、p、g 时间常数为 0.77、0.56、1.4 天。'),parameter('drive','基础驱动 drive=1；与甲状腺场景复用教学反馈形式，不表示两者动力学相同。')],
    assumptions:[...commonAssumptions,...axisAssumptions,'只模拟男性 GnRH–LH–睾酮平均反馈；芳香化相关反馈并入睾酮的合并效应。'],
    limitations:[...commonLimitations,'不含 GnRH/LH 脉冲、FSH、抑制素、精子生成、青春期、卵巢周期或雌激素正反馈。','与甲状腺采用相同教学常数，不主张两条轴具有相同生理时间尺度。'],
    intervention:{label:'恢复性腺响应',changes:[{key:'capacity',value:1}],meaning:'恢复睾丸响应能力；中枢驱动仍保留原值，不模拟睾酮给药或生育治疗。'},
    sources:[source('Endotext：Androgen Physiology, Pharmacology, Use and Misuse','https://www.ncbi.nlm.nih.gov/books/NBK279000/?report=reader','GnRH 促进 LH 分泌，LH 促进 Leydig 细胞生成睾酮。','睾酮及其芳香化相关信号参与负反馈；原发睾丸与中枢驱动不足应分别定位。')],
  },
  calcium:{
    clock:{unit:'小时',duration:48,step:0.08},
    states:[state('g','血钙','循环钙的聚合相对量，不区分离子钙、总钙与白蛋白结合。','受调节状态'),state('p','PTH','受血钙反馈及自主分泌项影响的甲状旁腺激素。'),state('h','血磷','正常肾功能前提下随 PTH 调整的聚合血磷相对量。','受调节状态'),state('u','钙动员信号','随 PTH 滞后变化的展示信号，不直接进入血钙方程，也不等同骨转换标志物。','显示信号')],
    parameters:[
      parameter('autonomous','自主 PTH 输入：正常/不足为 0，自主分泌为 1.3；干预设为 0。'),
      parameter('capacity','血钙反馈耦合的分泌响应：正常/自主分泌为 1，不足为 0.25；干预设为 1。'),
      parameter('pthResponse','PTH 目标=C[capacity×(1+4×(1−g))+autonomous]；响应时间常数 3 小时。'),
      parameter('calciumResponse','血钙目标为 1+0.3×(p−1)，时间常数 8 小时。'),
      parameter('phosphateResponse','血磷目标为 C[1−0.25×(p−1)]，时间常数 7 小时。'),
      parameter('mobilizationSignal','动员显示目标为 C[1+0.6×(p−1)]，时间常数 5 小时；C 表示 0.02–8 数值截断。'),
    ],
    assumptions:[...commonAssumptions,'肾功能正常；PTH 对血钙的骨、肾和间接肠道效应合并为一个目标项。','降低血钙提高反馈性 PTH，PTH 增高推动血钙升高并推动血磷下降。'],
    limitations:[...commonLimitations,'没有独立的骨钙储库、肾排泄通量、维生素 D 或 FGF23 状态；不能分析骨量或慢性肾病矿物质骨代谢异常。','持续 PTH 的简化效应不能外推到间歇性 PTH 治疗或完整骨重建过程。'],
    intervention:{label:'恢复 PTH 调节',changes:[{key:'capacity',value:1},{key:'autonomous',value:0}],meaning:'同时恢复反馈响应并去除自主分泌项，保留当时血钙、血磷及 PTH 状态。'},
    sources:[
      source('NIDDK：Primary Hyperparathyroidism','https://www.niddk.nih.gov/health-information/endocrine-diseases/primary-hyperparathyroidism','血钙参与 PTH 反馈；PTH 通过骨、肾和肠道相关作用提高血钙。'),
      source('Endotext：Calcium and Phosphate Homeostasis','https://www.ncbi.nlm.nih.gov/books/NBK279023/','PTH 增加肾钙重吸收并抑制肾近端磷重吸收；完整网络还包含维生素 D、FGF23 与骨代谢。'),
    ],
  },
  energy:{
    clock:{unit:'天',duration:28,step:0.05},
    states:[state('g','能量储存','摄入与消耗差额累积形成的相对储存量，不能换算为体重或脂肪公斤数。','累积状态'),state('p','脂肪反馈信号','由储存驱动的聚合反馈信号，不是瘦素浓度。'),state('h','摄入驱动','对外源输入及反馈作滞后响应的聚合摄入状态。'),state('u','消耗水平','对储存增加作滞后响应的聚合消耗状态。')],
    parameters:[
      parameter('excess','外源输入增量：平衡为 0，盈余/弱反馈为 0.3；干预设为 0。'),
      parameter('response','摄入对反馈的响应强度：平衡/盈余为 1，弱反馈为 0.2；干预保留该值。'),
      parameter('storageRate','dg/dt=0.09×(h−u)；系数单位为每天，用于相对储存变化。'),
      parameter('feedbackLag','dp/dt=(g−p)/3；反馈时间常数 3 天。'),
      parameter('intakeResponse','摄入目标 C[1+excess−response×0.65×(p−1)]，时间常数 1.5 天。'),
      parameter('expenditureResponse','消耗目标 C[1+0.18×(g−1)]，时间常数 2 天；C 表示 0.02–8 数值截断。'),
    ],
    assumptions:[...commonAssumptions,'储存变化来自输入与消耗差额，脂肪相关信号参与摄入反馈。','消耗仅依赖储存；脂肪信号对消耗的其他作用未独立建模。'],
    limitations:[...commonLimitations,'忽略体组成、食物成分、行为环境、药物、遗传与适应性产热的具体过程。','弱反馈是一种机制比较，不能由此解释个人肥胖原因或预测减重幅度。'],
    intervention:{label:'恢复能量输入',changes:[{key:'excess',value:0}],meaning:'撤去外源输入增量，保留已累积储存、信号滞后及反馈响应强度。'},
    sources:[
      source('NIDDK：Factors Affecting Weight & Health','https://www.niddk.nih.gov/health-information/weight-management/adult-overweight-obesity/factors-affecting-weight-health','持续输入超过消耗可形成储存；体重受生物、环境、药物与行为等多因素影响。'),
      source('Endotext：Functional Anatomy of the Hypothalamus and Pituitary','https://www.ncbi.nlm.nih.gov/books/NBK279126/?report=reader','脂肪来源的瘦素信号可作用于下丘脑食欲和能量调节；本模型仅作聚合类比。'),
    ],
  },
};

for(const contract of Object.values(contracts))Object.assign(contract,{modelVersion:MODEL_VERSION,evidenceVersion,reviewStatus});
const clone=value=>JSON.parse(JSON.stringify(value));

/** Returns an independent contract; unknown modules never fall back to glucose. */
export function getMechanism(moduleId){
  if(!Object.hasOwn(contracts,moduleId))throw new Error('Unknown mechanism module');
  return clone(contracts[moduleId]);
}

/** Structural and implementation consistency check, not a medical certification. */
export function validateMechanism(contract,module){
  const fail=message=>{throw new Error(`Invalid mechanism: ${message}`);};
  const require=(condition,message)=>{if(!condition)fail(message);};
  const nonempty=value=>typeof value==='string'&&value.trim().length>0;
  const strings=(value,name)=>require(Array.isArray(value)&&value.length>0&&value.every(nonempty),name);
  const unique=(items,name)=>{
    require(Array.isArray(items)&&items.length>0,name);
    require(items.every(item=>item&&nonempty(item.key)),`${name} keys`);
    require(new Set(items.map(item=>item.key)).size===items.length,`${name} duplicate keys`);
    return new Set(items.map(item=>item.key));
  };
  require(module&&Object.hasOwn(contracts,module.id),'unknown module');
  require(contract&&typeof contract==='object','contract');
  const expected=contracts[module.id];
  require(contract.modelVersion===MODEL_VERSION,'modelVersion');
  require(contract.evidenceVersion===evidenceVersion,'evidenceVersion');
  require(contract.reviewStatus===reviewStatus,'reviewStatus must disclose pending expert review');
  require(contract.clock&&['unit','duration','step'].every(key=>contract.clock[key]===module[key]),'clock does not match module');
  require(['duration','step'].every(key=>Number.isFinite(contract.clock[key])&&contract.clock[key]>0)&&contract.clock.step<=contract.clock.duration,'invalid clock');
  const states=unique(contract.states,'states');
  const params=unique(contract.parameters,'parameters');
  require(contract.parameters.length===expected.parameters.length&&expected.parameters.every(p=>params.has(p.key)),'parameter declarations');
  for(const entry of contract.parameters){
    require(nonempty(entry.meaning),'parameter meaning');
    require(entry.source===teachingSource,'parameter source must identify teaching design');
  }
  require(Array.isArray(module.metrics)&&module.metrics.length===states.size,'metric count');
  for(const [key,label] of module.metrics){
    const entry=contract.states.find(s=>s.key===key);
    require(entry&&entry.label===label,`metric reference ${key}`);
    require(entry.unit===relativeUnit&&nonempty(entry.meaning)&&nonempty(entry.role),`state ${key}`);
  }
  require(Array.isArray(module.nodes)&&Array.isArray(module.edges),'module graph');
  const nodes=new Set(module.nodes.map(node=>node[0]));
  require(nodes.size===module.nodes.length,'duplicate node');
  for(const node of module.nodes)require(states.has(node[5]),`node state reference ${node[0]}`);
  for(const [from,to,sign] of module.edges)require(nodes.has(from)&&nodes.has(to)&&['+','−'].includes(sign),'edge reference');
  require(nodes.has(module.focus),'focus reference');
  strings(contract.assumptions,'assumptions');strings(contract.limitations,'limitations');
  const intervention=contract.intervention;
  require(intervention&&intervention.label===module.experiment&&nonempty(intervention.meaning),'intervention');
  const changes=unique(intervention.changes,'intervention changes');
  for(const {key,value} of intervention.changes)require(params.has(key)&&Number.isFinite(value),`intervention parameter ${key}`);
  require(changes.size===expected.intervention.changes.length&&expected.intervention.changes.every(item=>intervention.changes.some(change=>change.key===item.key&&change.value===item.value)),'intervention implementation');
  require(Array.isArray(module.scenarios)&&module.scenarios.length>0,'scenarios');
  const scenarioKeys=module.id==='glucose'?['sensitivity','capacity']:module.id==='calcium'?['autonomous','capacity']:module.id==='energy'?['excess','response']:['capacity','pituitary'];
  for(const scenario of module.scenarios){
    require(scenario.params&&Object.keys(scenario.params).length===scenarioKeys.length&&Object.entries(scenario.params).every(([key,value])=>scenarioKeys.includes(key)&&params.has(key)&&Number.isFinite(value)),`scenario parameter reference ${scenario.id}`);
    const base=simulationParameters(module,scenario.id);
    const changed={...base,...Object.fromEntries(intervention.changes.map(({key,value})=>[key,value]))};
    const actual=simulationParameters(module,scenario.id,true);
    require(Object.keys(actual).length===Object.keys(changed).length&&Object.entries(actual).every(([key,value])=>changed[key]===value),'intervention differs from solver');
    const d=derivative(module,0,{g:1,i:1,p:1,h:1,u:1},base);
    require(Object.keys(d).length===states.size&&Object.keys(d).every(key=>states.has(key))&&Object.values(d).every(Number.isFinite),'solver state references');
  }
  require(Array.isArray(contract.sources)&&contract.sources.length===expected.sources.length,'sources');
  const seen=new Set();
  for(const entry of contract.sources){
    require(entry&&nonempty(entry.title)&&nonempty(entry.url),'source metadata');
    let url;try{url=new URL(entry.url);}catch{fail('source URL');}
    require(url.protocol==='https:'&&!url.username&&!url.password,'source URL must be public HTTPS');
    require(!seen.has(entry.url),'duplicate source');seen.add(entry.url);
    strings(entry.supports,'source supports');
    const verified=expected.sources.find(s=>s.url===entry.url);
    require(verified&&entry.title===verified.title&&JSON.stringify(entry.supports)===JSON.stringify(verified.supports),'unverified source or unsupported claim');
  }
  return true;
}
