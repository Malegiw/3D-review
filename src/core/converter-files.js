// Files the app installs into the user's private converter repository (bundled as text at build time).
import workflow from '../../.github/workflows/convert-models.yml?raw';
import converter from '../../tools/aps-convert.mjs?raw';
import pkg from '../../tools/package.json?raw';

export const CONVERTER_FILES = [
  { path: 'tools/package.json', text: pkg },
  { path: 'tools/aps-convert.mjs', text: converter },
  { path: 'models/incoming/.gitkeep', text: '' },
  { path: '.github/workflows/convert-models.yml', text: workflow },
];
