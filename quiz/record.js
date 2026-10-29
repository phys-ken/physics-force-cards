/**
 * record.js — 回答記録（QR①）と照合コード（QR②）の作成・照合
 * 生徒用の app.js と、先生用の verify.js の両方が使う。ルールを変えるときは RECORD_VERSION を上げる。
 *
 * QR① 記録データ（人が読める行の並び）
 *   FORCE-CARD-QUIZ RECORD v1
 *   id=記録ID / name=ニックネーム / course=コース / start=開始 / end=終了 / score=得点 / limit=制限時間
 *   q01=問題ID sel=選んだ番号(時間切れは -) ans=正解番号 ok|ng|timeout 秒数
 *   salt=ソルト
 *   rule=照合のしかた（説明文）
 *
 * QR② 照合コード
 *   FORCE-CARD-QUIZ CHECK v1
 *   id=記録ID（QR①と同じ）
 *   sha256=SHA-256( ソルト + 改行 + QR①の1行目から最後の q 行まで（改行区切り） ) の16進64文字
 */
var RECORD_VERSION = 'v1';
var RECORD_SALT = 'hosei-gh-physics-force-card-2026';
var RECORD_HEAD = 'FORCE-CARD-QUIZ RECORD ' + RECORD_VERSION;
var CHECK_HEAD = 'FORCE-CARD-QUIZ CHECK ' + RECORD_VERSION;
var RECORD_RULE = 'rule=QR2 sha256 = SHA-256(salt + LF + lines 1..last q of this QR); QR2 id = this id';

var recordLib = {
  pad2: function(n) {
    return n < 10 ? '0' + n : String(n);
  },

  formatLocalIso: function(d) {
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var abs = Math.abs(off);
    return (
      d.getFullYear() + '-' + this.pad2(d.getMonth() + 1) + '-' + this.pad2(d.getDate()) +
      'T' + this.pad2(d.getHours()) + ':' + this.pad2(d.getMinutes()) + ':' + this.pad2(d.getSeconds()) +
      sign + this.pad2(Math.floor(abs / 60)) + ':' + this.pad2(abs % 60)
    );
  },

  newRecordId: function() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    var id = '';
    for (var i = 0; i < buf.length; i++) id += chars[buf[i] % chars.length];
    return id;
  },

  /**
   * rec = { id, name, courseId, courseTitle, start(Date), end(Date), limitSec,
   *         items: [{ qid, selectedIndex(0=時間切れ), correctIndex, isCorrect, timedOut, elapsedSec }] }
   * 戻り値: ハッシュ対象の本文（salt 行より前の行）
   */
  buildBody: function(rec) {
    var correct = rec.items.filter(function(it) { return it.isCorrect; }).length;
    var lines = [
      RECORD_HEAD,
      'id=' + rec.id,
      'name=' + String(rec.name).replace(/[\r\n]/g, ' '),
      'course=' + rec.courseId + ' ' + rec.courseTitle,
      'start=' + this.formatLocalIso(rec.start),
      'end=' + this.formatLocalIso(rec.end),
      'score=' + correct + '/' + rec.items.length,
      'limit=' + rec.limitSec + 's'
    ];
    for (var i = 0; i < rec.items.length; i++) {
      var it = rec.items[i];
      var verdict = it.timedOut ? 'timeout' : (it.isCorrect ? 'ok' : 'ng');
      lines.push(
        'q' + this.pad2(i + 1) + '=' + it.qid +
        ' sel=' + (it.timedOut ? '-' : it.selectedIndex) +
        ' ans=' + it.correctIndex +
        ' ' + verdict +
        ' ' + Number(it.elapsedSec).toFixed(1) + 's'
      );
    }
    return lines.join('\n');
  },

  buildRecordText: function(body) {
    return body + '\nsalt=' + RECORD_SALT + '\n' + RECORD_RULE;
  },

  sha256Hex: function(text) {
    var bytes = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', bytes).then(function(buf) {
      var arr = new Uint8Array(buf);
      var hex = '';
      for (var i = 0; i < arr.length; i++) hex += (arr[i] < 16 ? '0' : '') + arr[i].toString(16);
      return hex;
    });
  },

  /** 記録本文から QR① と QR② の文字列を作る */
  buildQrTexts: function(rec) {
    var body = this.buildBody(rec);
    var recordText = this.buildRecordText(body);
    return this.sha256Hex(RECORD_SALT + '\n' + body).then(function(hex) {
      return {
        recordText: recordText,
        checkText: CHECK_HEAD + '\nid=' + rec.id + '\nsha256=' + hex,
        sha256: hex
      };
    });
  },

  /** QR① の文字列を読み解く（判定はしない） */
  parseRecordText: function(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var out = { head: lines[0] || '', fields: {}, items: [], bodyLines: [], saltLine: '' };
    var saltIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('salt=') === 0) { saltIdx = i; break; }
    }
    out.bodyLines = saltIdx >= 0 ? lines.slice(0, saltIdx) : lines.slice();
    out.saltLine = saltIdx >= 0 ? lines[saltIdx] : '';
    for (var j = 1; j < out.bodyLines.length; j++) {
      var line = out.bodyLines[j];
      var eq = line.indexOf('=');
      if (eq < 0) continue;
      var key = line.slice(0, eq);
      var val = line.slice(eq + 1);
      if (/^q\d+$/.test(key)) {
        var parts = val.split(' ');
        out.items.push({ key: key, qid: parts[0], verdict: parts[3] || '', raw: val });
      } else {
        out.fields[key] = val;
      }
    }
    return out;
  },

  parseCheckText: function(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var out = { head: lines[0] || '', id: '', sha256: '' };
    for (var i = 1; i < lines.length; i++) {
      if (lines[i].indexOf('id=') === 0) out.id = lines[i].slice(3);
      if (lines[i].indexOf('sha256=') === 0) out.sha256 = lines[i].slice(7).toLowerCase();
    }
    return out;
  },

  /**
   * QR① と QR② を照合する。戻り値 Promise<{ ok, reasons[], record, check }>
   * ok=true は「このアプリが作った記録で、QR①の中身が書き換えられていない」ことを示す。
   */
  verifyPair: function(recordText, checkText) {
    var rec = this.parseRecordText(recordText);
    var chk = this.parseCheckText(checkText);
    var reasons = [];
    if (rec.head !== RECORD_HEAD) reasons.push('QR①の1行目が「' + RECORD_HEAD + '」ではない');
    if (chk.head !== CHECK_HEAD) reasons.push('QR②の1行目が「' + CHECK_HEAD + '」ではない');
    if (rec.saltLine !== 'salt=' + RECORD_SALT) reasons.push('QR①のソルトが正しくない');
    if (!rec.fields.id || rec.fields.id !== chk.id) reasons.push('QR①とQR②の記録IDが一致しない');
    var okCount = rec.items.filter(function(it) { return it.verdict === 'ok'; }).length;
    if (rec.fields.score !== okCount + '/' + rec.items.length) reasons.push('score の行と q 行の正解数が合わない');
    var body = rec.bodyLines.join('\n');
    return this.sha256Hex(RECORD_SALT + '\n' + body).then(function(hex) {
      if (hex !== chk.sha256) reasons.push('ハッシュが一致しない（QR①の中身が書き換えられたか、QR②が別の記録のもの）');
      return { ok: reasons.length === 0, reasons: reasons, record: rec, check: chk, sha256: hex };
    });
  }
};
