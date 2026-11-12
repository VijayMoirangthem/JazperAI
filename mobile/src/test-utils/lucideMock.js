// lucide-react-native ships ESM that jest does not transform. Icons are not under test: every icon renders nothing.
const React = require('react');
const Icon = () => null;
module.exports = new Proxy({ __esModule: true }, { get: (t, k) => (k in t ? t[k] : Icon) });
