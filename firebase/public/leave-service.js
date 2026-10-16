import {doc,collection,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
export const leaveLabels={full:'1日',am:'半日（午前）',pm:'半日（午後）'};
export function validLeaveDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;}
export async function requestLeave({db,uid,date,part,note=''}){
  if(!validLeaveDate(date)||part!=='full')throw Error('日付と取得区分を選んでください。');
  if(note.length>200)throw Error('備考は200文字以内で入力してください。');
  const ref=doc(collection(db,'leaveRequests'));
  await runTransaction(db,async tx=>{tx.set(ref,{uid,date,part,note:note.trim(),status:'pending',createdAt:serverTimestamp(),createdBy:uid});});
}
export async function setLeaveBalance({db,uid,adminUid,days,expected,reason}){
  if(!Number.isFinite(days)||days<0||!Number.isInteger(days))throw Error('残日数は0以上、1日単位で入力してください。');
  if(!reason.trim()||reason.length>200)throw Error('設定理由を200文字以内で入力してください。');
  const ref=doc(db,'leaveBalances',uid),log=doc(collection(db,'leaveBalances',uid,'history'));
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref),before=snap.exists()?snap.data():null;
    if((before?.updatedAt?.toMillis()??null)!==(expected?.updatedAt?.toMillis()??null))throw Error('残日数が更新されました。一覧を更新してください。');
    tx.set(ref,{units:days*2,updatedBy:adminUid,updatedAt:serverTimestamp()});
    tx.set(log,{before:before?.units??null,after:days*2,reason:reason.trim(),updatedBy:adminUid,updatedAt:serverTimestamp()});
  });
}
export async function decideLeave({db,id,action,adminUid}){
  if(!['approve','reject','cancel'].includes(action))throw Error('操作が不正です。');
  const ref=doc(db,'leaveRequests',id);
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);if(!snap.exists())throw Error('申請がありません。');
    const r=snap.data();
    if(!validLeaveDate(r.date)||!leaveLabels[r.part])throw Error('申請の日付・取得区分が不正です。');
    if(r.status!==(action==='cancel'?'approved':'pending'))throw Error('処理済みです。一覧を更新してください。');
    if(action==='approve'&&r.part!=='full')throw Error('有給は1日単位です。半日の申請は却下し、1日で再申請してください。');
    if(action==='reject'){tx.update(ref,{status:'rejected',reviewedBy:adminUid,reviewedAt:serverTimestamp()});return;}
    const balanceRef=doc(db,'leaveBalances',r.uid),calendarRef=doc(db,'leaveDays',r.uid+'_'+r.date);
    const [balanceSnap,calendarSnap,profileSnap,configSnap]=await Promise.all([tx.get(balanceRef),tx.get(calendarRef),tx.get(doc(db,'staffProfiles',r.uid)),tx.get(doc(db,'settings','clinic'))]);
    if(!balanceSnap.exists())throw Error('先に管理者が残日数を設定してください。');
    const balance=balanceSnap.data(),units=r.part==='full'?2:1,profile=profileSnap.exists()?profileSnap.data():null;
    const slot=profile?configSnap.data().emails.indexOf(profile.email):-1;
    const calendar=calendarSnap.exists()?calendarSnap.data():{uid:r.uid,date:r.date,slot,am:'',pm:''};
    const halves=r.part==='full'?['am','pm']:[r.part];
    if(action==='approve'){
      if(slot<0)throw Error('現在のスタッフ設定に登録されていません。');
      if(balance.units<units)throw Error('有給残日数が不足しています。');
      if(halves.some(h=>calendar[h]))throw Error('同じ日・時間帯の有給が承認済みです。');
      for(const h of halves)calendar[h]=id;calendar.slot=slot;
    }else{
      if(halves.some(h=>calendar[h]!==id))throw Error('シフトの有給記録が変わっています。一覧を確認してください。');
      for(const h of halves)calendar[h]='';
    }
    const after=balance.units+(action==='approve'?-units:units);
    tx.update(balanceRef,{units:after,updatedBy:adminUid,updatedAt:serverTimestamp()});
    tx.set(doc(collection(db,'leaveBalances',r.uid,'history')),{before:balance.units,after,reason:action==='approve'?`${r.date} ${leaveLabels[r.part]} 承認`:`${r.date} ${leaveLabels[r.part]} 取消`,updatedBy:adminUid,updatedAt:serverTimestamp()});
    tx.set(calendarRef,calendar);
    tx.update(ref,action==='approve'?{status:'approved',reviewedBy:adminUid,reviewedAt:serverTimestamp()}:{status:'cancelled',cancelledBy:adminUid,cancelledAt:serverTimestamp()});
  });
}
