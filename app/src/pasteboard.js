// Atoll's history and screenshot flows use synchronous clipboard operations.
const { clipboard, nativeImage } = require('electron');
if (process.platform === 'darwin') {
  const native = require(require('path').join(process.resourcesPath, 'helper', 'platform.node'));
  module.exports = {
    has: native.has, availableFormats: native.availableFormats,
    readText: native.readText, writeText: native.writeText,
    readImage: () => nativeImage.createFromBuffer(native.readPNG()),
    writeImage: image => native.writePNG(image.toPNG())
  };
} else {
  module.exports = clipboard;
}
