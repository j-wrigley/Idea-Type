import React, { useCallback, useState } from 'react';

interface FontUploaderProps {
  onFontLoaded: (buffer: ArrayBuffer, fileName: string) => void;
  onOpenDialog: () => void;
  onCreateNew: () => void;
}

export const FontUploader: React.FC<FontUploaderProps> = ({
  onFontLoaded,
  onOpenDialog,
  onCreateNew,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const file = e.dataTransfer.files[0];
      if (!file) return;

      const validExts = ['.otf', '.ttf', '.woff'];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!validExts.includes(ext)) {
        alert('Please upload a .otf, .ttf, or .woff font file.');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          onFontLoaded(reader.result, file.name);
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [onFontLoaded],
  );

  return (
    <div className="uploader-screen">
      <div
        className={`uploader-dropzone ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="uploader-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <h1 className="uploader-title">Font Vector Editor</h1>
        <p className="uploader-subtitle">
          Drag & drop a font file here, or click below to browse
        </p>
        <p className="uploader-formats">Supports .otf, .ttf, .woff</p>
        <div className="uploader-actions">
          <button className="uploader-button" onClick={onOpenDialog}>
            Open Font File
          </button>
          <button className="uploader-button uploader-button-secondary" onClick={onCreateNew}>
            Create New Font
          </button>
        </div>
      </div>
    </div>
  );
};
