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
  | 'desert'
  | 'coast'
  | 'pitch'
  | 'hoop'
  | 'track'
  | 'tennis'
  | 'cycling'
  | 'skyline'
  | 'bridge'
  | 'street'
  | 'subway'
  | 'rooftops';

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
    id: 'desert',
    label: 'Desert at noon',
    group: 'Nature',
    background: '#f2c078',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#f6d9a0"/>',
      '<circle cx="126" cy="20" r="9" fill="#f9f0d2"/>',
      '<path d="M0 54 L26 40 L52 54 Z" fill="#d9a066"/>',
      '<path d="M60 54 L92 36 L124 54 Z" fill="#c98f57"/>',
      '<rect y="54" width="160" height="36" fill="#e8b877"/>',
      '<path d="M0 68 Q40 62 80 68 T160 68" fill="none" stroke="#d9a066" stroke-width="1.4"/>',
      '<g fill="#4f7a3f">',
      '<rect x="30" y="56" width="5" height="26" rx="2.5"/>',
      '<rect x="20" y="62" width="4" height="12" rx="2"/><rect x="20" y="62" width="12" height="4" rx="2"/>',
      '<rect x="41" y="58" width="4" height="14" rx="2"/><rect x="33" y="58" width="12" height="4" rx="2"/>',
      '<rect x="120" y="64" width="4" height="18" rx="2"/>',
      '<rect x="113" y="68" width="3" height="9" rx="1.5"/><rect x="113" y="68" width="9" height="3" rx="1.5"/>',
      '</g>',
      '<ellipse cx="32" cy="84" rx="14" ry="3" fill="#d9a066" opacity="0.6"/>',
    ].join(''),
  },
  {
    id: 'coast',
    label: 'Coast at dusk',
    group: 'Nature',
    background: '#f0a4a4',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#f7bfa8"/>',
      '<rect width="160" height="46" fill="#e98d84"/>',
      '<circle cx="80" cy="44" r="14" fill="#fbe3b0"/>',
      '<path d="M0 46 L22 30 L44 46 Z" fill="#7a5a72"/>',
      '<path d="M108 46 L134 26 L160 46 Z" fill="#6a4c66"/>',
      '<rect y="46" width="160" height="44" fill="#4e6a8a"/>',
      '<g fill="#fbe3b0" opacity="0.55">',
      '<rect x="74" y="50" width="12" height="3"/><rect x="72" y="58" width="16" height="3"/>',
      '<rect x="70" y="66" width="20" height="3"/><rect x="66" y="76" width="28" height="3"/>',
      '</g>',
      '<g stroke="#dbe8f2" stroke-width="1.2" fill="none" opacity="0.6">',
      '<path d="M8 62 H40"/><path d="M112 70 H148"/><path d="M24 80 H62"/>',
      '</g>',
      '<path d="M0 86 Q40 82 80 86 T160 86 L160 90 L0 90 Z" fill="#e0c9a6"/>',
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
    id: 'tennis',
    label: 'Tennis court',
    group: 'Sport',
    background: '#2f6f8f',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#2f6f8f"/>',
      '<path d="M28 12 H132 L156 84 H4 Z" fill="#4b8f5f"/>',
      '<g stroke="#f4f8f4" stroke-width="1.3" fill="none">',
      '<path d="M36 18 H124 L146 78 H14 Z"/>',
      '<path d="M46 40 H114"/><path d="M42 58 H118"/>',
      '<path d="M80 40 V58"/>',
      '<path d="M32 30 H128"/>',
      '</g>',
      '<rect x="20" y="46" width="120" height="2" fill="#e9eef2"/>',
      '<g stroke="#c8d4dc" stroke-width="0.8"><path d="M22 46 V56"/><path d="M138 46 V56"/></g>',
      '<circle cx="104" cy="66" r="3" fill="#d8e94a"/>',
      '<g fill="#2f3a45"><ellipse cx="60" cy="70" rx="4" ry="7"/><rect x="59" y="60" width="2" height="8"/></g>',
    ].join(''),
  },
  {
    id: 'cycling',
    label: 'Bicycle on a road',
    group: 'Sport',
    background: '#cfe0e8',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#cfe0e8"/>',
      '<path d="M0 58 L34 44 L70 58 Z" fill="#9db9c4"/>',
      '<path d="M56 58 L100 40 L146 58 Z" fill="#84a5b3"/>',
      '<rect y="58" width="160" height="32" fill="#5a6b72"/>',
      '<g stroke="#e8eef0" stroke-width="2" stroke-dasharray="10 8"><path d="M0 74 H160"/></g>',
      '<g fill="none" stroke="#22303a" stroke-width="2">',
      '<circle cx="52" cy="66" r="11"/><circle cx="104" cy="66" r="11"/>',
      '<path d="M52 66 L70 66 L82 48 L92 66"/><path d="M70 66 L82 48"/><path d="M104 66 L92 66"/>',
      '<path d="M82 48 L88 42"/><path d="M92 66 L96 50 L104 50"/>',
      '</g>',
      '<circle cx="88" cy="34" r="5" fill="#e0693a"/>',
      '<path d="M86 39 L80 50 L92 50 Z" fill="#e0693a"/>',
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
  {
    id: 'subway',
    label: 'Subway platform',
    group: 'City',
    background: '#e6e2d8',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#e6e2d8"/>',
      '<rect width="160" height="18" fill="#c9c3b6"/>',
      '<g fill="#f4f1e9" stroke="#d3cec2" stroke-width="0.6">',
      '<rect x="6" y="22" width="14" height="14"/><rect x="24" y="22" width="14" height="14"/>',
      '<rect x="42" y="22" width="14" height="14"/><rect x="6" y="40" width="14" height="14"/>',
      '<rect x="24" y="40" width="14" height="14"/><rect x="42" y="40" width="14" height="14"/>',
      '</g>',
      '<rect x="66" y="20" width="88" height="52" rx="4" fill="#4a6b86"/>',
      '<rect x="66" y="20" width="88" height="10" fill="#39566d"/>',
      '<g fill="#cfe2ef">',
      '<rect x="74" y="34" width="20" height="18" rx="2"/><rect x="100" y="34" width="20" height="18" rx="2"/>',
      '<rect x="126" y="34" width="20" height="18" rx="2"/>',
      '</g>',
      '<rect x="98" y="24" width="24" height="4" rx="2" fill="#f2d16b"/>',
      '<rect y="72" width="160" height="18" fill="#a49c8c"/>',
      '<rect y="72" width="160" height="3" fill="#d8a13a"/>',
      '<g fill="#3d4a52"><rect x="20" y="56" width="5" height="18"/><circle cx="22" cy="52" r="4"/>',
      '<rect x="36" y="58" width="5" height="16"/><circle cx="38" cy="54" r="4"/></g>',
    ].join(''),
  },
  {
    id: 'rooftops',
    label: 'Rooftops in the rain',
    group: 'City',
    background: '#7b8794',
    viewBox: BOX,
    markup: [
      '<rect width="160" height="90" fill="#8d99a6"/>',
      '<rect width="160" height="40" fill="#7b8794"/>',
      '<g fill="#5c6774">',
      '<path d="M0 44 L18 30 L36 44 V90 H0 Z"/><path d="M48 50 L66 34 L84 50 V90 H48 Z"/>',
      '<path d="M100 46 L120 28 L140 46 V90 H100 Z"/>',
      '</g>',
      '<g fill="#48525e">',
      '<rect x="36" y="52" width="12" height="38"/><rect x="84" y="58" width="16" height="32"/>',
      '<rect x="140" y="54" width="20" height="36"/>',
      '</g>',
      '<g fill="#f2c14e">',
      '<rect x="8" y="54" width="6" height="7"/><rect x="20" y="66" width="6" height="7"/>',
      '<rect x="56" y="60" width="6" height="7"/><rect x="70" y="72" width="6" height="7"/>',
      '<rect x="108" y="56" width="6" height="7"/><rect x="124" y="68" width="6" height="7"/>',
      '<rect x="146" y="64" width="6" height="7"/>',
      '</g>',
      '<g stroke="#dbe3ea" stroke-width="1" opacity="0.55">',
      '<path d="M10 0 L4 16"/><path d="M34 4 L28 22"/><path d="M58 0 L52 18"/><path d="M86 6 L80 24"/>',
      '<path d="M112 0 L106 16"/><path d="M136 4 L130 22"/><path d="M154 0 L148 18"/>',
      '<path d="M22 30 L16 48"/><path d="M96 34 L90 52"/><path d="M148 40 L142 58"/>',
      '</g>',
    ].join(''),
  },
];

export const SCENE_GROUPS: Scene['group'][] = ['Nature', 'Sport', 'City'];

export const sceneById = (id: string): Scene => SCENES.find((s) => s.id === id) ?? SCENES[0]!;
