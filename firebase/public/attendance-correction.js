import {doc,collection,runTransaction,serverTimestamp,Timestamp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
export const localTime=t=>t?.toMillis?new Date(t.toMillis()+32400000).toISOString().slice(0,23):'';
export function parseTime(value){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value))throw Error('日時を入力してください。');
  const date=new Date(value+'+09:00');
  if(!Number.isFinite(date.getTime())||new Date(date.getTime()+32400000).toISOString().slice(0,16)!==value.slice(0,16))throw Error('日時を確認してください。');
  return Timestamp.fromDate(date);
}
export async function saveCorrection({db,uid,adminUid,day,clockIn,clockOut,reason,expected}){
  reason=reason.trim();
  if(!reason||reason.length>200)throw Error('修正理由を200文字以内で入力してください。');
  if(Math.floor((clockIn.toMillis()+32400000)/86400000)!==day)throw Error('出勤日は変更できません。');
  if(clockIn.toMillis()>Date.now()||clockOut&&(clockOut.toMillis()<clockIn.toMillis()||clockOut.toMillis()>Date.now()))throw Error('時刻の前後関係、未来の日時でないかを確認してください。');
  const target=doc(db,'attendance',uid,'days',String(day)),parent=doc(db,'attendance',uid),audit=doc(collection(db,'attendance',uid,'corrections'));
  await runTransaction(db,async tx=>{
    const [snap,current]=await Promise.all([tx.get(target),tx.get(parent)]);
    const before=snap.exists()?snap.data():null,latest=current.exists()?current.data():null;
    const same=(a,b)=>a?.day===b?.day&&(a?.clockIn?.toMillis()??null)===(b?.clockIn?.toMillis()??null)&&(a?.clockOut?.toMillis()??null)===(b?.clockOut?.toMillis()??null)&&(a?.correctionId??null)===(b?.correctionId??null);
    if(!same(before,expected))throw Error('記録が更新されています。一覧を再表示してやり直してください。');
    if(latest&&latest.day<day&&!latest.clockOut)throw Error('前の勤務が退勤未打刻です。先にその日の退勤を修正してください。');
    if(latest&&latest.day>day&&!clockOut)throw Error('過去の記録には退勤時刻も入力してください。');
    const after={day,clockIn,clockOut,correctionId:audit.id};
    tx.set(audit,{day,before,after,reason,updatedBy:adminUid,updatedAt:serverTimestamp()});
    tx.set(target,after);
    if(!latest||latest.day<=day)tx.set(parent,after);
  });
}
