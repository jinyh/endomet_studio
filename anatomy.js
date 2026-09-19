import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

const MAX_MODEL_BYTES=96*1024*1024;
const finiteVector=v=>v.every(Number.isFinite);
const vector3=v=>Array.isArray(v)&&v.length===3&&finiteVector(v);
const labelColumnWidth=width=>Math.min(128,Math.max(76,width*.2));
const DIRECTIONS={left:[1,0,0],superior:[0,1,0],anterior:[0,0,1]};

export function resolveAnatomyDirections(manifest){
  const directions=manifest.coordinates?.anatomicalDirections??(manifest.assetId==='bodyparts3d-endocrine'?DIRECTIONS:null);
  if(!directions)return null;
  const axes=['left','superior','anterior'].map(key=>directions[key]);
  if(!axes.every(vector3))throw new Error('解剖方向必须包含三个有限单位向量。');
  const [left,up,front]=axes.map(axis=>new THREE.Vector3().fromArray(axis));
  if([left,up,front].some(axis=>Math.abs(axis.length()-1)>1e-4)||Math.abs(left.dot(up))>1e-4||Math.abs(left.dot(front))>1e-4||Math.abs(up.dot(front))>1e-4||left.clone().cross(up).dot(front)<.9999)throw new Error('解剖方向必须是正交右手坐标。');
  return {left:left.toArray(),superior:up.toArray(),anterior:front.toArray()};
}

const REGION_IDS={head:['hypothalamus','pituitary'],adrenal:['adrenal-left','adrenal-right','kidney-left','kidney-right'],abdomen:['pancreas','duodenum','stomach','liver'],pelvis:['testis-left','testis-right']};
const regionFor=label=>label?.region??Object.keys(REGION_IDS).find(region=>REGION_IDS[region].includes(label?.structureId))??'organ';

export function planAnatomyView(labels,selectedId,layer,contextVisible,relevantIds=[]){
  const selected=labels.find(label=>label.structureId===selectedId),region=regionFor(selected),relevant=new Set(relevantIds);
  const regionalIds=new Set(REGION_IDS[region]??[selectedId]);
  regionalIds.add(selectedId);for(const label of labels)if(label.region&&label.region===region)regionalIds.add(label.structureId);
  // A pancreas view keeps useful immediate neighbors, without the large overlying liver.
  if(selectedId==='pancreas')regionalIds.delete('liver');
  const effectiveLayer=selected?layer:'body';
  return {region,layer:effectiveLayer,entries:labels.map(label=>{
    const id=label.structureId,isSelected=id===selectedId,isRelevant=relevant.has(id),body=id==='body';
    let visible=isSelected||!label.context||(contextVisible&&(body||isRelevant));
    if(effectiveLayer==='organ')visible=isSelected;
    if(effectiveLayer==='regional')visible=!body&&regionalIds.has(id)&&(isSelected||!label.context||contextVisible);
    const silhouette=visible&&!isSelected&&contextVisible&&(body||(effectiveLayer==='regional'&&['stomach','liver'].includes(id)));
    return {id,visible,silhouette,selected:isSelected,relevant:isRelevant,labelVisible:visible&&!body&&(isSelected||isRelevant),frame:visible&&!body&&!silhouette};
  })};
}

export function anatomyCameraDirection(region,layer,selectedId,directions){
  const axes=directions??DIRECTIONS;
  let offset=[0,0,1];
  if(layer!=='body'){
    if(region==='head')offset=[.65,.12,1];
    else if(region==='adrenal')offset=[selectedId?.endsWith('right')?-.24:.24,.18,-1];
    else if(region==='abdomen')offset=[.22,.24,1];
    else if(region==='pelvis')offset=[.18,.08,1];
  }
  return new THREE.Vector3().fromArray(axes.left).multiplyScalar(offset[0]).addScaledVector(new THREE.Vector3().fromArray(axes.superior),offset[1]).addScaledVector(new THREE.Vector3().fromArray(axes.anterior),offset[2]).normalize().toArray();
}

