const { chromium } = require('/home/chai/.nvm/versions/node/v24.13.1/lib/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const shots = [
    { file: 'status-bar.html', out: 'status-bar.png', width: 800, height: 400 },
    { file: 'quick-fix.html', out: 'quick-fix.png', width: 800, height: 400 },
    { file: 'scan-report.html', out: 'scan-report.png', width: 800, height: 500 },
  ];

  for (const shot of shots) {
    await page.setViewportSize({ width: shot.width, height: shot.height });
    await page.goto('file://' + path.join(__dirname, shot.file));
    await page.screenshot({ path: path.join(__dirname, shot.out), type: 'png' });
    console.log('Captured ' + shot.out);
  }

  await browser.close();
})();
