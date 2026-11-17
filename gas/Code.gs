/**
 * Freestyle Dining E-nNS 予約API（Google Apps Script）
 *
 * ・お客様の予約をスプレッドシートに保存し、お店とお客様にメールを送る
 * ・来店前日の17時ごろにリマインドメールを送る
 * ・店舗用管理画面（admin.html）から、予約一覧・ステータス変更・受付停止ができる
 *
 * サイト側（index.html の CONFIG）と値をそろえてください。
 */
const CFG = {
  SHOP_EMAIL: 'shop@example.com',   // ← 予約通知を受け取るメールアドレス
  SHOP_NAME: 'Freestyle Dining E-nNS',
  SHOP_TEL: '048-423-9833',
  SHOP_ADDRESS: '埼玉県朝霞市栄町5-3-29 1F',
  CAPACITY: 40,
  STAY_HOURS: 2.5,
  MAX_DAYS_AHEAD: 60,
  SAME_DAY_CUTOFF_MIN: 120,
  LARGE_GROUP: 20,
  MAX_PEOPLE: 50,
  COURSE_PRICE: 4000,
  BEER_UP_PRICE: 1000,
  SLOTS_BY_DOW: {
    0: null,
    1: ['18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30'],
    2: ['18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30'],
    3: ['18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30'],
    4: ['18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30'],
    5: ['18:00','18:30','19:00','19:30','20:00','20:30','21:00','21:30'],
    6: ['18:00','18:30','19:00','19:30','20:00']
  },
  HOLIDAYS: [
    '2026-11-23','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03','2027-01-11','2027-02-11','2027-02-23',
    '2027-03-22','2027-04-29','2027-05-03','2027-05-04','2027-05-05','2027-07-19','2027-08-11','2027-09-20','2027-09-23',
    '2027-10-11','2027-11-03','2027-11-23'
  ]
};

const TZ = 'Asia/Tokyo';
const RSV = '予約';
const BLK = '受付停止';
const RSV_HEADERS = ['予約番号','受付日時','来店日','時間','人数','プラン','生ビール飲み放題','目的','お名前','電話','メール','ご要望','ステータス','店メモ','リマインド送信'];
const BLK_HEADERS = ['日付','時間（ALL=終日休業）','メモ'];
const STATUSES = ['予約','相談中','確定','キャンセル','来店済','無断キャンセル'];
const ACTIVE = ['予約','確定','来店済'];   // 席の計算に含めるステータス
const C = { ID:0, CREATED:1, DATE:2, TIME:3, PEOPLE:4, PLAN:5, BEER:6, PURPOSE:7, NAME:8, TEL:9, EMAIL:10, NOTE:11, STATUS:12, MEMO:13, REMIND:14 };

/* ---------- シート ---------- */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name, headers) {
  let sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#2b2118').setFontColor('#ffffff');
    sh.getRange(2, 1, 2000, headers.length).setNumberFormat('@');
    if (name === RSV) {
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build();
      sh.getRange(2, C.STATUS + 1, 2000, 1).setDataValidation(rule);
    }
  }
  return sh;
}
const rsvSheet_ = () => sheet_(RSV, RSV_HEADERS);
const blkSheet_ = () => sheet_(BLK, BLK_HEADERS);

const str_ = (v, fmt) => v instanceof Date ? Utilities.formatDate(v, TZ, fmt) : String(v);
function rows_() {
  return rsvSheet_().getDataRange().getValues().slice(1).map((r, i) => ({
    row: i + 2, id: String(r[C.ID]), created: str_(r[C.CREATED], 'yyyy-MM-dd HH:mm'),
    date: str_(r[C.DATE], 'yyyy-MM-dd'), time: str_(r[C.TIME], 'HH:mm'), people: Number(r[C.PEOPLE]),
    plan: String(r[C.PLAN]), beer: String(r[C.BEER]), purpose: String(r[C.PURPOSE]), name: String(r[C.NAME]),
    tel: String(r[C.TEL]), email: String(r[C.EMAIL]), note: String(r[C.NOTE]), status: String(r[C.STATUS]),
    memo: String(r[C.MEMO]), remind: String(r[C.REMIND])
  })).filter(r => r.id);
}
function blocks_() {
  return blkSheet_().getDataRange().getValues().slice(1)
    .map(r => ({ date: str_(r[0], 'yyyy-MM-dd'), time: str_(r[1], 'HH:mm') || 'ALL', memo: String(r[2] || '') }))
    .filter(b => b.date);
}

/* ---------- 空席計算 ---------- */
const toMin_ = t => { const p = t.split(':').map(Number); return p[0] * 60 + p[1]; };
function booked_(date) {
  const out = {};
  rows_().forEach(r => { if (r.date === date && ACTIVE.indexOf(r.status) >= 0) out[r.time] = (out[r.time] || 0) + r.people; });
  return out;
}
function peak_(booked, time) {
  const s0 = toMin_(time), e0 = s0 + CFG.STAY_HOURS * 60; let peak = 0;
  for (let t = s0; t < e0; t += 15) {
    let sum = 0;
    for (const bt in booked) { const s = toMin_(bt); if (t >= s && t < s + CFG.STAY_HOURS * 60) sum += booked[bt]; }
    peak = Math.max(peak, sum);
  }
  return peak;
}
function dayInfo_(date) {
  const bl = blocks_().filter(b => b.date === date);
  return { closed: bl.some(b => b.time === 'ALL' || b.time === ''), blocked: bl.map(b => b.time) };
}