export function fitAnatomyCamera(min,max,aspect,{direction=[0,0,1],up=[0,1,0],fov=38,padding=1.16}={}){
  if(!vector3(min)||!vector3(max)||min.some((n,i)=>n>max[i])||!Number.isFinite(aspect)||aspect<=0||!Number.isFinite(fov)||fov<=0||fov>=175||!Number.isFinite(padding)||padding<1||!vector3(direction)||!vector3(up))throw new Error('解剖镜头参数无效。');
  const forward=new THREE.Vector3().fromArray(direction),vertical=new THREE.Vector3().fromArray(up);
  if(forward.length()<1e-8||vertical.length()<1e-8)throw new Error('解剖镜头方向无效。');
  forward.normalize();const right=vertical.clone().cross(forward);
  if(right.length()<1e-5)throw new Error('解剖镜头方向与上方向不能平行。');
  right.normalize();vertical.copy(forward).cross(right).normalize();
  const target=new THREE.Vector3().fromArray(min).add(new THREE.Vector3().fromArray(max)).multiplyScalar(.5),tangent=Math.tan(fov*Math.PI/360);
  let distance=.008;
  for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]]){
    const corner=new THREE.Vector3(x,y,z).sub(target);
    distance=Math.max(distance,corner.dot(forward)+Math.max(Math.abs(corner.dot(right))/(tangent*aspect),Math.abs(corner.dot(vertical))/tangent)*padding);
  }
  return {target:target.toArray(),position:target.clone().addScaledVector(forward,distance).toArray(),up:vertical.toArray(),distance};
}

export function projectAnatomyScale(camera,anchor,width,maxPixels=96){
  if(!vector3(anchor)||!Number.isFinite(width)||width<=0)return null;
  const origin=new THREE.Vector3().fromArray(anchor),view=origin.clone().applyMatrix4(camera.matrixWorldInverse);
  if(-view.z<=camera.near)return null;
  const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),a=origin.clone().project(camera),b=origin.clone().add(right).project(camera);
  const pixelsPerMeter=Math.abs(b.x-a.x)*width/2;
  if(!Number.isFinite(pixelsPerMeter)||pixelsPerMeter<=0)return null;
  const maximum=maxPixels/pixelsPerMeter,power=10**Math.floor(Math.log10(maximum));
  const meters=([5,2,1].find(value=>value*power<=maximum)??1)*power;
  const value=meters>=1?meters:meters>=.01?meters*100:meters*1000,unit=meters>=1?'m':meters>=.01?'cm':'mm';
  return {meters,pixels:meters*pixelsPerMeter,label:`${Number(value.toPrecision(3))} ${unit}`};
}

export function projectAnatomyDirections(camera,directions){
  const inverse=camera.quaternion.clone().invert(),axes=directions??DIRECTIONS;
  return [['left','左','右','x'],['superior','上','下','y'],['anterior','前','后','z']].flatMap(([key,positive,negative,axis])=>{
    const vector=new THREE.Vector3().fromArray(axes[key]).applyQuaternion(inverse);
    return (directions?[1,-1]:[1]).map(sign=>({label:directions?(sign>0?positive:negative):axis.toUpperCase(),axis,x:vector.x*sign,y:-vector.y*sign,z:vector.z*sign}));
  });
}

const TISSUES={pancreas:{color:'#cfb394',roughness:.5},liver:{color:'#86534c',roughness:.4},kidney:{color:'#9c655d',roughness:.43},adrenal:{color:'#c3a873',roughness:.58},stomach:{color:'#c29c91',roughness:.51},duodenum:{color:'#c9a698',roughness:.52},hypothalamus:{color:'#c7acaa',roughness:.64},pituitary:{color:'#b99593',roughness:.55},testis:{color:'#c8b79e',roughness:.5}};

export function createAnatomyMaterial(source,label){
  const tissue=TISSUES[label.structureId.split('-')[0]]??{color:label.color??'#b9aaa0',roughness:.56};
  const material=source.isMeshStandardMaterial?source.clone():new THREE.MeshStandardMaterial();
  if(!source.isMeshStandardMaterial){for(const key of ['map','normalMap','bumpMap','aoMap','emissiveMap','alphaMap','color','side','opacity','transparent'])if(source[key]!==undefined)material[key]=source[key]?.clone&&source[key].isColor?source[key].clone():source[key];}
  if(!material.map)material.color.set(tissue.color);
  if(!material.roughnessMap)material.roughness=tissue.roughness;
  if(!material.metalnessMap)material.metalness=0;
  material.envMapIntensity=.65;
  return material;
}

