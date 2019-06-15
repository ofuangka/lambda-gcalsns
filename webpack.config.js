const path = require('path');
const ZipPlugin = require('zip-webpack-plugin');

module.exports = {
  mode: 'production',
  target: 'node',
  entry: './src/index.ts',
  module: {
    rules: [{
      test: /\.tsx?$/,
      use: 'ts-loader',
      exclude: /node_modules/
    }]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.json']
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    library: 'index',
    libraryTarget: 'commonjs2',
    filename: 'index.js'
  },
  plugins: [
    new ZipPlugin({
      filename: 'gcalsns.zip'
    })
  ]
};
