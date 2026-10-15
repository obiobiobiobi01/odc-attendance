import {localTime,parseTime,saveCorrection,submitCorrection,rejectCorrection} from './attendance-correction.js';
import {collection,doc,getDocFromServer,getDocsFromServer,query,where,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {monthRange,dayLabel,duration,calculate,totals,csv} from './attendance-report.js';
export function setupAttendance({db,auth,getConfig,download}) {
  const $=id=>document.getElementById(id);
  let isAdmin=false,selfUid=null,allowed=false,version=0,rows=[],loadedMonth='',busy=false,editing=null,staffOptions=[];
  const now=new Date(Date.now()+32400000);
  $('reportMonth').value=now.toISOString().slice(0,7);
  const stamp=t=>t?.toDate ? t.toDate().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
  function reset(adminMode=false,uid=null) {
    isAdmin=adminMode;selfUid=uid;const enabled=adminMode||!!uid;
    $('attendanceTitle').textContent=isAdmin?'管理者用・打刻一覧と月別集計':'自分の打刻・修正申請と月別集計';
    $('reportAdminHelp').hidden=!isAdmin;
    $('reportSelfHelp').hidden=isAdmin;
    $('correctionSave').textContent=isAdmin?'理由と時刻を保存':'修正を申請';
    version++; editing=null;staffOptions=[];$('correctionForm').hidden=true;$('correctionHistory').replaceChildren(); allowed=enabled; rows=[];loadedMonth='';busy=false;
    $('adminAttendance').hidden=!enabled;
    $('reportRows').replaceChildren();$('reportSummary').replaceChildren();$('requestRows').replaceChildren();$('requestStatus').textContent='';
    if(enabled)loadApplications();
    $('reportStatus').textContent='月を選んで「一覧を表示」を押してください。';
    controls();
  }
  function controls(){
    $('refreshRequests').disabled=!allowed||busy;
    $('addAttendance').disabled=!allowed||busy||!loadedMonth;
    $('correctionSave').disabled=busy;$('correctionCancel').disabled=busy;
    $('loadReport').disabled=!allowed||busy;$('reportMonth').disabled=busy;
    $('reportCsv').disabled=!allowed||busy||!loadedMonth;
    $('summaryCsv').disabled=!allowed||busy||!loadedMonth;
  }
  function cell(row,value){const td=document.createElement('td');td.textContent=value;row.append(td);return td;}
  function grouped(){const map=new Map();for(const r of rows){if(!map.has(r.uid))map.set(r.uid,[]);map.get(r.uid).push(r);}return [...map.values()];}
  function render(){
    $('reportRows').replaceChildren();$('reportSummary').replaceChildren();
    for(const group of grouped()) {
      const sum=totals(group), tr=document.createElement('tr');
      [group[0].name,sum.days,sum.confirmed,sum.pending,duration(sum.gross),sum.confirmed?duration(sum.net):'—'].forEach(v=>cell(tr,v));
      $('reportSummary').append(tr);
    }
    for(const r of rows){
      const tr=document.createElement('tr');
      [dayLabel(r.day),r.name,stamp(r.clockIn),stamp(r.clockOut),duration(r.gross)].forEach(v=>cell(tr,v));
      const td=cell(tr,''), input=document.createElement('input'); input.type='number';input.min='0';input.step='1';input.max=String(Math.floor((r.gross||0)/60000));input.value=r.review?.breakMinutes??'';
      input.placeholder='未確認';input.setAttribute('aria-label',`${dayLabel(r.day)} ${r.name} 休憩（分）`);
      input.disabled=!isAdmin||busy||r.gross==null;
      const button=document.createElement('button');button.textContent='保存';button.disabled=input.disabled;button.hidden=!isAdmin;
      button.onclick=()=>saveBreak(r,input.value);
      td.append(input,button);cell(tr,duration(r.net));cell(tr,r.status);
      const actions=cell(tr,''),edit=document.createElement('button'),history=document.createElement('button');
      edit.textContent='時刻修正';edit.disabled=busy;edit.onclick=()=>openCorrection(r);
      history.textContent='修正履歴';history.disabled=busy;history.onclick=()=>showHistory(r);
      actions.append(edit,history);$('reportRows').append(tr);
    }
  }
  async function load(){
    if(!allowed||busy)return;
    let range;try{range=monthRange($('reportMonth').value);}catch(e){$('reportStatus').textContent=e.message;return;}
    editing=null;$('correctionForm').hidden=true;$('correctionHistory').replaceChildren();
    const current=++version,month=$('reportMonth').value;
    busy=true;rows=[];loadedMonth='';render();controls();$('reportStatus').textContent='読み込んでいます…';
    try {
      const one=async path=>{const snap=await getDocFromServer(doc(db,path,selfUid));return {docs:snap.exists()?[snap]:[]};};
      const [people,profiles]=await Promise.all(isAdmin?[getDocsFromServer(collection(db,'attendance')),getDocsFromServer(collection(db,'staffProfiles'))]:[one('attendance'),one('staffProfiles')]);
      if(current!==version||!allowed)return;
      const names=new Map(profiles.docs.map(d=>[d.id,d.data()])),config=getConfig();
      staffOptions=profiles.docs.filter(d=>config.emails.includes(d.data().email)).map(d=>({uid:d.id,name:config.staff[config.emails.indexOf(d.data().email)]}));
      const groups=await Promise.all(people.docs.map(async person=>{
        const uid=person.id;
        const loadPart=part=>getDocsFromServer(query(collection(db,'attendance',uid,part),where('day','>=',range[0]),where('day','<',range[1])));
        const [records,reviews,corrections]=await Promise.all([loadPart('days'),loadPart('reviews'),loadPart('corrections')]);
        // Create defaults only where no saved review exists; a concurrent edit always wins.
        const missing=isAdmin?records.docs.filter(d=>!reviews.docs.some(r=>r.id===d.id)):[];
        for(const d of missing){
          if(current!==version||!allowed)return [];
          const record=d.data(),gross=calculate(record,null).gross;
          if(gross==null||gross<60*60000)continue;
          const target=doc(db,'attendance',uid,'reviews',d.id);
          await runTransaction(db,async tx=>{
            const existing=await tx.get(target);
            if(existing.exists()||current!==version||!allowed)return;
            tx.set(target,{day:record.day,breakMinutes:60,source:'automatic',updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid});
          });
        }
        const latest=missing.length?await loadPart('reviews'):reviews;
        const reviewMap=new Map(latest.docs.map(d=>[d.id,d.data()]));
        const profile=names.get(uid),slot=profile?config.emails.indexOf(profile.email):-1;
        const name=slot>=0?config.staff[slot]:profile?`${profile.name}（登録外）`:`名前未連携（${uid}）`;
        return records.docs.map(d=>{
          const record=d.data(),review=reviewMap.get(d.id),result=calculate(record,review);
          const logs=corrections.docs.map(c=>c.data()).filter(c=>c.day===record.day);
          const tags=[logs.some(c=>c.updatedBy===uid||c.requestId)?'本人修正あり':'',logs.some(c=>c.updatedBy!==uid&&!c.requestId)?'管理者修正あり':''].filter(Boolean);
          return {...record,uid,name,email:profile?.email||'',review,...result,status:[result.status,...tags].join(' ／ ')};
        });
      }));
      if(current!==version||!allowed)return;
      rows=groups.flat().sort((a,b)=>a.day-b.day||a.name.localeCompare(b.name,'ja'));loadedMonth=month;
      render();const s=totals(rows);
      $('reportStatus').textContent=rows.length?`${month}：${rows.length}件。未確認 ${s.pending}件。表示時点の記録です。最新の打刻は「一覧を表示」で更新してください。`:'この月の打刻記録はありません。';
    }catch(e){if(current===version){rows=[];loadedMonth='';render();$('reportStatus').textContent=`一覧を読み込めませんでした（${e.code||e.message}）。通信を確認して再度表示してください。`;}}
    finally{if(current===version){busy=false;render();controls();}}
  }
  async function saveBreak(row,value){
    if(!allowed||!isAdmin||busy)return;
    const minutes=Number(value);
    if(value.trim()===''||!Number.isInteger(minutes)||minutes<0||minutes*60000>row.gross){$('reportStatus').textContent='実際に取った休憩を、出勤〜退勤の範囲内の整数（分）で入力してください。';return;}
    const current=version,adminUid=auth.currentUser?.uid;
    busy=true;controls();render();$('reportStatus').textContent='休憩を保存中…';
    try {
      const target=doc(db,'attendance',row.uid,'reviews',String(row.day));
      await runTransaction(db,async tx=>{
        const existing=await tx.get(target),old=existing.exists()?existing.data():null;
        if((old?.updatedAt?.toMillis()??null)!==(row.review?.updatedAt?.toMillis()??null))throw Error('別の画面で休憩が更新されました。一覧を再表示して確認してください。');
        tx.set(target,{day:row.day,breakMinutes:minutes,source:'manual',updatedAt:serverTimestamp(),updatedBy:adminUid});
      });
      if(current===version){busy=false;await load();if(loadedMonth)$('reportStatus').textContent='休憩を保存し、集計を更新しました。';}
    }catch(e){if(current===version)$('reportStatus').textContent=`保存できませんでした：${e.code||e.message}`;}
    finally{if(current===version){busy=false;render();controls();}}
  }
  function openCorrection(row=null){
    if(!allowed||busy)return;
    if(!row&&!staffOptions.length){$('reportStatus').textContent='先にスタッフ本人がログインしてください。';return;}
    editing=row?{...row,expected:{day:row.day,clockIn:row.clockIn,clockOut:row.clockOut,...(row.correctionId?{correctionId:row.correctionId}:{})}}:{expected:null};
    const select=$('correctionStaff');select.replaceChildren();
    for(const person of row?[row]:staffOptions){const option=document.createElement('option');option.value=person.uid;option.textContent=person.name;select.append(option);}
    select.disabled=!!row;
    $('correctionDate').value=row?dayLabel(row.day):loadedMonth+'-01';$('correctionDate').disabled=!!row;
    $('correctionIn').value=row?localTime(row.clockIn):'';$('correctionOut').value=row?localTime(row.clockOut):'';
    $('correctionReason').value='';$('correctionMessage').textContent='';$('correctionForm').hidden=false;$('correctionForm').scrollIntoView?.({behavior:'smooth',block:'center'});
  }
  async function showHistory(row){
    if(!allowed||busy)return;
    const current=version;$('correctionHistory').textContent='履歴を読み込んでいます…';
    try{
      const result=await getDocsFromServer(query(collection(db,'attendance',row.uid,'corrections'),where('day','==',row.day)));
      if(current!==version||!allowed)return;
      $('correctionHistory').replaceChildren();
      const title=document.createElement('p');title.textContent=`${dayLabel(row.day)} ${row.name} の修正履歴`; $('correctionHistory').append(title);
      if(result.empty){title.textContent+='：修正なし';return;}
      for(const log of result.docs.map(d=>d.data()).sort((a,b)=>b.updatedAt.toMillis()-a.updatedAt.toMillis())){
        const line=document.createElement('p');line.textContent=`${stamp(log.updatedAt)} ／ ${log.requestId?'本人申請・管理者承認':log.updatedBy===row.uid?'本人':'管理者'} ／ ${log.reason} ／ 変更前 ${stamp(log.before?.clockIn)} ～ ${stamp(log.before?.clockOut)} → 変更後 ${stamp(log.after.clockIn)} ～ ${stamp(log.after.clockOut)}`;$('correctionHistory').append(line);
      }
    }catch(e){if(current===version)$('correctionHistory').textContent=`履歴を取得できません：${e.code||e.message}`;}
  }
  $('addAttendance').onclick=()=>openCorrection();
  $('correctionCancel').onclick=()=>{if(!busy){editing=null;$('correctionForm').hidden=true;}};
  $('correctionSave').onclick=async()=>{
    if(!allowed||busy||!editing)return;
    const current=version;
    try{
      const clockIn=parseTime($('correctionIn').value),clockOut=$('correctionOut').value?parseTime($('correctionOut').value):null;
      const date=$('correctionDate').value,day=Date.parse(date+'T00:00:00Z')/86400000;
      if(!Number.isInteger(day)||date.slice(0,7)!==loadedMonth)throw Error('対象月内の出勤日を選んでください。');
      busy=true;controls();render();$('correctionMessage').textContent='保存中…';
      await (isAdmin?saveCorrection:submitCorrection)({db,uid:$('correctionStaff').value,adminUid:auth.currentUser.uid,day,clockIn,clockOut,reason:$('correctionReason').value,expected:editing.expected});
      if(current===version){busy=false;await load();if(loadedMonth)$('reportStatus').textContent=isAdmin?'打刻と修正履歴を保存しました。休憩・実働も確認してください。':'修正を申請しました。承認までは正式な時刻・集計は変わりません。';await loadApplications();}
    }catch(e){if(current===version)$('correctionMessage').textContent=`保存できませんでした：${e.code||e.message}`;}
    finally{if(current===version){busy=false;controls();render();}}
  };
  async function loadApplications(){
    if(!allowed)return;
    const current=version,adminMode=isAdmin,uid=selfUid;
    $('requestStatus').textContent='申請を読み込んでいます…';
    try{
      const q=query(collection(db,'correctionRequests'),adminMode?where('status','==','pending'):where('uid','==',uid));
      const [requests,profiles]=await Promise.all([getDocsFromServer(q),adminMode?getDocsFromServer(collection(db,'staffProfiles')):Promise.resolve({docs:[]})]);
      if(current!==version||!allowed)return;
      const names=new Map(profiles.docs.map(d=>[d.id,d.data().name]));
      $('requestRows').replaceChildren();
      const applications=requests.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.createdAt.toMillis()-a.createdAt.toMillis());
      $('requestStatus').textContent=adminMode?`承認待ち ${applications.length}件（全月）。承認した時点で正式な記録と集計に反映します。`:'自分の申請履歴です。承認までは正式な記録は変わりません。';
      for(const application of applications){
        const tr=document.createElement('tr');
        [names.get(application.uid)|| (adminMode?application.uid:'自分'),dayLabel(application.day),stamp(application.createdAt),`${stamp(application.before?.clockIn)} ～ ${stamp(application.before?.clockOut)}`,`${stamp(application.proposed.clockIn)} ～ ${stamp(application.proposed.clockOut)}`,application.reason].forEach(value=>cell(tr,value));
        const actions=cell(tr,'');
        if(adminMode){
          for(const [label,approve] of [['承認',true],['却下',false]]){
            const button=document.createElement('button');button.textContent=label;button.disabled=busy;button.onclick=()=>decideApplication(application,approve);actions.append(button);
          }
        }else actions.textContent=({pending:'承認待ち',approved:'承認済み',rejected:'却下'})[application.status];
        $('requestRows').append(tr);
      }
    }catch(e){if(current===version){$('requestRows').replaceChildren();$('requestStatus').textContent=`申請を取得できません：${e.code||e.message}`;}}
  }
  async function decideApplication(application,approve){
    if(!allowed||!isAdmin||busy)return;
    const current=version;busy=true;controls();render();
    $('requestRows').querySelectorAll('button').forEach(b=>b.disabled=true);$('requestStatus').textContent='処理中…';
    try{
      if(approve)await saveCorrection({db,uid:application.uid,adminUid:auth.currentUser.uid,...application.proposed,reason:application.reason,expected:application.before,requestId:application.id});
      else await rejectCorrection({db,id:application.id,adminUid:auth.currentUser.uid});
      if(current!==version||!allowed)return;
      busy=false;if(loadedMonth)await load();await loadApplications();
    }catch(e){if(current===version)$('requestStatus').textContent=`処理できませんでした：${e.code||e.message} 記録が変わった申請は却下して、本人に再申請を依頼してください。`;}
    finally{if(current===version&&allowed){busy=false;controls();render();$('requestRows').querySelectorAll('button').forEach(b=>b.disabled=false);}}
  }
  $('refreshRequests').onclick=loadApplications;
  $('reportMonth').onchange=()=>reset(isAdmin,selfUid);
  $('loadReport').onclick=load;
  $('reportCsv').onclick=()=>{if(!allowed||busy||!loadedMonth)return;download(`ODC_打刻明細_${loadedMonth}.csv`,csv([['出勤日（日本時間）','氏名','Googleメール','UID','出勤','退勤','出勤〜退勤（時:分）','休憩（分）','実働（時:分）','状態'],...rows.map(r=>[dayLabel(r.day),r.name,r.email,r.uid,stamp(r.clockIn),stamp(r.clockOut),duration(r.gross),r.review?.breakMinutes??'',duration(r.net),r.status])]),'text/csv;charset=utf-8');};
  $('summaryCsv').onclick=()=>{if(!allowed||busy||!loadedMonth)return;download(`ODC_月別集計_${loadedMonth}.csv`,csv([['対象月','氏名','Googleメール','UID','打刻日数','集計対象日数','未確認日数','出勤〜退勤合計（時:分）','実働合計（時:分）'],...grouped().map(g=>{const s=totals(g);return [loadedMonth,g[0].name,g[0].email,g[0].uid,s.days,s.confirmed,s.pending,duration(s.gross),s.confirmed?duration(s.net):''];})]),'text/csv;charset=utf-8');};
  reset();return {reset};
}
