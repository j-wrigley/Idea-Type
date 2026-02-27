import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Font } from 'opentype.js';
import type { Theme } from '../App';

export interface ExportMetadata {
  familyName: string;
  styleName: string;
  version: string;
  copyright: string;
  designer: string;
  description: string;
  license: string;
  fileName: string;
  format: 'ttf' | 'woff';
  hinting: boolean;
}

interface ExportDialogProps {
  font: Font;
  theme: Theme;
  currentFileName: string;
  onExport: (metadata: ExportMetadata) => void;
  onCancel: () => void;
}

function getNameField(font: Font, field: string): string {
  const entry = font.names[field];
  if (!entry) return '';
  return entry.en || Object.values(entry)[0] || '';
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ font, theme, currentFileName, onExport, onCancel }) => {
  const defaults = useMemo(() => {
    const family = getNameField(font, 'fontFamily') || 'Untitled';
    const style = getNameField(font, 'fontSubfamily') || 'Regular';
    const version = getNameField(font, 'version') || 'Version 1.0';
    const copyright = getNameField(font, 'copyright');
    const designer = getNameField(font, 'designer');
    const description = getNameField(font, 'description');
    const license = getNameField(font, 'license');
    const baseName = currentFileName.replace(/\.[^.]+$/, '').replace(/-edited$/, '');
    return { family, style, version, copyright, designer, description, license, baseName };
  }, [font, currentFileName]);

  const [familyName, setFamilyName] = useState(defaults.family);
  const [styleName, setStyleName] = useState(defaults.style);
  const [version, setVersion] = useState(defaults.version);
  const [copyright, setCopyright] = useState(defaults.copyright);
  const [designer, setDesigner] = useState(defaults.designer);
  const [description, setDescription] = useState(defaults.description);
  const [license, setLicense] = useState(defaults.license);
  const [format, setFormat] = useState<'ttf' | 'woff'>('ttf');
  const [hinting] = useState(false);

  const fileName = useMemo(() => {
    const base = familyName.replace(/\s+/g, '') + '-' + styleName.replace(/\s+/g, '');
    return `${base}.${format}`;
  }, [familyName, styleName, format]);

  const handleExport = useCallback(() => {
    onExport({ familyName, styleName, version, copyright, designer, description, license, fileName, format, hinting });
  }, [familyName, styleName, version, copyright, designer, description, license, fileName, format, hinting, onExport]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && e.metaKey) handleExport();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel, handleExport]);

  return (
    <div className="export-overlay" onClick={onCancel}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="export-title">Export Font</h2>

        <div className="export-section">
          <div className="export-row">
            <div className="export-field">
              <label className="export-label">Family Name</label>
              <input
                type="text"
                className="export-input"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="export-field">
              <label className="export-label">Style</label>
              <input
                type="text"
                className="export-input"
                value={styleName}
                onChange={(e) => setStyleName(e.target.value)}
              />
            </div>
          </div>

          <div className="export-field">
            <label className="export-label">Version</label>
            <input
              type="text"
              className="export-input"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>
        </div>

        <div className="export-section">
          <h3 className="export-section-title">Metadata (optional)</h3>
          <div className="export-field">
            <label className="export-label">Copyright</label>
            <input
              type="text"
              className="export-input"
              value={copyright}
              onChange={(e) => setCopyright(e.target.value)}
              placeholder="Copyright 2026 Your Name"
            />
          </div>
          <div className="export-field">
            <label className="export-label">Designer</label>
            <input
              type="text"
              className="export-input"
              value={designer}
              onChange={(e) => setDesigner(e.target.value)}
              placeholder="Designer name"
            />
          </div>
          <div className="export-field">
            <label className="export-label">Description</label>
            <input
              type="text"
              className="export-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description"
            />
          </div>
          <div className="export-field">
            <label className="export-label">License</label>
            <input
              type="text"
              className="export-input"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              placeholder="e.g. OFL, MIT"
            />
          </div>
        </div>

        <div className="export-section">
          <h3 className="export-section-title">Output</h3>
          <div className="export-row">
            <div className="export-field export-field-grow">
              <label className="export-label">File Name</label>
              <span className="export-filename">{fileName}</span>
            </div>
            <div className="export-field">
              <label className="export-label">Format</label>
              <div className="export-format-btns">
                <button
                  className={`export-format-btn ${format === 'ttf' ? 'active' : ''}`}
                  onClick={() => setFormat('ttf')}
                >
                  TTF
                </button>
                <button
                  className={`export-format-btn ${format === 'woff' ? 'active' : ''}`}
                  onClick={() => setFormat('woff')}
                >
                  WOFF
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="export-actions">
          <button className="export-cancel-btn" onClick={onCancel}>Cancel</button>
          <button className="export-confirm-btn" onClick={handleExport} disabled={!familyName}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
};
