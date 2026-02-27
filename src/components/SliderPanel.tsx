import React, { useCallback, useState } from 'react';
import type { TransformValues, GridSettings, MetricLine } from '../types';
import { isDefaultTransform, DEFAULT_TRANSFORM } from '../types';
import type { Font, Glyph, PathCommand } from 'opentype.js';

export interface DesignToolValues {
  weight: number;
  width: number;
  contrast: number;
  opticalSize: number;
  xHeight: number;
  ascenderExtend: number;
  descenderExtend: number;
  spacing: number;
  roundness: number;
  slant: number;
  inkTrap: number;
  serif: number;
  overshoot: number;
}

export const DEFAULT_DESIGN_TOOLS: DesignToolValues = {
  weight: 0,
  width: 0,
  contrast: 0,
  opticalSize: 0,
  xHeight: 0,
  ascenderExtend: 0,
  descenderExtend: 0,
  spacing: 0,
  roundness: 0,
  slant: 0,
  inkTrap: 0,
  serif: 0,
  overshoot: 0,
};

export function isDefaultDesignTools(d: DesignToolValues): boolean {
  return (
    d.weight === 0 && d.width === 0 && d.contrast === 0 &&
    d.opticalSize === 0 && d.xHeight === 0 &&
    d.ascenderExtend === 0 && d.descenderExtend === 0 &&
    d.spacing === 0 && d.roundness === 0 &&
    d.slant === 0 && d.inkTrap === 0 && d.serif === 0 &&
    d.overshoot === 0
  );
}

interface SliderPanelProps {
  transform: TransformValues;
  onChange: (transform: TransformValues) => void;
  onApply: () => void;
  onApplyToAll: () => void;
  font: Font;
  glyph: Glyph | null;
  commandCount: number;
  gridSettings: GridSettings;
  onGridChange: (settings: GridSettings) => void;
  selectedPointCount: number;
  metricLines: MetricLine[];
  onMetricLinesChange: (lines: MetricLine[]) => void;
  designTools: DesignToolValues;
  onDesignToolsChange: (tools: DesignToolValues) => void;
  onApplyDesignTools: () => void;
  onApplyDesignToolsToAll: () => void;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
  onChange: (value: number) => void;
}

const GRID_SIZES = [10, 25, 50, 100, 200, 500];

