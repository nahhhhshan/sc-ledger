/* 公開版の共有帳簿（Supabase）。ledger.html の MODE='web'（URL の # に帳簿 ID があるとき）から initWeb() が呼ばれる。
 * 帳簿は推測できない長い ID で区別し、それを知っている人だけが join_ledger() で参加して読み書きできる（決まりは supabase_schema.sql）。
 * 下の URL と鍵はページに載せて使う前提の公開用（publishable）の値。 */
const SUPA_URL = 'https://gcqisbfutegmklceleaf.supabase.co';
const SUPA_KEY = 'sb_publishable_VrhqvsYJf-p8IKadPU_9Ug_e7OXRS7o';
const SUPA_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
const NAME_KEY = 'sc-ledger-name';
const CLIENT_ID = (() => { let id = lsGet('sc-ledger-client'); if(!/^[a-z0-9]{10}$/.test(id)){ id = Math.random().toString(36).slice(2, 12).padEnd(10, '0'); lsSet('sc-ledger-client', id); } return id; })();

function lsGet(k){ try{ return localStorage.getItem(k) || ''; }catch(e){ return ''; } }
function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
function loadScript(src){ return new Promise((ok, ng) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ng; document.head.appendChild(s); }); }

function webPanel(html){
  let p = document.getElementById('webPanel');
  if(!p){
    p = document.createElement('section');
    p.id = 'webPanel'; p.className = 'panel';
    document.querySelector('.wrap').insertBefore(p, document.querySelector('.tiles'));
  }
  p.innerHTML = html; p.hidden = !html;
  return p;
}
// データベースの行 ⇔ 画面の記録
const rowToEntry = r => {
  const e = {id:r.id, date:r.date, type:r.type, amount:Number(r.amount), memo:r.memo || ''};
  for(const [k, c] of [['ship','ship'], ['mission','mission'], ['by','by'], ['src','src'], ['createdAt','created_at']]) if(r[c] != null) e[k] = r[c];
  return e;
};
const entryToRow = (lid, e) => ({ledger_id:lid, id:e.id, date:e.date, type:e.type, amount:e.amount, memo:(e.memo || '').slice(0, 200),
  ship:e.ship || null, mission:e.mission || null, by:e.by || null, src:e.src || null, created_at:e.createdAt || Date.now()});
