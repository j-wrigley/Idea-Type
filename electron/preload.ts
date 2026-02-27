import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFontFile: (): Promise<{ buffer: ArrayBuffer; fileName: string } | null> =>
    ipcRenderer.invoke('open-font-file'),

  saveFontFile: (arrayBuffer: ArrayBuffer, defaultName: string): Promise<boolean> =>
    ipcRenderer.invoke('save-font-file', arrayBuffer, defaultName),
});
