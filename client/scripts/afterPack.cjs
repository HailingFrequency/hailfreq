// M1: harden the packaged Electron binary by flipping security fuses after pack.
// Runs once per platform during `electron-builder` (before the AppImage/NSIS is
// assembled), so the fuse settings are baked into the shipped binary.
const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const exeName = packager.appInfo.productFilename;

  let electronBinary;
  if (electronPlatformName === "linux") {
    // electron-builder lowercases the executable name on linux.
    electronBinary = path.join(appOutDir, packager.executableName || exeName.toLowerCase());
  } else if (electronPlatformName === "win32") {
    electronBinary = path.join(appOutDir, `${exeName}.exe`);
  } else {
    electronBinary = path.join(appOutDir, `${exeName}.app`, "Contents", "MacOS", exeName);
  }

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    // Disable the ELECTRON_RUN_AS_NODE escape hatch (no arbitrary Node execution).
    [FuseV1Options.RunAsNode]: false,
    // Encrypt cookies/session data at rest.
    [FuseV1Options.EnableCookieEncryption]: true,
    // Ignore NODE_OPTIONS / --inspect injection in the packaged app.
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // Only load app code from the asar archive.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });

  console.log(`[afterPack] fuses flipped on ${electronBinary}`);
};
