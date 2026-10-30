// Files the app installs into the user's private converter repository (bundled as text at build time).
import workflow from '../../.github/workflows/convert-models.yml?raw';
import apsConverter from '../../tools/aps-convert.mjs?raw';
import nwdConverter from '../../tools/nwd-convert.mjs?raw';
import nwd2glb from '../../tools/nwd2glb/nwd2glb.cpp?raw';
import nwd2glbCmake from '../../tools/nwd2glb/CMakeLists.txt?raw';
import pkg from '../../tools/package.json?raw';

export const CONVERTER_FILES = [
  { path: 'tools/package.json', text: pkg },
  { path: 'tools/aps-convert.mjs', text: apsConverter },
  { path: 'tools/nwd-convert.mjs', text: nwdConverter },
  { path: 'tools/nwd2glb/nwd2glb.cpp', text: nwd2glb },
  { path: 'tools/nwd2glb/CMakeLists.txt', text: nwd2glbCmake },
  { path: 'models/incoming/.gitkeep', text: '' },
  { path: '.github/workflows/convert-models.yml', text: workflow },
];
