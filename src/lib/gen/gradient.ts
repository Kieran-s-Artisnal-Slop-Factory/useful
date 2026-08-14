/**
 * CSS gradient building (plan §5.1.2) — a pure def → CSS string function so
 * the preview and the copyable output can never disagree.
 */

export type GradientKind = 'linear' | 'radial' | 'conic';

export interface GradientStop {
  color: string;
  /** 0–100 (%), or null to let the browser space it. */
  position: number | null;
}

export interface GradientDef {
  kind: GradientKind;
  /** Degrees — linear direction or conic start angle. */
  angle: number;
  /** Radial only. */
  shape: 'circle' | 'ellipse';
  repeating: boolean;
  stops: GradientStop[];
}

export const DEFAULT_GRADIENT: GradientDef = {
  kind: 'linear',
  angle: 135,
  shape: 'ellipse',
  repeating: false,
  stops: [
    { color: '#1e3a5f', position: 0 },
    { color: '#e8a13a', position: 100 },
  ],
};

const fmtStop = (s: GradientStop): string =>
  s.position === null ? s.color : `${s.color} ${trim(s.position)}%`;

const trim = (n: number): string => String(Math.round(n * 100) / 100);

/** The CSS <image> value for the def, e.g. "linear-gradient(135deg, a 0%, b 100%)". */
export function gradientCss(def: GradientDef): string {
  const stops = def.stops.map(fmtStop).join(', ');
  const name = (def.repeating ? 'repeating-' : '') + def.kind + '-gradient';
  switch (def.kind) {
    case 'linear':
      return `${name}(${trim(def.angle)}deg, ${stops})`;
    case 'conic':
      return `${name}(from ${trim(def.angle)}deg, ${stops})`;
    case 'radial':
      return `${name}(${def.shape}, ${stops})`;
  }
}

/** The full copyable declaration. */
export function gradientDeclaration(def: GradientDef): string {
  return `background: ${gradientCss(def)};`;
}
