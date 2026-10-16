import {collection,doc,getDocsFromServer,getDocFromServer,query,where} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {leaveLabels,requestLeave,setLeaveBalance,decideLeave} from './leave-service.js';
export function setupLeave({db,auth}){
  const $=id=>document.getElementById(id);let admin=false,uid=null,version=0,busy=false;
  const stamp=t=>t?.toDate?t.toDate().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
  const cell=(tr,value)=>{const td=document.createElement('td');td.textContent=value;tr.append(td);return td;};
  function controls(){ $('leavePanel').querySelectorAll('button,input,select').forEach(el=>el.disabled=busy); }
  function reset(isAdmin=false,self=null){version++;admin=isAdmin;uid=self;busy=false;$('leavePanel').hidden=!admin&&!uid;$('leaveApply').hidden=!uid;$('leaveBalances').replaceChildren();$('leaveRequests').replaceChildren();$('leaveHistory').replaceChildren();$('leaveStatus').textContent='';controls();if(admin||uid)refresh();}
  async function refresh(){
    if((!admin&&!uid)||busy)return;const current=version;busy=true;controls();$('leaveStatus').textContent='有給を読み込んでいます…';
    try{
      const single=async collectionName=>{const snap=await getDocFromServer(doc(db,collectionName,uid));return {docs:snap.exists()?[snap]:[]};};
      const [profiles,balances,requests]=await Promise.all([admin?getDocsFromServer(collection(db,'staffProfiles')):single('staffProfiles'),admin?getDocsFromServer(collection(db,'leaveBalances')):single('leaveBalances'),getDocsFromServer(admin?collection(db,'leaveRequests'):query(collection(db,'leaveRequests'),where('uid','==',uid)))]);
      if(current!==version)return;
      const balanceMap=new Map(balances.docs.map(d=>[d.id,d.data()])),names=new Map(profiles.docs.map(d=>[d.id,d.data().name]));
      $('leaveBalances').replaceChildren();$('leaveRequests').replaceChildren();
      for(const profile of profiles.docs){
        const balance=balanceMap.get(profile.id),tr=document.createElement('tr');cell(tr,profile.data().name);cell(tr,balance?`${balance.units/2}日`:'未設定');
        const td=cell(tr,'');
        if(admin){
          const input=document.createElement('input');input.type='number';input.min='0';input.step='1';input.placeholder='残日数';input.value=balance?balance.units/2:'';input.setAttribute('aria-label',profile.data().name+' 有給残日数');
          const button=document.createElement('button');button.textContent='残日数を保存';button.onclick=()=>act(async()=>{
            if(input.value.trim()==='')throw Error('残日数を入力してください。');
            await setLeaveBalance({db,uid:profile.id,adminUid:auth.currentUser.uid,days:Number(input.value),expected:balance});
          },'残日数を保存しました。');td.append(input,button);
        }
        const history=document.createElement('button');history.textContent='残日数の履歴';history.onclick=()=>showHistory(profile.id,profile.data().name);td.append(history);$('leaveBalances').append(tr);
      }
      const statusNames={pending:'承認待ち',approved:'承認済み',rejected:'却下',cancelled:'承認取消'};
      const all=requests.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.status!=='pending')-(b.status!=='pending')||b.createdAt.toMillis()-a.createdAt.toMillis());
      for(const r of all){
        const tr=document.createElement('tr');[names.get(r.uid)||r.uid,r.date,leaveLabels[r.part],r.note,stamp(r.createdAt),statusNames[r.status]].forEach(v=>cell(tr,v));
        const td=cell(tr,'');
        if(admin){for(const [label,action] of r.status==='pending'?[['承認','approve'],['却下','reject']]:r.status==='approved'?[['承認を取り消す','cancel']]:[]){
          const button=document.createElement('button');button.textContent=label;button.onclick=()=>{if(action==='cancel'&&!confirm('承認を取り消して残日数を戻しますか？'))return;return act(()=>decideLeave({db,id:r.id,action,adminUid:auth.currentUser.uid}),`${label}しました。`);};td.append(button);
        }}$('leaveRequests').append(tr);
      }
      $('leaveStatus').textContent=`承認待ち ${all.filter(r=>r.status==='pending').length}件。${profiles.docs.length?'':'スタッフ本人が一度ログインすると残日数を設定できます。'}`;
    }catch(e){if(current===version)$('leaveStatus').textContent=`読み込めませんでした：${e.code||e.message}`;}
    finally{if(current===version){busy=false;controls();}}
  }
  async function act(action,message){
    if(busy)return;const current=version;busy=true;controls();$('leaveStatus').textContent='保存中…';
    try{await action();if(current===version){busy=false;await refresh();if(current===version)$('leaveStatus').textContent=message;}}
    catch(e){if(current===version)$('leaveStatus').textContent=`保存できませんでした：${e.code||e.message}`;}
    finally{if(current===version){busy=false;controls();}}
  }
  async function showHistory(person,name){
    const current=version;$('leaveHistory').textContent='履歴を読み込んでいます…';
    try{const snap=await getDocsFromServer(collection(db,'leaveBalances',person,'history'));if(current!==version)return;$('leaveHistory').replaceChildren();
      for(const r of snap.docs.map(d=>d.data()).sort((a,b)=>b.updatedAt.toMillis()-a.updatedAt.toMillis())){const p=document.createElement('p');p.textContent=`${name} ${stamp(r.updatedAt)}：${r.before==null?'未設定':r.before/2+'日'} → ${r.after/2}日 ／ ${r.reason}`;$('leaveHistory').append(p);}
    }catch(e){if(current===version)$('leaveHistory').textContent=`履歴を取得できません：${e.code||e.message}`;}
  }
  $('leaveRefresh').onclick=refresh;
  $('leaveSubmit').onclick=()=>act(()=>requestLeave({db,uid,date:$('leaveDate').value,part:'full',note:$('leaveNote').value}),'有給を申請しました。承認までは残日数とシフトは変わりません。');
  reset();return {reset};
}