function createSilhouetteMaterial(color='#81929b',opacity=.2){
  return new THREE.ShaderMaterial({uniforms:{tint:{value:new THREE.Color(color)},opacity:{value:opacity}},vertexShader:'varying vec3 surfaceNormal; varying vec3 viewPosition; void main(){vec4 view=modelViewMatrix*vec4(position,1.0);surfaceNormal=normalize(normalMatrix*normal);viewPosition=-view.xyz;gl_Position=projectionMatrix*view;}',fragmentShader:'uniform vec3 tint; uniform float opacity; varying vec3 surfaceNormal; varying vec3 viewPosition; void main(){float edge=pow(1.0-abs(dot(normalize(surfaceNormal),normalize(viewPosition))),2.4);gl_FragColor=vec4(tint,edge*opacity);}',transparent:true,depthWrite:false,side:THREE.FrontSide,toneMapped:false});
}

function makeStudioEnvironment(renderer){
  const studio=new THREE.Scene(),panels=[];
  studio.background=new THREE.Color('#30383d');
  for(const [position,scale,intensity] of [[[-3,4,3],[4,5],5],[[4,1,2],[3,5],2],[[1,3,-4],[3,3],3]]){
    const panel=new THREE.Mesh(new THREE.PlaneGeometry(...scale),new THREE.MeshBasicMaterial({color:new THREE.Color().setScalar(intensity),side:THREE.DoubleSide}));panel.position.fromArray(position);panel.lookAt(0,0,0);studio.add(panel);panels.push(panel);
  }
  const generator=new THREE.PMREMGenerator(renderer),environment=generator.fromScene(studio,.02,.1,50);generator.dispose();for(const panel of panels){panel.geometry.dispose();panel.material.dispose();}return environment;
}

// Callouts stay in side columns. Crowded secondary labels are omitted rather than
// moved to a distant anatomical region; every visible callout retains its anchor.
export function layoutAnatomyLabels(points,width,height){
  const labelWidth=labelColumnWidth(width),halfHeight=15,gap=36,edge=12,placements=[];
  const ordered=[...points].sort((a,b)=>Number(!!b.selected)-Number(!!a.selected)||a.anchorY-b.anchorY);
  for(const point of ordered){
    if(!finiteVector([point.anchorX,point.anchorY])||point.anchorX<0||point.anchorX>width||point.anchorY<0||point.anchorY>height)continue;
    const preferred=point.anchorX<width/2?'left':'right',candidates=[];
    for(const side of [preferred,preferred==='left'?'right':'left']){
      const x=side==='left'?edge+labelWidth/2:width-edge-labelWidth/2;
      for(const offset of [0,-gap,gap,-gap*2,gap*2]){
        const y=Math.max(edge+halfHeight,Math.min(height-edge-halfHeight,point.anchorY+offset));
        if((side==='right'&&y<142)||(side==='left'&&y>height-76))continue;
        if(Math.abs(y-point.anchorY)>72||placements.some(item=>item.side===side&&Math.abs(item.y-y)<gap))continue;
        candidates.push({x,y,side,cost:Math.abs(y-point.anchorY)+(side===preferred?0:18)});
      }
    }
    candidates.sort((a,b)=>a.cost-b.cost);
    if(candidates.length){const {x,y,side}=candidates[0];placements.push({...point,x,y,side,width:labelWidth,lineEndX:x+(side==='left'?1:-1)*(labelWidth/2+4)});}
  }
  return placements;
}

// Models must stay beside the checked manifest; a GLB cannot pull in remote resources.
export function resolveAnatomyModelUrl(uri,manifestUrl,pageUrl){
  const page=new URL(pageUrl),base=new URL(manifestUrl,page),url=new URL(uri,base);
  const folder=new URL('.',base).pathname;
  if(!['http:','https:'].includes(url.protocol)||base.origin!==page.origin||url.origin!==page.origin||!url.pathname.startsWith(folder)||!url.pathname.endsWith('.glb')||url.search||url.hash||url.username||url.password)throw new Error('解剖模型必须是清单目录内的本地 GLB 文件。');
  return url.href;
}

