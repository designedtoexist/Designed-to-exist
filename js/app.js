
(function(){
  var FRAMES = [];
  for (var q = 1; q <= 243; q++) FRAMES.push('frames/f_' + (q < 10 ? '00' : q < 100 ? '0' : '') + q + '.webp');
  var N = FRAMES.length, FPS = 24;
  var imgs = new Array(N), loaded = 0, ready = false;

  var cv = document.getElementById('cv'), ctx = cv.getContext('2d');
  var track = document.getElementById('track');
  var beats = [].slice.call(document.querySelectorAll('.beat'));
  var tcEl = document.getElementById('tc'), railEl = document.getElementById('rail'), cueEl = document.getElementById('cue');
  var lbar = document.getElementById('lbar'), lpct = document.getElementById('lpct'), loader = document.getElementById('loader');

  var target = 0, current = 0, lastDrawn = -1;
  var veil = document.getElementById('veil');
  var topEl = document.querySelector('.top'), railWrap = document.querySelector('.rail');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function size(){
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth, h = cv.clientHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    lastDrawn = -1;
  }

  function nearestLoaded(i){
    if (imgs[i] && imgs[i].complete && imgs[i].naturalWidth) return imgs[i];
    for (var d = 1; d < N; d++){
      var a = imgs[i-d], b = imgs[i+d];
      if (a && a.complete && a.naturalWidth) return a;
      if (b && b.complete && b.naturalWidth) return b;
    }
    return null;
  }

  function draw(i,a){
    var im = nearestLoaded(i); if (!im) return;
    var cw = cv.width, ch = cv.height, iw = im.naturalWidth, ih = im.naturalHeight;
    var s = Math.max(cw/iw, ch/ih), w = iw*s, h = ih*s;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = a;
    ctx.drawImage(im, (cw-w)/2, (ch-h)/2, w, h);
    ctx.globalAlpha = 1;
  }

  function progress(){
    var r = track.getBoundingClientRect();
    var span = r.height - window.innerHeight;
    return Math.min(1, Math.max(0, -r.top / span));
  }

  function fmt(t){
    var m = Math.floor(t/60), s = t - m*60;
    return (m<10?'0':'')+m+':'+(s<10?'0':'')+s.toFixed(1);
  }

  function frame(){
    target = progress();
    current += (target - current) * (reduce ? 1 : 0.035);
    if (Math.abs(target-current) < 0.00002) current = target;

    var pos = current * (N-1);
    if (Math.abs(pos - lastDrawn) > 0.004){
      var i0 = Math.min(N-1, Math.floor(pos)), i1 = Math.min(N-1, i0+1), a = pos - i0;
      draw(i0, 1); warm(i0);
      if (i1 !== i0 && a > 0.01) draw(i1, a);
      lastDrawn = pos; tcEl.textContent = fmt(pos/FPS);
    }
    railEl.style.width = (current*100)+'%';
    cueEl.style.opacity = target > 0.03 ? 0 : 1;
    var v = (current - 0.84) / 0.16; v = v < 0 ? 0 : (v > 1 ? 1 : v);
    var e = v * v * (3 - 2 * v);
    cv.style.filter = e > 0.001 ? 'blur(' + (e * 12).toFixed(2) + 'px)' : 'none';
    cv.style.opacity = (1 - e * 0.62).toFixed(3);
    cv.style.transform = 'scale(' + (1 + e * 0.08).toFixed(4) + ')';
    var ui = 1 - Math.min(1, Math.max(0, (current - 0.88) / 0.07));
    topEl.style.opacity = ui; railWrap.style.opacity = ui;
    bgm.update(current);

    for (var k = 0; k < beats.length; k++){
      var b = beats[k], f = parseFloat(b.dataset.from), t = parseFloat(b.dataset.to);
      b.classList.toggle('on', target >= f && target <= t || (k===0 && target < t));
    }
    requestAnimationFrame(frame);
  }

  var READY_AT = Math.ceil(N * 0.3);
  function onLoad(){
    loaded++;
    var p = Math.min(100, Math.round(loaded / READY_AT * 100));
    lbar.style.width = p + '%'; lpct.textContent = 'LOADING ' + p + '%';
    if (loaded >= READY_AT) finish();
  }
  function finish(){
    if (ready) return; ready = true;
    lpct.textContent = 'READY';
    document.getElementById('enter').hidden = false;
    document.getElementById('enSound').focus({preventScroll:true});
  }
  function enter(withSound){
    loader.classList.add('done');
    if (withSound) bgm.start();
  }

  // ---------- generative background music (Web Audio, no files) ----------
  var bgm = (function(){
    var AC = window.AudioContext || window.webkitAudioContext;
    var btn = document.getElementById('snd'), lbl = btn.querySelector('.lbl');
    if (!AC){ btn.style.display = 'none'; return {start:function(){}, update:function(){}, toggle:function(){}}; }
    var ctx, master, bus, lp, rev, padG, bassG, arpG, kickG, hatG, leadG, clapSend, noiseBuf, timer = null;
    var on = false, built = false, nextTime = 0, step = 0, energy = 0, lastUpd = 0;
    var BPM = 118, STEP = 60 / BPM / 4;

    // D minor: Dm  Bb  Gm  A
    var CHORDS = [
      {root:38, notes:[62,65,69]},
      {root:46, notes:[58,62,65]},
      {root:43, notes:[55,58,62]},
      {root:45, notes:[57,61,64]}
    ];
    var ARP = [0,1,2,3, 2,1,2,1, 0,1,2,3, 4,3,2,1];
    // lead melody per bar: [step, midi note, length in steps]
    var LEAD = [
      [[0,81,3],[3,77,3],[6,74,2],[8,77,4]],
      [[0,77,3],[3,74,3],[6,70,2],[8,74,4]],
      [[0,74,3],[3,79,3],[6,82,2],[8,81,4]],
      [[0,76,3],[3,81,3],[6,85,2],[8,81,4],[12,76,4]]
    ];
    var padOsc = [];

    function mtof(m){ return 440 * Math.pow(2, (m - 69) / 12); }
    function ui(){ btn.setAttribute('aria-pressed', on ? 'true' : 'false'); lbl.textContent = on ? 'Sound on' : 'Sound off'; }
    function ss(a, b, x){ x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); }

    function impulse(sec, decay){
      var rate = ctx.sampleRate, len = Math.floor(rate * sec), b = ctx.createBuffer(2, len, rate);
      for (var c = 0; c < 2; c++){
        var d = b.getChannelData(c);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return b;
    }

    function build(){
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0;
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.ratio.value = 3.5; comp.attack.value = 0.008; comp.release.value = 0.18;
      master.connect(comp); comp.connect(ctx.destination);

      bus = ctx.createGain();
      lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.8;
      bus.connect(lp); lp.connect(master);

      rev = ctx.createConvolver(); rev.buffer = impulse(2.6, 2.6);
      var revG = ctx.createGain(); revG.gain.value = 0.36;
      lp.connect(rev); rev.connect(revG); revG.connect(master);
      clapSend = ctx.createGain(); clapSend.gain.value = 0.5; clapSend.connect(rev);

      var lfo = ctx.createOscillator(), lfoG = ctx.createGain();
      lfo.frequency.value = 0.09; lfoG.gain.value = 260;
      lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();

      padG = ctx.createGain(); padG.gain.value = 0.55; padG.connect(bus);
      bassG = ctx.createGain(); bassG.gain.value = 0; bassG.connect(bus);
      arpG = ctx.createGain(); arpG.gain.value = 0.22; arpG.connect(bus);
      leadG = ctx.createGain(); leadG.gain.value = 0; leadG.connect(bus);
      var dly = ctx.createDelay(1), fb = ctx.createGain(), dg = ctx.createGain();
      dly.delayTime.value = STEP * 3; fb.gain.value = 0.38; dg.gain.value = 0.45;
      arpG.connect(dly); leadG.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(dg); dg.connect(bus);
      kickG = ctx.createGain(); kickG.gain.value = 0; kickG.connect(master);
      hatG = ctx.createGain(); hatG.gain.value = 0; hatG.connect(master);

      var len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var nd = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

      for (var v = 0; v < 3; v++){
        for (var k = 0; k < 2; k++){
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sawtooth'; o.detune.value = k ? 9 : -9;
          o.frequency.value = mtof(CHORDS[0].notes[v]);
          g.gain.value = 0.045;
          o.connect(g); g.connect(padG); o.start();
          padOsc.push({o:o, v:v});
        }
      }
      built = true;
    }

    function note(t, midi, dur, type, vol, cutoff, dest){
      var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = type; o.frequency.value = mtof(midi);
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(150, cutoff * 0.3), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(g); g.connect(dest);
      o.start(t); o.stop(t + dur + 0.05);
    }

    function lead(t, midi, dur){
      [-7, 7].forEach(function(dt){
        var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = mtof(midi); o.detune.value = dt;
        f.type = 'lowpass';
        f.frequency.setValueAtTime(900, t);
        f.frequency.exponentialRampToValueAtTime(3400, t + 0.06);
        f.frequency.exponentialRampToValueAtTime(1500, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
        g.gain.setValueAtTime(0.28, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
        o.connect(f); f.connect(g); g.connect(leadG);
        o.start(t); o.stop(t + dur + 0.3);
      });
    }

    function kick(t){
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
      g.gain.setValueAtTime(0.95, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
      o.connect(g); g.connect(kickG); o.start(t); o.stop(t + 0.36);
    }

    function clap(t){
      var s = ctx.createBufferSource(); s.buffer = noiseBuf;
      var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 0.8;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.8, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.014);
      g.gain.exponentialRampToValueAtTime(0.7, t + 0.017);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      s.connect(f); f.connect(g); g.connect(hatG); g.connect(clapSend);
      s.start(t, Math.random() * 1.2); s.stop(t + 0.22);
    }

    function hat(t, vol, dec){
      var s = ctx.createBufferSource(); s.buffer = noiseBuf;
      var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      s.connect(f); f.connect(g); g.connect(hatG);
      s.start(t, Math.random() * 1.2); s.stop(t + dec + 0.02);
    }

    function sched(t){
      var s = step % 16, bar = Math.floor(step / 16) % 4, ch = CHORDS[bar];
      if (s === 0){
        padOsc.forEach(function(p){ p.o.frequency.setTargetAtTime(mtof(ch.notes[p.v]), t, 0.35); });
      }
      if (s % 2 === 0){
        var bm = ch.root + ((s === 6 || s === 14) ? 12 : 0);
        note(t, bm, STEP * 1.7, 'sine', 0.55, 2000, bassG);
        note(t, bm, STEP * 1.7, 'sawtooth', 0.32, 520, bassG);
      }
      var nn = ch.notes.concat(ch.notes.map(function(n){ return n + 12; }));
      note(t, nn[ARP[s]], 0.26, 'sawtooth', (s % 4 === 0 ? 0.2 : 0.12), 2800, arpG);
      if (energy > 0.45){
        LEAD[bar].forEach(function(n){ if (n[0] === s) lead(t, n[1], n[2] * STEP); });
      }
      if (energy > 0.1 && s % 4 === 0){
        kick(t);
        var depth = 0.5 * ss(0.1, 0.4, energy);
        bus.gain.setValueAtTime(1 - depth, t);
        bus.gain.linearRampToValueAtTime(1, t + 0.22);
      }
      if (energy > 0.25){
        if (s === 4 || s === 12) clap(t);
        if (s % 4 === 2) hat(t, 0.2, 0.11); else if (s % 2 === 1) hat(t, 0.06, 0.04);
      }
      step++;
    }
    function tick(){
      if (nextTime < ctx.currentTime - 0.5) nextTime = ctx.currentTime + 0.05;
      while (nextTime < ctx.currentTime + 0.15){ sched(nextTime); nextTime += STEP; }
    }

    function run(){
      if (!built) build();
      ctx.resume();
      on = true; ui();
      var t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0.85, t + 2.5);
      nextTime = t + 0.08;
      clearInterval(timer); timer = setInterval(tick, 25);
    }
    function stop(){
      on = false; ui();
      var t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + 0.4);
      clearInterval(timer); timer = null;
      setTimeout(function(){ if (!on) ctx.suspend(); }, 600);
    }

    // the track builds as you scroll in, and drops back to a calm pad on the last page
    function update(p){
      if (!on || !ctx) return;
      var now = ctx.currentTime;
      if (now - lastUpd < 0.12) return;
      lastUpd = now;
      energy = ss(0.02, 0.4, p) * (1 - ss(0.86, 1.0, p));
      var e = energy;
      lp.frequency.setTargetAtTime(600 + 4200 * e, now, 0.6);
      padG.gain.setTargetAtTime(0.55 - 0.2 * e, now, 0.6);
      bassG.gain.setTargetAtTime(ss(0.04, 0.3, e) * 0.75, now, 0.5);
      arpG.gain.setTargetAtTime(0.22 + 0.55 * e, now, 0.6);
      kickG.gain.setTargetAtTime(ss(0.1, 0.4, e) * 0.95, now, 0.4);
      hatG.gain.setTargetAtTime(ss(0.25, 0.55, e) * 0.8, now, 0.4);
      leadG.gain.setTargetAtTime(ss(0.45, 0.8, e) * 0.9, now, 0.5);
    }

    document.addEventListener('visibilitychange', function(){
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else if (on) ctx.resume();
    });

    return {
      start: function(){ if (!on) run(); },
      toggle: function(){ if (on) stop(); else run(); },
      update: update
    };
  })();

  document.getElementById('enSound').addEventListener('click', function(){ enter(true); });
  document.getElementById('enSilent').addEventListener('click', function(){ enter(false); });
  document.getElementById('snd').addEventListener('click', function(){ bgm.toggle(); });

  // load in order so early scroll positions are available first
  var nextI = 0, active = 0, MAXC = 8;
  function pump(){
    while (active < MAXC && nextI < N){
      (function(i){
        var im = new Image(); imgs[i] = im; active++;
        im.decoding = 'async';
        im.onload = im.onerror = function(){ active--; onLoad(); pump(); };
        im.src = FRAMES[i];
      })(nextI++);
    }
  }
  pump();

  // decode upcoming frames ahead of time so scrubbing never stalls
  function warm(i){
    for (var j = i - 6; j <= i + 20; j++){
      var m = imgs[j];
      if (m && m.complete && !m._w){ m._w = 1; if (m.decode) m.decode().catch(function(){}); }
    }
  }

  window.addEventListener('resize', size);
  size();
  requestAnimationFrame(frame);

  var outro = document.querySelector('.outro');
  document.querySelector('.outro-bg .pic').style.backgroundImage = 'url(' + FRAMES[N-1] + ')';
  if ('IntersectionObserver' in window){
    new IntersectionObserver(function(es){
      es.forEach(function(e){
        if (e.isIntersecting) outro.classList.add('in');
        else if (!e.isIntersecting) outro.classList.remove('in');
      });
    }, {threshold:[0], rootMargin:'0px 0px -25% 0px'}).observe(outro);
  } else { outro.classList.add('in'); }

  document.getElementById('again').addEventListener('click', function(){
    window.scrollTo({top: track.offsetTop, behavior: reduce ? 'auto' : 'smooth'});
  });
})();
