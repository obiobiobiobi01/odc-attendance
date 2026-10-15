import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, collection, onSnapshot, getDoc, setDoc, serverTimestamp, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { setupAttendance } from './admin-attendance.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);
const ADMIN = 'omotesandodc@gmail.com', $ = id => document.getElementById(id);
const base = {staff: ['スタッフA','スタッフB','スタッフC','スタッフD','スタッフE','スタッフF'], emails: Array(6).fill(''), patterns: {early:['09:00','18:00',60],normal:['09:30','18:30',60],late:['10:00','19:00',60]}};
const labels = {normal:'普通',early:'早番',late:'遅番',off:'休日',leave:'有給',unset:'未登録'};
const marks = {normal:'',early:'早',late:'遅',off:'休',leave:'有',unset:'·'};
let config = structuredClone(base), shifts = {}, unsubscribers = [], generation = 0, admin = false, ready = false;
let y = new Date().getFullYear(), m = new Date().getMonth(), selected = '';
const pad = n => String(n).padStart(2,'0'), dateKey = d => `${y}-${pad(m+1)}-${pad(d)}`;
const message = s => { $('status').textContent = s; };
let punchState = null, punchReady = false, punchBusy = false;
const attendanceReport=setupAttendance({db,auth,getConfig:()=>config,download});
const workDay = () => Math.floor((Date.now() + 9*3600000)/86400000);
function clearData() {
  attendanceReport.reset();
  punchState = null; punchReady = false; renderPunch();
  $('punchHistory').replaceChildren();
  unsubscribers.forEach(f => f()); unsubscribers = []; ready = false;
  shifts = {}; config = structuredClone(base); $('app').hidden = true;
  $('grid').replaceChildren(); $('staffFields').replaceChildren(); $('patterns').replaceChildren();
  $('dialog').close(); $('settings').classList.add('hidden');
}
function failed(error) {
  clearData();
  message(error.code === 'permission-denied' ? '利用権限がありません。管理者はFirestoreルールの公開を、スタッフはメールアドレスの登録を確認してください。' : `接続できませんでした。再ログインしてください（${error.code || '通信エラー'}）。`);
}
$('login').onclick = async () => {
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({prompt:'select_account'});
  try { await signInWithPopup(auth, provider); }
  catch (e) { message(`ログインできませんでした（${e.code}）。ポップアップを許可して再度お試しください。`); }
};
$('logout').onclick = () => signOut(auth).catch(e => message(`ログアウトに失敗しました（${e.code}）。`));
onAuthStateChanged(auth, async user => {
  const current = ++generation; clearData(); admin = false;
  $('login').hidden = !!user; $('logout').hidden = !user;
  $('account').textContent = user?.email || 'ログインしてください';
  if (!user) { message('登録済みのGoogleアカウントでログインしてください。'); return; }
  admin = user.email === ADMIN && user.emailVerified;
  message('共有データを読み込んでいます…');
  const ref = doc(db,'settings','clinic');
  try {
    const first = await getDoc(ref);
    if (current !== generation) return;
    if (!first.exists() && admin) await setDoc(ref, base);
    if (current !== generation) return;
    const initialConfig=first.exists()?first.data():base;
    const staffSlot=initialConfig.emails.indexOf(user.email);
    if(staffSlot>=0) {
      await setDoc(doc(db,'staffProfiles',user.uid),{email:user.email,name:initialConfig.staff[staffSlot],slot:staffSlot});
      if(current!==generation)return;
    }
    attendanceReport.reset(admin,staffSlot>=0?user.uid:null);
    unsubscribers.push(onSnapshot(ref, snap => {
      if (current !== generation) return;
      if (!snap.exists()) { failed({code:'permission-denied'}); return; }
      config = snap.data();
      if (!admin && !config.emails.includes(user.email)) { failed({code:'permission-denied'}); return; }
      $('toggle').hidden = !admin;
      render(); renderPunch(); if ($('settings').classList.contains('hidden')) settings();
    }, failed));
    unsubscribers.push(onSnapshot(doc(db,'attendance',user.uid), snap => {
      if (current !== generation) return;
      punchState = snap.exists() ? snap.data() : null; punchReady = true; renderPunch();
    }, e => { if (current === generation) { punchReady=false; renderPunch(); $('punchStatus').textContent=`打刻を読み込めません（${e.code}）。`; } }));
    unsubscribers.push(onSnapshot(collection(db,'attendance',user.uid,'days'), snap => {
      if (current !== generation) return;
      $('punchHistory').replaceChildren();
      snap.docs.map(d=>d.data()).sort((a,b)=>b.day-a.day).slice(0,31).forEach(data=>{
        const line=document.createElement('li');
        line.textContent=`出勤 ${stamp(data.clockIn)} ／ 退勤 ${data.clockOut ? stamp(data.clockOut) : '未打刻'}`;
        $('punchHistory').append(line);
      });
    }, e => { if(current===generation) $('punchStatus').textContent=`履歴を読み込めません（${e.code}）。`; }));
    unsubscribers.push(onSnapshot(collection(db,'shifts'), snap => {
      if (current !== generation) return;
      shifts = Object.fromEntries(snap.docs.map(d => [d.id,d.data()])); ready = true;
      $('app').hidden = false; render();
      message(admin ? '管理者としてログイン中。変更は共有保存されます。' : '共有シフトを表示しています。変更は管理者に依頼してください。');
    }, failed));
  } catch(e) { if (current === generation) failed(e); }
});
function render() {
  $('month').textContent = `${y}年${m+1}月`; const grid = $('grid'); grid.replaceChildren();
  const cell = (text, cls) => { const e = document.createElement('div'); e.className = 'cell '+cls; e.textContent = text; grid.append(e); return e; };
  cell('日付','head'); config.staff.forEach(n => cell(n,'head'));
  for (let d=1; d<=new Date(y,m+1,0).getDate(); d++) {
    const w = new Date(y,m,d).getDay(); cell(`${d} ${'日月火水木金土'[w]}`,'day '+(w===0?'sun':w===6?'sat':''));
    for (let i=0;i<6;i++) {
      const id = dateKey(d)+'_'+i, value = shifts[id] || {type:'unset',phone:false};
      const b = document.createElement('button'); b.className = 'shift '+value.type; b.textContent = marks[value.type]; b.disabled = !admin || !ready;
      if (value.phone) { const mark = document.createElement('span'); mark.className='phone-mark'; mark.textContent='電'; b.append(mark); }
      b.setAttribute('aria-label',`${dateKey(d)} ${config.staff[i]} ${labels[value.type]}${value.phone?' 電話番':''}`);
      b.onclick = () => { selected=id; $('dialogTitle').textContent=`${m+1}月${d}日・${config.staff[i]}`; $('type').value=value.type; $('phone').checked=value.phone; $('dialog').showModal(); };
      cell('','').append(b);
    }
  }
}
function field(parent, text, id, value, type='text') {
  const label=document.createElement('label'), input=document.createElement('input');
  label.textContent=text; input.id=id; input.type=type; input.value=value;
  if(type==='text') input.maxLength=20;
  label.append(input); parent.append(label); return input;
}
function settings() {
  $('staffFields').replaceChildren(); $('patterns').replaceChildren();
  config.staff.forEach((name,i) => {
    const group=document.createElement('div'); group.className='fields';
    field(group,`スタッフ${i+1}`,'s'+i,name); field(group,'ログイン用Googleメール（任意）','e'+i,config.emails[i],'email');
    $('staffFields').append(group);
  });
  for(const k of ['early','normal','late']) {
    const group=document.createElement('div'); group.className='pattern fields';
    field(group,labels[k]+' 開始',k+'0',config.patterns[k][0],'time');
    field(group,'終了',k+'1',config.patterns[k][1],'time');
    const input=field(group,'休憩（分）',k+'2',config.patterns[k][2],'number'); input.min=0; input.max=480;
    $('patterns').append(group);
  }
}
async function write(button, action) {
  if (!admin || !ready) return;
  button.disabled=true; message('保存中…');
  try { await action(); message('共有保存しました。'); }
  catch(e) { message(`保存できませんでした（${e.code || '通信エラー'}）。入力を確認し、再度保存してください。`); throw e; }
  finally { button.disabled=false; }
}
$('form').onsubmit = async e => {
  if(e.submitter?.value!=='save') return;
  e.preventDefault(); const button=e.submitter;
  try {
    await write(button, () => setDoc(doc(db,'shifts',selected),{type:$('type').value,phone:$('phone').checked,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid}));
    $('dialog').close();
  } catch {}
};
$('toggle').onclick = () => { const opening=$('settings').classList.contains('hidden'); if(opening) settings(); $('settings').classList.toggle('hidden'); $('toggle').textContent=opening?'設定を閉じる':'設定を開く'; };
$('save').onclick = async () => {
  const staff=Array.from({length:6},(_,i)=>$('s'+i).value.trim()), emails=Array.from({length:6},(_,i)=>$('e'+i).value.trim().toLowerCase()), patterns={};
  if(staff.some(s=>!s)) { alert('スタッフ名を入力してください。'); return; }
  if(emails.some(e=>e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) || new Set(emails.filter(Boolean)).size!==emails.filter(Boolean).length) { alert('メールアドレスの形式・重複を確認してください。'); return; }
  for(const k of ['early','normal','late']) {
    const [start,end,rest]=[$(k+'0').value,$(k+'1').value,Number($(k+'2').value)];
    const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
    if(!start||!end||start>=end||!Number.isInteger(rest)||rest<0||rest>480||rest>=minutes(end)-minutes(start)) { alert('勤務時間と休憩を確認してください。'); return; }
    patterns[k]=[start,end,rest];
  }
  try { await write($('save'),()=>setDoc(doc(db,'settings','clinic'),{staff,emails,patterns})); } catch {}
};
$('prev').onclick=()=>{if(--m<0){m=11;y--;}render();};
$('next').onclick=()=>{if(++m>11){m=0;y++;}render();};
$('today').onclick=()=>{const n=new Date();y=n.getFullYear();m=n.getMonth();render();};
function download(name, content, type) {
  const url=URL.createObjectURL(new Blob(['\ufeff',content],{type})), a=document.createElement('a'); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('export').onclick=()=>{
  if(!ready)return;
  const rows=[['日付','曜日',...config.staff]];
  for(let d=1;d<=new Date(y,m+1,0).getDate();d++) rows.push([dateKey(d),'日月火水木金土'[new Date(y,m,d).getDay()],...config.staff.map((_,i)=>{const s=shifts[dateKey(d)+'_'+i]||{type:'unset'};return labels[s.type]+(s.phone?'・電話番':'');})]);
  const escape=v=>'"'+String(v).replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
  download(`ODC_シフト_${y}_${pad(m+1)}.csv`,rows.map(r=>r.map(escape).join(',')).join('\r\n'),'text/csv;charset=utf-8');
};
$('backup').onclick=()=>{if(ready)download('ODC_共有シフト.json',JSON.stringify({config,shifts},null,2),'application/json');};

function stamp(value) {
  return value?.toDate ? value.toDate().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '確認中';
}
function renderPunch() {
  const registered = !!auth.currentUser && config.emails.includes(auth.currentUser.email);
  const open = punchState && !punchState.clockOut;
  $('clockIn').disabled = !registered || !punchReady || punchBusy || !!open || (punchState?.day >= workDay());
  $('clockOut').disabled = !registered || !punchReady || punchBusy || !open;
  $('punchStatus').textContent = !registered ? '打刻はスタッフ設定に登録した本人のGoogleアカウントで行ってください。' : !punchReady ? '打刻を読み込んでいます…' : open ? `出勤済み：${stamp(punchState.clockIn)}${punchState.day < workDay() ? '（前日以前の退勤が未打刻です。実際の退勤時刻と異なる場合は管理者に連絡してください。）' : ''}` : punchState?.day === workDay() ? `本日は退勤済み：${stamp(punchState.clockOut)}` : '本日はまだ出勤していません。';
}
async function punch(kind) {
  const user=auth.currentUser, current=generation;
  if(!user || !punchReady || punchBusy || !config.emails.includes(user.email)) return;
  if(kind==='out' && !confirm('退勤を記録しますか？')) return;
  punchBusy=true; renderPunch(); $('punchStatus').textContent='打刻を保存中…';
  try {
    const ref=doc(db,'attendance',user.uid), day=workDay();
    await runTransaction(db, async tx=>{
      const snap=await tx.get(ref), previous=snap.exists()?snap.data():null;
      let data;
      if(kind==='in') {
        if(previous && (!previous.clockOut || previous.day>=day)) throw new Error('すでに出勤済みです。本日は再出勤できません。');
        data={day,clockIn:serverTimestamp(),clockOut:null};
      } else {
        if(!previous || previous.clockOut) throw new Error('退勤済み、または出勤記録がありません。');
        data={...previous,clockOut:serverTimestamp()};
      }
      tx.set(ref,data);
      tx.set(doc(db,'attendance',user.uid,'days',String(data.day)),data);
    });
    if(current===generation) message(`${kind==='in'?'出勤':'退勤'}を保存しました。`);
  } catch(e) {
    if(current===generation) message(e.code ? `打刻できませんでした（${e.code}）。通信・端末の日付を確認してください。保存済みか履歴を確認してから再度お試しください。` : e.message);
  } finally { punchBusy=false; renderPunch(); }
}
$('clockIn').onclick=()=>punch('in');
$('clockOut').onclick=()=>punch('out');
setInterval(()=>{ if(auth.currentUser && !punchBusy) renderPunch(); },30000);
