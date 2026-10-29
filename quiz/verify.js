/**
 * verify.js — 提出された回答記録画像の照合（先生用）
 * 1枚の画像から2つのQRを読む：1つ読めたらその場所を白く塗りつぶして、もう1度読む。
 */
var MAX_SCAN_WIDTH = 2000;

var verifier = {
  loadImage: function(file) {
    return new Promise(function(resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function() { resolve(img); };
      img.onerror = function() { reject(new Error('画像を開けない')); };
      img.src = url;
    });
  },

  /** 画像から最大 maxCount 個のQR文字列を読む */
  scanQrs: function(img, maxCount) {
    var scale = Math.min(1, MAX_SCAN_WIDTH / img.naturalWidth);
    var w = Math.round(img.naturalWidth * scale);
    var h = Math.round(img.naturalHeight * scale);
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    var found = [];
    for (var n = 0; n < maxCount; n++) {
      var data = ctx.getImageData(0, 0, w, h);
      var res = jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (!res) break;
      found.push(res.data);
      this.maskLocation(ctx, res.location);
    }
    return found;
  },

  /** 読めたQRの範囲（少し広げた四角形）を白で塗る */
  maskLocation: function(ctx, loc) {
    var pts = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
    var cx = 0;
    var cy = 0;
    pts.forEach(function(p) { cx += p.x / 4; cy += p.y / 4; });
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    pts.forEach(function(p, i) {
      var x = cx + (p.x - cx) * 1.15;
      var y = cy + (p.y - cy) * 1.15;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  },

  pickPair: function(texts) {
    var recordText = '';
    var checkText = '';
    texts.forEach(function(t) {
      if (t.indexOf(RECORD_HEAD) === 0) recordText = t;
      else if (t.indexOf(CHECK_HEAD) === 0) checkText = t;
    });
    return { recordText: recordText, checkText: checkText };
  },

  checkFile: function(file) {
    var self = this;
    return this.loadImage(file).then(function(img) {
      var texts = self.scanQrs(img, 4);
      var pair = self.pickPair(texts);
      if (!pair.recordText || !pair.checkText) {
        return {
          file: file.name,
          ok: false,
          readable: false,
          reasons: ['QRを2つ読み取れない（読めた数: ' + texts.length + '）。画像が切れていないか、ぼやけていないか確認'],
          record: null
        };
      }
      return recordLib.verifyPair(pair.recordText, pair.checkText).then(function(v) {
        v.file = file.name;
        v.readable = true;
        return v;
      });
    }).catch(function(err) {
      return { file: file.name, ok: false, readable: false, reasons: [String(err.message || err)], record: null };
    });
  },

  esc: function(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  renderTable: function(results) {
    var self = this;
    var idCount = {};
    results.forEach(function(r) {
      if (r.record && r.record.fields.id) idCount[r.record.fields.id] = (idCount[r.record.fields.id] || 0) + 1;
    });
    var rows = results.map(function(r) {
      var f = (r.record && r.record.fields) || {};
      var notes = r.reasons.slice();
      var dup = f.id && idCount[f.id] > 1;
      if (dup) notes.push('同じ記録IDの画像が ' + idCount[f.id] + ' 枚ある（使い回しの疑い）');
      var verdict = !r.readable
        ? '<span class="warn">読めない</span>'
        : (r.ok ? (dup ? '<span class="warn">本物・重複</span>' : '<span class="ok">本物</span>') : '<span class="ng">不一致</span>');
      var when = f.start ? f.start.replace('T', ' ').slice(0, 19) : '';
      return '<tr>' +
        '<td>' + self.esc(r.file) + '</td>' +
        '<td>' + verdict + '</td>' +
        '<td>' + self.esc(f.name) + '</td>' +
        '<td>' + self.esc(f.course) + '</td>' +
        '<td>' + self.esc(f.score) + '</td>' +
        '<td>' + self.esc(when) + '</td>' +
        '<td>' + self.esc(f.id) + '</td>' +
        '<td>' + self.esc(notes.join(' / ')) + '</td>' +
      '</tr>';
    });
    var table = document.getElementById('result-table');
    table.querySelector('tbody').innerHTML = rows.join('');
    table.hidden = false;
    var okN = results.filter(function(r) { return r.ok; }).length;
    document.getElementById('summary').textContent =
      results.length + ' 枚を確認：本物 ' + okN + ' 枚／それ以外 ' + (results.length - okN) + ' 枚';
  },

  onFiles: function(fileList) {
    var self = this;
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    document.getElementById('summary').textContent = files.length + ' 枚を読み取り中…';
    var results = [];
    files.reduce(function(p, file) {
      return p.then(function() {
        return self.checkFile(file).then(function(r) { results.push(r); });
      });
    }, Promise.resolve()).then(function() {
      self.renderTable(results);
    });
  },

  onPaste: function() {
    var recordText = document.getElementById('paste-record').value.trim();
    var checkText = document.getElementById('paste-check').value.trim();
    recordLib.verifyPair(recordText, checkText).then(function(v) {
      var out = document.getElementById('paste-result');
      var f = v.record.fields;
      out.textContent = (v.ok ? '本物' : '不一致：' + v.reasons.join(' / ')) +
        '\nニックネーム: ' + (f.name || '') +
        '\nコース: ' + (f.course || '') +
        '\n得点: ' + (f.score || '') +
        '\n開始: ' + (f.start || '') +
        '\n記録ID: ' + (f.id || '');
      out.hidden = false;
    });
  }
};

document.getElementById('file-input').addEventListener('change', function(e) {
  verifier.onFiles(e.target.files);
});
document.getElementById('paste-verify-btn').addEventListener('click', function() {
  verifier.onPaste();
});
