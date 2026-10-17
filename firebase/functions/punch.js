const {isIP}=require('node:net');

// Direct Cloud Functions endpoint only: never place this behind a Hosting rewrite.
// Reject ambiguous proxy chains, including client-supplied X-Forwarded-For values.
function clinicNetwork(header,allowed) {
  if(typeof header!=='string'||typeof allowed!=='string'||isIP(allowed)!==4)return false;
  const parts=header.split(',').map(s=>s.trim());
  return parts.length===1&&isIP(parts[0])===4&&parts[0]===allowed;
}
async function handlePunch({db,auth,data,header,allowed,Timestamp,fail}) {
  const token=auth?.token;
  if(!auth||token?.email_verified!==true||token?.firebase?.sign_in_provider!=='google.com')throw fail('unauthenticated','Googleでログインし直してください。');
  if(!data||!['in','out','check'].includes(data.kind)||Object.keys(data).some(k=>k!=='kind'))throw fail('invalid-argument','打刻操作が不正です。');
  const networkOK=clinicNetwork(header,allowed);
  return db.runTransaction(async tx=>{
    const settings=await tx.get(db.doc('settings/clinic'));
    if(!settings.exists||!settings.data().emails?.includes(token.email))throw fail('permission-denied','スタッフ設定に登録された本人だけが打刻できます。');
    if(data.kind==='check')return {allowed:networkOK};
    if(!networkOK)throw fail('permission-denied','院内Wi-Fiに接続してください。院内でも打刻できない場合は管理者に連絡してください。');
    const ref=db.doc(`attendance/${auth.uid}`),snap=await tx.get(ref),previous=snap.exists?snap.data():null;
    const now=Timestamp.now(),day=Math.floor((now.toMillis()+32400000)/86400000);
    let record;
    if(data.kind==='in') {
      if(previous&&(!previous.clockOut||previous.day>=day))throw fail('failed-precondition','すでに出勤済みです。本日は再出勤できません。');
      const daily=await tx.get(ref.collection('days').doc(String(day)));
      if(daily.exists)throw fail('failed-precondition','本日の記録がすでにあります。管理者に確認してください。');
      record={day,clockIn:now,clockOut:null};
    } else {
      if(!previous||previous.clockOut)throw fail('failed-precondition','退勤済み、または出勤記録がありません。');
      if(now.toMillis()<previous.clockIn.toMillis())throw fail('failed-precondition','出勤時刻を確認してください。');
      record={...previous,clockOut:now};
    }
    tx.set(ref,record);
    tx.set(ref.collection('days').doc(String(record.day)),record);
    return {saved:true,day:record.day};
  });
}
module.exports={clinicNetwork,handlePunch};
