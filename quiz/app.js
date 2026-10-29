/**
 * app.js — 力のカードゲーム 演習（GitHub Pages 版）
 * GAS 版（index.html）と同じ問題・同じ出題画面を、サーバーなしで動かす。
 * GAS 版との違い：ニックネームはこの端末にだけ保存／記録は送信しない／1問20秒の制限時間／結果画面で回答記録画像（QR付き）を作る。
 * 問題の図・選択肢の描画（getPromptCardsForQuestion〜renderCurrentQuestion）は GAS 版と同じ作りにそろえる。
 */
var TIME_LIMIT_SEC = 20;
var QUESTIONS_PER_ROUND = 10;

var STAGE_DEFS = [
  { id: 'simple_10', code: '入門', title: '基本コース', bankKey: 'simple_10', isTutorial: true },
  { id: 'lv1a_intro_61', code: 'Lv.1', title: '力の名称', bankKey: 'lv1a_intro_61' },
  { id: 'lv2_equilibrium_40', code: 'Lv.2', title: '力のつりあい', bankKey: 'lv2_equilibrium_40' },
  { id: 'lv3_reaction_60', code: 'Lv.3', title: '作用・反作用', bankKey: 'lv3_reaction_60' },
  { id: 'lv4_synthesis_50', code: 'Lv.4', title: '2力の関係', bankKey: 'lv4_synthesis_50' },
  { id: 'random_all', code: '総合', title: '全範囲ランダム', bankKey: '' }
];

var STORAGE_KEYS = {
  NICKNAME: 'pfc_static_nickname_v1'
};

