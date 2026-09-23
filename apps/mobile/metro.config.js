// Sources use NodeNext-style `.js` specifiers for `.ts` files (tsc needs them);
// Metro does not map those, so try `.ts`/`.tsx` first for relative `.js` imports.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const base = moduleName.slice(0, -'.js'.length);
    for (const ext of ['.ts', '.tsx']) {
      try {
        return resolve(context, base + ext, platform);
      } catch {
        // Not a TypeScript source; try the next extension or the original specifier.
      }
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
