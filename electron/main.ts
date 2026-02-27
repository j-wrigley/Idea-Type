import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('open-font-file', async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Font Files', extensions: ['otf', 'ttf', 'woff'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const nodeBuffer = readFileSync(filePath);
  const arrayBuffer = nodeBuffer.buffer.slice(
    nodeBuffer.byteOffset,
    nodeBuffer.byteOffset + nodeBuffer.byteLength,
  );

  return {
    buffer: arrayBuffer,
    fileName: path.basename(filePath),
  };
});

ipcMain.handle(
  'save-font-file',
  async (_event, arrayBuffer: ArrayBuffer, defaultName: string) => {
    if (!mainWindow) return false;

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [
        { name: 'OpenType Font', extensions: ['otf'] },
        { name: 'TrueType Font', extensions: ['ttf'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return false;
    }

    writeFileSync(result.filePath, Buffer.from(arrayBuffer));
    return true;
  },
);
