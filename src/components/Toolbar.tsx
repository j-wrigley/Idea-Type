import React from 'react';
import type { Theme } from '../App';
import type { EditorTool } from '../types';

interface ToolbarProps {
  fileName: string;
  canUndo: boolean;
  canRedo: boolean;
  hasGlyph: boolean;
  hasSelection: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onDelete: () => void;
  zoom: number;
  theme: Theme;
  onToggleTheme: () => void;
  showRulers: boolean;
  onToggleRulers: () => void;
  showPathDirection: boolean;
  onTogglePathDirection: () => void;
  showFill: boolean;
  onToggleFill: () => void;
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  onReverseContour: () => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  fileName,
  canUndo,
  canRedo,
  hasGlyph,
  hasSelection,
  onNew,
  onOpen,
  onSave,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onDelete,
  zoom,
  theme,
  onToggleTheme,
  showRulers,
  onToggleRulers,
  showPathDirection,
  onTogglePathDirection,
  showFill,
  onToggleFill,
  activeTool,
  onToolChange,
  onReverseContour,
  onFlipHorizontal,
  onFlipVertical,
}) => {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="toolbar-drag-region" />
        <button className="toolbar-btn" onClick={onNew} title="New Font (Cmd+N)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
          <span>New</span>
        </button>
        <button className="toolbar-btn" onClick={onOpen} title="Open Font (Cmd+O)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span>Open</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={onSave}
          disabled={!hasGlyph}
          title="Export Font (Cmd+S)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>Export</span>
        </button>
        <div className="toolbar-divider" />
        <button
          className="toolbar-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Cmd+Z)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
        <button
          className="toolbar-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Cmd+Shift+Z)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <div className="toolbar-divider" />
        <button
          className="toolbar-btn"
          onClick={onDelete}
          disabled={!hasSelection}
          title="Delete Selected Points (Delete)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
        <div className="toolbar-divider" />
        <button
          className={`toolbar-btn ${activeTool === 'select' ? 'active' : ''}`}
          onClick={() => onToolChange('select')}
          title="Select Tool (V)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
            <path d="M4 2l14 10.5-6.5 1.5-3 6.5L4 2z" fill="currentColor" stroke="currentColor" />
            <path d="M11.5 14l4.5 6.5" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className={`toolbar-btn ${activeTool === 'shape' ? 'active' : ''}`}
          onClick={() => onToolChange(activeTool === 'shape' ? 'select' : 'shape')}
          title="Shape Select Tool (A). Double-click overlapping shapes to cycle selection."
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
            <path d="M4 2l14 10.5-6.5 1.5-3 6.5L4 2z" stroke="currentColor" />
            <path d="M11.5 14l4.5 6.5" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className={`toolbar-btn ${activeTool === 'pen' ? 'active' : ''}`}
          onClick={() => onToolChange(activeTool === 'pen' ? 'select' : 'pen')}
          title="Pen Tool (P)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            <path d="M2 2l7.586 7.586" />
            <circle cx="11" cy="11" r="2" />
          </svg>
        </button>
        <button
          className={`toolbar-btn ${activeTool === 'rect' ? 'active' : ''}`}
          onClick={() => onToolChange(activeTool === 'rect' ? 'select' : 'rect')}
          title="Rectangle Tool (R)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="0" ry="0" />
          </svg>
        </button>
        <button
          className={`toolbar-btn ${activeTool === 'ellipse' ? 'active' : ''}`}
          onClick={() => onToolChange(activeTool === 'ellipse' ? 'select' : 'ellipse')}
          title="Ellipse Tool (E)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="12" rx="10" ry="10" />
          </svg>
        </button>
        <button
          className={`toolbar-btn ${activeTool === 'slice' ? 'active' : ''}`}
          onClick={() => onToolChange(activeTool === 'slice' ? 'select' : 'slice')}
          title="Slice Tool (X). Drag a line across shapes to cut and split them."
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="5" width="14" height="14" rx="1" />
            <path d="M5 19L19 5" strokeWidth="2" />
          </svg>
        </button>
        <div className="toolbar-divider" />
        <button
          className="toolbar-btn"
          onClick={onReverseContour}
          disabled={!hasSelection}
          title="Reverse Contour Direction (Shift+R)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10" />
            <polyline points="23 20 23 14 17 14" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
        </button>
        <button
          className="toolbar-btn"
          onClick={onFlipHorizontal}
          disabled={!hasSelection}
          title="Flip Horizontal (Shift+H)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2 2" />
            <polygon points="3,12 9,6 9,18" fill="currentColor" stroke="none" />
            <polygon points="21,12 15,6 15,18" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button
          className="toolbar-btn"
          onClick={onFlipVertical}
          disabled={!hasSelection}
          title="Flip Vertical (Shift+Alt+V)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" strokeDasharray="2 2" />
            <polygon points="12,3 6,9 18,9" fill="currentColor" stroke="none" />
            <polygon points="12,21 6,15 18,15" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <div className="toolbar-divider" />
        <button
          className={`toolbar-btn ${showRulers ? 'active' : ''}`}
          onClick={onToggleRulers}
          title="Toggle Rulers"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 2v20h20" />
            <line x1="2" y1="8" x2="6" y2="8" />
            <line x1="2" y1="14" x2="4" y2="14" />
            <line x1="8" y1="22" x2="8" y2="18" />
            <line x1="14" y1="22" x2="14" y2="20" />
          </svg>
        </button>
        <button
          className={`toolbar-btn ${showPathDirection ? 'active' : ''}`}
          onClick={onTogglePathDirection}
          title="Toggle Path Direction"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button
          className={`toolbar-btn ${showFill ? 'active' : ''}`}
          onClick={onToggleFill}
          title="Toggle Fill Preview (F)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={showFill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          </svg>
        </button>
      </div>

      <div className="toolbar-center">
        <span className="toolbar-filename">{fileName}</span>
      </div>

      <div className="toolbar-right">
        <button
          className="toolbar-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <div className="toolbar-divider" />
        <button className="toolbar-btn small" onClick={onZoomOut} title="Zoom Out">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          className="toolbar-btn zoom-label"
          onClick={onZoomReset}
          title="Reset Zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="toolbar-btn small" onClick={onZoomIn} title="Zoom In">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
};
