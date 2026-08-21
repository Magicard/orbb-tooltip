import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [
      "eng.traineddata",
      "lib/ocr",
      "icon.ico",
      "maps",
      // "renderer/assets/item-scanned.wav",
      // "renderer/assets/item-upped.wav",
    ],
    name: "ORBBToolTip",
    icon: "icon.ico",
    appVersion: "1.0.0",
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: "./renderer/public/index.html",
            js: "./main/renderer/main.ts",
            name: "main_window",
            preload: {
              js: "./main/preloads/main.ts",
            },
          },
          {
            html: "./renderer/public/tooltip.html",
            js: "./main/renderer/tooltip.ts",
            name: "tooltip_window",
            preload: {
              js: "./main/preloads/tooltip.ts",
            },
          },
          {
            html: "./renderer/public/questpanel.html",
            js: "./main/renderer/questpanel.ts",
            name: "quest_panel_window",
            preload: {
              js: "./main/preloads/questpanel.ts",
            },
          },
          {
            html: "./renderer/public/map.html",
            js: "./main/renderer/map.ts",
            name: "map_window",
            preload: {
              js: "./main/preloads/map.ts",
            },
          },
        ],
      },
    }),
  ],
};

export default config;
