'use strict';
// Tokens live only in memory. Reloading/closing this page requires login again.
window.ODCCloud = (() => {
  let token = null, userId = null, role = null, revision = null;
  const config = () => window.ODC_CONFIG || {};
  function configured() {
    const c = config();
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(c.url || '') &&
      /^sb_publishable_/.test(c.publishableKey || '');
  }
  async function request(path, options = {}) {
    if (!configured()) throw new Error('共有保存の接続設定がまだ完了していません。');
    let response;
    try {
      response = await fetch(config().url + path, {
        ...options,
        signal: AbortSignal.timeout(15000),
        headers: { apikey: config().publishableKey, 'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}), ...options.headers }
      });
    } catch {
      throw new Error('通信できませんでした。保存結果が不明な場合は「最新を読み込む」で確認してください。');
    }
    if (!response.ok) {
      if (response.status === 401) {
        token = null; role = null; userId = null; revision = null;
        throw new Error('認証できません。IDとパスワードを確認して、再ログインしてください。');
      }
      throw new Error('処理に失敗しました。権限・接続設定を確認してください。');
    }
    return response.status === 204 ? null : response.json();
  }
  async function login(id, password) {
    token = null; role = null; revision = null; userId = null;
    const email = id.includes('@') ? id : id + '@' + config().loginDomain;
    const auth = await request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email, password })
    });
    token = auth.access_token; userId = auth.user.id;
    try {
      const memberships = await request('/rest/v1/odc_members?select=role&user_id=eq.' + encodeURIComponent(userId));
      if (memberships.length !== 1) throw new Error('このアカウントはスタッフとして登録されていません。');
      role = memberships[0].role;
      return await load();
    } catch (error) { token = null; role = null; userId = null; revision = null; throw error; }
  }
  async function load() {
    const rows = await request('/rest/v1/odc_state?id=eq.1&select=payload,revision');
    if (rows.length !== 1) throw new Error('共有データが見つかりません。管理者の初期設定が必要です。');
    revision = rows[0].revision;
    return rows[0].payload;
  }
  async function save(payload) {
    if (role !== 'admin') throw new Error('シフト変更は管理者のみ可能です。');
    const next = await request('/rest/v1/rpc/odc_save_state', {
      method: 'POST', body: JSON.stringify({ expected_revision: revision, new_payload: payload })
    });
    if (next === null) throw new Error('別の端末で更新されています。「最新を読み込む」を押してから、変更をやり直してください。');
    revision = next;
  }
  async function logout() {
    try { if (token) await request('/auth/v1/logout', { method: 'POST' }); }
    finally { token = null; userId = null; role = null; revision = null; }
  }
  return { configured, login, load, save, logout, isAdmin: () => role === 'admin' };
})();