export function inspectEmbeddedGLB(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<20||buffer.byteLength>MAX_MODEL_BYTES)throw new Error('GLB 文件大小无效。');
  const view=new DataView(buffer);
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==buffer.byteLength)throw new Error('GLB 文件头无效。');
  let json=null,binaryChunks=0;
  for(let offset=12;offset<buffer.byteLength;){
    if(offset+8>buffer.byteLength)throw new Error('GLB 数据块不完整。');
    const size=view.getUint32(offset,true),type=view.getUint32(offset+4,true);offset+=8;
    if(size%4||offset+size>buffer.byteLength)throw new Error('GLB 数据块长度无效。');
    if(type===0x4e4f534a){if(json||offset!==20)throw new Error('GLB JSON 数据块无效。');json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,offset,size)));}
    if(type===0x004e4942)binaryChunks++;
    offset+=size;
  }
  if(!json||json.asset?.version!=='2.0'||binaryChunks!==1||!Array.isArray(json.buffers)||json.buffers.length!==1)throw new Error('需要包含几何数据的 GLB 2.0 文件。');
  if(json.buffers.some(item=>item.uri!==undefined)||(json.images??[]).some(item=>item.uri!==undefined))throw new Error('GLB 不可引用外部缓冲区或图像。');
  if((json.extensionsRequired??[]).length)throw new Error('当前解剖查看器不支持需要额外解码器的 GLB 扩展。');
  return json;
}

export async function verifyAnatomyModelIntegrity(buffer,lod){
  if(buffer.byteLength!==lod.byteLength)throw new Error('模型文件大小与清单不一致。');
  if(!globalThis.crypto?.subtle)throw new Error('浏览器不支持模型完整性校验，请通过 HTTPS 或本机地址访问。');
  const hash=await crypto.subtle.digest('SHA-256',buffer);
  const actual=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(actual!==lod.sha256)throw new Error('模型 SHA-256 校验失败，文件与清单不一致。');
}

export function verifyAnatomyBounds(actual,declared){
  const tolerance=1e-5;
  if(!['min','max'].every(key=>actual[key].every((value,index)=>Math.abs(value-declared[key][index])<=tolerance)))throw new Error('实际结构边界与清单不一致。');
}

// Distance accounts for both aspect ratio and depth, including narrow desktop panels.
export function fitAnatomyBounds(min,max,aspect,fov=38,padding=1.2){
  if(!finiteVector([...min,...max])||min.some((n,i)=>n>max[i])||!Number.isFinite(aspect)||aspect<=0)throw new Error('解剖模型边界无效。');
  const size=max.map((n,i)=>n-min[i]);
  const tangent=Math.tan(fov*Math.PI/360);
  const distance=Math.max(size[1]/2/tangent,size[0]/2/(tangent*aspect),0.025)*padding+size[2]/2;
  return {target:min.map((n,i)=>(n+max[i])/2),distance};
}

function disposeObject(root,extraMaterials=[]){
  const geometries=new Set(),materials=new Set(extraMaterials),textures=new Set();
  root?.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry);
    for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[]){
      materials.add(material);
    }
  });
  for(const material of materials)for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
  textures.forEach(item=>item.dispose());materials.forEach(item=>item.dispose());geometries.forEach(item=>item.dispose());
}