var app = {
  nickname: '',
  bank: null,
  cardsByNo: {},
  allQuestionsById: {},
  currentQuiz: null,
  timerHandle: null,

  init: function() {
    this.bank = typeof QUESTIONS_BANK !== 'undefined' ? QUESTIONS_BANK : null;
    this.indexQuestionsBank();
    try {
      this.nickname = localStorage.getItem(STORAGE_KEYS.NICKNAME) || '';
    } catch (e) {
      this.nickname = '';
    }
    this.goHome();
  },

  indexQuestionsBank: function() {
    this.cardsByNo = {};
    this.allQuestionsById = {};
    if (!this.bank) return;
    var cards = this.bank.cards || [];
    for (var c = 0; c < cards.length; c++) {
      this.cardsByNo[cards[c].no] = cards[c];
    }
    if (!this.bank.quizzes) return;
    var activeKeys = ['simple_10', 'lv1a_intro_61', 'lv2_equilibrium_40', 'lv3_reaction_60', 'lv4_synthesis_50'];
    for (var i = 0; i < activeKeys.length; i++) {
      var list = this.bank.quizzes[activeKeys[i]] || [];
      for (var j = 0; j < list.length; j++) {
        this.allQuestionsById[list[j].qid] = list[j];
      }
    }
  },

  /** カード画像はこのリポジトリの直下にある（quiz/ から見て ../） */
  getCardImageUrl: function(cardNo) {
    var card = this.cardsByNo[Number(cardNo)];
    if (!card || !card.flat_fname) return '';
    return '../' + encodeURIComponent(card.flat_fname);
  },

  /* ── ニックネーム ── */
  submitNickname: function(ev) {
    if (ev) ev.preventDefault();
    var val = String(document.getElementById('welcome-nickname-input').value || '').trim();
    if (!val) return;
    this.nickname = val.slice(0, 20);
    try {
      localStorage.setItem(STORAGE_KEYS.NICKNAME, this.nickname);
    } catch (e) {}
    this.goHome();
  },

  editNickname: function() {
    document.getElementById('welcome-nickname-input').value = this.nickname;
    this.showView('welcome');
  },

  /* ── ホーム ── */
  renderHome: function() {
    document.getElementById('home-nickname').textContent = this.nickname;
    var rowsHtml = '';
    for (var i = 0; i < STAGE_DEFS.length; i++) {
      var st = STAGE_DEFS[i];
      var count = this.getStagePool(st.id).length;
      rowsHtml +=
        '<div class="course-row">' +
          '<div class="course-info">' +
            '<div class="course-header-line">' +
              '<span class="course-code">' + st.code + '</span>' +
              '<span class="course-title">' + st.title + '</span>' +
            '</div>' +
            '<div class="course-progress-wrap"><span>' + (st.isTutorial ? '固定の10問' : '全' + count + '問から10問') + '</span></div>' +
          '</div>' +
          '<div class="course-actions">' +
            '<button class="btn btn-primary" onclick="app.startStage(\'' + st.id + '\')">開始</button>' +
          '</div>' +
        '</div>';
    }
    document.getElementById('all-stages-container').innerHTML = rowsHtml;
  },

  getStagePool: function(modeId) {
    if (!this.bank || !this.bank.quizzes) return [];
    if (modeId === 'random_all') {
      var all = [];
      var keys = ['lv1a_intro_61', 'lv2_equilibrium_40', 'lv3_reaction_60', 'lv4_synthesis_50'];
      for (var i = 0; i < keys.length; i++) all = all.concat(this.bank.quizzes[keys[i]] || []);
      return all;
    }
    return (this.bank.quizzes[modeId] || []).slice();
  },

  shuffleArray: function(arr) {
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  },

  startStage: function(modeId) {
    var questions = modeId === 'simple_10'
      ? this.getStagePool('simple_10').slice(0, QUESTIONS_PER_ROUND)
      : this.shuffleArray(this.getStagePool(modeId)).slice(0, QUESTIONS_PER_ROUND);
    if (questions.length === 0) return;

    this.currentQuiz = {
      recordId: recordLib.newRecordId(),
      modeId: modeId,
      questions: questions,
      totalQuestions: questions.length,
      currentIndex: 0,
      correctCount: 0,
      startedAt: new Date(),
      questionStartMs: Date.now(),
      answersHistory: [],
      answeredCurrent: false
    };
    this.showView('quiz');
    this.renderCurrentQuestion();
  },

  /**
   * 問題文中に「〇〇が△△から受ける力」と基準の力が指定されており、
   * その力と【力のつりあい】【作用・反作用】の関係にある力を問う問題について、
   * 問題文の基準力を表すカード配列（1枚）を返す。
   * ※「〜を表している図はどれか」のように言葉で表された矢印そのものを探す問題では空配列を返す。
   */
  getPromptCardsForQuestion: function(q) {
    if (!q || !q.question_text || !this.bank || !this.bank.cards) return [];
    var qText = String(q.question_text);
    if (qText.indexOf('を表している図はどれか') !== -1) {
      return [];
    }
    var re = /「([^」]+)」/g;
    var matches = [];
    var m;
    while ((m = re.exec(qText)) !== null) {
      if (m[1] && m[1] !== '力A' && m[1] !== '力B') {
        matches.push(m[1]);
      }
    }
    if (matches.length === 0) return [];

    var cards = this.bank.cards || [];
    var setCards = [];
    for (var i = 0; i < cards.length; i++) {
      if (q.set_name && String(q.set_name).indexOf(cards[i].set_name) === 0) {
        setCards.push(cards[i]);
      }
    }

    var result = [];
    for (var j = 0; j < matches.length; j++) {
      var targetLabel = matches[j];
      var found = null;
      for (var k = 0; k < setCards.length; k++) {
        var c = setCards[k];
        if (c.quiz_label === targetLabel || targetLabel.indexOf(c.main_force) === 0) {
          found = c;
          break;
        }
      }
      if (found) {
        result.push(found);
      }
    }
    return result;
  },

  buildPromptRefFiguresHtml: function(q) {
    var refCards = this.getPromptCardsForQuestion(q);
    if (!refCards || refCards.length === 0) return '';
    if (refCards.length === 1) {
      var c1 = refCards[0];
      return (
        '<div class="prompt-ref-wrap">' +
          '<div class="prompt-ref-single">' +
            '<div class="pair-figure-head">' + this.escapeHtml(c1.main_force) + '</div>' +
            '<div class="pair-figure-body"><img src="' + this.getCardImageUrl(c1.no) + '" alt="' + this.escapeHtml(c1.main_force) + '" /></div>' +
          '</div>' +
        '</div>'
      );
    }
    var gridHtml = '<div class="prompt-ref-wrap"><div class="pair-figure-grid" style="margin-bottom:0;">';
    for (var i = 0; i < refCards.length; i++) {
      var rc = refCards[i];
      gridHtml +=
        '<div class="pair-figure-cell">' +
          '<div class="pair-figure-head">' + this.escapeHtml(rc.main_force) + '</div>' +
          '<div class="pair-figure-body"><img src="' + this.getCardImageUrl(rc.no) + '" alt="' + this.escapeHtml(rc.main_force) + '" /></div>' +
        '</div>';
    }
    gridHtml += '</div></div>';
    return gridHtml;
  },

  renderCurrentQuestion: function() {
    var qz = this.currentQuiz;
    if (!qz) return;
    var q = qz.questions[qz.currentIndex];
    qz.answeredCurrent = false;
    qz.questionStartMs = Date.now();

    document.getElementById('quiz-progress-label').textContent =
      (qz.currentIndex + 1) + ' / ' + qz.totalQuestions;

    var cleanText = String(q.question_text || '').replace(/^【[^】]+】\s*/, '').trim();
    document.getElementById('quiz-question-text').textContent = cleanText;

    document.getElementById('quiz-feedback-banner').classList.add('hidden');

    var promptFigArea = document.getElementById('quiz-prompt-figure-area');
    var choicesArea = document.getElementById('quiz-choices-container');
    var circleNums = ['①', '②', '③', '④'];

    this.startTimer();

    // パターン1: 選択肢それぞれが個別カード画像を持つ問題 (choice_card_nos がある問題: 3択または4択)
    if (Array.isArray(q.choice_card_nos) && q.choice_card_nos.length > 0) {
      promptFigArea.innerHTML = this.buildPromptRefFiguresHtml(q);
      choicesArea.className = 'choices-image-grid';

      var imgGridHtml = '';
      for (var i = 0; i < q.choice_card_nos.length; i++) {
        var idx = i + 1;
        var imgUrl = this.getCardImageUrl(q.choice_card_nos[i]);
        imgGridHtml +=
          '<button type="button" class="choice-card-btn" id="choice-btn-' + idx + '" onclick="app.selectOption(' + idx + ')">' +
            '<div class="choice-card-head">' +
              '<span>' + circleNums[i] + '</span>' +
            '</div>' +
            '<div class="choice-card-body">' +
              '<img src="' + imgUrl + '" alt="選択肢' + circleNums[i] + 'の図" />' +
            '</div>' +
          '</button>';
      }
      choicesArea.innerHTML = imgGridHtml;
      return;
    }

    // パターン2: 力Aと力Bの2力関係判定 (pair_card_nos = [noA, noB])
    if (Array.isArray(q.pair_card_nos) && q.pair_card_nos.length === 2) {
      var urlA = this.getCardImageUrl(q.pair_card_nos[0]);
      var urlB = this.getCardImageUrl(q.pair_card_nos[1]);
      promptFigArea.innerHTML =
        '<div class="pair-figure-grid">' +
          '<div class="pair-figure-cell">' +
            '<div class="pair-figure-head">力A</div>' +
            '<div class="pair-figure-body"><img src="' + urlA + '" alt="力Aの図" /></div>' +
          '</div>' +
          '<div class="pair-figure-cell">' +
            '<div class="pair-figure-head">力B</div>' +
            '<div class="pair-figure-body"><img src="' + urlB + '" alt="力Bの図" /></div>' +
          '</div>' +
        '</div>';
    } else {
      // パターン3: 1枚の個別カード画像を見て力の名称を選ぶ問題 (Lv.1)
      var singleUrl = this.getCardImageUrl(q.card_no);
      promptFigArea.innerHTML =
        '<div class="single-figure-wrap">' +
          '<img src="' + singleUrl + '" alt="問題図" />' +
        '</div>';
    }

    // テキスト選択肢の描画
    choicesArea.className = 'choices-text-list';
    var textHtml = '';
    for (var j = 0; j < (q.options || []).length; j++) {
      var optText = String(q.options[j] || '').trim();
      if (!optText) continue;
      var optIdx = j + 1;
      textHtml +=
        '<button type="button" class="choice-text-btn" id="choice-btn-' + optIdx + '" onclick="app.selectOption(' + optIdx + ')">' +
          '<span class="choice-index-box">' + (circleNums[j] || optIdx) + '</span>' +
          '<span>' + this.escapeHtml(optText) + '</span>' +
        '</button>';
    }
    choicesArea.innerHTML = textHtml;
  },

  /* ── 制限時間（1問20秒） ── */
  startTimer: function() {
    this.stopTimer();
    var self = this;
    var fill = document.getElementById('quiz-timer-fill');
    var label = document.getElementById('quiz-timer-text');
    var tick = function() {
      var qz = self.currentQuiz;
      if (!qz || qz.answeredCurrent) return;
      var leftMs = TIME_LIMIT_SEC * 1000 - (Date.now() - qz.questionStartMs);
      if (leftMs <= 0) {
        fill.style.width = '0%';
        label.textContent = '0秒';
        self.stopTimer();
        self.answerCurrent(0, true);
        return;
      }
      fill.style.width = (leftMs / (TIME_LIMIT_SEC * 1000)) * 100 + '%';
      fill.className = 'timer-fill' + (leftMs <= 5000 ? ' low' : '');
      label.textContent = Math.ceil(leftMs / 1000) + '秒';
    };
    tick();
    this.timerHandle = setInterval(tick, 100);
  },

  stopTimer: function() {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  },

  selectOption: function(selectedIndex) {
    this.answerCurrent(selectedIndex, false);
  },

  /** selectedIndex=0 かつ timedOut=true は時間切れ（不正解として扱う） */
  answerCurrent: function(selectedIndex, timedOut) {
    var qz = this.currentQuiz;
    if (!qz || qz.answeredCurrent) return;
    qz.answeredCurrent = true;
    this.stopTimer();

    var q = qz.questions[qz.currentIndex];
    var correctIndex = Number(q.correct_answer);
    var isCorrect = !timedOut && selectedIndex === correctIndex;
    var elapsedSec = timedOut
      ? TIME_LIMIT_SEC
      : Math.min(TIME_LIMIT_SEC, Math.round(((Date.now() - qz.questionStartMs) / 1000) * 10) / 10);
    if (isCorrect) qz.correctCount += 1;

    qz.answersHistory.push({
      q: q,
      qid: q.qid,
      selectedIndex: selectedIndex,
      correctIndex: correctIndex,
      isCorrect: isCorrect,
      timedOut: timedOut,
      elapsedSec: elapsedSec
    });

    var allBtns = document.querySelectorAll('#quiz-choices-container button');
    for (var i = 0; i < allBtns.length; i++) {
      allBtns[i].disabled = true;
    }
    var corrBtn = document.getElementById('choice-btn-' + correctIndex);
    if (corrBtn) corrBtn.classList.add('is-correct');
    if (!isCorrect && !timedOut) {
      var selBtn = document.getElementById('choice-btn-' + selectedIndex);
      if (selBtn) selBtn.classList.add('is-wrong');
    }

    var circleNums = ['①', '②', '③', '④'];
    var correctLabel = circleNums[correctIndex - 1] || correctIndex;
    var banner = document.getElementById('quiz-feedback-banner');
    banner.className = 'feedback-bar ' + (isCorrect ? 'correct' : 'wrong');
    document.getElementById('feedback-status-text').textContent = isCorrect
      ? '正解'
      : (timedOut ? '時間切れ（正解：' + correctLabel + '）' : '不正解（正解：' + correctLabel + '）');
    document.getElementById('feedback-explanation-text').textContent = q.explanation || '';
    document.getElementById('next-question-btn').textContent =
      qz.currentIndex + 1 < qz.totalQuestions ? '次へ' : '結果へ';
  },

  nextQuestion: function() {
    var qz = this.currentQuiz;
    if (!qz) return;
    if (qz.currentIndex + 1 < qz.totalQuestions) {
      qz.currentIndex += 1;
      this.renderCurrentQuestion();
    } else {
      this.finishQuiz();
    }
  },

  quitQuiz: function() {
    this.stopTimer();
    this.currentQuiz = null;
    this.goHome();
  },

  finishQuiz: function() {
    var qz = this.currentQuiz;
    if (!qz) return;
    qz.endedAt = new Date();
    this.renderResultScreen();
    this.showView('result');
    this.buildRecordImage();
  },

  getModeTitle: function(modeId) {
    var st = STAGE_DEFS.find(function(s) { return s.id === modeId; });
    return st ? st.code + ' ' + st.title : modeId;
  },

  renderResultScreen: function() {
    var qz = this.currentQuiz;
    document.getElementById('result-badge-area').innerHTML =
      qz.correctCount === qz.totalQuestions ? '<span class="status-tag perfect">満点</span>' : '';
    document.getElementById('result-mode-title').textContent = this.getModeTitle(qz.modeId);
    document.getElementById('result-score-text').textContent = qz.correctCount + ' / ' + qz.totalQuestions;
    document.getElementById('result-actions-area').innerHTML =
      '<button class="btn btn-secondary" onclick="app.startStage(\'' + qz.modeId + '\')">もう1回</button>' +
      '<button class="btn btn-neutral" onclick="app.goHome()">一覧へ戻る</button>';

    var circleNums = ['①', '②', '③', '④'];
    var revHtml = '';
    for (var i = 0; i < qz.answersHistory.length; i++) {
      var item = qz.answersHistory[i];
      var q = item.q;
      var corr = circleNums[item.correctIndex - 1] || item.correctIndex;
      var verdictHtml = item.isCorrect
        ? '正解 (' + corr + ')'
        : (item.timedOut
          ? '時間切れ<div style="font-size:0.72rem;">正:' + corr + '</div>'
          : '不正解<div style="font-size:0.72rem;">選:' + (circleNums[item.selectedIndex - 1] || item.selectedIndex) + ' / 正:' + corr + '</div>');
      revHtml +=
        '<tr>' +
          '<td style="width:72px;font-weight:700;">問' + (i + 1) + '<div style="font-size:0.72rem;color:var(--ink-muted);">' + q.qid + '</div></td>' +
          '<td style="width:90px;font-weight:700;color:' + (item.isCorrect ? 'var(--correct)' : 'var(--wrong)') + ';">' + verdictHtml + '</td>' +
          '<td>' +
            '<div style="font-weight:600;margin-bottom:4px;">' + this.escapeHtml(q.question_text) + '</div>' +
            '<div style="font-size:0.78rem;color:var(--ink-sub);white-space:pre-line;">' + this.escapeHtml(q.explanation || '') + '</div>' +
          '</td>' +
        '</tr>';
    }
    document.getElementById('result-review-list').innerHTML = revHtml;
  },

  /* ── 回答記録画像（提出用） ── */
  buildRecordImage: function() {
    var qz = this.currentQuiz;
    var self = this;
    var img = document.getElementById('record-image');
    img.removeAttribute('src');
    var rec = {
      id: qz.recordId,
      name: this.nickname,
      courseId: qz.modeId,
      courseTitle: this.getModeTitle(qz.modeId),
      start: qz.startedAt,
      end: qz.endedAt,
      limitSec: TIME_LIMIT_SEC,
      items: qz.answersHistory
    };
    recordLib.buildQrTexts(rec).then(function(qr) {
      var url = self.drawRecordCanvas(rec, qr);
      img.src = url;
      var link = document.getElementById('record-download-link');
      link.href = url;
      link.download = '回答記録_' + rec.courseId + '_' + rec.id + '.png';
    });
  },

  drawQr: function(ctx, text, x, y, size) {
    // 誤り訂正は L（目を粗くして、縮小・写真でも読みやすくする）
    var qr = qrcode(0, 'L');
    qr.addData(text, 'Byte');
    qr.make();
    var n = qr.getModuleCount();
    var quiet = 4;
    var cell = Math.floor(size / (n + quiet * 2));
    var real = cell * (n + quiet * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, y, real, real);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell, cell);
      }
    }
    return real;
  },

  drawRecordCanvas: function(rec, qr) {
    var W = 1080;
    var pad = 56;
    var rowH = 54;
    var qrSize = 580;
    var H = 330 + rec.items.length * rowH + 30 + qrSize + 40;
    var canvas = document.getElementById('record-canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    var font = '"BIZ UDPGothic", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", Meiryo, sans-serif';

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#004198';
    ctx.fillRect(0, 0, W, 12);

    ctx.fillStyle = '#1A1A1C';
    ctx.textBaseline = 'top';
    ctx.font = '700 40px ' + font;
    ctx.fillText('力のカードゲーム 回答記録', pad, 44);
    ctx.font = '400 26px ' + font;
    ctx.fillStyle = '#4D5358';
    ctx.fillText('物理基礎｜Web版（1問' + rec.limitSec + '秒）', pad, 98);

    var correct = rec.items.filter(function(it) { return it.isCorrect; }).length;
    var info = [
      ['ニックネーム', rec.name],
      ['コース', rec.courseTitle],
      ['回答日時', recordLib.formatLocalIso(rec.start).replace('T', ' ').slice(0, 19) + ' 〜 ' + recordLib.formatLocalIso(rec.end).slice(11, 19)],
      ['記録ID', rec.id]
    ];
    ctx.font = '400 28px ' + font;
    for (var i = 0; i < info.length; i++) {
      ctx.fillStyle = '#6E767D';
      ctx.fillText(info[i][0], pad, 150 + i * 40);
      ctx.fillStyle = '#1A1A1C';
      ctx.fillText(String(info[i][1]), pad + 190, 150 + i * 40);
    }
    ctx.textAlign = 'right';
    ctx.font = '400 26px ' + font;
    ctx.fillStyle = '#4D5358';
    ctx.fillText('得点', W - pad, 30);
    ctx.font = '700 84px ' + font;
    ctx.fillStyle = correct === rec.items.length ? '#0E6245' : '#1A1A1C';
    ctx.fillText(correct + ' / ' + rec.items.length, W - pad, 60);
    ctx.textAlign = 'left';

    var top = 330;
    ctx.fillStyle = '#1A1A1C';
    ctx.fillRect(pad, top - 6, W - pad * 2, 2);
    ctx.font = '400 26px ' + font;
    for (var k = 0; k < rec.items.length; k++) {
      var it = rec.items[k];
      var y = top + k * rowH + 10;
      ctx.fillStyle = '#1A1A1C';
      ctx.fillText('問' + (k + 1), pad, y);
      ctx.fillText(it.qid, pad + 90, y);
      ctx.fillStyle = '#4D5358';
      var theme = String((it.q && it.q.theme) || '');
      ctx.fillText(theme.length > 16 ? theme.slice(0, 16) + '…' : theme, pad + 270, y);
      ctx.fillStyle = it.isCorrect ? '#0E6245' : '#B91C1C';
      ctx.fillText(it.isCorrect ? '正解' : (it.timedOut ? '時間切れ' : '不正解'), pad + 720, y);
      ctx.fillStyle = '#4D5358';
      ctx.textAlign = 'right';
      ctx.fillText(Number(it.elapsedSec).toFixed(1) + '秒', W - pad, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#D8DCE0';
      ctx.fillRect(pad, top + (k + 1) * rowH - 2, W - pad * 2, 1);
    }

    // 記録データ（中身が多いので大きく）と照合コード（中身が少ないので小さく）を並べる。生徒向けの見出しは付けない
    var qrTop = top + rec.items.length * rowH + 30;
    var checkSize = 360;
    this.drawQr(ctx, qr.recordText, pad - 8, qrTop, qrSize);
    this.drawQr(ctx, qr.checkText, W - pad - checkSize + 8, qrTop, checkSize);
    return canvas.toDataURL('image/png');
  },

  /* ── 画面切り替え ── */
  showView: function(viewName) {
    var views = ['welcome', 'home', 'quiz', 'result'];
    for (var i = 0; i < views.length; i++) {
      var el = document.getElementById('view-' + views[i]);
      if (el) {
        if (views[i] === viewName) el.classList.remove('hidden');
        else el.classList.add('hidden');
      }
    }
    window.scrollTo(0, 0);
  },

  goHome: function() {
    this.stopTimer();
    if (!this.nickname) {
      this.showView('welcome');
      return;
    }
    this.renderHome();
    this.showView('home');
  },

  escapeHtml: function(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

window.addEventListener('DOMContentLoaded', function() {
  app.init();
});
