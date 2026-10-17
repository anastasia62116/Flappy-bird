(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const gameFrame = document.getElementById('gameFrame');
  const soundToggle = document.getElementById('soundToggle');
  const soundIcon = document.getElementById('soundIcon');
  const soundLabel = document.getElementById('soundLabel');

  const BASE_W = 360;
  const BASE_H = 640;

  let W = BASE_W;
  let H = BASE_H;

  const GROUND_H = 88;
  let GROUND_Y = H - GROUND_H;
  const PIPE_W = 58;
  const PIPE_GAP = 158;
  const PIPE_SPACING = 198;
  const GRAVITY = 1450;
  const FLAP_VELOCITY = -425;
  const BASE_PIPE_SPEED = 145;
  const BIRD_X = 95;
  const BIRD_RADIUS = 15;
  const PIPE_MARGIN = 72;

  let state = 'ready'; // ready | playing | over
  let lastTime = 0;
  let elapsed = 0;
  let score = 0;
  let best = readBest();
  let soundEnabled = true;
  let audioContext = null;
  let groundOffset = 0;
  let pipes = [];
  let particles = [];
  let screenShake = 0;
  let newRecord = false;

  const bird = {
    x: BIRD_X,
    y: 285,
    vy: 0,
    rotation: 0,
    flapFrame: 0
  };

  // Облака распределяются по ширине поля без увеличения их размера.
  const clouds = [
    { x: 30, ratio: 0.08, y: 110, scale: 0.92, speed: 8 },
    { x: 98, ratio: 0.27, y: 194, scale: 0.55, speed: 4.2 },
    { x: 154, ratio: 0.43, y: 65, scale: 0.52, speed: 3.5 },
    { x: 238, ratio: 0.66, y: 164, scale: 0.68, speed: 5 },
    { x: 0, ratio: 0.90, y: 125, scale: 0.73, speed: 4.5 }
  ];

  function readBest() {
    try {
      return Number(localStorage.getItem('flappyBirdBest') || 0) || 0;
    } catch (_) {
      return 0;
    }
  }

  function saveBest() {
    try {
      localStorage.setItem('flappyBirdBest', String(best));
    } catch (_) {
      // Игра продолжает работать, даже если хранилище недоступно.
    }
  }

  function birdStartY() {
    // На стандартном поле сохраняется исходная координата птицы.
    return Math.min(
      GROUND_Y - BIRD_RADIUS,
      Math.max(
        BIRD_RADIUS,
        GROUND_Y * (285 / (BASE_H - GROUND_H))
      )
    );
  }

  function resizeCanvas() {
    const rect = gameFrame.getBoundingClientRect();

    if (!rect.width || !rect.height) return;

    const oldGroundY = GROUND_Y;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    // Используем единый масштаб: объекты не деформируются.
    // Дополнительное пространство расширяет игровой мир.
    const scale = Math.min(
      1,
      rect.width / BASE_W,
      rect.height / BASE_H
    );

    W = rect.width / scale;
    H = rect.height / scale;
    GROUND_Y = H - GROUND_H;

    // Сохраняем относительные вертикальные позиции труб
    // при изменении размера игрового поля.
    if (oldGroundY > 0 && Math.abs(oldGroundY - GROUND_Y) > 0.5) {
      const oldMin = PIPE_MARGIN + PIPE_GAP / 2;
      const oldMax = oldGroundY - PIPE_MARGIN - PIPE_GAP / 2;
      const newMin = PIPE_MARGIN + PIPE_GAP / 2;
      const newMax = GROUND_Y - PIPE_MARGIN - PIPE_GAP / 2;

      pipes.forEach(pipe => {
        const fraction = oldMax > oldMin
          ? Math.max(
            0,
            Math.min(1, (pipe.gapY - oldMin) / (oldMax - oldMin))
          )
          : 0.5;

        pipe.gapY = newMin +
          fraction * Math.max(0, newMax - newMin);
      });

      const oldRange = Math.max(
        1,
        oldGroundY - BIRD_RADIUS * 2
      );

      const birdFraction = (bird.y - BIRD_RADIUS) / oldRange;

      bird.y = BIRD_RADIUS +
        Math.max(0, Math.min(1, birdFraction)) *
        Math.max(1, GROUND_Y - BIRD_RADIUS * 2);
    }

    // Распределяем облака по всей ширине.
    clouds.forEach(cloud => {
      cloud.x = cloud.ratio * W;
    });

    // Canvas масштабируется одинаково по обеим осям.
    ctx.setTransform(
      dpr * scale, 0,
      0, dpr * scale,
      0, 0
    );

    draw();
  }

  function initAudio() {
    if (!soundEnabled) return;

    try {
      const AudioCtx =
        window.AudioContext || window.webkitAudioContext;

      if (AudioCtx && !audioContext) {
        audioContext = new AudioCtx();
      }

      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
    } catch (_) {
      audioContext = null;
    }
  }

  function tone(
    frequency,
    duration,
    type = 'sine',
    volume = 0.045,
    endFrequency = null
  ) {
    if (!soundEnabled) return;

    initAudio();

    if (!audioContext) return;

    try {
      const start = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);

      if (endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(25, endFrequency),
          start + duration
        );
      }

      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        start + duration
      );

      oscillator.connect(gain);
      gain.connect(audioContext.destination);

      oscillator.start(start);
      oscillator.stop(start + duration);
    } catch (_) {
      // Звук необязателен для игрового процесса.
    }
  }

  function flapSound() {
    tone(470, 0.09, 'triangle', 0.035, 250);
  }

  function scoreSound() {
    tone(760, 0.08, 'sine', 0.045, 980);

    setTimeout(() => {
      tone(1050, 0.08, 'sine', 0.035, 1250);
    }, 65);
  }

  function hitSound() {
    tone(180, 0.23, 'sawtooth', 0.05, 55);
  }

  function resetRound() {
    score = 0;
    newRecord = false;
    elapsed = 0;
    pipes = [];
    particles = [];
    screenShake = 0;

    bird.y = birdStartY();
    bird.vy = 0;
    bird.rotation = 0;
    bird.flapFrame = 0;

    // Заполняем видимую часть широкого поля трубами.
    for (
      let x = BASE_W + 80;
      x < W + PIPE_SPACING * 2;
      x += PIPE_SPACING
    ) {
      addPipe(x);
    }
  }

  function addPipe(x) {
    const margin = PIPE_MARGIN;

    const available = Math.max(
      0,
      GROUND_Y - margin * 2 - PIPE_GAP
    );

    const gapCenter =
      margin + Math.random() * available + PIPE_GAP / 2;

    pipes.push({
      x,
      gapY: gapCenter,
      scored: false
    });
  }

  function startGame() {
    initAudio();
    resetRound();
    state = 'playing';
    flap();
  }

  function flap() {
    if (state !== 'playing') return;

    bird.vy = FLAP_VELOCITY;
    bird.flapFrame = 0.12;

    flapSound();

    for (let i = 0; i < 4; i++) {
      particles.push({
        x: bird.x - 12,
        y: bird.y + 5,
        vx: -35 - Math.random() * 65,
        vy: (Math.random() - 0.5) * 85,
        life: 0.25 + Math.random() * 0.18,
        size: 2 + Math.random() * 3
      });
    }
  }

  function endGame() {
    if (state !== 'playing') return;

    state = 'over';
    screenShake = 0.18;

    hitSound();

    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 160;

      particles.push({
        x: bird.x,
        y: bird.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.35,
        size: 2 + Math.random() * 4
      });
    }

    if (score > best) {
      best = score;
      newRecord = true;
      saveBest();
    }
  }

  function handleAction(event) {
    if (
      event &&
      event.type === 'pointerdown' &&
      event.button !== 0
    ) {
      return;
    }

    if (event) event.preventDefault();

    canvas.focus({ preventScroll: true });

    if (state === 'ready' || state === 'over') {
      startGame();
    } else {
      flap();
    }
  }

  canvas.addEventListener('pointerdown', handleAction);

  canvas.addEventListener('keydown', event => {
    if (
      event.code === 'Space' ||
      event.code === 'ArrowUp' ||
      event.code === 'Enter'
    ) {
      event.preventDefault();

      if (event.repeat) return;

      if (state === 'ready' || state === 'over') {
        startGame();
      } else {
        flap();
      }
    }
  });

  soundToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;

    soundToggle.setAttribute(
      'aria-pressed',
      String(soundEnabled)
    );

    soundToggle.setAttribute(
      'aria-label',
      soundEnabled ? 'Выключить звук' : 'Включить звук'
    );

    soundIcon.textContent = soundEnabled ? '♫' : '♪̸';
    soundLabel.textContent = soundEnabled
      ? 'Звук включён'
      : 'Звук выключен';

    if (soundEnabled) {
      initAudio();
      tone(560, 0.08, 'sine', 0.025, 760);
    }
  });

  function update(dt) {
    elapsed += dt;

    groundOffset = (
      groundOffset +
      (state === 'playing' ? BASE_PIPE_SPEED : 32) * dt
    ) % 24;

    clouds.forEach(cloud => {
      cloud.x -= cloud.speed * dt;

      if (cloud.x < -90) {
        cloud.x = W + 55;
      }
    });

    particles = particles.filter(p => p.life > 0);

    particles.forEach(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 350 * dt;
      p.life -= dt;
    });

    if (screenShake > 0) {
      screenShake = Math.max(0, screenShake - dt);
    }

    if (state === 'ready') {
      bird.y = birdStartY() + Math.sin(elapsed * 3.3) * 8;
      bird.rotation = Math.sin(elapsed * 3.3) * 0.04;
      bird.flapFrame = (bird.flapFrame + dt) % 0.7;
      return;
    }

    if (state === 'playing') {
      bird.vy += GRAVITY * dt;
      bird.y += bird.vy * dt;

      bird.rotation = Math.min(
        Math.PI / 2,
        Math.max(-0.45, bird.vy / 590)
      );

      bird.flapFrame = Math.max(0, bird.flapFrame - dt);

      const speed =
        BASE_PIPE_SPEED + Math.min(42, score * 1.8);

      pipes.forEach(pipe => {
        pipe.x -= speed * dt;
      });

      while (
        pipes.length &&
        pipes[0].x + PIPE_W < -5
      ) {
        pipes.shift();
      }

      const lastPipe = pipes[pipes.length - 1];

      if (!lastPipe || lastPipe.x < W - PIPE_SPACING) {
        addPipe(W + 8);
      }

      for (const pipe of pipes) {
        if (
          !pipe.scored &&
          pipe.x + PIPE_W < bird.x
        ) {
          pipe.scored = true;
          score += 1;
          scoreSound();
        }

        if (
          bird.x + BIRD_RADIUS - 3 > pipe.x &&
          bird.x - BIRD_RADIUS + 3 < pipe.x + PIPE_W
        ) {
          const gapTop = pipe.gapY - PIPE_GAP / 2;
          const gapBottom = pipe.gapY + PIPE_GAP / 2;

          if (
            bird.y - BIRD_RADIUS + 3 < gapTop ||
            bird.y + BIRD_RADIUS - 3 > gapBottom
          ) {
            endGame();
            break;
          }
        }
      }

      if (
        bird.y - BIRD_RADIUS < 0 ||
        bird.y + BIRD_RADIUS > GROUND_Y
      ) {
        bird.y = Math.min(
          GROUND_Y - BIRD_RADIUS,
          Math.max(BIRD_RADIUS, bird.y)
        );

        endGame();
      }
    } else if (state === 'over') {
      if (bird.y + BIRD_RADIUS < GROUND_Y) {
        bird.vy += GRAVITY * dt;

        bird.y = Math.min(
          GROUND_Y - BIRD_RADIUS,
          bird.y + bird.vy * dt
        );

        bird.rotation = Math.min(
          Math.PI / 2,
          bird.rotation + 2.8 * dt
        );
      }
    }
  }

  function roundedRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);

    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawHillLayer(baseOffset, peakOffset, period, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y - baseOffset);

    // Продолжаем холмы до правого края поля.
    for (let x = 0; x < W; x += period) {
      const span = Math.min(period, W - x);
      const mid = x + span * 0.5;
      const right = x + span;

      ctx.quadraticCurveTo(
        x + span * 0.23,
        GROUND_Y - peakOffset,
        mid,
        GROUND_Y - (baseOffset - 8)
      );

      ctx.quadraticCurveTo(
        x + span * 0.74,
        GROUND_Y - (peakOffset + 8),
        right,
        GROUND_Y - baseOffset
      );
    }

    ctx.lineTo(W, GROUND_Y);
    ctx.lineTo(0, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);

    sky.addColorStop(0, '#70c5ce');
    sky.addColorStop(0.72, '#a5e1dc');
    sky.addColorStop(1, '#d2edcf');

    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Холмы заполняют всю ширину игровой области.
    drawHillLayer(145, 212, 240, '#a7d9ac');
    drawHillLayer(108, 170, 260, '#c1e6a8');

    clouds.forEach(cloud => {
      drawCloud(cloud.x, cloud.y, cloud.scale);
    });
  }

  function drawCloud(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    ctx.fillStyle = 'rgba(255,255,255,.74)';
    ctx.beginPath();

    ctx.arc(0, 7, 16, 0, Math.PI * 2);
    ctx.arc(17, 0, 21, 0, Math.PI * 2);
    ctx.arc(38, 8, 15, 0, Math.PI * 2);
    ctx.arc(19, 12, 18, 0, Math.PI * 2);

    ctx.fill();
    ctx.restore();
  }

  function drawPipe(pipe) {
    const top = pipe.gapY - PIPE_GAP / 2;
    const bottom = pipe.gapY + PIPE_GAP / 2;
    const capH = 23;

    // Верхняя труба.
    const topGradient = ctx.createLinearGradient(
      pipe.x,
      0,
      pipe.x + PIPE_W,
      0
    );

    topGradient.addColorStop(0, '#63b83d');
    topGradient.addColorStop(0.18, '#8edb4e');
    topGradient.addColorStop(0.72, '#78cb3f');
    topGradient.addColorStop(1, '#4b9d32');

    ctx.fillStyle = topGradient;
    ctx.fillRect(
      pipe.x + 3,
      0,
      PIPE_W - 6,
      top - capH + 2
    );

    ctx.fillStyle = '#65b83a';
    ctx.fillRect(pipe.x, top - capH, PIPE_W, capH);

    ctx.fillStyle = '#a1e65b';
    ctx.fillRect(
      pipe.x + 5,
      0,
      7,
      Math.max(0, top - capH)
    );

    ctx.fillRect(
      pipe.x + 4,
      top - capH + 3,
      PIPE_W - 8,
      4
    );

    ctx.fillStyle = '#438f2f';
    ctx.fillRect(pipe.x, top - capH, PIPE_W, 4);

    ctx.fillRect(
      pipe.x + PIPE_W - 5,
      0,
      5,
      Math.max(0, top - capH)
    );

    ctx.strokeStyle = '#428f31';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      pipe.x + 1,
      top - capH,
      PIPE_W - 2,
      capH
    );

    // Нижняя труба.
    ctx.fillStyle = topGradient;
    ctx.fillRect(
      pipe.x + 3,
      bottom + capH - 2,
      PIPE_W - 6,
      GROUND_Y - bottom - capH + 4
    );

    ctx.fillStyle = '#65b83a';
    ctx.fillRect(pipe.x, bottom, PIPE_W, capH);

    ctx.fillStyle = '#a1e65b';
    ctx.fillRect(
      pipe.x + 5,
      bottom + capH,
      7,
      Math.max(0, GROUND_Y - bottom - capH)
    );

    ctx.fillRect(
      pipe.x + 4,
      bottom + 4,
      PIPE_W - 8,
      4
    );

    ctx.fillStyle = '#438f2f';
    ctx.fillRect(
      pipe.x,
      bottom + capH - 3,
      PIPE_W,
      4
    );

    ctx.fillRect(
      pipe.x + PIPE_W - 5,
      bottom + capH,
      5,
      Math.max(0, GROUND_Y - bottom - capH)
    );

    ctx.strokeStyle = '#428f31';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      pipe.x + 1,
      bottom,
      PIPE_W - 2,
      capH
    );

    // Небольшие блики на кромках.
    ctx.fillStyle = 'rgba(255,255,255,.20)';

    ctx.fillRect(
      pipe.x + 14,
      0,
      2,
      Math.max(0, top - capH)
    );

    ctx.fillRect(
      pipe.x + 14,
      bottom + capH,
      2,
      Math.max(0, GROUND_Y - bottom - capH)
    );
  }

  function drawGround() {
    // Земля и трава заполняют всю ширину.
    ctx.fillStyle = '#ded895';
    ctx.fillRect(0, GROUND_Y, W, GROUND_H);

    ctx.fillStyle = '#8bd14a';
    ctx.fillRect(0, GROUND_Y, W, 13);

    ctx.fillStyle = '#5dbb43';
    ctx.fillRect(0, GROUND_Y, W, 4);

    ctx.fillStyle = '#c4b978';
    ctx.fillRect(0, GROUND_Y + 13, W, 3);

    ctx.save();

    ctx.beginPath();
    ctx.rect(
      0,
      GROUND_Y + 16,
      W,
      GROUND_H - 16
    );

    ctx.clip();
    ctx.translate(-groundOffset, 0);

    for (let x = -24; x < W + 30; x += 24) {
      ctx.fillStyle = '#b7aa6e';
      ctx.beginPath();

      ctx.moveTo(x, GROUND_Y + 25);
      ctx.lineTo(x + 10, GROUND_Y + 25);
      ctx.lineTo(x + 3, GROUND_Y + 31);
      ctx.lineTo(x - 7, GROUND_Y + 31);

      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#f0e4a5';
      ctx.fillRect(x + 3, GROUND_Y + 44, 12, 3);
    }

    ctx.restore();
  }

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rotation);

    // Тело.
    ctx.fillStyle = 'rgba(39,75,68,.18)';
    ctx.beginPath();
    ctx.ellipse(1, 3, 18, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f8c83e';
    ctx.strokeStyle = '#ae7629';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 13, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Крыло.
    const wingLift = bird.flapFrame > 0
      ? -5
      : Math.sin(elapsed * 14) * 2;

    ctx.fillStyle = '#f4a92e';
    ctx.beginPath();
    ctx.ellipse(
      -6,
      2 + wingLift,
      8,
      6,
      -0.35,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.strokeStyle = '#bd8130';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,.48)';
    ctx.beginPath();
    ctx.moveTo(-11, 1 + wingLift);

    ctx.quadraticCurveTo(
      -7,
      -1 + wingLift,
      -3,
      1 + wingLift
    );

    ctx.stroke();

    // Глаз.
    ctx.fillStyle = '#fffdf2';
    ctx.beginPath();
    ctx.ellipse(7, -5, 6.2, 7, 0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#7a5527';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#253f42';
    ctx.beginPath();
    ctx.arc(9, -4, 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(9.7, -5, 0.85, 0, Math.PI * 2);
    ctx.fill();

    // Клюв.
    ctx.fillStyle = '#f18437';
    ctx.strokeStyle = '#a8562a';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(25, 3);
    ctx.lineTo(14, 7);
    ctx.closePath();

    ctx.fill();
    ctx.stroke();

    // Светлый животик.
    ctx.fillStyle = '#fff0a7';
    ctx.beginPath();
    ctx.ellipse(3, 7, 7, 4, -0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawParticles() {
    particles.forEach(p => {
      ctx.globalAlpha = Math.max(
        0,
        Math.min(1, p.life * 3)
      );

      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalAlpha = 1;
  }

  function outlinedText(
    text,
    x,
    y,
    size,
    color = '#ffffff'
  ) {
    ctx.font = `900 ${size}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size * 0.13);
    ctx.strokeStyle = 'rgba(73, 91, 73, .76)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawScore() {
    if (state === 'playing') {
      outlinedText(String(score), W / 2, 76, 52);
      return;
    }

    if (state === 'ready') {
      outlinedText(String(score), W / 2, 76, 46);
    }
  }

  function drawOverlayPanel(x, y, w, h) {
    ctx.save();

    ctx.fillStyle = 'rgba(38, 62, 56, .22)';
    roundedRect(x + 3, y + 5, w, h, 17);
    ctx.fill();

    ctx.fillStyle = '#fff8dd';
    roundedRect(x, y, w, h, 17);
    ctx.fill();

    ctx.strokeStyle = '#b68b4f';
    ctx.lineWidth = 3;
    roundedRect(x + 1.5, y + 1.5, w - 3, h - 3, 15);
    ctx.stroke();

    ctx.restore();
  }

  function drawReadyOverlay() {
    ctx.save();

    ctx.fillStyle = 'rgba(25, 71, 72, .08)';
    ctx.fillRect(0, 0, W, GROUND_Y);

    const panelW = 290;
    const panelH = 142;
    const panelX = (W - panelW) / 2;
    const panelY = (H - panelH) / 2 - 18;
    const centerX = W / 2;

    drawOverlayPanel(panelX, panelY, panelW, panelH);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#744d2b';
    ctx.font = '900 27px ui-rounded, system-ui, sans-serif';
    ctx.fillText('FLAPPY BIRD', centerX, panelY + 40);

    ctx.fillStyle = '#987147';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(
      'Нажми, чтобы начать',
      centerX,
      panelY + 70
    );

    ctx.fillText(
      'и взлететь',
      centerX,
      panelY + 91
    );

    // Анимированная стрелка под окном.
    const bob = Math.sin(elapsed * 4) * 4;
    const arrowY = panelY + panelH + 28 + bob;

    ctx.fillStyle = '#f8c83e';
    ctx.strokeStyle = '#ae7629';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(centerX, arrowY);
    ctx.lineTo(centerX - 12, arrowY + 17);
    ctx.lineTo(centerX - 4, arrowY + 14);
    ctx.lineTo(centerX - 4, arrowY + 26);
    ctx.lineTo(centerX + 4, arrowY + 26);
    ctx.lineTo(centerX + 4, arrowY + 14);
    ctx.lineTo(centerX + 12, arrowY + 17);
    ctx.closePath();

    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function drawGameOverOverlay() {
    ctx.save();

    ctx.fillStyle = 'rgba(35, 69, 65, .18)';
    ctx.fillRect(0, 0, W, GROUND_Y);

    // Окно окончания игры располагается по центру поля.
    const panelW = 284;
    const panelH = 230;
    const panelX = (W - panelW) / 2;
    const panelY = (H - panelH) / 2;
    const centerX = W / 2;

    drawOverlayPanel(panelX, panelY, panelW, panelH);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#bd563e';
    ctx.font = '900 30px ui-rounded, system-ui, sans-serif';
    ctx.fillText(
      'ИГРА ОКОНЧЕНА',
      centerX,
      panelY + 42
    );

    ctx.fillStyle = '#9a774c';
    ctx.font = '700 12px system-ui, sans-serif';

    ctx.fillText(
      'СЧЁТ',
      centerX - 66,
      panelY + 79
    );

    ctx.fillText(
      'РЕКОРД',
      centerX + 67,
      panelY + 79
    );

    ctx.fillStyle = '#704a2b';
    ctx.font = '900 37px ui-rounded, system-ui, sans-serif';

    ctx.fillText(
      String(score),
      centerX - 66,
      panelY + 119
    );

    ctx.fillText(
      String(best),
      centerX + 67,
      panelY + 119
    );

    if (newRecord) {
      ctx.fillStyle = '#d58e27';
      ctx.font = '800 13px system-ui, sans-serif';

      ctx.fillText(
        'НОВЫЙ РЕКОРД!',
        centerX,
        panelY + 145
      );
    }

    // Кнопка перезапуска находится внутри окна.
    const bw = 190;
    const bh = 48;
    const bx = centerX - bw / 2;
    const by = panelY + 165;

    ctx.fillStyle = '#4f9f45';
    roundedRect(bx, by + 3, bw, bh, 12);
    ctx.fill();

    ctx.fillStyle = '#78ca4e';
    roundedRect(bx, by, bw, bh, 12);
    ctx.fill();

    ctx.strokeStyle = '#3b8136';
    ctx.lineWidth = 2;
    roundedRect(bx + 1, by + 1, bw - 2, bh - 2, 11);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 16px system-ui, sans-serif';

    ctx.fillText(
      'ИГРАТЬ СНОВА',
      centerX,
      by + 30
    );

    ctx.restore();
  }

  function draw() {
    if (!ctx) return;

    ctx.save();

    if (screenShake > 0) {
      const amount = screenShake * 18;

      ctx.translate(
        (Math.random() - 0.5) * amount,
        (Math.random() - 0.5) * amount
      );
    }

    drawBackground();
    pipes.forEach(drawPipe);
    drawGround();
    drawParticles();
    drawBird();
    drawScore();

    if (state === 'ready') {
      drawReadyOverlay();
    }

    if (state === 'over') {
      drawGameOverOverlay();
    }

    ctx.restore();
  }

  function frame(timestamp) {
    const dt = lastTime
      ? Math.min((timestamp - lastTime) / 1000, 0.033)
      : 0;

    lastTime = timestamp;

    update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  // Сначала определяем размер поля, затем создаём трубы.
  resizeCanvas();
  resetRound();

  window.addEventListener(
    'resize',
    resizeCanvas,
    { passive: true }
  );

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(gameFrame);
  }

  requestAnimationFrame(frame);
})();