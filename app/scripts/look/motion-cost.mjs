import { baseline } from './slime-board.mjs';

export function animationAudit() {
  const exceptions = [], failures = [];
  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'running' || animation.effect?.getTiming().iterations !== Infinity) continue;
    const target = animation.effect.target;
    const names = [...new Set(animation.effect.getKeyframes().flatMap(frame => Object.keys(frame)))].filter(name => !['offset', 'computedOffset', 'easing', 'composite'].includes(name));
    const item = { name: animation.animationName, target: target.tagName, properties: names };
    const avatar = target.closest?.('svg.slime');
    if (avatar && avatar.getBoundingClientRect().width > 72) { exceptions.push({ ...item, exception: 'large-avatar-vector', size: avatar.getBoundingClientRect().width }); continue; }
    if (!(target instanceof HTMLElement) || names.some(name => !['transform', 'opacity', 'translate', 'rotate', 'scale'].includes(name))) failures.push(item);
  }
  return { failures, exceptions };
}

/** Repeat the same synthetic eight-working/two-sleeping load in the real entry. */
export async function motionCost(page, revision) {
  if(revision)await baseline(page,revision);
  try {
  const audit = await page.evaluate(animationAudit);
  const load = await page.evaluate(async () => {
    const current = await import('/src/main/slime.ts');
    const { handOver, slimeSVG } = window.__slimeBaseline ?? current;
    // Only the slimes that move (R-SLIME-01); a picture has no clock to hand over.
    const svgs = [...document.querySelectorAll('.slime-surface:not([data-slime-still]) svg.slime')];
    const saved = svgs.map(svg => svg.dataset.state);
    const visible = svgs.filter(svg => {
      const surface=svg.closest('.slime-surface'), rect=surface.getBoundingClientRect();
      return rect.width>0 && rect.width<=72 && rect.height>0 && rect.top<innerHeight && rect.bottom>0 && rect.left<innerWidth && rect.right>0 && getComputedStyle(surface).visibility!=='hidden';
    }).slice(0,10);
    // The ordinary fixture may have fewer than ten members; use the shared board's avatar host.
    const reserve = document.createElement('div'); reserve.id = 'look-motion-reserve';
    reserve.style.cssText = 'position:fixed;bottom:8px;left:8px;display:flex;pointer-events:none';
    for (let index = visible.length; index < 10; index++) reserve.insertAdjacentHTML('beforeend', `<span class="av mb-av mb-av-slime" style="--av:40px">${slimeSVG({ color: 'sky' }, { moving: true })}</span>`);
    document.body.append(reserve);
    const avatars=[...visible,...reserve.querySelectorAll('svg.slime')];
    // Each avatar changes directly to its measured state, as a real event does.
    // An intermediate idle strip would create an artificial second handover.
    svgs.filter(svg=>!avatars.includes(svg)).forEach(svg=>handOver(svg,'idle'));
    avatars.forEach((svg,index)=>handOver(svg,index<8?'working':'sleeping'));
    return {saved,working:avatars.filter(svg=>svg.dataset.state==='working').length,sleeping:avatars.filter(svg=>svg.dataset.state==='sleeping').length,
      avatarNodes:avatars.reduce((count,svg)=>count+svg.closest('.slime-surface').querySelectorAll('*').length,0),
      sizes:avatars.map(svg=>svg.closest('.slime-surface').getBoundingClientRect().width)};
  });
  if(load.working!==8 || load.sleeping!==2 || load.sizes.some(size=>size<=0 || size>72))throw new Error(`Invalid visible motion load: ${JSON.stringify(load)}`);
  // Allow settling and deferred browser housekeeping before measuring steady motion.
  await new Promise(resolve => setTimeout(resolve, 6500));
  const client = await page.createCDPSession(); await client.send('Performance.enable');
  const read = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(({name,value}) => [name,value]));
  const samples = [], windows = [];
  for (let index = 0; index < 2; index++) {
    const before = await read(), start = performance.now();
    await new Promise(resolve => setTimeout(resolve, 2500));
    const after = await read(), seconds = (performance.now() - start) / 1000;
    windows.push({start:before.Timestamp,end:after.Timestamp,heapBefore:before.JSHeapUsedSize,heapAfter:after.JSHeapUsedSize,nodesBefore:before.Nodes,nodesAfter:after.Nodes});
    samples.push(Object.fromEntries(['TaskDuration','RecalcStyleDuration','LayoutDuration','ScriptDuration'].map(name => [name, +((after[name]-before[name])/seconds*100).toFixed(2)])));
  }
  const loaded = await page.evaluate(animationAudit);
  await client.detach();
  await page.evaluate(async saved => {
    document.querySelector('#look-motion-reserve').remove();
    const current = await import('/src/main/slime.ts');
    const { handOver } = window.__slimeBaseline ?? current;
    [...document.querySelectorAll('.slime-surface:not([data-slime-still]) svg.slime')].forEach((svg, index) => handOver(svg, saved[index]));
  }, load.saved);
  const withinBudget = !audit.failures.length && !loaded.failures.length && samples.every(sample => sample.TaskDuration <= 3);
  const result = {check:'motion-cost', revision:revision ?? 'working-tree',warmup:6.5,seconds:2.5,load:{working:load.working,sleeping:load.sleeping,avatarNodes:load.avatarNodes,sizes:load.sizes},samples,windows,limit:3,withinBudget,audit,loaded};
  if (!revision && !withinBudget) {
    const error = new Error(`Motion exceeds its main-thread budget: ${JSON.stringify(result)}`); error.assertion = result; throw error;
  }
  return result;
  } finally {if(revision)await page.evaluate(()=>window.__slimeRestore());}
}

