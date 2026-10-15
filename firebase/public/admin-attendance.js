import {localTime,parseTime,saveCorrection} from './attendance-correction.js';
import {collection,doc,getDocsFromServer,query,where,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {monthRange,dayLabel,duration,calculate,totals,csv} from './attendance-report.js';
export function setupAttendance({db,auth,getConfig,download}) {
  const $=id=>document.getElementById(id);
  let allowed=false,version=0,rows=[],loadedMonth='',busy=false,editing=null,staffOptions=[];
  const now=new Date(Date.now()+32400000);
  $('reportMonth').value=now.toISOString().slice(0,7);
  const stamp=t=>t?.toDate ? t.toDate().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—';
  function reset(enabled=false) {
    version++; editing=null;staffOptions=[];$('correctionForm').hidden=true;$('correctionHistory').replaceChildren(); allowed=enabled; rows=[];loadedMonth='';busy=false;
    $('adminAttendance').hidden=!enabled;
    $('reportRows').replaceChildren();$('reportSummary').replaceChildren();
    $('reportStatus').textContent='月を選んで「一覧を表示」を押してください。';
    controls();
  }
  function controls(){
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
      input.disabled=busy||r.gross==null;
      const button=document.createElement('button');button.textContent='保存';button.disabled=input.disabled;
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
      const [people,profiles]=await Promise.all([getDocsFromServer(collection(db,'attendance')),getDocsFromServer(collection(db,'staffProfiles'))]);
      if(current!==version||!allowed)return;
      const names=new Map(profiles.docs.map(d=>[d.id,d.data()])),config=getConfig();
      staffOptions=profiles.docs.filter(d=>config.emails.includes(d.data().email)).map(d=>({uid:d.id,name:config.staff[config.emails.indexOf(d.data().email)]}));
      const groups=await Promise.all(people.docs.map(async person=>{
        const uid=person.id;
        const loadPart=part=>getDocsFromServer(query(collection(db,'attendance',uid,part),where('day','>=',range[0]),where('day','<',range[1])));
        const [records,reviews]=await Promise.all([loadPart('days'),loadPart('reviews')]);
        // Create defaults only where no saved review exists; a concurrent edit always wins.
        const missing=records.docs.filter(d=>!reviews.docs.some(r=>r.id===d.id));
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
        return records.docs.map(d=>{const record=d.data(),review=reviewMap.get(d.id);return {...record,uid,name,email:profile?.email||'',review,...calculate(record,review)};});
      }));
      if(current!==version||!allowed)return;
      rows=groups.flat().sort((a,b)=>a.day-b.day||a.name.localeCompare(b.name,'ja'));loadedMonth=month;
      render();const s=totals(rows);
      $('reportStatus').textContent=rows.length?`${month}：${rows.length}件。未確認 ${s.pending}件。表示時点の記録です。最新の打刻は「一覧を表示」で更新してください。`:'この月の打刻記録はありません。';
    }catch(e){if(current===version){rows=[];loadedMonth='';render();$('reportStatus').textContent=`一覧を読み込めませんでした（${e.code||e.message}）。通信を確認して再度表示してください。`;}}
    finally{if(current===version){busy=false;render();controls();}}
  }
  async function saveBreak(row,value){
    if(!allowed||busy)return;
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
        const line=document.createElement('p');line.textContent=`${stamp(log.updatedAt)} ／ ${log.reason} ／ 変更前 ${stamp(log.before?.clockIn)} ～ ${stamp(log.before?.clockOut)} → 変更後 ${stamp(log.after.clockIn)} ～ ${stamp(log.after.clockOut)}`;$('correctionHistory').append(line);
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
      await saveCorrection({db,uid:$('correctionStaff').value,adminUid:auth.currentUser.uid,day,clockIn,clockOut,reason:$('correctionReason').value,expected:editing.expected});
      if(current===version){busy=false;await load();if(loadedMonth)$('reportStatus').textContent='打刻と修正履歴を保存しました。休憩・実働も確認してください。';}
    }catch(e){if(current===version)$('correctionMessage').textContent=`保存できませんでした：${e.code||e.message}`;}
    finally{if(current===version){busy=false;controls();render();}}
  };
  $('reportMonth').onchange=()=>reset(allowed);
  $('loadReport').onclick=load;
  $('reportCsv').onclick=()=>{if(!allowed||busy||!loadedMonth)return;download(`ODC_打刻明細_${loadedMonth}.csv`,csv([['出勤日（日本時間）','氏名','Googleメール','UID','出勤','退勤','出勤〜退勤（時:分:秒）','休憩（分）','実働（時:分:秒）','状態'],...rows.map(r=>[dayLabel(r.day),r.name,r.email,r.uid,stamp(r.clockIn),stamp(r.clockOut),duration(r.gross),r.review?.breakMinutes??'',duration(r.net),r.status])]),'text/csv;charset=utf-8');};
  $('summaryCsv').onclick=()=>{if(!allowed||busy||!loadedMonth)return;download(`ODC_月別集計_${loadedMonth}.csv`,csv([['対象月','氏名','Googleメール','UID','打刻日数','集計対象日数','未確認日数','出勤〜退勤合計（時:分:秒）','実働合計（時:分:秒）'],...grouped().map(g=>{const s=totals(g);return [loadedMonth,g[0].name,g[0].email,g[0].uid,s.days,s.confirmed,s.pending,duration(s.gross),s.confirmed?duration(s.net):''];})]),'text/csv;charset=utf-8');};
  reset();return {reset};
}