const newEntryId = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function initWeb(){
  const notReady = () => Promise.reject({code:'not-connected'});
  for(const k of ['add','addMany','remove','clearAll','setStart','setPersonStart','setHandle','setAvatar','dropPerson','moveLegacy']) store[k] = notReady;
  const lid = location.hash.replace(/^#/, '');
  const home = location.pathname;   // このブラウザだけの帳簿（# なし）

  // 1) 自分の名前
  let myName = lsGet(NAME_KEY);
  if(!myName){
    $('storeNote').innerHTML = '保存先: <b>未接続</b>（名前を入れると共有帳簿に接続します）';
    render();
    await new Promise(done => {
      const p = webPanel(`<h2>あなたの名前</h2>
        <p class="hint">共有帳簿で記録者として表示されます。ゲーム内の名前やニックネームで大丈夫です。</p>
        <form id="nameForm" class="row" style="margin-top:10px;align-items:end">
          <label><span class="lab">名前</span><input type="text" id="myName" maxlength="20" required></label>
          <button class="btn" type="submit">決定</button></form>
        <p class="hint" style="margin-top:10px"><a href="${esc(home)}">このブラウザだけの帳簿に戻る</a></p>`);
      p.querySelector('#nameForm').onsubmit = ev => {
        ev.preventDefault();
        const v = p.querySelector('#myName').value.trim();
        if(!v) return;
        lsSet(NAME_KEY, v); myName = v; done();
      };
    });
  }
  me = myName;

  // 2) 接続（匿名ログイン → 帳簿に参加）
  $('storeNote').innerHTML = '保存先: <b>共有帳簿に接続中…</b>';
  const fail = msg => {
    $('storeNote').innerHTML = '保存先: <b class="neg">接続できません</b>';
    webPanel('<h2>共有帳簿に接続できませんでした</h2><p class="hint">' + msg + '</p><p class="hint">この状態では記録を保存できません。ページを読み込み直しても直らないときは、広告ブロックなどの拡張機能を一時的に止めて試してください。</p>'
      + `<p class="hint"><a href="${esc(home)}">このブラウザだけの帳簿に戻る</a></p>`);
  };
  let sb;
  try{
    if(!window.supabase) await loadScript(SUPA_LIB);
    sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, {auth:{persistSession:true, autoRefreshToken:true, storageKey:'sc-ledger-auth'}});
    const {data:{session}} = await sb.auth.getSession();
    if(!session){ const {error} = await sb.auth.signInAnonymously(); if(error) throw error; }
    const {error} = await sb.rpc('join_ledger', {lid, nm:me});
    if(error) throw error;
  }catch(e){ fail('接続できませんでした（' + esc(e.message || e.code || e) + '）。'); return; }

  // 3) 共有URL の欄（右上「共有URL」で開く）
  const shareUrl = location.href;
  const sp = webPanel(`<h2>共有URL <span class="hint" style="font-weight:400;letter-spacing:0">このURLを知っている人は誰でも読み書きできます。一緒に使う人以外には教えないでください。</span>
      <button class="btn ghost" type="button" id="closeShare" style="padding:3px 10px;font-size:12px">閉じる</button></h2>
    <div class="row" style="align-items:center"><input type="text" id="shareUrl" readonly value="${esc(shareUrl)}" style="flex:1 1 260px">
    <button class="btn ghost" type="button" id="copyUrl">コピー</button>
    <button class="btn ghost" type="button" id="renameBtn">名前を変更（${esc(me)}）</button></div>
    <p class="hint" style="margin-top:8px"><a href="${esc(home)}">このブラウザだけの帳簿に戻る</a></p>`);
  sp.hidden = true;
  const hs = $('hdrShare');
  const toggleShare = open => { sp.hidden = !open; hs.setAttribute('aria-expanded', String(open)); };
  hs.hidden = false;
  hs.onclick = () => toggleShare(sp.hidden);
  $('closeShare').onclick = () => toggleShare(false);
  $('copyUrl').onclick = async () => {
    try{ await navigator.clipboard.writeText(shareUrl); toast('URLをコピーしました'); }
    catch(e){ $('shareUrl').select(); toast('選択したのでコピーしてください'); }
  };
  $('renameBtn').onclick = () => { try{ localStorage.removeItem(NAME_KEY); }catch(e){} location.reload(); };

  // 4) 保存のしかた
  const E = () => sb.from('entries');
  const chk = ({error}) => { if(error) throw {code:error.code || error.message, message:error.message}; };
  const addLocal = list => { const have = new Set(entries.map(e => e.id)); for(const e of list) if(!have.has(e.id)) entries.push(e); render(); };
  // 設定（開始額・ゲーム内の名前・アイコン）は帳簿の settings にまとめて書く
  const saveSettings = async o => { const next = sdoc(o); chk(await sb.from('ledgers').update({settings:next}).eq('id', lid)); settings = {...settings, ...next}; render(); };
  store.db = null;
  store.add = async e => { const x = {...e, id:newEntryId()}; chk(await E().insert(entryToRow(lid, x))); addLocal([x]); };
  store.remove = async id => { chk(await E().delete().eq('ledger_id', lid).eq('id', id)); entries = entries.filter(x => x.id !== id); render(); };
  store.addMany = async (list, onProgress) => {
    for(let i = 0; i < list.length; i += 500){
      const part = list.slice(i, i + 500);
      chk(await E().upsert(part.map(e => entryToRow(lid, e)), {onConflict:'ledger_id,id', ignoreDuplicates:true}));
      addLocal(part);
      onProgress && onProgress(Math.min(i + 500, list.length));
    }
  };
  store.removeMany = async ids => {
    for(let i = 0; i < ids.length; i += 200) chk(await E().delete().eq('ledger_id', lid).in('id', ids.slice(i, i + 200)));
    const del = new Set(ids); entries = entries.filter(x => !del.has(x.id)); render();
  };
  store.clearAll = async () => { chk(await E().delete().eq('ledger_id', lid)); entries = []; render(); };
  store.setStart = v => saveSettings({startBalance:v});
  store.setPersonStart = (k, v) => saveSettings({starts:{...(settings.starts || {}), [k]:v}});
  store.setHandle = (k, h) => { const handles = {...(settings.handles || {})}; if(h) handles[k] = h; else delete handles[k]; return saveSettings({handles}); };
  store.setAvatar = (k, url) => { const avatars = {...(settings.avatars || {})}; if(url) avatars[k] = url; else delete avatars[k]; return saveSettings({avatars}); };
  store.dropPerson = k => {
    const starts = {...(settings.starts || {})};
    for(const key of Object.keys(starts)) if(splitKey(key)[0] === k) delete starts[key];
    const handles = {...(settings.handles || {})}; delete handles[k];
    const avatars = {...(settings.avatars || {})}; delete avatars[k];
    return saveSettings({starts, handles, avatars});
  };
  store.moveLegacy = k => saveSettings({startBalance:0, starts:{...(settings.starts || {}), [k]:(Number((settings.starts || {})[k]) || 0) + (settings.startBalance || 0)}});
  const applySettings = d => { d = d || {}; settings = {startBalance:Number(d.startBalance) || 0, starts:d.starts || {}, handles:d.handles || {}, avatars:d.avatars || {}}; };

  // 5) 読み込み（全件。1回 1,000 件ずつ）
  $('storeNote').innerHTML = '保存先: <b>共有帳簿（Supabase）</b>';
  entries = []; render();
  try{
    const {data:L, error} = await sb.from('ledgers').select('settings').eq('id', lid).single();
    if(error) throw error;
    applySettings(L.settings);
    let all = [];
    for(let from = 0; ; from += 1000){
      const {data, error} = await E().select('*').eq('ledger_id', lid).order('inserted_at').range(from, from + 999);
      if(error) throw error;
      all = all.concat(data.map(rowToEntry));
      if(data.length < 1000) break;
    }
    entries = all; render();
  }catch(e){ toast('記録を読み込めませんでした（' + (e.message || e.code || e) + '）。ページを再読み込みしてください。'); return; }

  // 6) ブラウザだけの帳簿から作ったとき: その記録を移す（作った本人の記録として）
  let mig = ''; try{ mig = sessionStorage.getItem('sc-ledger-migrate') || ''; sessionStorage.removeItem('sc-ledger-migrate'); }catch(e){}
  if(mig === lid){
    try{
      const local = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      const list = (local.entries || []).map(e => ({...e, by:e.by || me}));
      if(list.length) await store.addMany(list);
      const sb0 = Number((local.settings || {}).startBalance) || 0;
      if(sb0 && !(settings.starts || {})[me]) await store.setPersonStart(me, sb0);
      if(list.length) toast(`このブラウザの ${list.length}件を共有帳簿に移しました`);
    }catch(e){ toast('このブラウザの記録を共有帳簿に移せませんでした（' + (e.code || e.message || e) + '）'); }
  }

  // 7) 相手の追加・削除・設定の変更をすぐ反映し、接続中の人を表示する（Realtime。接続中の表示はデータベースに書かない）
  const ch = sb.channel('ledger-' + lid, {config:{presence:{key:CLIENT_ID}}});
  ch.on('postgres_changes', {event:'INSERT', schema:'public', table:'entries', filter:'ledger_id=eq.' + lid}, p => {
    const e = rowToEntry(p.new);
    if(entries.some(x => x.id === e.id)) return;
    entries.push(e); render();
    if(e.by && e.by !== me) toast(`${e.by} が ${typeOf(e.type).label} ${sfmt(e.amount)} を追加しました`);
  });
  ch.on('postgres_changes', {event:'DELETE', schema:'public', table:'entries'}, p => {
    const o = p.old || {};
    if(o.ledger_id && o.ledger_id !== lid) return;
    if(entries.some(x => x.id === o.id)){ entries = entries.filter(x => x.id !== o.id); render(); }
  });
  ch.on('postgres_changes', {event:'UPDATE', schema:'public', table:'ledgers', filter:'id=eq.' + lid}, p => { applySettings(p.new.settings); render(); });
  const drawPeers = () => {
    const st = ch.presenceState();
    const on = [...new Set(Object.values(st).flat().map(x => x.name).filter(Boolean))];
    if(!on.includes(me)) on.unshift(me);
    $('peers').hidden = false;
    $('peers').innerHTML = '<span>接続中</span>' + on.map(n => peerChip(n)).join('');
  };
  window.redrawPeers = drawPeers;
  ch.on('presence', {event:'sync'}, drawPeers);
  ch.subscribe(async status => { if(status === 'SUBSCRIBED') await ch.track({name:me}); });
}
