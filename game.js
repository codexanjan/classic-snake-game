const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const modes = {
  classic: { name:'Classic', rule:'Eat food and grow. Avoid the walls and your own tail.' },
  wrap: { name:'Wrap', rule:'Cross an edge to appear on the other side. Avoid your own tail.', wrap:true },
  maze: { name:'Maze', rule:'Find a path around the barriers. Walls and your own tail end the run.', maze:true },
  sprint: { name:'Time Attack', rule:'Collect as much food as possible in 60 seconds. Avoid collisions.', timed:true },
  zen: { name:'Zen', rule:'No collisions, no timer. Pass through edges and your tail at your own pace.', wrap:true, safe:true }
};
const vectors = {up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
const store = {
  read(key,fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  write(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch {} }
};
const saved = store.read('snakePreferences',{});
const prefs = {
  mode: Object.hasOwn(modes,saved?.mode) ? saved.mode : 'classic',
  speed: Number.isInteger(saved?.speed) && saved.speed>=3 && saved.speed<=18 ? saved.speed : 8,
  size: [16,20,24].includes(saved?.size) ? saved.size : 20,
  foodCount: [1,3,5].includes(saved?.foodCount) ? saved.foodCount : 1,
  theme: ['light','dark','blue'].includes(saved?.theme) ? saved.theme : 'light',
  sound: saved?.sound===true, gridLines: saved?.gridLines!==false,
  effects: saved?.effects!==false, autoSpeed: saved?.autoSpeed===true
};
const priorRecords = store.read('snakeRecords',{});
const records = priorRecords && typeof priorRecords==='object' && !Array.isArray(priorRecords) ? priorRecords : {};
const statsSaved = store.read('snakeLifetime',{});
const positive = n => Number.isFinite(n) && n>=0 ? Math.floor(n) : 0;
const lifetime = {eaten:positive(statsSaved?.eaten),longest:Math.max(3,positive(statsSaved?.longest))};
// Keep the old version's record accessible without mixing its different scoring rules into new records.
const legacyBest = positive(Number(store.read('neonSnakeBest',0)));
if(legacyBest) $('best').title = 'Previous version best: '+legacyBest;
let snake, foods, obstacles, direction, turns, phase, score, eaten, elapsed, particles;
let previousFrame=0, accumulator=0, colors={}, audio, pointerStart=null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const same = (a,b) => a.x===b.x && a.y===b.y;
const recordKey = () => prefs.mode+':'+prefs.size;
const currentSpeed = () => Math.min(18,prefs.speed+(prefs.autoSpeed?Math.floor((eaten||0)/5):0));

function icons() { if(window.lucide) window.lucide.createIcons({attrs:{class:'icon','aria-hidden':'true'}}); }
function iconButton(id,name,fallback,label) {
  $(id).innerHTML='<span data-lucide="'+name+'">'+fallback+'</span>';
  $(id).ariaLabel=label; $(id).title=label; icons();
}
function savePreferences() { store.write('snakePreferences',prefs); }
function updateColors() {
  const css=getComputedStyle(document.body);
  for(const name of ['board','grid','accent','body','food','obstacle']) colors[name]=css.getPropertyValue('--'+name).trim();
}
function updatePreferences() {
  for(const id of ['mode','speed','foodCount']) $(id).value=prefs[id];
  $('boardSize').value=prefs.size;
  for(const id of ['sound','gridLines','effects','autoSpeed']) $(id).checked=prefs[id];
  document.body.dataset.theme=prefs.theme;
  document.querySelectorAll('.theme').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.theme===prefs.theme)));
  document.querySelectorAll('[data-speed]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.speed)===prefs.speed)));
  $('soundButton').setAttribute('aria-pressed',String(prefs.sound));
  iconButton('soundButton',prefs.sound?'volume-2':'volume-x','♪',prefs.sound?'Mute sound':'Enable sound');
  $('modeRule').textContent=modes[prefs.mode].rule;
  updateColors(); updateHud();
}
function updateHud() {
  $('score').textContent=score||0; $('eaten').textContent=eaten||0;
  $('best').textContent=positive(records[recordKey()]);
  $('totalEaten').textContent=lifetime.eaten; $('longest').textContent=lifetime.longest;
  $('length').textContent=snake?.length||3;
  const seconds=modes[prefs.mode].timed ? Math.ceil(Math.max(0,60000-(elapsed||0))/1000) : Math.floor((elapsed||0)/1000);
  $('timer').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
  $('timeLabel').textContent=modes[prefs.mode].timed?'Time left':'Time';
  $('speedValue').textContent=currentSpeed()+' / sec';
}
function barriers() {
  const result=[]; if(!modes[prefs.mode].maze) return result;
  const n=prefs.size, low=Math.floor(n*.25), high=n-low-1;
  for(let i=low;i<=high;i++) {
    if(Math.abs(i-Math.floor(n/2))>1) result.push({x:i,y:low},{x:i,y:high});
  }
  for(let i=low+1;i<high;i++) if(Math.abs(i-Math.floor(n/2))>2) result.push({x:low,y:i},{x:high,y:i});
  return result;
}
function fillFood() {
  const available=[];
  for(let y=0;y<prefs.size;y++) for(let x=0;x<prefs.size;x++) {
    const p={x,y};
    if(!snake.some(s=>same(s,p))&&!foods.some(f=>same(f,p))&&!obstacles.some(o=>same(o,p))) available.push(p);
  }
  while(foods.length<prefs.foodCount && available.length) foods.push(available.splice(Math.floor(Math.random()*available.length),1)[0]);
  if(!foods.length && phase==='running') finish('Board complete');
}
function showOverlay(title,text,action) {
  $('overlayTitle').textContent=title; $('overlayText').textContent=text; $('actionText').textContent=action; $('overlay').hidden=false;
}
function resetGame() {
  const mid=Math.floor(prefs.size/2);
  snake=[{x:mid-1,y:mid},{x:mid-2,y:mid},{x:mid-3,y:mid}];
  direction=vectors.right; turns=[]; foods=[]; obstacles=barriers();
  score=0; eaten=0; elapsed=0; particles=[]; accumulator=0; phase='ready';
  fillFood(); updateHud(); $('status').textContent='Ready to play'; $('pauseButton').disabled=true;
  iconButton('pauseButton','pause','Ⅱ','Pause');
  showOverlay(modes[prefs.mode].name,modes[prefs.mode].rule,'Play '+modes[prefs.mode].name);
}
function startGame() {
  if(phase==='over') resetGame();
  phase='running'; previousFrame=performance.now(); accumulator=0;
  $('overlay').hidden=true; $('pauseButton').disabled=false;
  $('status').textContent=modes[prefs.mode].name+' · Playing';
  iconButton('pauseButton','pause','Ⅱ','Pause');
  canvas.focus({preventScroll:true}); unlockAudio();
}
function pauseGame() {
  if(phase==='paused') { startGame(); return; }
  if(phase!=='running') return;
  phase='paused'; turns=[]; $('status').textContent='Paused'; iconButton('pauseButton','play','▶','Resume');
  showOverlay('Paused',eaten+' food eaten · '+score+' points','Resume');
}
function finish(reason) {
  phase='over'; turns=[]; $('pauseButton').disabled=true; $('status').textContent=reason;
  updateHud(); tone(150,.14);
  showOverlay(reason,eaten+' food eaten · '+score+' points · '+snake.length+' length','Play again');
}
function setDirection(name) {
  if(phase==='paused'||phase==='over'||turns.length>=2) return;
  const next=vectors[name], last=turns.at(-1)||direction;
  if(!next||same(next,last)||(next.x===-last.x&&next.y===-last.y)) {
    if(phase==='ready'&&next&&same(next,last)) startGame();
    return;
  }
  turns.push(next); if(phase==='ready') startGame();
}
function step() {
  if(phase!=='running') return;
  direction=turns.shift()||direction;
  const next={x:snake[0].x+direction.x,y:snake[0].y+direction.y}, mode=modes[prefs.mode];
  if(mode.wrap) { next.x=(next.x+prefs.size)%prefs.size; next.y=(next.y+prefs.size)%prefs.size; }
  else if(next.x<0||next.y<0||next.x>=prefs.size||next.y>=prefs.size) { finish('Wall hit'); return; }
  const foodIndex=foods.findIndex(f=>same(f,next));
  // A non-growing move may enter the cell vacated by the tail.
  const body=foodIndex>=0?snake:snake.slice(0,-1);
  if(!mode.safe && (body.some(s=>same(s,next))||obstacles.some(o=>same(o,next)))) { finish('Collision'); return; }
  snake.unshift(next);
  if(foodIndex>=0) {
    foods.splice(foodIndex,1); score+=10; eaten++; lifetime.eaten++; lifetime.longest=Math.max(lifetime.longest,snake.length);
    records[recordKey()]=Math.max(positive(records[recordKey()]),score);
    store.write('snakeRecords',records); store.write('snakeLifetime',lifetime);
    if(prefs.effects&&!reducedMotion.matches) for(let i=0;i<8;i++) particles.push({x:next.x+.5,y:next.y+.5,vx:(Math.random()-.5)*.09,vy:(Math.random()-.5)*.09,life:1});
    tone(500,.07); fillFood();
  } else snake.pop();
  updateHud();
}
function unlockAudio() {
  if(!prefs.sound) return;
  try {
    const Context=window.AudioContext||window.webkitAudioContext;
    if(Context) { audio=audio||new Context(); if(audio.state==='suspended') audio.resume().catch(()=>{}); }
  } catch {}
}
function tone(frequency,duration) {
  if(!prefs.sound||!audio) return;
  try {
    const oscillator=audio.createOscillator(), gain=audio.createGain();
    oscillator.type='sine'; oscillator.frequency.value=frequency;
    gain.gain.setValueAtTime(.045,audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime+duration);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  } catch {}
}
function rounded(x,y,w,h,r) { ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fill(); }
function draw(delta) {
  const cell=canvas.width/prefs.size;
  ctx.fillStyle=colors.board; ctx.fillRect(0,0,canvas.width,canvas.height);
  if(prefs.gridLines) {
    ctx.strokeStyle=colors.grid; ctx.lineWidth=1; ctx.beginPath();
    for(let i=1;i<prefs.size;i++) { ctx.moveTo(i*cell,0);ctx.lineTo(i*cell,canvas.height);ctx.moveTo(0,i*cell);ctx.lineTo(canvas.width,i*cell); }
    ctx.stroke();
  }
  ctx.fillStyle=colors.obstacle;
  for(const p of obstacles) rounded(p.x*cell+3,p.y*cell+3,cell-6,cell-6,4);
  for(const f of foods) {
    const x=(f.x+.5)*cell,y=(f.y+.53)*cell;
    ctx.fillStyle=colors.food;ctx.beginPath();ctx.ellipse(x,y,cell*.26,cell*.28,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=colors.accent;ctx.lineWidth=cell*.065;ctx.beginPath();ctx.moveTo(x,y-cell*.26);ctx.lineTo(x+cell*.07,y-cell*.4);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.5)';ctx.beginPath();ctx.arc(x-cell*.08,y-cell*.09,cell*.055,0,Math.PI*2);ctx.fill();
  }
  for(let i=snake.length-1;i>=0;i--) {
    const p=snake[i]; ctx.fillStyle=i===0?colors.accent:colors.body;
    rounded(p.x*cell+2.5,p.y*cell+2.5,cell-5,cell-5,cell*.23);
    if(i===0) {
      const x=(p.x+.5)*cell+direction.x*cell*.17,y=(p.y+.5)*cell+direction.y*cell*.17;
      ctx.fillStyle='#ffffff';
      for(const side of [-1,1]) { ctx.beginPath();ctx.arc(x-direction.y*cell*.16*side,y+direction.x*cell*.16*side,cell*.073,0,Math.PI*2);ctx.fill(); }
    }
  }
  if(!prefs.effects||reducedMotion.matches) particles=[];
  if(phase!=='paused') for(const p of particles) { p.x+=p.vx*delta/16.67;p.y+=p.vy*delta/16.67;p.life-=delta/450; }
  particles=particles.filter(p=>p.life>0);
  for(const p of particles) { ctx.globalAlpha=p.life;ctx.fillStyle=colors.food;ctx.beginPath();ctx.arc(p.x*cell,p.y*cell,cell*.06,0,Math.PI*2);ctx.fill(); }
  ctx.globalAlpha=1;
}
function advance(delta) {
  if(phase!=='running') return;
  const remaining=modes[prefs.mode].timed?Math.max(0,60000-elapsed):delta;
  const active=Math.min(delta,remaining); elapsed+=active; accumulator+=active;
  while(phase==='running'&&accumulator>=1000/currentSpeed()) { accumulator-=1000/currentSpeed();step(); }
  if(phase==='running'&&modes[prefs.mode].timed&&elapsed>=60000) finish('Time is up');
  updateHud();
}
function frame(now) {
  const delta=Math.max(0,Math.min(now-previousFrame,100));previousFrame=now;advance(delta);draw(delta);requestAnimationFrame(frame);
}
$('overlayAction').addEventListener('click',startGame);
$('pauseButton').addEventListener('click',pauseGame);
$('restartButton').addEventListener('click',()=>{resetGame();startGame();});
$('mode').addEventListener('change',()=>{prefs.mode=$('mode').value;savePreferences();resetGame();updatePreferences();});
$('boardSize').addEventListener('change',()=>{prefs.size=Number($('boardSize').value);savePreferences();resetGame();updatePreferences();});
function changeSpeed(value) { prefs.speed=Number(value);accumulator=0;savePreferences();updatePreferences(); }
$('speed').addEventListener('input',()=>changeSpeed($('speed').value));
document.querySelectorAll('[data-speed]').forEach(button=>button.addEventListener('click',()=>changeSpeed(button.dataset.speed)));
$('foodCount').addEventListener('change',()=>{prefs.foodCount=Number($('foodCount').value);foods=foods.slice(0,prefs.foodCount);fillFood();savePreferences();});
function changeSound(value) { prefs.sound=value;savePreferences();updatePreferences();unlockAudio();tone(450,.06); }
$('soundButton').addEventListener('click',()=>changeSound(!prefs.sound));
$('sound').addEventListener('change',()=>changeSound($('sound').checked));
for(const id of ['gridLines','effects','autoSpeed']) $(id).addEventListener('change',()=>{prefs[id]=$(id).checked;savePreferences();updateHud();});
document.querySelectorAll('.theme').forEach(button=>button.addEventListener('click',()=>{prefs.theme=button.dataset.theme;savePreferences();updatePreferences();}));
$('helpButton').addEventListener('click',()=>{
  if(phase==='running') pauseGame();
  $('help').open=!$('help').open;
  if($('help').open) $('help').scrollIntoView({behavior:reducedMotion.matches?'instant':'smooth',block:'center'});
});
document.addEventListener('keydown',event=>{
  if(event.target.closest('input,select,textarea,summary,[contenteditable="true"]')) return;
  const keys={ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right'};
  if(event.code==='Space' && event.target.closest('button')) return;
  if(keys[event.code]) {event.preventDefault();if(!event.repeat)setDirection(keys[event.code]);}
  else if(['Space','KeyP'].includes(event.code)&&!event.repeat) {event.preventDefault();if(phase==='ready')startGame();else pauseGame();}
  else if(event.code==='KeyR'&&!event.repeat) {event.preventDefault();resetGame();startGame();}
  else if(event.code==='Enter'&&phase==='over'&&!event.target.closest('button')) {event.preventDefault();startGame();}
});
document.querySelectorAll('[data-dir]').forEach(button=>button.addEventListener('click',()=>setDirection(button.dataset.dir)));
$('boardWrap').addEventListener('pointerdown',event=>{
  if(event.target.closest('button'))return;
  pointerStart={x:event.clientX,y:event.clientY,id:event.pointerId};$('boardWrap').setPointerCapture(event.pointerId);
});
$('boardWrap').addEventListener('pointerup',event=>{
  if(!pointerStart||event.pointerId!==pointerStart.id)return;
  const dx=event.clientX-pointerStart.x,dy=event.clientY-pointerStart.y;pointerStart=null;
  if(Math.max(Math.abs(dx),Math.abs(dy))>=18)setDirection(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));
});
$('boardWrap').addEventListener('pointercancel',()=>{pointerStart=null;});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&phase==='running')pauseGame();});
window.addEventListener('blur',()=>{if(phase==='running')pauseGame();});
resetGame();updatePreferences();icons();requestAnimationFrame(frame);
