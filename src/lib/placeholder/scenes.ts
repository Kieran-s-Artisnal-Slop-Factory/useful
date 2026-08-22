/**
 * Nine drawn scenes (0.3.0 phase 11).
 *
 * Hand-written SVG, in this repository, for the reason the plan gives:
 * provenance for art we drew is one line, and provenance for art scraped off
 * the web is a research project. They are deliberately simple — flat shapes
 * and a limited palette per scene — because a placeholder that is too
 * detailed stops reading as a placeholder and starts looking like a decision
 * somebody made.
 *
 * Each is drawn in a 160×90 box (16:9) and placed with
 * `preserveAspectRatio="xMidYMid slice"`, so one drawing fills any frame:
 * the proportions hold and the frame crops, like `object-fit: cover`.
 */

export type SceneId =
  | 'mountains'
  | 'forest'
  | 'lake'
  | 'pitch'
  | 'hoop'
  | 'track'
  | 'skyline'
  | 'bridge'
  | 'street';

export interface Scene {
  id: SceneId;
  label: string;
  group: 'Nature' | 'Sport' | 'City';
  /** Painted behind the drawing, so a `slice` crop never shows through. */
  background: string;
  viewBox: string;
  markup: string;
}

const BOX = '0 0 160 90';

export const SCENES: Scene[] = [
  {
    id: 'mountains',
    label: 'Mountains at sunrise',
    group: 'Nature',
    background: '#f3d9b1',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#f3d9b1"/>',
      '<circle cx="112" cy="30" r="13" fill="#f0a868"/>',
      '<path d="M0 90 L34 34 L58 62 L74 44 L104 90 Z" fill="#5b7c99"/>',
      '<path d="M34 34 L44 52 L24 52 Z" fill="#eef4f8"/>',
      '<path d="M64 90 L102 30 L138 76 L160 52 L160 90 Z" fill="#3f5d75"/>',
      '<path d="M102 30 L112 48 L92 48 Z" fill="#eef4f8"/>',
      '<path d="M0 90 L0 78 Q40 70 80 78 T160 78 L160 90 Z" fill="#2c4459"/>',
    ].join(''),
  },
  {
    id: 'forest',
    label: 'Pines in fog',
    group: 'Nature',
    background: '#dfe8e6',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#dfe8e6"/>',
      '<g fill="#9db5ac">',
      '<path d="M18 78 L28 40 L38 78 Z"/><path d="M44 78 L54 34 L64 78 Z"/><path d="M72 78 L80 46 L88 78 Z"/>',
      '<path d="M104 78 L116 36 L128 78 Z"/><path d="M136 78 L146 50 L156 78 Z"/>',
      '</g>',
      '<g fill="#4f7061">',
      '<path d="M8 84 L22 44 L36 84 Z"/><path d="M52 84 L68 30 L84 84 Z"/><path d="M96 84 L110 48 L124 84 Z"/>',
      '<path d="M126 84 L142 38 L158 84 Z"/>',
      '</g>',
      '<rect y="82" width="160" height="8" fill="#33503f"/>',
    ].join(''),
  },
  {
    id: 'lake',
    label: 'Lake and reeds',
    group: 'Nature',
    background: '#cfe4ef',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#cfe4ef"/>',
      '<circle cx="34" cy="24" r="10" fill="#f7f3e3"/>',
      '<path d="M0 52 L28 34 L52 52 Z" fill="#8fa9b8"/>',
      '<path d="M40 52 L74 28 L108 52 Z" fill="#6f8b9c"/>',
      '<rect y="52" width="160" height="38" fill="#4a7f9e"/>',
      '<g stroke="#eaf4f8" stroke-width="1.2" opacity="0.7">',
      '<path d="M14 62 H54"/><path d="M84 68 H126"/><path d="M30 76 H78"/><path d="M96 82 H140"/>',
      '</g>',
      '<g stroke="#3c5a3f" stroke-width="1.6" fill="none">',
      '<path d="M126 90 V60"/><path d="M132 90 V54"/><path d="M138 90 V64"/><path d="M20 90 V68"/><path d="M26 90 V62"/>',
      '</g>',
      '<g fill="#5b422c"><ellipse cx="132" cy="52" rx="2" ry="5"/><ellipse cx="26" cy="60" rx="2" ry="5"/></g>',
    ].join(''),
  },
  {
    id: 'pitch',
    label: 'Football pitch',
    group: 'Sport',
    background: '#4b8b3b',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#4b8b3b"/>',
      '<g fill="#57993f">',
      '<rect x="0" width="20" height="90"/><rect x="40" width="20" height="90"/>',
      '<rect x="80" width="20" height="90"/><rect x="120" width="20" height="90"/>',
      '</g>',
      '<g stroke="#f2f7f0" stroke-width="1.4" fill="none">',
      '<rect x="8" y="8" width="144" height="74"/>',
      '<path d="M80 8 V82"/><circle cx="80" cy="45" r="14"/>',
      '<rect x="8" y="26" width="18" height="38"/><rect x="134" y="26" width="18" height="38"/>',
      '<rect x="8" y="36" width="7" height="18"/><rect x="145" y="36" width="7" height="18"/>',
      '</g>',
      '<circle cx="80" cy="45" r="2.4" fill="#f2f7f0"/>',
    ].join(''),
  },
  {
    id: 'hoop',
    label: 'Basketball hoop',
    group: 'Sport',
    background: '#e8b06a',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#e8b06a"/>',
      '<rect x="52" y="14" width="56" height="34" rx="2" fill="#fdf6ec" stroke="#2f3a45" stroke-width="1.6"/>',
      '<rect x="70" y="30" width="20" height="14" fill="none" stroke="#d9534f" stroke-width="1.6"/>',
      '<rect x="66" y="47" width="28" height="2.6" fill="#d9534f"/>',
      '<path d="M68 50 L72 62 M76 50 L78 62 M84 50 L82 62 M92 50 L88 62" stroke="#fdf6ec" stroke-width="1.2" fill="none"/>',
      '<path d="M68 62 Q80 66 92 62" stroke="#fdf6ec" stroke-width="1.2" fill="none"/>',
      '<rect x="78" y="48" width="4" height="42" fill="#2f3a45"/>',
      '<circle cx="120" cy="70" r="9" fill="#e07b39" stroke="#2f3a45" stroke-width="1.2"/>',
      '<path d="M111 70 H129 M120 61 V79 M113 64 Q120 70 113 76 M127 64 Q120 70 127 76" stroke="#2f3a45" stroke-width="0.9" fill="none"/>',
      '<rect y="84" width="160" height="6" fill="#b7854a"/>',
    ].join(''),
  },
  {
    id: 'track',
    label: 'Running track',
    group: 'Sport',
    background: '#c96a52',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#c96a52"/>',
      '<g fill="none" stroke="#f6efe6" stroke-width="1.2">',
      '<rect x="10" y="14" width="140" height="62" rx="31"/>',
      '<rect x="20" y="22" width="120" height="46" rx="23"/>',
      '<rect x="30" y="30" width="100" height="30" rx="15"/>',
      '</g>',
      '<rect x="44" y="30" width="72" height="30" rx="2" fill="#5f9a4f"/>',
      '<g stroke="#f6efe6" stroke-width="1.2"><path d="M80 14 V22"/><path d="M80 68 V76"/></g>',
    ].join(''),
  },
  {
    id: 'skyline',
    label: 'Skyline at dusk',
    group: 'City',
    background: '#2b3a55',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#2b3a55"/>',
      '<circle cx="130" cy="22" r="8" fill="#f6d186"/>',
      '<g fill="#1d2942">',
      '<rect x="4" y="46" width="18" height="44"/><rect x="26" y="32" width="14" height="58"/>',
      '<rect x="44" y="52" width="20" height="38"/><rect x="68" y="24" width="16" height="66"/>',
      '<rect x="88" y="40" width="22" height="50"/><rect x="114" y="56" width="14" height="34"/>',
      '<rect x="132" y="36" width="24" height="54"/>',
      '</g>',
      '<g fill="#f6d186">',
      '<rect x="8" y="52" width="3" height="4"/><rect x="15" y="52" width="3" height="4"/><rect x="8" y="62" width="3" height="4"/>',
      '<rect x="30" y="40" width="3" height="4"/><rect x="30" y="50" width="3" height="4"/><rect x="35" y="60" width="3" height="4"/>',
      '<rect x="72" y="32" width="3" height="4"/><rect x="78" y="32" width="3" height="4"/><rect x="72" y="44" width="3" height="4"/>',
      '<rect x="94" y="48" width="3" height="4"/><rect x="102" y="48" width="3" height="4"/><rect x="94" y="60" width="3" height="4"/>',
      '<rect x="138" y="44" width="3" height="4"/><rect x="146" y="44" width="3" height="4"/><rect x="138" y="56" width="3" height="4"/>',
      '</g>',
      '<rect y="86" width="160" height="4" fill="#131c30"/>',
    ].join(''),
  },
  {
    id: 'bridge',
    label: 'Bridge over water',
    group: 'City',
    background: '#bcd4e0',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#bcd4e0"/>',
      '<rect y="60" width="160" height="30" fill="#5b87a6"/>',
      '<g stroke="#a83b32" stroke-width="2.4" fill="none">',
      '<path d="M0 34 Q40 6 80 34 T160 34"/>',
      '<path d="M8 34 V56 M28 22 V56 M52 20 V56 M80 34 V56 M108 20 V56 M132 22 V56 M152 34 V56"/>',
      '</g>',
      '<rect x="0" y="54" width="160" height="5" fill="#8c3029"/>',
      '<rect x="24" y="14" width="6" height="46" fill="#a83b32"/>',
      '<rect x="130" y="14" width="6" height="46" fill="#a83b32"/>',
      '<g stroke="#eaf2f6" stroke-width="1" opacity="0.7"><path d="M12 70 H50"/><path d="M76 78 H118"/><path d="M30 82 H72"/></g>',
    ].join(''),
  },
  {
    id: 'street',
    label: 'Street of shops',
    group: 'City',
    background: '#efe3d0',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#efe3d0"/>',
      '<g stroke="#3b3a36" stroke-width="1.2">',
      '<rect x="6" y="30" width="34" height="46" fill="#d98f6a"/>',
      '<rect x="44" y="20" width="30" height="56" fill="#e5c46b"/>',
      '<rect x="78" y="34" width="32" height="42" fill="#8fb08a"/>',
      '<rect x="114" y="24" width="38" height="52" fill="#9fb6c9"/>',
      '</g>',
      '<g fill="#f7f2e6">',
      '<rect x="12" y="38" width="8" height="8"/><rect x="26" y="38" width="8" height="8"/>',
      '<rect x="50" y="28" width="8" height="8"/><rect x="62" y="28" width="8" height="8"/><rect x="50" y="42" width="8" height="8"/>',
      '<rect x="84" y="42" width="8" height="8"/><rect x="98" y="42" width="8" height="8"/>',
      '<rect x="120" y="32" width="8" height="8"/><rect x="134" y="32" width="8" height="8"/><rect x="120" y="46" width="8" height="8"/>',
      '</g>',
      '<g fill="#5b422c">',
      '<rect x="18" y="60" width="10" height="16"/><rect x="54" y="58" width="10" height="18"/>',
      '<rect x="90" y="62" width="10" height="14"/><rect x="128" y="58" width="10" height="18"/>',
      '</g>',
      '<rect y="76" width="160" height="14" fill="#6f6a61"/>',
      '<g stroke="#efe3d0" stroke-width="1.4"><path d="M6 84 H22"/><path d="M34 84 H50"/><path d="M62 84 H78"/><path d="M90 84 H106"/><path d="M118 84 H134"/><path d="M146 84 H158"/></g>',
    ].join(''),
  },
];

export const SCENE_GROUPS: Scene['group'][] = ['Nature', 'Sport', 'City'];

export const sceneById = (id: string): Scene => SCENES.find((s) => s.id === id) ?? SCENES[0]!;