export class AnatomyScene {
  constructor(container,{onSelect=()=>{},onStatus=()=>{}}={}){
    this.host=container;this.onSelect=onSelect;this.onStatus=onStatus;this.active=true;this.destroyed=false;this.layer='body';this.contextVisible=true;this.selected=null;this.manual=false;this.entries=[];this.loadVersion=0;this.relevant=new Set();
    this.reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(38,1,0.001,100);this.camera.position.set(0,0,3);
    this.target=new THREE.Vector3();this.eye=new THREE.Vector3(0,0,3);this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    try{this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}
    catch(error){this.failed=true;this.status('error','当前设备无法开启解剖三维视图。请使用支持 WebGL 2 的浏览器。');return;}
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,2));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.08;this.renderer.domElement.className='anatomy-canvas';container.prepend(this.renderer.domElement);
    this.environment=makeStudioEnvironment(this.renderer);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.65;
    this.scene.add(new THREE.HemisphereLight(0xf3ece4,0x485663,.32));this.scene.add(this.camera);
    for(const [color,intensity,position] of [[0xffead9,2.2,[-3,4,3]],[0xd8e6f3,.7,[4,1,2]],[0xf5ece1,1.1,[1,2,-3]]]){const light=new THREE.DirectionalLight(color,intensity);light.position.fromArray(position);light.target.position.set(0,0,-2);this.camera.add(light,light.target);}
    this.createMeasurementGuides();
    this.pointerDown=event=>{this.pointerStart={x:event.clientX,y:event.clientY};};
    this.pointerUp=event=>this.pick(event);
    this.contextLost=event=>{event.preventDefault();this.failed=true;this.setActive(false);this.status('error','WebGL 上下文已丢失，请重新载入解剖模型。');};
    this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);this.renderer.domElement.addEventListener('pointerup',this.pointerUp);this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();this.draw=this.draw.bind(this);
  }
  status(state,message,details){if(!this.destroyed)this.onStatus({state,message,...(details?{details}:{})});}
  createMeasurementGuides(){
    const namespace='http://www.w3.org/2000/svg';
    this.compass=document.createElement('div');this.compass.className='anatomy-compass';this.compass.hidden=true;this.compass.title='方向随视角旋转；左、右指参考人体自身的左、右。';
    this.compassSvg=document.createElementNS(namespace,'svg');this.compassSvg.setAttribute('viewBox','0 0 112 108');this.compassSvg.setAttribute('role','img');this.compassSvg.setAttribute('aria-label','随观察相机旋转的坐标方向');
    this.compassAxes=Array.from({length:6},()=>{const group=document.createElementNS(namespace,'g'),line=document.createElementNS(namespace,'line'),dot=document.createElementNS(namespace,'circle'),text=document.createElementNS(namespace,'text');line.setAttribute('x1','56');line.setAttribute('y1','52');dot.setAttribute('r','2');text.setAttribute('text-anchor','middle');text.setAttribute('dominant-baseline','middle');group.append(line,dot,text);this.compassSvg.append(group);return {group,line,dot,text};});
    this.compassTitle=document.createElement('span');this.compass.append(this.compassSvg,this.compassTitle);this.host.append(this.compass);
    this.scaleGuide=document.createElement('div');this.scaleGuide.className='anatomy-scale';this.scaleGuide.hidden=true;this.scaleGuide.title='当前观察中心平面的参考长度。';this.scaleLabel=document.createElement('span');this.scaleRule=document.createElement('i');this.scaleRule.className='anatomy-scale-rule';const caption=document.createElement('small');caption.textContent='焦点平面';this.scaleGuide.append(this.scaleLabel,this.scaleRule,caption);this.host.append(this.scaleGuide);
  }
  updateMeasurementGuides(){
    const projected=projectAnatomyDirections(this.camera,this.directions);
    this.compassAxes.forEach((elements,index)=>{
      const axis=projected[index];elements.group.style.display=axis?'':'none';if(!axis)return;
      const length=Math.hypot(axis.x,axis.y),towardViewer=length<.2&&axis.z>0;
      if(length<.2&&!towardViewer){elements.group.style.display='none';return;}
      elements.group.dataset.axis=axis.axis;elements.group.style.opacity=axis.z<0?'.48':'1';
      const x=56+axis.x*34,y=52+axis.y*34;
      elements.line.setAttribute('x2',String(x));elements.line.setAttribute('y2',String(y));elements.line.style.display=towardViewer?'none':'';elements.dot.setAttribute('cx',String(x));elements.dot.setAttribute('cy',String(y));elements.dot.style.display=towardViewer?'none':'';
      elements.text.setAttribute('x',String(towardViewer?56:56+axis.x*46));elements.text.setAttribute('y',String(towardViewer?52:52+axis.y*46));elements.text.textContent=axis.label;
    });
    const scale=projectAnatomyScale(this.camera,this.controls.target.toArray(),this.host.clientWidth,Math.min(100,this.host.clientWidth*.23));this.scaleGuide.hidden=!scale;
    if(scale){this.scaleLabel.textContent=scale.label;this.scaleRule.style.width=`${scale.pixels}px`;}
  }
  async load(manifest,manifestUrl){
    if(this.destroyed||this.failed)return false;
    const version=++this.loadVersion;this.abort?.abort();this.abort=new AbortController();this.clear();this.status('loading','正在载入真实解剖模型…');
    let root=null;
    try{
      const directions=resolveAnatomyDirections(manifest);
      const lod=manifest.lods.find(item=>item.level===0)??manifest.lods[0];
      const url=resolveAnatomyModelUrl(lod.uri,manifestUrl,location.href);
      const response=await fetch(url,{signal:this.abort.signal,credentials:'same-origin',redirect:'error'});
      if(!response.ok)throw new Error(`模型文件载入失败（HTTP ${response.status}）。`);
      if(Number(response.headers.get('content-length'))>MAX_MODEL_BYTES)throw new Error('模型文件超过大小限制。');
      const buffer=await response.arrayBuffer();await verifyAnatomyModelIntegrity(buffer,lod);inspectEmbeddedGLB(buffer);
      const manager=new THREE.LoadingManager();manager.setURLModifier(resource=>{if(resource.startsWith('blob:'))return resource;throw new Error('模型包含未经允许的外部资源。');});
      const gltf=await new GLTFLoader(manager).parseAsync(buffer,'');root=gltf.scene;
      if(this.destroyed||version!==this.loadVersion){disposeObject(root);return false;}
      const {OrbitControls}=await import('./vendor/OrbitControls.js');
      if(this.destroyed||version!==this.loadVersion){disposeObject(root);return false;}
      root.updateMatrixWorld(true);
      const meshes=[];root.traverse(object=>{if(object.isMesh)meshes.push(object);});
      const byName=new Map();for(const mesh of meshes){if(byName.has(mesh.name))throw new Error(`模型网格名称重复：${mesh.name}`);byName.set(mesh.name,mesh);}
      if(meshes.length!==manifest.labels.length)throw new Error('模型网格数量与解剖清单不一致。');
      const entries=manifest.labels.map(label=>{
        const mesh=byName.get(label.meshName??label.structureId);if(!mesh)throw new Error(`模型缺少清单结构：${label.name}`);
        const bounds=new THREE.Box3().setFromObject(mesh);
        if(bounds.isEmpty()||!finiteVector([...bounds.min.toArray(),...bounds.max.toArray()])||bounds.getSize(new THREE.Vector3()).length()>20)throw new Error(`结构几何边界无效：${label.name}`);
        verifyAnatomyBounds({min:bounds.min.toArray(),max:bounds.max.toArray()},label.bounds);
        return {label,mesh,bounds,anchor:new THREE.Vector3().fromArray(label.anchor)};
      });
      const triangles=meshes.reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0);
      if(triangles!==lod.triangleCount)throw new Error('实际模型三角形数量与清单不一致。');
      const oldMaterials=new Set();
      for(const entry of entries){
        const {mesh,label}=entry;for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])oldMaterials.add(material);
        const originals=Array.isArray(mesh.material)?mesh.material:[mesh.material];entry.surfaceMaterials=originals.map(material=>createAnatomyMaterial(material,label));entry.baseAppearance=entry.surfaceMaterials.map(material=>({color:material.color.clone(),opacity:material.opacity,transparent:material.transparent,depthWrite:material.depthWrite}));
        mesh.material=Array.isArray(mesh.material)?entry.surfaceMaterials:entry.surfaceMaterials[0];
        if(!entry.surfaceMaterials.some(material=>material.map))entry.silhouetteMaterial=createSilhouetteMaterial(label.structureId==='body'?'#8b9ba4':'#b9b3aa',label.structureId==='body'?.3:.38);
        if(!mesh.geometry.attributes.normal)mesh.geometry.computeVertexNormals();
        mesh.userData.structureId=label.structureId;
      }
      // Clones retain the original GLB textures; only the superseded material objects are disposed.
      for(const material of oldMaterials)material.dispose();
      this.directions=directions;this.camera.up.fromArray(directions?.superior??[0,1,0]);this.controls?.dispose();this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=!this.reduced;this.controls.enablePan=true;this.controls.enabled=this.manual;
      this.root=root;this.entries=entries;this.manifest=manifest;this.scene.add(root);this.selected=null;this.compass.hidden=false;this.scaleGuide.hidden=false;this.compassTitle.textContent=directions?'患者方向':'模型坐标 · 方向未标定';
      const svgNamespace='http://www.w3.org/2000/svg';this.leaders=document.createElementNS(svgNamespace,'svg');this.leaders.classList.add('anatomy-leaders');this.leaders.setAttribute('aria-hidden','true');Object.assign(this.leaders.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});this.host.append(this.leaders);
      for(const entry of entries){
        if(entry.label.structureId==='body')continue;
        const button=document.createElement('button');button.type='button';button.className='anatomy-label';button.dataset.structureId=entry.label.structureId;button.textContent=entry.label.name;button.addEventListener('click',()=>this.onSelect(entry.label.structureId));this.host.append(button);entry.button=button;
        entry.leader=document.createElementNS(svgNamespace,'polyline');entry.leader.classList.add('anatomy-leader');entry.leader.setAttribute('fill','none');entry.leader.setAttribute('stroke','#8ba7b8');entry.leader.setAttribute('stroke-width','1');
        entry.anchorDot=document.createElementNS(svgNamespace,'circle');entry.anchorDot.classList.add('anatomy-anchor');entry.anchorDot.setAttribute('r','2.2');entry.anchorDot.setAttribute('fill','#b5d4df');this.leaders.append(entry.leader,entry.anchorDot);
      }
      this.host.dataset.anatomyAssetId=manifest.assetId;this.applyView(true);this.status('ready','真实解剖模型已载入。',{meshCount:meshes.length,triangleCount:triangles});this.setActive(this.active);return true;
    }catch(error){
      if(root&&root!==this.root)disposeObject(root);
      if(version!==this.loadVersion||this.destroyed)return false;
      this.clear();this.status('error',error.name==='AbortError'?'模型载入已取消。':`无法显示解剖模型：${error.message}`);return false;
    }
  }
  clear(){
    cancelAnimationFrame(this.frame);this.frame=null;
    const extraMaterials=this.entries.flatMap(entry=>[...entry.surfaceMaterials,...(entry.silhouetteMaterial?[entry.silhouetteMaterial]:[])]);
    for(const entry of this.entries)entry.button?.remove();this.entries=[];
    this.leaders?.remove();this.leaders=null;
    if(this.root){this.scene.remove(this.root);disposeObject(this.root,extraMaterials);this.root=null;}
    if(this.compass)this.compass.hidden=true;if(this.scaleGuide)this.scaleGuide.hidden=true;
    delete this.host.dataset.anatomyAssetId;
  }
  focus(id){if(id!==null&&!this.entries.some(entry=>entry.label.structureId===id))return;this.selected=id;this.applyView();}
  setLayer(layer){if(!['body','regional','organ'].includes(layer))return;this.layer=layer;this.applyView();}
  setContextVisible(visible){this.contextVisible=!!visible;this.applyView();}
  setRelevantStructures(ids){this.relevant=new Set(Array.isArray(ids)?ids:[]);this.applyView();}
  setManual(enabled){this.manual=!!enabled;if(this.controls)this.controls.enabled=this.manual;if(!enabled)this.applyView();}
  setActive(active){this.active=!!active;cancelAnimationFrame(this.frame);this.frame=null;if(this.active&&!this.failed&&!this.destroyed&&this.root){this.last=performance.now();this.frame=requestAnimationFrame(this.draw);}}
  applyView(snap=false){
    if(!this.root)return;
    const plan=planAnatomyView(this.entries.map(entry=>entry.label),this.selected,this.layer,this.contextVisible,[...this.relevant]),bounds=new THREE.Box3();
    this.host.dataset.anatomyLayer=plan.layer;
    for(const entry of this.entries){
      const state=plan.entries.find(item=>item.id===entry.label.structureId),isSelected=state.selected;
      entry.mesh.visible=state.visible;
      entry.mesh.material=state.silhouette&&entry.silhouetteMaterial?entry.silhouetteMaterial:entry.surfaceMaterials.length===1?entry.surfaceMaterials[0]:entry.surfaceMaterials;
      const translucent=entry.label.context&&!isSelected;
      entry.surfaceMaterials.forEach((material,index)=>{
        const base=entry.baseAppearance[index],oldTransparent=material.transparent;
        material.color.copy(base.color);if(isSelected&&!material.map)material.color.lerp(new THREE.Color('#f6e5cc'),.045);
        material.opacity=translucent?Math.min(base.opacity,plan.layer==='body'?.2:.27):base.opacity;
        material.transparent=translucent||base.transparent;material.depthWrite=translucent?false:base.depthWrite;
        if(oldTransparent!==material.transparent)material.needsUpdate=true;
      });
      entry.mesh.renderOrder=state.silhouette?2:translucent?1:0;
      entry.button?.classList.toggle('selected',isSelected);entry.button?.setAttribute('aria-pressed',String(isSelected));
      entry.leader?.classList.toggle('selected',isSelected);entry.anchorDot?.classList.toggle('selected',isSelected);
      if(entry.button)entry.button.hidden=!state.labelVisible;
      if(state.frame||(plan.layer==='body'&&entry.label.structureId==='body'))bounds.union(entry.bounds);
    }
    // Independent organ packs have no body shell; all their visible meshes still frame normally.
    if(bounds.isEmpty())for(const entry of this.entries)if(entry.mesh.visible)bounds.union(entry.bounds);
    if(bounds.isEmpty())return;
    this.viewBounds=bounds;
    const width=this.host.clientWidth,height=this.host.clientHeight;
    const framingAspect=width&&height?Math.max(width*.3,width-2*(labelColumnWidth(width)+22))/height:this.camera.aspect;
    const frame=fitAnatomyCamera(bounds.min.toArray(),bounds.max.toArray(),framingAspect,{direction:anatomyCameraDirection(plan.region,plan.layer,this.selected,this.directions),up:this.directions?.superior??[0,1,0],fov:this.camera.fov,padding:plan.layer==='body'?1.14:1.18});
    this.target.fromArray(frame.target);this.eye.fromArray(frame.position);
    this.camera.near=Math.max(frame.distance/5000,0.0001);this.camera.far=Math.max(frame.distance*12,10);this.camera.updateProjectionMatrix();
    this.controls.minDistance=Math.max(frame.distance*.14,0.01);this.controls.maxDistance=Math.max(frame.distance*5,3);
    if(snap||this.reduced){this.camera.position.copy(this.eye);this.controls.target.copy(this.target);this.camera.lookAt(this.target);}
  }
  resize(){
    if(!this.renderer||this.destroyed)return;
    const width=this.host.clientWidth,height=this.host.clientHeight;if(!width||!height)return;
    this.renderer.setSize(width,height);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();if(this.root)this.applyView();
  }
  pick(event){
    if(!this.root||!this.pointerStart||Math.hypot(event.clientX-this.pointerStart.x,event.clientY-this.pointerStart.y)>6)return;
    const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);
    const candidates=this.entries.filter(entry=>entry.mesh.visible&&entry.label.structureId!=='body').map(entry=>entry.mesh);
    const hit=this.raycaster.intersectObjects(candidates,false)[0];if(hit)this.onSelect(hit.object.userData.structureId);
  }
  draw(now){
    if(!this.active||this.destroyed||this.failed)return;
    const dt=Math.min((now-this.last)/1000,.1);this.last=now;
    if(this.manual)this.controls.update();else{const ease=this.reduced?1:1-Math.exp(-dt*5);this.camera.position.lerp(this.eye,ease);this.controls.target.lerp(this.target,ease);this.camera.lookAt(this.controls.target);}
    this.camera.updateMatrixWorld();
    this.updateMeasurementGuides();
    const width=this.host.clientWidth,height=this.host.clientHeight,points=[];
    this.leaders.setAttribute('viewBox',`0 0 ${width} ${height}`);
    for(const entry of this.entries){
      if(entry.leader){entry.leader.style.display='none';entry.anchorDot.style.display='none';entry.button.style.visibility='hidden';}
      if(!entry.button||entry.button.hidden||!entry.mesh.visible)continue;
      const point=entry.anchor.clone().project(this.camera);
      if(point.z>=-1&&point.z<=1)points.push({entry,anchorX:(point.x/2+.5)*width,anchorY:(-point.y/2+.5)*height,selected:entry.label.structureId===this.selected});
    }
    for(const placement of layoutAnatomyLabels(points,width,height)){
      const {entry,x,y,side,anchorX,anchorY,lineEndX}=placement;
      Object.assign(entry.button.style,{visibility:'visible',left:`${x}px`,top:`${y}px`,width:`${placement.width}px`,maxWidth:`${placement.width}px`,boxSizing:'border-box',overflow:'hidden',textOverflow:'ellipsis'});
      const elbowX=lineEndX+(side==='left'?12:-12);
      entry.leader.setAttribute('points',`${anchorX},${anchorY} ${elbowX},${y} ${lineEndX},${y}`);entry.leader.style.display='';
      entry.anchorDot.setAttribute('cx',String(anchorX));entry.anchorDot.setAttribute('cy',String(anchorY));entry.anchorDot.style.display='';
    }
    this.renderer.render(this.scene,this.camera);this.frame=requestAnimationFrame(this.draw);
  }
  destroy(){
    this.destroyed=true;this.loadVersion++;this.abort?.abort();cancelAnimationFrame(this.frame);this.resizeObserver?.disconnect();this.controls?.dispose();this.clear();
    this.compass?.remove();this.scaleGuide?.remove();this.environment?.dispose();
    if(this.renderer){const canvas=this.renderer.domElement;canvas.removeEventListener('pointerdown',this.pointerDown);canvas.removeEventListener('pointerup',this.pointerUp);canvas.removeEventListener('webglcontextlost',this.contextLost);this.renderer.dispose();canvas.remove();}
  }
}
