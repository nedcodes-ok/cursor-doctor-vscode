const { chromium } = require('/home/chai/.nvm/versions/node/v24.13.1/lib/node_modules/playwright');
const GIFEncoder = require('/home/chai/.nvm/versions/node/v24.13.1/lib/node_modules/gif-encoder-2');
const fs = require('fs');
const path = require('path');
const { PNG } = require('/home/chai/.nvm/versions/node/v24.13.1/lib/node_modules/pngjs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 720, height: 640 });
  await page.goto('file://' + path.join(__dirname, 'terminal.html'));

  const totalLines = 27;
  const frames = [];

  // Frame timing: [lineIndex, holdFrames]
  const timing = [
    [0, 8],   // prompt + command — hold longer
    [1, 2],
    [2, 6],   // grade — hold longer
    [3, 2],
    [4, 4],   // progress bar
    [5, 2],
    [6, 2], [7, 1],   // rules exist
    [8, 2], [9, 1],   // legacy
    [10, 2], [11, 1],  // syntax
    [12, 2], [13, 1],  // token
    [14, 2], [15, 1],  // coverage
    [16, 2], [17, 1],  // file sizes
    [18, 2], [19, 1],  // alwaysApply
    [20, 2], [21, 1],  // skills
    [22, 2],
    [23, 4],  // summary — hold
    [24, 2],
    [25, 3],  // auto-fix
    [26, 12], // final hold
  ];

  // Capture frames
  for (let i = 0; i < timing.length; i++) {
    const [lineIdx, holdCount] = timing[i];
    
    // Show all lines up to this point
    for (let j = 0; j <= lineIdx; j++) {
      await page.evaluate((idx) => {
        const el = document.getElementById('l' + idx);
        if (el) el.style.opacity = '1';
      }, j);
    }

    // Capture frame
    const buf = await page.screenshot({ type: 'png' });
    for (let h = 0; h < holdCount; h++) {
      frames.push(buf);
    }
  }

  await browser.close();

  // Now create GIF from PNG frames
  // Use first frame to get dimensions
  const firstPng = PNG.sync.read(frames[0]);
  const width = firstPng.width;
  const height = firstPng.height;

  const encoder = new GIFEncoder(width, height, 'neuquant', false);
  encoder.setDelay(100); // 100ms per frame = 10fps
  encoder.setRepeat(0); // loop forever
  encoder.setQuality(10);
  
  const outPath = path.join(__dirname, '..', 'images', 'demo.gif');
  encoder.createReadStream().pipe(fs.createWriteStream(outPath));
  encoder.start();

  for (const frameBuf of frames) {
    const png = PNG.sync.read(frameBuf);
    // gif-encoder-2 expects raw RGBA pixel data
    encoder.addFrame(png.data);
  }

  encoder.finish();
  console.log('GIF created: ' + outPath + ' (' + frames.length + ' frames)');
})();
