// Central runtime configuration + quality presets.
// URL params:  ?test=1  (tiny counts for headless screenshot CI)
//              ?q=low|med|high|ultra
//              ?weather=clear|cloudy|rain|snow|storm|aurora
//              ?time=dawn|day|golden|dusk|night
//              ?skipintro=1

const params = new URLSearchParams(location.search)
export const TEST = params.get('test') === '1'

const QUALITY = params.get('q') || (TEST ? 'low' : 'high')

const PRESETS = {
  low:   { trees: 6000,   terrainSeg: 220, shadows: false, mist: 120,  stars: 600,  pixelRatio: 1 },
  med:   { trees: 60000,  terrainSeg: 360, shadows: false, mist: 300,  stars: 1500, pixelRatio: 1 },
  high:  { trees: 180000, terrainSeg: 560, shadows: true,  mist: 600,  stars: 2600, pixelRatio: 1.5 },
  ultra: { trees: 266000, terrainSeg: 760, shadows: true,  mist: 900,  stars: 4000, pixelRatio: 2 }
}

export const CONFIG = {
  quality: QUALITY,
  ...PRESETS[QUALITY] || PRESETS.high,
  test: TEST,
  initialWeather: params.get('weather') || (TEST ? 'clear' : 'clear'),
  initialTime: params.get('time') || 'golden',
  skipIntro: params.get('skipintro') === '1' || TEST
}

export const ASSET_BASE = import.meta.env?.BASE_URL || './'
