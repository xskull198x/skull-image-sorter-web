(function initPngInfoFormatter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PngInfoFormatter = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function buildPngInfoFormatter() {
  'use strict';

  const CATEGORY_ORDER = [
    'Characters',
    'Bottoms',
    'Tops',
    'Outfit',
    'Accessories',
    'BG',
    'Styles',
    'Pose',
    'Sex',
    'Emotion',
    'Eyes',
    'Mouth',
    'Camera',
    'Body',
    'Hair',
    'Weather',
    'Lighting',
    'Props',
    'Other'
  ];

  const PARAM_START_RE = /(?:^|\n|,\s*)(Steps|Sampler|Schedule type|CFG scale|Seed|Size|Model hash|Model|Soft Regional|ADetailer|Lora hashes|Version|NGMS|Module)\s*:/i;
  const HIDDEN_PREFIXES = [
    'soft regional',
    'adetailer',
    'dynamic prompts',
    'controlnet',
    'tiled diffusion',
    'tiled vae',
    'ultimate sd upscale',
    'hires',
    'ngms',
    'module'
  ];
  const HIDDEN_KEYS = new Set(['version', 'lora hashes', 'ti hashes', 'model hash', 'emphasis']);
  const SPECIAL_TAG_CATEGORIES = new Map([
    ['sub', 'Characters'],
    ['dom', 'Characters'],
    ['adult', 'Styles'],
    ['2girls', 'Styles'],
    ['dim_light', 'Lighting'],
    ['dim light', 'Lighting'],
    ['tense', 'Emotion'],
    ['cash_piles', 'Props'],
    ['cash piles', 'Props'],
    ['gold_bars', 'Props'],
    ['gold bars', 'Props'],
    ['bed', 'Props'],
    ['casino_vault', 'BG'],
    ['casino vault', 'BG'],
    ['secure_room', 'BG'],
    ['secure room', 'BG'],
    ['reinforced_steel_walls', 'BG'],
    ['reinforced steel walls', 'BG'],
    ['metal_door', 'BG'],
    ['metal door', 'BG']
  ]);
  const HIGH_CONFIDENCE_STYLES = new Set([
    'kittew',
    'masterpiece',
    'best quality',
    'high quality',
    'low quality',
    '8k',
    '4k',
    'absurdres',
    'incredibly absurdres',
    'highres',
    'ultra_detailed',
    'ultra detailed',
    'western comics',
    'western comics \\(style\\)',
    'anime',
    '2d',
    '2.5d',
    '3d',
    'realistic',
    'semi-realistic',
    'cartoon',
    'comic',
    'comic style',
    'manga',
    'illustration',
    'cel shading',
    'painterly',
    'source_anime',
    'source_cartoon',
    'source_comic'
  ]);
  const HIGH_CONFIDENCE_SEX = new Set([
    'cunnilingus',
    'anilingus',
    'rimming',
    'fellatio',
    'deepthroat',
    'glansjob',
    'penetration',
    'vaginal',
    'vaginal sex',
    'anal',
    'anal sex',
    'strap-on',
    'strapon',
    'tribadism',
    'paizuri',
    'titfuck',
    'breast_sucking',
    'breast sucking',
    'handjob',
    'fingering',
    'female_masturbation',
    'female masturbation',
    'masturbation',
    'tongue in pussy',
    'tongue_in_pussy',
    'tongue in anus',
    'tongue_in_anus',
    'licking pussy',
    'licking_pussy',
    'licking anus',
    'licking_anus',
    'sitting on face',
    'face sitting',
    'facesitting',
    'oral',
    'oral sex',
    'irrumatio',
    'sex from behind',
    'mating press',
    'missionary',
    'prone bone',
    '69',
    'mutual_cunnilingus',
    'mutual cunnilingus',
    'cooperative_fellatio',
    'cooperative fellatio',
    'penis'
  ]);

  const HEURISTICS = [
    ['Hair', ['hair', 'ponytail', 'bun', 'braid', 'bangs', 'twintails']],
    ['Eyes', ['eyes', 'iris', 'pupils', 'heterochromia']],
    ['Mouth', ['mouth', 'lips', 'tongue', 'teeth', 'fang', 'drool', 'saliva']],
    ['Body', ['body', 'thick', 'busty', 'voluptuous', 'curvy', 'athletic', 'fit', 'abs', 'hips', 'thighs', 'milf', 'breasts', 'ass', 'waist', 'skinny', 'slender', 'toned']],
    ['Sex', ['cunnilingus', 'fellatio', 'deepthroat', 'penetration', 'strap-on', 'strapon', 'anal', 'vaginal', 'sex', 'fingering', 'handjob', 'paizuri', 'titfuck', 'tribadism', 'rimming', 'anilingus', 'breast_sucking', 'breast sucking', 'sitting on face']],
    ['Pose', ['kneeling', 'sitting', 'standing', 'lying', 'on back', 'on stomach', 'spread legs', 'grabbing thigh', 'face between thighs', 'bent over', 'on all fours', 'seiza', 'squatting']],
    ['Lighting', ['light', 'lighting', 'dim', 'neon', 'glow', 'godrays', 'shadow', 'sunset', 'sunrise', 'tense']],
    ['BG', ['room', 'casino', 'vault', 'bedroom', 'forest', 'city', 'street', 'castle', 'beach', 'office', 'school', 'classroom', 'dungeon', 'bar', 'club', 'bathhouse', 'onsen']],
    ['Props', ['bed', 'chair', 'table', 'door', 'cash', 'gold bars', 'weapon', 'gun', 'sword', 'lasso']],
    ['Accessories', ['earrings', 'vambraces', 'bracelet', 'choker', 'glasses', 'mask', 'tiara', 'belt', 'gloves', 'boots', 'headband', 'necklace', 'pendant']],
    ['Styles', ['masterpiece', 'best quality', '8k', 'absurdres', 'western comics', 'anime', '2d', '3d', 'realistic', 'style', 'kittew']]
  ];

  function normalizeTag(tag) {
    return String(tag || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\.$/, '')
      .toLowerCase();
  }

  function normalizeForMatching(tag) {
    let value = normalizeTag(tag);
    let changed = true;
    while (changed) {
      changed = false;
      if ((value.startsWith('(') && value.endsWith(')')) || (value.startsWith('[') && value.endsWith(']'))) {
        const inner = value.slice(1, -1).trim();
        if (inner) {
          value = inner;
          changed = true;
        }
      }
    }
    const weighted = value.match(/^(.+):[-+]?\d*\.?\d+$/);
    if (weighted && !weighted[1].includes('<')) value = weighted[1].trim();
    return value.replace(/\s+/g, ' ');
  }

  function normalizedWords(tag) {
    return normalizeForMatching(tag)
      .replace(/_/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  function tagMatchesNeedle(tag, needle) {
    const normalized = normalizeForMatching(tag).replace(/_/g, ' ');
    const normalizedNeedle = normalizeTag(needle).replace(/_/g, ' ');
    if (!normalizedNeedle) return false;
    if (normalizedNeedle.includes(' ')) return normalized.includes(normalizedNeedle);
    return normalizedWords(tag).includes(normalizedNeedle);
  }

  function categoryFromSpecialTags(tag) {
    const normalized = normalizeForMatching(tag);
    const spaceNormalized = normalized.replace(/_/g, ' ');
    return SPECIAL_TAG_CATEGORIES.get(normalized) || SPECIAL_TAG_CATEGORIES.get(spaceNormalized) || '';
  }

  function categoryFromHighConfidenceTags(tag) {
    const normalized = normalizeForMatching(tag);
    const spaceNormalized = normalized.replace(/_/g, ' ');
    if (HIGH_CONFIDENCE_STYLES.has(normalized) || HIGH_CONFIDENCE_STYLES.has(spaceNormalized)) return 'Styles';
    if (HIGH_CONFIDENCE_SEX.has(normalized) || HIGH_CONFIDENCE_SEX.has(spaceNormalized)) return 'Sex';
    return '';
  }

  function splitTags(promptText) {
    const tags = [];
    let current = '';
    let paren = 0;
    let square = 0;
    let angle = 0;
    let escaped = false;

    for (const char of String(promptText || '')) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        current += char;
        escaped = true;
        continue;
      }

      if (char === '(') paren += 1;
      else if (char === ')' && paren > 0) paren -= 1;
      else if (char === '[') square += 1;
      else if (char === ']' && square > 0) square -= 1;
      else if (char === '<') angle += 1;
      else if (char === '>' && angle > 0) angle -= 1;

      if (char === ',' && paren === 0 && square === 0 && angle === 0) {
        const tag = current.trim();
        if (tag) tags.push(tag);
        current = '';
        continue;
      }

      current += char;
    }

    const tail = current.trim();
    if (tail) tags.push(tail);

    const seen = new Set();
    return tags.filter((tag) => {
      const key = normalizeTag(tag);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function parseParameterPairs(text) {
    const parameters = {};
    for (const part of splitTags(text)) {
      const idx = part.indexOf(':');
      if (idx <= 0) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim().replace(/^"|"$/g, '');
      if (key) parameters[key] = value;
    }
    return parameters;
  }

  function splitPromptSections(rawInfo) {
    const raw = String(rawInfo || '').trim();
    const source = raw.replace(/^parameters\s*:\s*/i, '').trim();
    const negativeMarker = source.search(/\bNegative prompt\s*:/i);

    if (negativeMarker < 0) {
      const paramMatch = source.match(PARAM_START_RE);
      const paramStart = paramMatch ? paramMatch.index + paramMatch[0].search(/[A-Za-z]/) : -1;
      return {
        positive: paramStart >= 0 ? source.slice(0, paramStart).trim() : source,
        negative: '',
        parameters: paramStart >= 0 ? parseParameterPairs(source.slice(paramStart)) : {}
      };
    }

    const positive = source.slice(0, negativeMarker).trim();
    const afterNegative = source.slice(negativeMarker).replace(/^Negative prompt\s*:\s*/i, '');
    const paramMatch = afterNegative.match(PARAM_START_RE);
    const paramStart = paramMatch ? paramMatch.index + paramMatch[0].search(/[A-Za-z]/) : -1;
    const negative = paramStart >= 0 ? afterNegative.slice(0, paramStart).trim() : afterNegative.trim();
    const parameterText = paramStart >= 0 ? afterNegative.slice(paramStart).trim() : '';

    return { positive, negative, parameters: parseParameterPairs(parameterText) };
  }

  function extractModelName(parameters) {
    const modelKey = Object.keys(parameters || {}).find((key) => key.toLowerCase() === 'model');
    return modelKey && parameters[modelKey] ? parameters[modelKey] : 'Unknown';
  }

  function isHiddenMetadataKey(key) {
    const normalized = String(key || '').trim().toLowerCase();
    return HIDDEN_KEYS.has(normalized) || HIDDEN_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  }

  function filterMetadata(parameters) {
    const visible = {};
    for (const [key, value] of Object.entries(parameters || {})) {
      if (key.toLowerCase() === 'model') visible[key] = value;
      else if (!isHiddenMetadataKey(key)) {
        // Main display intentionally keeps only Model. This branch is left for raw/debug callers.
      }
    }
    return visible;
  }

  function loadCategoryMatcher(presetsJson = {}) {
    const map = new Map();
    for (const category of CATEGORY_ORDER) {
      const presets = presetsJson[category];
      if (!presets || typeof presets !== 'object') continue;
      for (const [presetName, value] of Object.entries(presets)) {
        if (category === 'Characters') {
          for (const tag of characterPresetTags(presetName, value)) {
            const key = normalizeForMatching(tag);
            if (key && !map.has(key)) map.set(key, category);
          }
          continue;
        }
        for (const tag of splitTags(String(value).replace(/\.+$/g, ''))) {
          const key = normalizeForMatching(tag);
          if (key && !map.has(key)) map.set(key, category);
        }
      }
    }
    return { map };
  }

  function characterPresetTags(presetName, value) {
    const tags = [];
    const name = String(presetName || '').trim();
    if (name) tags.push(name);

    const [firstValueTag] = splitTags(String(value || '').replace(/\.+$/g, ''));
    if (firstValueTag && isSafeCharacterIdentity(firstValueTag)) tags.push(firstValueTag);
    return tags;
  }

  function isSafeCharacterIdentity(tag) {
    const normalized = normalizeForMatching(tag);
    if (!normalized) return false;
    if (categoryFromSpecialTags(normalized) === 'Characters') return true;
    if (normalized.length < 2) return false;
    if (/^\d+(girl|boy|girls|boys)$/i.test(normalized)) return false;
    return heuristicCategory(tag) === 'Other';
  }

  function heuristicCategory(tag) {
    const special = categoryFromHighConfidenceTags(tag) || categoryFromSpecialTags(tag);
    if (special) return special;

    for (const [category, needles] of HEURISTICS) {
      if (needles.some((needle) => tagMatchesNeedle(tag, needle))) return category;
    }
    return 'Other';
  }

  function categorizeTags(tags, matcher = loadCategoryMatcher()) {
    const grouped = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, []]));
    for (const tag of tags) {
      const key = normalizeForMatching(tag);
      let category = categoryFromHighConfidenceTags(tag) || categoryFromSpecialTags(tag) || matcher.map.get(key);
      if (!category) category = heuristicCategory(tag);
      grouped[category || 'Other'].push(tag);
    }
    return grouped;
  }

  function formatGroupedTags(grouped) {
    const lines = [];
    for (const category of CATEGORY_ORDER) {
      const tags = grouped[category] || [];
      if (!tags.length) continue;
      lines.push(`${category}:`);
      lines.push(tags.join(', '));
      lines.push('');
    }
    while (lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  function formatNormalPrompt(positivePrompt, matcher) {
    return formatGroupedTags(categorizeTags(splitTags(positivePrompt), matcher));
  }

  function isCoupleMode(positivePrompt) {
    return String(positivePrompt || '').includes('|');
  }

  function splitCouplePrompt(positivePrompt) {
    const parts = String(positivePrompt || '')
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length <= 1) return { slots: parts, global: '' };
    return { slots: parts.slice(0, -1), global: parts[parts.length - 1] };
  }

  function formatCouplePrompt(positivePrompt, matcher) {
    const { slots, global } = splitCouplePrompt(positivePrompt);
    const lines = ['Couple Mode', ''];
    slots.forEach((slot, index) => {
      lines.push(`Character Slot ${index + 1}:`);
      const formatted = formatNormalPrompt(slot, matcher);
      if (formatted) lines.push(formatted);
      lines.push('');
    });
    if (global) {
      lines.push('Global:');
      const formatted = formatNormalPrompt(global, matcher);
      if (formatted) lines.push(formatted);
    }
    return lines.join('\n').trim();
  }

  function formatNegativePrompt(negativePrompt) {
    return splitTags(negativePrompt).join(', ');
  }

  function parsePngInfo(rawInfo) {
    const sections = splitPromptSections(rawInfo);
    return {
      positive_prompt: sections.positive,
      negative_prompt: sections.negative,
      generation_parameters: sections.parameters
    };
  }

  function formatPngInfo(rawInfo, presetsJson = {}) {
    const parsed = parsePngInfo(rawInfo);
    const matcher = loadCategoryMatcher(presetsJson);
    const model = extractModelName(parsed.generation_parameters);
    const positive = isCoupleMode(parsed.positive_prompt)
      ? formatCouplePrompt(parsed.positive_prompt, matcher)
      : formatNormalPrompt(parsed.positive_prompt, matcher);
    const negative = formatNegativePrompt(parsed.negative_prompt);

    return [
      `Model: ${model}`,
      '',
      'Positive Prompt:',
      positive || 'None',
      '',
      'Negative Prompt:',
      negative || 'None'
    ].join('\n');
  }

  return {
    CATEGORY_ORDER,
    parsePngInfo,
    extractModelName,
    splitPromptSections,
    isCoupleMode,
    splitCouplePrompt,
    splitTags,
    loadCategoryMatcher,
    categorizeTags,
    formatNormalPrompt,
    formatCouplePrompt,
    formatNegativePrompt,
    filterMetadata,
    formatPngInfo
  };
});
