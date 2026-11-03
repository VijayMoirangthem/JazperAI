const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Windows path-length workaround: node_modules is a junction to D:\mn. Pin
// resolution to the real folder so each package has exactly one identity.
const nm = path.join(__dirname, 'node_modules');
const real = fs.realpathSync(nm);
if (real !== nm) {
  config.watchFolders = [...(config.watchFolders ?? []), real];
  config.resolver.nodeModulesPaths = [real];
}

// react-devtools-core's backend needs @babel/runtime/regenerator (gone in v8) and
// crashes at startup. Stub it out; on-device testing doesn't use React DevTools.
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-devtools-core') return { type: 'sourceFile', filePath: path.join(__dirname, 'tools', 'react-devtools-core-stub.js') };
  const res = (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
  // npm left a duplicate of the whole tree at <real>/node_modules. Same versions, so
  // fold every file back onto <real>/<pkg> to keep a single copy of each package.
  if (real !== nm && res && res.type === 'sourceFile') {
    const dup = path.join(real, 'node_modules') + path.sep;
    if (res.filePath.startsWith(dup)) {
      const folded = path.join(real, res.filePath.slice(dup.length));
      if (fs.existsSync(folded)) return { ...res, filePath: folded };
    }
  }
  return res;
};

module.exports = config;