/* ---------- 入口 ---------- */
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function doGet(e) {
  try {
    const p = e.parameter || {};
    if (p.action === 'availability') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) return json_({ ok: false, error: '日付が不正です' });
      const info = dayInfo_(p.date);
      return json_({ ok: true, booked: booked_(p.date), blocked: info.blocked, closed: info.closed });
    }
    if (p.action === 'closures') {
      const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
      return json_({ ok: true, closed: blocks_().filter(b => b.time === 'ALL' && b.date >= today).map(b => b.date) });
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '不正なリクエストです' }); }
  if (p.action && p.action !== 'reserve') return admin_(p);
  return reserve_(p);
}

/* ---------- 予約受付 ---------- */
function reserve_(p) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: '混み合っています。少し待ってから再度お試しください' });
  try {
    const err = validate_(p);
    if (err) return json_({ ok: false, error: err });

    const info = dayInfo_(p.date);
    if (info.closed) return json_({ ok: false, error: 'その日は臨時休業です' });
    if (info.blocked.indexOf(p.time) >= 0) return json_({ ok: false, error: 'その時間は受付を停止しています' });

    const consult = p.people >= CFG.LARGE_GROUP || p.plan === 'shabu';
    if (p.people < CFG.LARGE_GROUP) {
      const left = CFG.CAPACITY - peak_(booked_(p.date), p.time);
      if (left < p.people) return json_({ ok: false, error: '申し訳ありません。その時間は満席になりました' });
    }

    const id = 'EN' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
    const status = consult ? '相談中' : '予約';
    rsvSheet_().appendRow([
      id, Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), p.date, p.time, p.people,
      planLabel_(p.plan), p.plan === 'course' && p.beerUp ? 'あり' : '', p.purpose || '',
      p.name, p.tel, p.email, p.note || '', status, '', ''
    ]);
    try { notify_(id, p, consult); } catch (mailErr) { console.error(mailErr); }
    return json_({ ok: true, id: id });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'サーバーエラーが発生しました' });
  } finally {
    lock.releaseLock();
  }
}

function planLabel_(plan) {
  return plan === 'course' ? '宴会コース' : plan === 'shabu' ? 'しゃぶしゃぶ・特製鍋' : '席のみ';
}

function validate_(p) {
  if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !/^\d{2}:\d{2}$/.test(p.time)) return '日時が不正です';
  p.people = Number(p.people);
  if (!(p.people >= 1 && p.people <= CFG.MAX_PEOPLE)) return '人数が不正です';
  if (['course','shabu','seat'].indexOf(p.plan) < 0) return 'プランが不正です';
  p.name = String(p.name || '').trim(); p.tel = String(p.tel || '').trim(); p.email = String(p.email || '').trim();
  p.note = String(p.note || '').slice(0, 500); p.purpose = String(p.purpose || '').slice(0, 30);
  p.beerUp = p.beerUp === true;
  if (!p.name || p.name.length > 50) return 'お名前を確認してください';
  if (!/^[0-9\-+() ]{10,15}$/.test(p.tel)) return '電話番号を確認してください';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) return 'メールアドレスを確認してください';

  const d = new Date(p.date + 'T00:00:00+09:00');
  const dow = Number(Utilities.formatDate(d, TZ, 'u')) % 7;
  const slots = CFG.SLOTS_BY_DOW[dow];
  if (!slots || CFG.HOLIDAYS.indexOf(p.date) >= 0) return 'その日は定休日です';
  if (slots.indexOf(p.time) < 0) return 'その時間は受付していません';
  const visit = new Date(p.date + 'T' + p.time + ':00+09:00'), now = new Date();
  if ((visit - now) / 60000 < CFG.SAME_DAY_CUTOFF_MIN) return 'ネット予約の受付時間を過ぎています';
  if ((visit - now) / 86400000 > CFG.MAX_DAYS_AHEAD + 1) return 'まだ予約を受け付けていない日付です';
  return null;
}

