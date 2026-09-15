/* まなびあつめ — さかなつりモード（canvas の描画と操作）
   出題・正誤判定・ライトナー箱は index.html 側と共通。ここは見た目だけ。
   外から使うのは fishGame.start / stop / say。
   index.html の answer() / afterCorrect() / repeatPrompt() / session を呼ぶので、
   読み込みは index.html の <script> より後（DOM が出来たあと）にすること。 */

/* ================================================================
   さかなつりモード
   選択肢を泳がせるだけで、出題・正誤・ライトナー箱はカードと共通。
   ねこ（ハチワレ）は kanji-fishing の cat.js を移植した。
================================================================ */
const fishGame = (() => {
  const canvas = document.getElementById("fish-canvas");
  const ctx = canvas.getContext("2d");
  const COLORS = ["#4fc3f7", "#81c784", "#ffb74d", "#f06292", "#ba68c8", "#4db6ac", "#ff8a65"];
  const PRAISE = ["やったー！せいかい！", "すごい！！", "かっこいい！", "てんさい！！", "やるね〜！"];

  let fishes = [], particles = [], raf = 0, running = false;
  let W = 0, H = 0, waterY = 0, t0 = Date.now();
  const cat = { state: "idle", speech: "", timer: 0, bounce: 0, blinkT: 0, blinking: false };

  // 漢字は明朝、よみはまるゴシック。
  // 文字数で切り替えると「て」と「ちから」で書体が変わってしまうので、種類で決める
  function fracFont() {
    return 'bold 21px "Hiragino Maru Gothic ProN","BIZ UDPGothic","Yu Gothic UI",sans-serif';
  }

  // 分数は 分子／よこ線／分母 の3つを積んで描く
  function drawFrac(ctx, n, d) {
    ctx.font = fracFont();
    const wn = ctx.measureText(String(n)).width;
    const wd = ctx.measureText(String(d)).width;
    const lw = Math.max(wn, wd) + 10;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 4;
    ctx.fillText(String(n), 0, -13);
    ctx.fillText(String(d), 0, 15);
    ctx.shadowBlur = 0;
    ctx.fillRect(-lw / 2, 0, lw, 3);
  }

  function fishFont(text, kind) {
    if (kind === "kanji") return 'bold 30px "Yu Mincho","YuMincho","Hiragino Mincho ProN","MS Mincho",serif';
    // 「3じ15ふん」のような長い答えもあるので、数字も長さで縮める
    if (kind === "time")  return 'bold 26px "Hiragino Maru Gothic ProN","BIZ UDPGothic","Yu Gothic UI",sans-serif';
    if (kind === "num")   return 'bold ' + (text.length <= 3 ? 28 : text.length <= 5 ? 23 : 19) +
                                 'px "Hiragino Maru Gothic ProN","BIZ UDPGothic","Yu Gothic UI",sans-serif';
    if (kind === "en")    return 'bold ' + (text.length <= 3 ? 26 : text.length <= 5 ? 23 : 20) + 'px "Segoe UI","Helvetica Neue",Arial,sans-serif';
    const n = text.length;
    const size = n <= 2 ? 25 : n <= 4 ? 22 : 18;
    return 'bold ' + size + 'px "Hiragino Maru Gothic ProN","BIZ UDPGothic","Yu Gothic UI",sans-serif';
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(260, Math.round(r.width));
    H = Math.max(240, Math.round(r.height));
    waterY = Math.round(H * 0.22);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // 1匹ずつ別のレーンを泳がせる（重ならないので、押し間違いが起きない）
  function layout() {
    const n = fishes.length;
    const band = H - waterY - 14;
    fishes.forEach((f, i) => {
      f.laneY = waterY + 10 + band * ((i + 0.5) / n);
      f.minX = f.w / 2 + 30;   // 尾びれのぶんの余白
      f.maxX = W - f.w / 2 - (f.laneY > H - 130 ? 124 : 30); // 下のレーンはねこを避ける
      if (f.maxX < f.minX + 20) f.maxX = f.minX + 20;
      f.x = Math.min(Math.max(f.x, f.minX), f.maxX);
    });
  }

  function start(q) {
    resize();
    particles = [];
    fishes = q.choices.map((c, i) => {
      const text = c.text;
      let w;
      if (c.kind === "frac") {
        // 上下に積むので、幅は大きいほうの数字＋余白、高さも確保できるよう太めにする
        ctx.font = fracFont();
        w = Math.max(102, Math.round(Math.max(
          ctx.measureText(String(c.n)).width, ctx.measureText(String(c.d)).width)) + 66);
      } else {
        ctx.font = fishFont(text, c.kind);
        w = Math.max(86, Math.round(ctx.measureText(text).width) + 54);
      }
      return {
        choice: c, text: text, kind: c.kind, n: c.n, d: c.d,
        // 横に長い魚ほど縦も伸びてレーンが重なるので、高さに上限をつける
        w: w, h: Math.min(Math.round(w * 0.58), 62),
        x: 0, laneY: 0, phase: Math.random() * Math.PI * 2,
        speed: 0.45 + Math.random() * 0.6,
        dir: Math.random() < 0.5 ? 1 : -1,
        color: COLORS[i % COLORS.length],
        state: "swim", anim: 0
      };
    });
    fishes.forEach(f => { f.x = 40 + Math.random() * Math.max(40, W - 120); });
    layout();
    // ループは毎回張り直す。running フラグを信じて張り直さないと、
    // 何かの拍子にコマが止まったとき「魚のいない青い画面」のまま復帰できない
    if (raf) cancelAnimationFrame(raf);
    running = true;
    drawFrame();                       // リサイズでクリアされた直後を空のままにしない
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    fishes = []; particles = [];
    say("", "idle");
  }

  function say(text, state) {
    cat.state = state || "idle";
    cat.speech = text || "";
    cat.timer = text ? 170 : 0;
    if (state === "happy") cat.bounce = 10;
  }

  /* ---- タップ ---- */
  canvas.addEventListener("pointerdown", e => {
    if (!running || !session) return;
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width);
    const py = (e.clientY - r.top) * (H / r.height);
    for (let i = fishes.length - 1; i >= 0; i--) {
      const f = fishes[i];
      if (f.state !== "swim") continue;
      const fy = f.laneY + Math.sin((Date.now() - t0) / 600 + f.phase) * 4;
      if (px > f.x - f.w / 2 && px < f.x + f.w / 2 && py > fy - f.h / 2 && py < fy + f.h / 2) {
        onTap(f, fy);
        return;
      }
    }
  });

  function onTap(f, fy) {
    const q = session.queue[session.idx];
    const ok = answer(f.choice);
    if (ok === null) return;
    if (ok) {
      f.state = "caught";
      burst(f.x, fy, "#ffd700");
      burst(f.x, fy, "#ff6b9d");
      say(q.tries === 1 ? PRAISE[Math.floor(Math.random() * PRAISE.length)] : "できたね！", "happy");
      afterCorrect(q);
    } else {
      f.state = "gone";
      burst(f.x, fy, "#b0bec5");
      say("ちがうよ〜\nもういちど！", "sad");
      repeatPrompt(q);
    }
  }

  function burst(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * (1.6 + Math.random() * 4),
        vy: Math.sin(a) * (1.6 + Math.random() * 4),
        life: 1, color: color, size: 6 + Math.random() * 7
      });
    }
  }

  /* ---- ループ ---- */
  let sizeTick = 0, lastFrame = 0;
  function loop() {
    if (!running) return;
    try { drawFrame(); }
    catch (e) { console.error("fish draw error", e); }   // 1コマ落ちてもループは続ける
    raf = requestAnimationFrame(loop);
  }

  function drawFrame() {
    lastFrame = Date.now();
    // 端末回転・ペインのリサイズ・アドレスバーの出入りを取りこぼさないよう、
    // 実寸をときどき見て変わっていたら作り直す
    if (++sizeTick % 15 === 0) {
      const r = canvas.getBoundingClientRect();
      if (Math.abs(Math.round(r.width) - W) > 2 || Math.abs(Math.round(r.height) - H) > 2) {
        resize(); layout();
      }
    }
    drawBackground();

    const now = Date.now();
    fishes.forEach(f => {
      if (f.state === "swim") {
        f.x += f.speed * f.dir;
        if (f.x > f.maxX) { f.x = f.maxX; f.dir = -1; }
        if (f.x < f.minX) { f.x = f.minX; f.dir = 1; }
      } else {
        f.anim += 1;
        if (f.state === "caught") f.y0 = (f.y0 || 0) - 6;
        else f.y0 = (f.y0 || 0) + 1.2;
      }
      drawFish(f, now);
    });

    // 先に寿命を減らしてから、消えたものを捨てる。
    // 減らす前にふるいにかけると life が負のまま描画に回り、
    // arc() の半径が負 → 例外 → 描画ループごと死ぬ（青い画面に魚が出ない不具合の原因だった）
    particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.022; });
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.size * p.life), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    updateCat();
    drawCat();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, waterY);
    sky.addColorStop(0, "#87ceeb");
    sky.addColorStop(1, "#b0e0ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, waterY);

    const water = ctx.createLinearGradient(0, waterY, 0, H);
    water.addColorStop(0, "#29b6d8");
    water.addColorStop(1, "#1565a0");
    ctx.fillStyle = water;
    ctx.fillRect(0, waterY, W, H - waterY);

    ctx.beginPath();
    ctx.arc(W * 0.12, waterY * 0.5, Math.min(22, waterY * 0.35), 0, Math.PI * 2);
    ctx.fillStyle = "#ffe066";
    ctx.fill();

    const t = Date.now() / 800;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      const wy = waterY + 8 + i * 20;
      ctx.moveTo(0, wy);
      for (let x = 0; x <= W; x += 12) ctx.lineTo(x, wy + Math.sin(x / 60 + t + i) * 4);
      ctx.stroke();
    }
  }

  function drawFish(f, now) {
    if (f.state !== "swim" && f.anim > 110) return;
    const y = f.laneY + (f.y0 || 0) + (f.state === "swim" ? Math.sin((now - t0) / 600 + f.phase) * 4 : 0);

    ctx.save();
    ctx.globalAlpha = f.state === "swim" ? 1 : Math.max(0, 1 - f.anim / 110);
    ctx.translate(f.x, y);
    ctx.scale(f.dir < 0 ? -1 : 1, 1);

    const color = f.state === "gone" ? "#90a4ae" : f.color;
    const w = f.w, h = f.h;
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";

    // 二股の尾びれ
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 6, 0);
    ctx.lineTo(-w / 2 - 26, -20);
    ctx.lineTo(-w / 2 - 12, 0);
    ctx.lineTo(-w / 2 - 26, 20);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.stroke();

    // 背びれ
    ctx.beginPath();
    ctx.moveTo(-10, -h / 2 + 4);
    ctx.quadraticCurveTo(6, -h / 2 - 20, 24, -h / 2 + 2);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.stroke();

    // からだ
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill(); ctx.stroke();

    // しま模様（からだの中だけ）
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    [-w * 0.22, w * 0.02, w * 0.26].forEach(x => {
      ctx.save(); ctx.translate(x, 0); ctx.rotate(0.18);
      ctx.fillRect(-4, -h, 8, h * 2);
      ctx.restore();
    });
    ctx.restore();

    // 胸びれ
    ctx.beginPath();
    ctx.ellipse(2, h / 2 - 3, 13, 7, Math.PI / 4.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill(); ctx.stroke();

    // め
    ctx.beginPath();
    ctx.arc(w / 2 - 15, -8, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.beginPath();
    ctx.arc(w / 2 - 13, -8, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = "#333"; ctx.fill();

    // 字（向きは戻してから描く）
    ctx.scale(f.dir < 0 ? -1 : 1, 1);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (f.kind === "frac") {
      drawFrac(ctx, f.n, f.d);
    } else {
      ctx.font = fishFont(f.text, f.kind);
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 4;
      ctx.fillText(f.text, 0, 2);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  /* ---- ねこ（実物の写真がモチーフ・おすわりのちび体型） ----
     黒い体と黒いしっぽ。白は「鼻すじ→口もと→あご→むね」の帯と、まえあしのくつ下だけ。
     **目は黒い毛の中**に置く（写真のとおり）。顔のパーツは頭の上半分に寄せる。
     表情は state（idle / happy / sad）で目と口だけを差し替える。 */
  const CAT_BLACK = "#3a3532", CAT_LINE = "#26221f", CAT_WHITE = "#fdfbf7";
  const CAT_EYE = "#b3c96b", CAT_PINK = "#f2a3ae";

  function drawCatFigure(ctx, state, blinking) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // しっぽ（黒）
    ctx.beginPath();
    ctx.moveTo(26, 54);
    ctx.quadraticCurveTo(70, 52, 60, 14);
    ctx.strokeStyle = CAT_LINE; ctx.lineWidth = 14; ctx.stroke();
    ctx.strokeStyle = CAT_BLACK; ctx.lineWidth = 10; ctx.stroke();

    // からだ（黒・おすわり）
    ctx.beginPath();
    ctx.moveTo(-30, 64);
    ctx.quadraticCurveTo(-35, 26, -18, 13);
    ctx.quadraticCurveTo(0, 5, 18, 13);
    ctx.quadraticCurveTo(35, 26, 30, 64);
    ctx.quadraticCurveTo(0, 73, -30, 64);
    ctx.closePath();
    ctx.fillStyle = CAT_BLACK; ctx.fill();
    ctx.strokeStyle = CAT_LINE; ctx.lineWidth = 2.4; ctx.stroke();

    // むねの白（あごから下へ流れる帯）
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(-13, 4);
    ctx.quadraticCurveTo(-19, 38, -10, 66);
    ctx.lineTo(10, 66);
    ctx.quadraticCurveTo(19, 38, 13, 4);
    ctx.closePath();
    ctx.fillStyle = CAT_WHITE; ctx.fill();
    ctx.restore();

    // まえあし（白いくつ下）
    [-14, 14].forEach(x => {
      ctx.beginPath();
      ctx.ellipse(x, 61, 11, 7.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = CAT_WHITE; ctx.fill();
      ctx.strokeStyle = CAT_LINE; ctx.lineWidth = 2.2; ctx.stroke();
    });

    // みみ（黒・中はうすいピンク）
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(s * 34, -34); ctx.lineTo(s * 30, -76); ctx.lineTo(s * 5, -52);
      ctx.closePath();
      ctx.fillStyle = CAT_BLACK; ctx.fill();
      ctx.strokeStyle = CAT_LINE; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 29, -41); ctx.lineTo(s * 27, -68); ctx.lineTo(s * 13, -52);
      ctx.closePath();
      ctx.fillStyle = "rgba(242,163,174,0.75)"; ctx.fill();
    });

    // あたま（黒）
    ctx.beginPath();
    ctx.arc(0, -16, 42, 0, Math.PI * 2);
    ctx.fillStyle = CAT_BLACK; ctx.fill();
    ctx.strokeStyle = CAT_LINE; ctx.lineWidth = 2.4; ctx.stroke();

    // 鼻すじから口もと・あごへ抜ける白（八割れ）
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, -16, 42, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(0, -46);                        // 頭のてっぺん（-58）より下から始める
    ctx.quadraticCurveTo(-5, -40, -7, -20);    // 眉間はせまく
    ctx.quadraticCurveTo(-9, -8, -18, 2);      // 鼻すじから口もとへ広がる
    ctx.quadraticCurveTo(-21, 14, -13, 26);
    ctx.quadraticCurveTo(-6, 30, 0, 30);
    ctx.quadraticCurveTo(6, 30, 13, 26);
    ctx.quadraticCurveTo(21, 14, 18, 2);
    ctx.quadraticCurveTo(9, -8, 7, -20);
    ctx.quadraticCurveTo(5, -40, 0, -46);
    ctx.closePath();
    ctx.fillStyle = CAT_WHITE; ctx.fill();
    ctx.restore();

    // め（黒い毛の中。顔の上半分に置く）
    [-20, 20].forEach(x => {
      if (blinking) {
        ctx.beginPath();
        ctx.moveTo(x - 8, -18); ctx.quadraticCurveTo(x, -14, x + 8, -18);
        ctx.strokeStyle = CAT_WHITE; ctx.lineWidth = 3; ctx.stroke();
        return;
      }
      if (state === "happy") {
        ctx.beginPath();
        ctx.moveTo(x - 9, -15); ctx.quadraticCurveTo(x, -27, x + 9, -15);
        ctx.strokeStyle = CAT_WHITE; ctx.lineWidth = 3.4; ctx.stroke();
        return;
      }
      const ry = state === "sad" ? 6.5 : 10.5;
      ctx.beginPath();
      ctx.ellipse(x, -18, 9, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = CAT_EYE; ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1.4; ctx.stroke();
      // ひとみ
      ctx.beginPath();
      ctx.ellipse(x, -18, 3.4, Math.min(ry - 1.5, 8), 0, 0, Math.PI * 2);
      ctx.fillStyle = "#24201d"; ctx.fill();
      ctx.beginPath();
      ctx.arc(x - 3.2, -22, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill();
    });

    // はな（白い帯の上）
    ctx.beginPath();
    ctx.moveTo(0, 6); ctx.lineTo(-4.6, 1); ctx.lineTo(4.6, 1);
    ctx.closePath();
    ctx.fillStyle = CAT_PINK; ctx.fill();

    // くち
    ctx.strokeStyle = "#6b5f58"; ctx.lineWidth = 2;
    if (state === "happy") {
      ctx.beginPath(); ctx.arc(0, 7, 8, 0.25, Math.PI - 0.25); ctx.stroke();
    } else if (state === "sad") {
      ctx.beginPath(); ctx.arc(0, 19, 8, Math.PI + 0.3, -0.3); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, 10); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-7, 10); ctx.quadraticCurveTo(-3.5, 14, 0, 10);
      ctx.quadraticCurveTo(3.5, 14, 7, 10);
      ctx.stroke();
    }

    // ひげ（黒い毛の上なので白）
    ctx.strokeStyle = "rgba(255,255,255,0.72)"; ctx.lineWidth = 1.5;
    [-1, 1].forEach(s => {
      ctx.beginPath(); ctx.moveTo(s * 17, 4); ctx.lineTo(s * 46, -4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 18, 9); ctx.lineTo(s * 46, 10); ctx.stroke();
    });
  }

  function updateCat() {
    if (cat.timer > 0) cat.timer--;
    cat.blinkT++;
    if (cat.blinkT > 150) {
      cat.blinking = true;
      if (cat.blinkT > 158) { cat.blinking = false; cat.blinkT = 0; }
    }
    if (cat.bounce > 0) cat.bounce -= 0.5;
  }

  function drawCat() {
    const s = 0.58;
    const x = W - 62;
    const y = H - 48 - Math.abs(Math.sin(Date.now() / 400)) * 4 - cat.bounce;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    drawCatFigure(ctx, cat.state, cat.blinking);
    ctx.restore();
    if (cat.timer > 0 && cat.speech) drawBubble(x, y);
  }

  function drawBubble(x, y) {
    const lines = cat.speech.split("\n");
    ctx.font = 'bold 15px "Hiragino Maru Gothic ProN","BIZ UDPGothic","Yu Gothic UI",sans-serif';
    let tw = 0;
    lines.forEach(l => { tw = Math.max(tw, ctx.measureText(l).width); });
    const bw = Math.min(W - 24, tw + 26);
    const bh = 18 + lines.length * 20;
    let bx = x - 46 - bw;
    if (bx < 8) bx = 8;
    const by = Math.max(4, y - 54 - bh);
    const r = 12;

    ctx.save();
    ctx.globalAlpha = Math.min(1, cat.timer / 20);
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();
    ctx.strokeStyle = "#ffb84d";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(bx + bw - 14, by + bh);
    ctx.lineTo(bx + bw + 12, by + bh + 14);
    ctx.lineTo(bx + bw - 30, by + bh);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();

    ctx.fillStyle = "#5a4632";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((l, i) => ctx.fillText(l, bx + bw / 2, by + 19 + i * 20));
    ctx.restore();
  }

  addEventListener("resize", () => { if (running) { resize(); layout(); } });

  // 見張り番：動いているはずなのに1秒以上コマが進んでいなければループを張り直す
  setInterval(() => {
    if (!running || fishes.length === 0) return;
    if (document.hidden) return;
    if (Date.now() - lastFrame < 1000) return;
    if (raf) cancelAnimationFrame(raf);
    resize(); layout();
    raf = requestAnimationFrame(loop);
  }, 700);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && running && fishes.length > 0) {
      if (raf) cancelAnimationFrame(raf);
      resize(); layout();
      raf = requestAnimationFrame(loop);
    }
  });

  return { start: start, stop: stop, say: say, isRunning: () => running, fishes: () => fishes,
           debug: () => ({ running: running, raf: raf, fishes: fishes.length, W: W, H: H, age: Date.now() - lastFrame }) };
})();