const SliderRow: React.FC<SliderRowProps> = ({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  unit = '',
  onChange,
}) => {
  return (
    <div className="slider-row">
      <div className="slider-header">
        <label className="slider-label">{label}</label>
        <span className="slider-value">
          {Number.isInteger(step) ? value : value.toFixed(2)}
          {unit}
        </span>
      </div>
      <div className="slider-track-container">
        <input
          type="range"
          className="slider-input"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        {value !== defaultValue && (
          <button
            className="slider-reset-btn"
            onClick={() => onChange(defaultValue)}
            title="Reset to default"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
};

export const SliderPanel: React.FC<SliderPanelProps> = ({
  transform,
  onChange,
  onApply,
  onApplyToAll,
  font,
  glyph,
  commandCount,
  gridSettings,
  onGridChange,
  selectedPointCount,
  metricLines,
  onMetricLinesChange,
  designTools,
  onDesignToolsChange,
  onApplyDesignTools,
  onApplyDesignToolsToAll,
}) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDesignConfirm, setShowDesignConfirm] = useState(false);
  const [newLineName, setNewLineName] = useState('');
  const [newLineValue, setNewLineValue] = useState('0');
  const [showAddLine, setShowAddLine] = useState(false);

  const handleToggleLine = useCallback((id: string) => {
    onMetricLinesChange(metricLines.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  }, [metricLines, onMetricLinesChange]);

  const handleLineValueChange = useCallback((id: string, value: number) => {
    onMetricLinesChange(metricLines.map(l => l.id === id ? { ...l, value } : l));
  }, [metricLines, onMetricLinesChange]);

  const handleRemoveLine = useCallback((id: string) => {
    onMetricLinesChange(metricLines.filter(l => l.id !== id));
  }, [metricLines, onMetricLinesChange]);

  const handleAddCustomLine = useCallback(() => {
    const label = newLineName.trim();
    if (!label) return;
    const value = parseInt(newLineValue) || 0;
    const id = `custom_${Date.now()}`;
    onMetricLinesChange([...metricLines, { id, label, value, visible: true, editable: true, builtin: false }]);
    setNewLineName('');
    setNewLineValue('0');
    setShowAddLine(false);
  }, [newLineName, newLineValue, metricLines, onMetricLinesChange]);

  const update = useCallback(
    (field: keyof TransformValues, value: number) => {
      onChange({ ...transform, [field]: value });
    },
    [transform, onChange],
  );

  const canApply = !isDefaultTransform(transform);

  const handleApplyToAll = useCallback(() => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }
    setShowConfirm(false);
    onApplyToAll();
  }, [showConfirm, onApplyToAll]);

  const handleDesignApplyToAll = useCallback(() => {
    if (!showDesignConfirm) {
      setShowDesignConfirm(true);
      return;
    }
    setShowDesignConfirm(false);
    onApplyDesignToolsToAll();
  }, [showDesignConfirm, onApplyDesignToolsToAll]);

  return (
    <div className="slider-panel">
      <div className="panel-section">
        <h3 className="panel-title">Font Metrics</h3>
        <div className="metrics-grid">
          <div className="metric-item">
            <span className="metric-label">Units/Em</span>
            <span className="metric-value">{font.unitsPerEm}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Ascender</span>
            <span className="metric-value">{font.ascender}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Descender</span>
            <span className="metric-value">{font.descender}</span>
          </div>
          {glyph && (
            <>
              <div className="metric-item">
                <span className="metric-label">Advance W</span>
                <span className="metric-value">{glyph.advanceWidth ?? 0}</span>
              </div>
              <div className="metric-item">
                <span className="metric-label">Commands</span>
                <span className="metric-value">{commandCount}</span>
              </div>
              <div className="metric-item">
                <span className="metric-label">Selected</span>
                <span className="metric-value">{selectedPointCount} pts</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="panel-section">
        <h3 className="panel-title">Transform</h3>
        <SliderRow
          label="Scale X"
          value={transform.scaleX}
          min={0.1}
          max={3}
          step={0.01}
          defaultValue={1}
          unit="x"
          onChange={(v) => update('scaleX', v)}
        />
        <SliderRow
          label="Scale Y"
          value={transform.scaleY}
          min={0.1}
          max={3}
          step={0.01}
          defaultValue={1}
          unit="x"
          onChange={(v) => update('scaleY', v)}
        />
        <SliderRow
          label="Rotation"
          value={transform.rotation}
          min={-180}
          max={180}
          step={1}
          defaultValue={0}
          unit="°"
          onChange={(v) => update('rotation', v)}
        />
        <SliderRow
          label="Shift X"
          value={transform.shiftX}
          min={-500}
          max={500}
          step={1}
          defaultValue={0}
          onChange={(v) => update('shiftX', v)}
        />
        <SliderRow
          label="Shift Y"
          value={transform.shiftY}
          min={-500}
          max={500}
          step={1}
          defaultValue={0}
          onChange={(v) => update('shiftY', v)}
        />
        <SliderRow
          label="Skew X"
          value={transform.skewX}
          min={-45}
          max={45}
          step={0.5}
          defaultValue={0}
          unit="°"
          onChange={(v) => update('skewX', v)}
        />
        <SliderRow
          label="Skew Y"
          value={transform.skewY}
          min={-45}
          max={45}
          step={0.5}
          defaultValue={0}
          unit="°"
          onChange={(v) => update('skewY', v)}
        />
        <div className="slider-actions">
          <button
            className="btn-apply"
            onClick={onApply}
            disabled={!canApply}
          >
            Apply
          </button>
          <button
            className={`btn-apply ${showConfirm ? 'btn-danger' : 'btn-secondary'}`}
            onClick={handleApplyToAll}
            disabled={!canApply}
          >
            {showConfirm ? 'Confirm All?' : 'Apply to All'}
          </button>
          <button
            className="btn-reset"
            onClick={() => { onChange(DEFAULT_TRANSFORM); setShowConfirm(false); }}
            disabled={!canApply}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="panel-section">
        <h3 className="panel-title">Grid</h3>
        <div className="grid-controls">
          <label className="toggle-row">
            <span className="slider-label">Show Grid</span>
            <input
              type="checkbox"
              checked={gridSettings.visible}
              onChange={(e) => onGridChange({ ...gridSettings, visible: e.target.checked })}
            />
          </label>
          <label className="toggle-row">
            <span className="slider-label">Snap to Grid</span>
            <input
              type="checkbox"
              checked={gridSettings.snapToGrid}
              onChange={(e) => onGridChange({ ...gridSettings, snapToGrid: e.target.checked })}
            />
          </label>
          <div className="slider-header" style={{ marginTop: 6 }}>
            <span className="slider-label">Grid Size</span>
            <select
              className="grid-select"
              value={gridSettings.spacing}
              onChange={(e) => onGridChange({ ...gridSettings, spacing: parseInt(e.target.value) })}
            >
              {GRID_SIZES.map((s) => (
                <option key={s} value={s}>{s} units</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <h3 className="panel-title">Guidelines</h3>
        <div className="guidelines-list">
          {metricLines.map((line) => (
            <div key={line.id} className="guideline-row">
              <input
                type="checkbox"
                checked={line.visible}
                onChange={() => handleToggleLine(line.id)}
                title={`Toggle ${line.label}`}
              />
              <span className="guideline-label">{line.label}</span>
              {line.editable ? (
                <input
                  type="number"
                  className="guideline-value-input"
                  value={line.value}
                  onChange={(e) => handleLineValueChange(line.id, parseInt(e.target.value) || 0)}
                />
              ) : (
                <span className="guideline-value-readonly">{line.value}</span>
              )}
              {!line.builtin && (
                <button className="guideline-remove-btn" onClick={() => handleRemoveLine(line.id)} title="Remove line">&times;</button>
              )}
            </div>
          ))}
        </div>
        {showAddLine ? (
          <div className="guideline-add-form">
            <input
              type="text"
              className="guideline-name-input"
              placeholder="Label"
              value={newLineName}
              onChange={(e) => setNewLineName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomLine(); }}
              autoFocus
            />
            <input
              type="number"
              className="guideline-value-input"
              placeholder="Y"
              value={newLineValue}
              onChange={(e) => setNewLineValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomLine(); }}
            />
            <button className="btn-apply" style={{ padding: '2px 8px', fontSize: 12 }} onClick={handleAddCustomLine}>Add</button>
            <button className="btn-reset" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setShowAddLine(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn-secondary" style={{ marginTop: 6, fontSize: 12, width: '100%' }} onClick={() => setShowAddLine(true)}>+ Add Custom Line</button>
        )}
      </div>

      <div className="panel-section">
        <h3 className="panel-title">Design Tools</h3>
        <SliderRow label="Weight" value={designTools.weight} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => onDesignToolsChange({ ...designTools, weight: v })} />
        <SliderRow label="Width" value={designTools.width} min={-100} max={100} step={1} defaultValue={0} unit="%" onChange={(v) => onDesignToolsChange({ ...designTools, width: v })} />
        <SliderRow label="Contrast" value={designTools.contrast} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => onDesignToolsChange({ ...designTools, contrast: v })} />
        <SliderRow label="Slant" value={designTools.slant} min={-30} max={30} step={1} defaultValue={0} unit="°" onChange={(v) => onDesignToolsChange({ ...designTools, slant: v })} />
        <SliderRow label="x-Height" value={designTools.xHeight} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => onDesignToolsChange({ ...designTools, xHeight: v })} />
        <SliderRow label="Ascender" value={designTools.ascenderExtend} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => onDesignToolsChange({ ...designTools, ascenderExtend: v })} />
        <SliderRow label="Descender" value={designTools.descenderExtend} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => onDesignToolsChange({ ...designTools, descenderExtend: v })} />
        <SliderRow label="Overshoot" value={designTools.overshoot} min={-50} max={50} step={1} defaultValue={0} onChange={(v) => onDesignToolsChange({ ...designTools, overshoot: v })} />
        <SliderRow label="Roundness" value={designTools.roundness} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => onDesignToolsChange({ ...designTools, roundness: v })} />
        <SliderRow label="Ink Trap" value={designTools.inkTrap} min={0} max={100} step={1} defaultValue={0} onChange={(v) => onDesignToolsChange({ ...designTools, inkTrap: v })} />
        <SliderRow label="Serif" value={designTools.serif} min={0} max={100} step={1} defaultValue={0} onChange={(v) => onDesignToolsChange({ ...designTools, serif: v })} />
        <SliderRow label="Optical Size" value={designTools.opticalSize} min={-50} max={50} step={1} defaultValue={0} onChange={(v) => onDesignToolsChange({ ...designTools, opticalSize: v })} />
        <SliderRow label="Spacing" value={designTools.spacing} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => onDesignToolsChange({ ...designTools, spacing: v })} />
        <div className="slider-actions">
          <button
            className="btn-apply"
            onClick={onApplyDesignTools}
            disabled={isDefaultDesignTools(designTools)}
          >
            Apply
          </button>
          <button
            className={`btn-apply ${showDesignConfirm ? 'btn-danger' : 'btn-secondary'}`}
            onClick={handleDesignApplyToAll}
            disabled={isDefaultDesignTools(designTools)}
          >
            {showDesignConfirm ? 'Confirm All?' : 'Apply to All'}
          </button>
          <button
            className="btn-reset"
            onClick={() => { onDesignToolsChange(DEFAULT_DESIGN_TOOLS); setShowDesignConfirm(false); }}
            disabled={isDefaultDesignTools(designTools)}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
};
