/**
 * render-html.cjs — screenshots a local HTML file with Electron.
 *
 *   xvfb-run -a npx electron scripts/render-html.cjs <input.html> <output.png> [width] [height]
 *
 * Used to eyeball the printed report without a printer.
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

app.disableHardwareAcceleration()

app
  .whenReady()
  .then(async () => {
    const [input, output, w, h] = process.argv.slice(2)
    if (!input || !output) {
      console.error('usage: render-html.cjs <input.html> <output.png> [width] [height]')
      app.exit(2)
      return
    }

    const win = new BrowserWindow({
      width: Number(w) || 820,
      height: Number(h) || 1180,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })

    await win.loadURL(pathToFileURL(path.resolve(input)).href)
    // Let webfonts and the embedded base64 images settle.
    await new Promise((r) => setTimeout(r, 1400))

    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
    if (String(output).toLowerCase().endsWith('.pdf')) {
      const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
      fs.writeFileSync(path.resolve(output), pdf)
    } else {
      const image = await win.webContents.capturePage()
      fs.writeFileSync(path.resolve(output), image.toPNG())
    }
    console.log(`[render] ${output} (${fs.statSync(path.resolve(output)).size} bytes)`)
    app.exit(0)
  })
  .catch((err) => {
    console.error('[render] failed:', err)
    app.exit(1)
  })