/* ---------- メール ---------- */
function whenText_(date, time) {
  const d = new Date(date + 'T00:00:00+09:00');
  return Utilities.formatDate(d, TZ, 'M月d日') + '（' + '日月火水木金土'[Number(Utilities.formatDate(d, TZ, 'u')) % 7] + '） ' + time;
}
function detail_(id, r) {
  let plan = planLabel_(r.plan);
  if (r.plan === 'course') {
    const unit = CFG.COURSE_PRICE + (r.beerUp ? CFG.BEER_UP_PRICE : 0);
    plan += (r.beerUp ? '（生ビール飲み放題）' : '') + '　' + (unit * r.people).toLocaleString() + '円';
  }
  return '予約番号：' + id + '\n日時：' + whenText_(r.date, r.time) + '\n人数：' + r.people + '名\nプラン：' + plan +
    '\n目的：' + (r.purpose || '—') + '\nお名前：' + r.name + ' 様\n電話：' + r.tel + '\nメール：' + r.email + '\nご要望：' + (r.note || 'なし');
}
function notify_(id, p, consult) {
  const when = whenText_(p.date, p.time), body = detail_(id, p);
  MailApp.sendEmail({
    to: CFG.SHOP_EMAIL,
    subject: (consult ? '【要連絡・相談】' : '【新規予約】') + when + ' ' + p.people + '名 ' + p.name + '様',
    body: (consult ? '※お客様へ折り返しの連絡が必要です\n\n' : '') + body + '\n\n予約一覧：' + ss_().getUrl(),
    replyTo: p.email
  });
  const head = consult
    ? p.name + ' 様\n\nお問い合わせありがとうございます。内容を確認のうえ、お店から折り返しご連絡します。\n（この時点ではまだご予約は確定していません）\n\n'
    : p.name + ' 様\n\nご予約ありがとうございます。以下の内容で承りました。\n\n';
  MailApp.sendEmail({
    to: p.email,
    subject: '【' + CFG.SHOP_NAME + '】' + (consult ? 'ご相談を受け付けました' : 'ご予約確認') + '（' + when + '）',
    body: head + body + footer_(),
    name: CFG.SHOP_NAME, replyTo: CFG.SHOP_EMAIL
  });
}
function footer_() {
  return '\n\nキャンセル・変更はお電話でお願いします：' + CFG.SHOP_TEL +
    '\n※全席喫煙可のお店です\n\n――――――――――\n' + CFG.SHOP_NAME + '\n' + CFG.SHOP_ADDRESS + '\n朝霞駅 徒歩10分／店舗裏に駐車場1〜3番あり\nTEL ' + CFG.SHOP_TEL;
}

/** 毎日17時台に実行：翌日来店のお客様へリマインド */
function sendReminders() {
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), TZ, 'yyyy-MM-dd');
  const sh = rsvSheet_();
  rows_().forEach(r => {
    if (r.date !== tomorrow || r.remind || ['予約','確定'].indexOf(r.status) < 0 || !r.email) return;
    MailApp.sendEmail({
      to: r.email,
      subject: '【' + CFG.SHOP_NAME + '】明日のご来店をお待ちしています（' + whenText_(r.date, r.time) + '）',
      body: r.name + ' 様\n\n明日のご予約のご案内です。\n\n予約番号：' + r.id + '\n日時：' + whenText_(r.date, r.time) +
        '\n人数：' + r.people + '名\nプラン：' + r.plan + footer_(),
      name: CFG.SHOP_NAME, replyTo: CFG.SHOP_EMAIL
    });
    sh.getRange(r.row, C.REMIND + 1).setValue(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
  });
}

/* ---------- 店舗用管理API ---------- */
function admin_(p) {
  const key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key || p.key !== key) return json_({ ok: false, error: '管理パスワードが違います' });
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    if (p.action === 'list') {
      const from = p.from || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), to = p.to || '9999-12-31';
      const list = rows_().filter(r => r.date >= from && r.date <= to)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
        .map(r => { delete r.row; return r; });
      return json_({ ok: true, list: list, blocks: blocks_().filter(b => b.date >= from), statuses: STATUSES, capacity: CFG.CAPACITY });
    }
    if (p.action === 'update') {
      const r = rows_().find(x => x.id === p.id);
      if (!r) return json_({ ok: false, error: '予約が見つかりません' });
      const sh = rsvSheet_();
      if (p.status) {
        if (STATUSES.indexOf(p.status) < 0) return json_({ ok: false, error: 'ステータスが不正です' });
        sh.getRange(r.row, C.STATUS + 1).setValue(p.status);
      }
      if (typeof p.memo === 'string') sh.getRange(r.row, C.MEMO + 1).setValue(p.memo.slice(0, 500));
      return json_({ ok: true });
    }
    if (p.action === 'block') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) return json_({ ok: false, error: '日付が不正です' });
      const t = p.time === 'ALL' || !p.time ? 'ALL' : p.time;
      blkSheet_().appendRow([p.date, t, String(p.memo || '').slice(0, 100)]);
      return json_({ ok: true });
    }
    if (p.action === 'unblock') {
      const sh = blkSheet_(), vals = sh.getDataRange().getValues();
      for (let i = vals.length - 1; i >= 1; i--) {
        if (str_(vals[i][0], 'yyyy-MM-dd') === p.date && (str_(vals[i][1], 'HH:mm') || 'ALL') === p.time) sh.deleteRow(i + 1);
      }
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 初期設定（最初に一度だけ実行） ---------- */
function setup() {
  rsvSheet_(); blkSheet_();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) {
    props.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 12));
  }
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendReminders').timeBased().everyDays(1).atHour(17).inTimezone(TZ).create();
  const sh = ss_().getSheetByName('シート1'); if (sh && sh.getLastRow() === 0) ss_().deleteSheet(sh);
  Logger.log('セットアップ完了。管理パスワード：' + props.getProperty('ADMIN_KEY'));
}
