import { contextBridge, ipcRenderer, clipboard } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFontFile: (): Promise<{ buffer: ArrayBuffer; fileName: string } | null> =>
    ipcRenderer.invoke('open-font-file'),

  saveFontFile: (arrayBuffer: ArrayBuffer, defaultName: string): Promise<boolean> =>
    ipcRenderer.invoke('save-font-file', arrayBuffer, defaultName),

  readClipboard: (): { html: string; text: string } => ({
    html: clipboard.readHTML(),
    text: clipboard.readText(),
  }),

  writeClipboard: (text: string, html: string): void => {
    clipboard.write({ text, html });
  },
});
