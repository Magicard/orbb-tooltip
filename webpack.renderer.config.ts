import type { Configuration } from "webpack";

import { rules } from "./webpack.rules";
import { plugins } from "./webpack.plugins";

rules.push({
  test: /\.css$/,
  use: [
    { loader: "style-loader" },
    { loader: "css-loader" },
    { loader: "postcss-loader" },
  ],
});

rules.push({
  test: /\.(woff|woff2|eot|ttf|otf)$/i,
  type: "asset/resource",
});

rules.push({
  test: /\.(wav|mp3|ogg|m4a)$/i,
  type: "asset/resource",
});

rules.push({
  test: /\.(png|jpe?g|gif|webp)$/i,
  type: "asset/resource",
});

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins,
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css"],
  },
  // target: 'electron-renderer',
};
