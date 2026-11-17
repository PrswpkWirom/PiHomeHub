/**
 * Draw the Snoopy ASCII vignette on a canvas with CSS-controlled width and height.
 * The canvas stays transparent so it can sit directly in an existing hero.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ onPlaybackChange?: (playing: boolean) => void }} [options]
 * @returns {{ play: () => void, pause: () => void, destroy: () => void } | null}
 */
export function mountSnoopyAsciiAnimation(canvas, { onPlaybackChange } = {}) {
  const ownerDocument = canvas.ownerDocument;
  const view = ownerDocument.defaultView;
  const context = canvas.getContext("2d");
  if (!view || !context) return null;

  const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
  const widthInWorld = 520;
  const heightInWorld = 222;
  const frameInterval = 1000 / 22;
  const cycleLength = 16;
  const alarmStarts = 12.34;
  const hopStarts = 12.58;
  const hopDuration = .70;
  const alarmStops = 13.34;
  const alarmIsRinging = () => time >= alarmStarts && time < alarmStops;
  const raster = ownerDocument.createElement("canvas");
  raster.width = widthInWorld;
  raster.height = heightInWorld;
  const ink = raster.getContext("2d", {willReadFrequently: true});
  if (!ink) return null;
  const marks = {
    cream: "#ff0000", fur: "#8a0000", shade: "#0000ff", feature: "#00008a",
    copper: "#00ff00", metal: "#008a00", rose: "#00ffff", dark: "#830083"
  };
  const palettes = {
    light: {
      cream: "#554438", fur: "#75685d", shade: "#80634f", feature: "#654b38",
      copper: "#a14c32", metal: "#8c6650", rose: "#a3484e", dark: "#403830"
    },
    dark: {
      cream: "#ffe6cd", fur: "#a28a77", shade: "#98745e", feature: "#d3aa8b",
      copper: "#e8a282", metal: "#a27861", rose: "#eda19a", dark: "#a48673"
    }
  };
  const themeRoot = ownerDocument.documentElement;
  const currentPalette = () => palettes[themeRoot.classList.contains("dark") ? "dark" : "light"];
  let colors = currentPalette();
  const poses = {
    head: new Path2D("M -37 -91 C -39 -111 -24 -126 -6 -128 C 12 -131 29 -123 35 -111 C 40 -101 37 -94 43 -92 C 51 -93 62 -96 69 -89 C 76 -83 74 -72 66 -65 C 57 -55 41 -52 28 -56 C 17 -49 0 -52 -13 -56 C -28 -62 -35 -74 -37 -91 Z"),
    ear: new Path2D("M -22 -109 C -31 -108 -34 -102 -34 -92 C -33 -83 -39 -76 -35 -65 C -31 -56 -19 -55 -13 -62 C -6 -70 -7 -91 -12 -101 C -14 -107 -17 -109 -22 -109 Z"),
    torso: new Path2D("M -13 -56 C -16 -47 -28 -36 -27 -22 C -27 -10 -16 -6 -3 -7 C 12 -6 23 -12 22 -25 C 21 -37 15 -46 13 -55 Z"),
    curl: new Path2D("M -52 1 C -66 -9 -62 -30 -44 -40 C -30 -48 -15 -49 3 -42 C 22 -35 30 -20 26 -10 C 22 -2 13 3 2 3 Z")
  };
  let metrics;
  let running = !motion.matches;
  let manuallyPaused = false;
  let destroyed = false;
  let inView = true;
  let frameId = 0;
  let lastFrame = null;
  let time = 0;

  function smooth(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  function paint(path, fill, stroke, weight = 2.6) {
    if (fill) {
      ink.fillStyle = fill;
      ink.fill(path);
    }
    if (stroke) {
      ink.strokeStyle = stroke;
      ink.lineWidth = weight;
      ink.stroke(path);
    }
  }

  function curve(commands, color, weight = 2.6) {
    paint(new Path2D(commands), null, color, weight);
  }

  function oval(x, y, rx, ry, color, edge = null) {
    const shape = new Path2D();
    shape.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    paint(shape, color, edge);
  }

  function rectangle(x, y, w, h, edge, fill = null) {
    const shape = new Path2D();
    shape.rect(x, y, w, h);
    paint(shape, fill, edge);
  }

  function drawHead(expression, nod, earTilt) {
    const {cream, fur, shade, feature, rose, dark} = marks;
    ink.save();
    ink.translate(2, -55);
    ink.rotate(nod);
    ink.translate(-2, 55);
    paint(poses.head, fur, cream, 3.65);
    oval(64.5, -86, 10.8, 7.7, dark, cream);
    oval(65.5, -88.5, 3.0, 1.8, feature);

    ink.save();
    ink.translate(-22, -105);
    ink.rotate(earTilt);
    ink.translate(22, 105);
    paint(poses.ear, shade, cream, 2);
    ink.restore();

    if (expression === "sleep" || expression === "yawn") {
      curve("M 17 -97 Q 23 -92 29 -97", dark, 4.0);
    } else if (expression === "startle") {
      oval(24, -101, 5.7, 6.6, dark, cream);
      oval(25, -102, 2.1, 2.8, cream);
      curve("M 19 -114 Q 24 -118 30 -114", cream, 2.6);
    } else if (expression === "blink" || expression === "happy") {
      curve("M 18 -97 Q 23 -103 29 -97", dark, 4.0);
    } else {
      oval(23, -101, 3.2, 5.9, dark);
      oval(23, -103, 1.3, 1.6, cream);
    }
    if (expression === "yawn") {
      oval(40, -68, 9, 7, dark);
      curve("M 36 -65 Q 40 -62 45 -65", rose, 2.6);
    } else if (expression === "startle") {
      oval(36, -66, 5.7, 6.4, dark, cream);
    } else {
      curve("M 29 -68 Q 38 -60 49 -67", dark, 3.1);
      oval(31, -78, 5.5, 2.5, rose);
    }
    ink.restore();
  }

  function drawStanding({x, direction, turn, walk, step, crouch, mode, clock, drawer, hop}) {
    const {cream, fur, copper} = marks;
    const bounce = walk ? -Math.abs(step) * 3 : Math.sin(clock * 2) * .7;
    const stride = walk ? step * 10 : hop * 6;
    ink.save();
    ink.translate(x, 200 + bounce - hop * 24);
    ink.scale(direction * turn, 1 - .25 * crouch + hop * .05);
    const wag = Math.sin(clock * (walk ? 13 : 7)) * (walk ? 5 : 3);
    curve(`M -23 -25 Q -34 -25 -40 ${-34 + wag} Q -41 ${-39 + wag} -35 ${-34 + wag} L -25 -30`, cream, 3.1);
    oval(-13 - stride, -4, 13, 6.3, fur, cream);
    paint(poses.torso, fur, cream);
    oval(12 + stride, -3, 16, 7, fur, cream);
    curve("M -12 -53 Q 0 -47 13 -53", copper, 5.4);
    oval(10, -47, 3, 4, copper);

    if (mode === "rack" || mode === "typing") {
      const reach = mode === "rack" ? 70 - 38 * drawer : 54;
      const paw = mode === "rack" ? -59 + 17 * drawer : -32 + Math.sin(clock * 14) * 3.8;
      curve(`M 4 -34 Q 22 -24 ${reach - 14} ${paw + 3} L ${reach} ${paw}`, cream, 3.7);
      oval(reach + 2, paw, 7, 5, fur, cream);
      if (mode === "typing") {
        const secondPaw = -30 + Math.sin(clock * 14 + Math.PI) * 3.5;
        curve(`M 8 -27 Q 34 -18 49 ${secondPaw}`, cream, 2.6);
      }
    } else if (mode === "startle") {
      curve("M -13 -32 Q -29 -23 -43 -46 M 8 -32 Q 20 -21 29 -43", cream, 3.3);
      oval(-43, -47, 6, 4.5, fur, cream);
      oval(30, -44, 6, 4.5, fur, cream);
    } else {
      curve(`M 7 -38 Q 19 -29 ${12 - stride * .5} -24`, cream, 2.8);
    }
    const blink = (clock > 2.18 && clock < 2.35) || (clock > 6.1 && clock < 6.28);
    const expression = mode === "startle" ? "startle" : mode === "yawn" ? "yawn" : blink ? "blink" : mode === "rack" && clock > 1.27 && clock < 1.77 ? "happy" : "awake";
    const earTilt = mode === "startle" ? -.19 - hop * .63 : walk ? step * .15 : Math.sin(clock * 4.3) * .035;
    drawHead(expression, mode === "startle" ? -.13 - hop * .14 : mode === "yawn" ? -.13 : crouch * .12 + Math.sin(clock * 2.8) * .024, earTilt);
    ink.restore();
  }

  function drawSleeping(clock, settling) {
    const {cream, fur, copper} = marks;
    const breath = Math.sin(clock * 2.45) * 1.55;
    ink.save();
    ink.translate(258, 201);
    ink.scale(-1, 1 + breath * .006);
    oval(7, 2, 60, 5.4, null, copper);
    paint(poses.curl, fur, cream, 3.2);
    curve("M -48 -10 Q -65 -13 -58 -22", cream, 2.5);
    oval(14, -1, 24, 6, fur, cream);
    curve("M 0 -28 Q 10 -25 17 -28", copper, 3.2);
    ink.translate(11, 68 - settling * 5);
    ink.scale(.87, .91);
    drawHead("sleep", .15, -.06);
    ink.restore();
  }

  function drawAlarmClock(ringing, now) {
    const {cream, copper, metal} = marks;
    ink.save();
    ink.translate(196, 169);
    if (ringing) ink.rotate(Math.sin((now - alarmStarts) * 28) * .19);
    oval(0, -2, 11, 10, "#000000", ringing ? cream : copper);
    curve("M 0 -8 V -2 L 5 -4 M -7 6 L -10 10 M 7 6 L 10 10", ringing ? cream : metal, 2.1);
    curve("M -12 -10 Q -10 -16 -5 -15 M 5 -15 Q 10 -16 12 -10", copper, 2.7);
    ink.restore();
  }

  function drawExtendedTray(open, y) {
    const {copper, cream, metal} = marks;
    const x = 428 - 52 * open;
    const frontY = y + 17 * open;
    const back = 428;
    const width = 56;
    rectangle(back, y, width, 19, metal, "#000000");
    paint(new Path2D(`M ${x} ${frontY} L ${back} ${y} H ${back + width} L ${x + width} ${frontY} Z`), "#000000", copper, 2.6);
    for (let board = 0; board < 3; board++) {
      const socket = x + 11 + board * 14;
      const length = 12 * open;
      curve(`M ${socket} ${frontY - 3} l ${length} ${-length * .32} h 6`, metal, 2.4);
    }
    rectangle(x, frontY, width, 16, cream, "#000000");
    curve(`M ${x - 5} ${frontY + 5} h 9 v 6 h -9 M ${x + 12} ${frontY + 8} h 22`, copper, 2.45);
    oval(x + 47, frontY + 8, 3.7, 3.7, cream);
  }

  function drawEquipment(rackActive, typing, now, drawer, ringing) {
    const {copper, metal} = marks;
    curve("M 43 207 L 199 207 M 209 207 L 330 207 M 343 207 L 505 207", metal, 1.1);
    curve("M 50 182 H 215 M 62 183 V 205 M 203 183 V 205", metal, 2.5);
    paint(new Path2D("M65 125 H147 L154 166 H73 Z"), null, copper, 2.9);
    paint(new Path2D("M73 166 H154 L180 177 H83 Z"), null, copper, 2.9);
    curve("M84 171 H113 M119 171 H147", metal, 2.25);
    curve("M138 176 C136 198 155 199 177 199 H389 Q418 199 418 173", metal, 1.8);

    drawAlarmClock(ringing, now);

    const panel = marks.copper;
    const status = marks.cream;
    const rackTop = 51;
    const front = 418;
    const rackWidth = 77;
    rectangle(front, rackTop, rackWidth, 147, panel);
    curve("M418 51 L438 31 H517 V176 L495 198 M495 51 L517 31", panel, 3.1);
    curve("M426 47 H493 M434 36 H505", metal, 1.7);
    for (let vent = 0; vent < 9; vent++) {
      const x = 438 + vent * 7;
      curve(`M${x} 44 l6 -6`, metal, 1.85);
    }
    curve("M503 54 L511 46 V171 L503 181 Z", metal, 1.65);
    for (let vent = 0; vent < 10; vent++) {
      const y = 64 + vent * 10;
      curve(`M505 ${y} l5 -5`, metal, 1.8);
    }
    curve("M423 57 V192 M489 57 V192 M426 70 H486 M426 187 H486", metal, 2.1);
    for (const x of [424, 488]) {
      for (const y of [60, 190]) oval(x, y, 2.1, 2.1, panel);
    }
    for (let bay = 0; bay < 4; bay++) {
      const y = 76 + bay * 27;
      if (bay === 2 && drawer > .025) continue;
      rectangle(428, y, 56, 19, bay === 3 ? panel : metal);
      curve(`M432 ${y + 5} V${y + 14} M480 ${y + 5} V${y + 14}`, panel, 2.1);
      if (bay === 1) {
        for (let port = 0; port < 4; port++) {
          rectangle(438 + port * 6, y + 6, 4.6, 6, metal);
        }
      } else {
        for (let vent = 0; vent < 5; vent++) {
          const x = 437 + vent * 5;
          curve(`M${x} ${y + 6} v6`, metal, 1.7);
        }
      }
      const signal = Math.sin(now * 5);
      const lit = rackActive && bay === 3 && signal > -.05;
      oval(469, y + 9, lit ? 4.1 : 2.6, lit ? 4.1 : 2.6, lit ? status : panel);
      oval(476, y + 9, 1.85, 1.85, metal);
    }
    curve("M424 198 V205 H434 V198 M481 198 V205 H489 V198", panel, 2.3);
    if (drawer > .025) drawExtendedTray(drawer, 130);
    if (typing && Math.sin(now * 12) > 0.05) {
      curve("M93 149 H132", copper, 2.1);
    }
  }

  function resize() {
    if (destroyed) return;
    const {width, height} = canvas.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    const compact = width < 390;
    const cols = compact ? 86 : 105;
    const rows = compact ? 25 : 32;
    const scale = Math.min(width / widthInWorld, height / heightInWorld);
    const sx = widthInWorld * scale / cols;
    const sy = heightInWorld * scale / rows;
    const density = Math.min(2, view.devicePixelRatio || 1);
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
    context.setTransform(density, 0, 0, density, 0, 0);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `500 ${Math.min(sx / .60, sy * 1.07)}px "Liberation Mono", "Courier New", monospace`;
    metrics = {width, height, cols, rows, sx, sy, ox: (width - sx * cols) / 2, oy: (height - sy * rows) / 2};
    draw();
  }

  function drawAscii() {
    const {width, height, cols, rows, sx, sy, ox, oy} = metrics;
    const pixels = ink.getImageData(0, 0, widthInWorld, heightInWorld).data;
    context.clearRect(0, 0, width, height);
    const sampleCount = 5;
    const pixelToCol = cols / widthInWorld;
    const pixelToRow = rows / heightInWorld;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let outline = 0, fill = 0, shade = 0, detail = 0, copper = 0, metal = 0, blush = 0, dark = 0;
        let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
        for (let j = 0; j < sampleCount; j++) {
          const y = Math.floor((row + (j + .5) / sampleCount) / pixelToRow);
          for (let i = 0; i < sampleCount; i++) {
            const x = Math.floor((col + (i + .5) / sampleCount) / pixelToCol);
            const p = (y * widthInWorld + x) * 4;
            const a = pixels[p + 3] / 255;
            if (a < .07) continue;
            const r = pixels[p];
            const g = pixels[p + 1];
            const b = pixels[p + 2];
            if (r < 60 && g < 60 && b < 60) continue;
            const redStroke = r > g && r > b && r > 168;
            const greenStroke = g > r && g > b;
            if (g > 95 && b > 95 && Math.abs(g - b) < 10 && r < 64) {
              blush += a;
            } else if (r > 70 && b > 70 && Math.abs(r - b) < 12 && g < 65) {
              dark += a;
            } else if (redStroke || greenStroke) {
              const weight = a * (redStroke || g > 160 ? 1 : .7);
              sumX += i * weight;
              sumY += j * weight;
              sumXX += i * i * weight;
              sumYY += j * j * weight;
              sumXY += i * j * weight;
              if (redStroke) outline += weight;
              else if (g > 160) copper += weight;
              else metal += weight;
            } else if (b > r && b > g) {
              if (b > 169) shade += a;
              else detail += a;
            } else fill += a;
          }
        }
        const lineWeight = outline + copper + metal;
        let glyph = "";
        let color;
        if (dark > 5.8) {
          glyph = dark > 12 ? "@" : dark > 8 ? "o" : "+";
          color = colors.dark;
        } else if (blush > 3.8) {
          glyph = blush > 8 ? ":" : ".";
          color = colors.rose;
        } else if (detail > 4.6) {
          glyph = detail > 12 ? "@" : detail > 8 ? "o" : "+";
          color = colors.feature;
        } else if (shade > 7.3 && outline < 4.8) {
          glyph = shade > 15 ? "#" : shade > 11 ? "+" : ":";
          color = colors.shade;
        } else if (lineWeight > 2.1) {
          const vx = sumXX - sumX * sumX / lineWeight;
          const vy = sumYY - sumY * sumY / lineWeight;
          const cov = sumXY - sumX * sumY / lineWeight;
          glyph = vx > vy * 2.3 ? "-" : vy > vx * 2.3 ? "|" : Math.abs(cov) > .29 * (vx + vy) ? (cov > 0 ? "\\" : "/") : lineWeight > 9 ? "+" : ":";
          color = outline > 2 ? colors.cream : copper > 2.5 ? colors.copper : colors.metal;
        } else if (fill > 10.5 && (row * 2 + col) % 4 === 0) {
          glyph = ".";
          color = colors.fur;
        }
        if (glyph) {
          context.fillStyle = color;
          context.fillText(glyph, ox + (col + .5) * sx, oy + (row + .5) * sy);
        }
      }
    }

    function label(x, y, text, color) {
      context.fillStyle = color;
      const col = Math.round(x * pixelToCol);
      const row = Math.round(y * pixelToRow);
      for (let i = 0; i < text.length; i++) {
        context.fillText(text[i], ox + (col + i + .5) * sx, oy + (row + .5) * sy);
      }
    }

    label(432, 62, "PHH", colors.copper);
    label(86, 133, ">_", colors.copper);
    if (time >= 4.5 && time < 7.65 && Math.sin(time * 5) > 0) label(108, 133, "...", colors.metal);
    if (time >= 9.45 && time < alarmStarts) {
      const progress = ((time - 9.45) % 2.7) / 2.7;
      for (let i = 0; i < 3; i++) {
        if (progress < .17 * i) continue;
        label(201 - i * 14, 135 - i * 16 - progress * 12, i === 2 ? "Z" : "z", i === 2 ? colors.metal : colors.copper);
      }
    }
    if (alarmIsRinging()) {
      const wobble = Math.sin((time - alarmStarts) * 22) > 0 ? 3 : 0;
      label(174 - wobble, 159, "((", colors.copper);
      label(211 + wobble, 159, "))", colors.copper);
      label(172, 135, "RRING!", colors.rose);
    }
    if (time >= hopStarts + .08 && time < hopStarts + hopDuration) {
      label(231, 47, "!", colors.cream);
      label(295, 33, "!", colors.copper);
    }
  }

  function draw() {
    if (!metrics) return;
    ink.clearRect(0, 0, widthInWorld, heightInWorld);
    ink.lineCap = "round";
    ink.lineJoin = "round";
    const drawer = smooth((time - .53) / .71) * (1 - smooth((time - 2.04) / .88));
    const rackActive = time < 3.2 || time >= 15.32;
    const typing = time >= 4.55 && time < 7.65;
    drawEquipment(rackActive, typing, time, drawer, alarmIsRinging());

    if (time >= 9.15 && time < hopStarts) {
      drawSleeping(time, smooth((time - 9.15) / .48));
    } else {
      const goToLaptop = smooth((time - 3.38) / 1.17);
      const nestle = smooth((time - 8.15) / 1.0);
      const goToRack = smooth((time - 14) / 1.32);
      const hopProgress = (time - hopStarts) / hopDuration;
      const recovering = time >= hopStarts && time < 13.7;
      const startled = hopProgress >= 0 && hopProgress < 1;
      const hop = startled ? Math.sin(hopProgress * Math.PI) : 0;
      const jumpBack = 12 * smooth(hopProgress * 1.6);
      const leftward = time >= 3.34 && time < 13.74;
      const turn = time < 4 ? Math.max(.21, Math.min(1, Math.abs(time - 3.34) * 4.1))
        : Math.max(.21, Math.min(1, Math.abs(time - 13.74) * 4.6));
      const crouch = recovering ? 1 - smooth(hopProgress * 3) : time < hopStarts ? nestle : 0;
      const walking = (time >= 3.38 && time < 4.55) || (time >= 14 && time < 15.32);
      const mode = startled ? "startle" : rackActive ? "rack" : typing ? "typing"
        : time >= 7.65 && time < 9.15 ? "yawn" : "idle";
      drawStanding({
        x: 349 - 126 * goToLaptop + 35 * nestle + jumpBack + 79 * goToRack - drawer * 14,
        direction: leftward ? -1 : 1,
        turn,
        walk: walking,
        step: Math.sin(time * 17),
        crouch,
        mode,
        drawer,
        hop,
        clock: time
      });
    }
    drawAscii();
  }

  function tick(now) {
    frameId = 0;
    if (lastFrame === null) lastFrame = now;
    const elapsed = now - lastFrame;
    if (elapsed >= frameInterval - 1) {
      time = (time + Math.min(elapsed, 120) / 1000) % cycleLength;
      lastFrame = now;
      draw();
    }
    sync();
  }

  function sync() {
    if (!destroyed && running && inView && !ownerDocument.hidden) {
      if (!frameId) frameId = view.requestAnimationFrame(tick);
      return;
    }
    if (frameId) view.cancelAnimationFrame(frameId);
    frameId = 0;
    lastFrame = null;
  }

  function setRunning(next) {
    if (destroyed || running === next) return;
    running = next;
    sync();
    onPlaybackChange?.(running);
  }

  function handleMotionChange() {
    setRunning(!motion.matches && !manuallyPaused);
  }

  const resizeObserver = new view.ResizeObserver(resize);
  resizeObserver.observe(canvas);
  // Repaint the same frame on theme changes, including reduced-motion stills.
  const themeObserver = new view.MutationObserver(() => {
    const nextColors = currentPalette();
    if (colors === nextColors || destroyed) return;
    colors = nextColors;
    draw();
  });
  themeObserver.observe(themeRoot, { attributes: true, attributeFilter: ["class"] });
  const intersectionObserver = view.IntersectionObserver
    ? new view.IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        sync();
      })
    : null;
  intersectionObserver?.observe(canvas);
  motion.addEventListener("change", handleMotionChange);
  ownerDocument.addEventListener("visibilitychange", sync);
  resize();
  sync();
  onPlaybackChange?.(running);

  return {
    play() {
      manuallyPaused = false;
      setRunning(true);
    },
    pause() {
      manuallyPaused = true;
      setRunning(false);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      sync();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      intersectionObserver?.disconnect();
      motion.removeEventListener("change", handleMotionChange);
      ownerDocument.removeEventListener("visibilitychange", sync);
    }
  };
}