/** Isolate the unmeasured emblem decoder and the explicitly allowed single large vector. */
export async function motionDetails(page) {
  await page.evaluate(() => {
    window.__motionPaused = document.getAnimations().filter(animation => animation.playState === 'running');
    window.__motionPaused.forEach(animation => animation.pause());
    window.__motionImages = [...document.querySelectorAll('img[src$="-loop.webp"]')].map(image => [image,image.src]);
    window.__motionImages.forEach(([image]) => { image.src=image.src.replace('-loop.webp','-64.webp'); });
    const host=document.createElement('div');host.id='look-motion-detail';host.style.cssText='position:fixed;left:16px;bottom:16px';document.body.append(host);
  });
  const client = await page.createCDPSession();await client.send('Performance.enable');
  const read = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(({name,value})=>[name,value]));
  const measure=async()=>{
    await new Promise(resolve=>setTimeout(resolve,2500));
    const samples=[];
    for(let index=0;index<2;index++){
      const before=await read(),start=performance.now();await new Promise(resolve=>setTimeout(resolve,2500));const after=await read();
      samples.push(+((after.TaskDuration-before.TaskDuration)/((performance.now()-start)/1000)*100).toFixed(2));
    }
    return samples;
  };
  const setEmblem=async loop=>page.evaluate(async loop=>{const {avatarHTML}=await import('/src/main/avatar.ts');const host=document.querySelector('#look-motion-detail');host.innerHTML=avatarHTML({size:40,loop});await Promise.all([...host.querySelectorAll('img')].map(image=>image.decode()));},loop);
  await setEmblem(false);const still=await measure();
  await setEmblem(true);const emblem=await measure();
  await page.evaluate(async()=>{const {slimeSVG}=await import('/src/main/slime.ts');document.querySelector('#look-motion-detail').innerHTML=`<span class="av mb-av mb-av-slime" style="--av:96px">${slimeSVG({color:'sky'},{state:'working',moving:true})}</span>`;});
  const large=await measure();const audit=await page.evaluate(animationAudit);
  await client.detach();
  await page.evaluate(()=>{document.querySelector('#look-motion-detail').remove();window.__motionImages.forEach(([image,src])=>{image.src=src;});window.__motionPaused.forEach(animation=>animation.play());});
  return {check:'motion-details',seconds:2.5,repeats:2,stillEmblem:still,loopEmblem:emblem,large96Working:large,audit};
}
