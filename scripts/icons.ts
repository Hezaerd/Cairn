import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Renders every Cairn icon from brand/cairn.svg with the Tauri CLI. Run `pnpm icons`.
const root = process.cwd();

const source = readFileSync(path.join(root, "brand/cairn.svg"), "utf8");

const tauri = path.join(root, "apps/desktop/node_modules/@tauri-apps/cli/tauri.js");

const desktopIcons = path.join(root, "apps/desktop/src-tauri/icons");

const extensionIcons = path.join(root, "apps/extension/public/icons");

const markSizes = [16, 24, 32, 64, 128, 256];

// Windows reads the first entry of an .ico in some places, so 32 comes first.
const icoSizes = [32, 16, 24, 48, 64, 128, 256];

const extensionSizes = [16, 32, 48, 128];

const size = 1254;

const tileColor = "#2e2e2e";

const tileMarkColor = "#f0f0f0";

// The mark alone disappears on a taskbar or toolbar of its own color, so the app icon puts it on a tile.
// Small tiles give the mark more room so its seams stay visible.
const tileScale = 0.78;

const smallTileScale = 0.88;

const smallTileSizes = [16, 24];

const tileRadius = 220;

const paths = source.slice(source.indexOf("<path"), source.lastIndexOf("</svg>")).trim();

function mark(color: string) {
  return source.replace('fill="#000"', `fill="${color}"`);
}

function tile(scale: number) {
  const offset = (size * (1 - scale)) / 2;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" rx="${tileRadius}" fill="${tileColor}"/>`,
    `<g transform="translate(${offset} ${offset}) scale(${scale})">`,
    paths.replace('fill="#000"', `fill="${tileMarkColor}"`),
    "</g>",
    "</svg>",
  ].join("\n");
}

function render(svg: string, output: string, sizes?: number[]) {
  const input = `${output}.svg`;

  writeFileSync(input, svg);

  const args = [tauri, "icon", input, "--output", output];

  if (sizes) args.push("--png", sizes.join(","));

  execFileSync(process.execPath, args, { stdio: "pipe" });
}

/** Packs PNG images into one .ico, in the given order. */
function ico(files: { size: number; png: Buffer }[]) {
  const header = Buffer.alloc(6 + 16 * files.length);

  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(files.length, 4);

  let offset = header.length;

  for (const [index, file] of files.entries()) {
    const entry = 6 + 16 * index;

    header.writeUInt8(file.size % 256, entry);
    header.writeUInt8(file.size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(file.png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += file.png.length;
  }

  return Buffer.concat([header, ...files.map((file) => file.png)]);
}

const work = mkdtempSync(path.join(tmpdir(), "cairn-icons-"));

try {
  const app = path.join(work, "app");

  const tiles = path.join(work, "tiles");

  const smallTiles = path.join(work, "small-tiles");

  const tileSizes = [...new Set([...icoSizes, ...extensionSizes])];

  render(tile(tileScale), app);
  render(
    tile(tileScale),
    tiles,
    tileSizes.filter((size) => !smallTileSizes.includes(size)),
  );
  render(tile(smallTileScale), smallTiles, smallTileSizes);

  const tilePng = (size: number) =>
    path.join(smallTileSizes.includes(size) ? smallTiles : tiles, `${size}x${size}.png`);

  for (const name of [
    "32x32.png",
    "64x64.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.png",
    "icon.icns",
  ]) {
    copyFileSync(path.join(app, name), path.join(desktopIcons, name));
  }

  writeFileSync(
    path.join(desktopIcons, "icon.ico"),
    ico(icoSizes.map((size) => ({ size, png: readFileSync(tilePng(size)) }))),
  );

  mkdirSync(extensionIcons, { recursive: true });

  for (const size of extensionSizes) {
    copyFileSync(tilePng(size), path.join(extensionIcons, `${size}.png`));
  }

  // The bare mark, black for light backgrounds and white for dark ones. The tray picks one.
  mkdirSync(path.join(desktopIcons, "mark"), { recursive: true });

  for (const [name, color] of [
    ["black", "#000"],
    ["white", "#fff"],
  ]) {
    const output = path.join(work, name);

    render(mark(color), output, markSizes);

    for (const size of markSizes) {
      copyFileSync(
        path.join(output, `${size}x${size}.png`),
        path.join(desktopIcons, `mark/${name}-${size}.png`),
      );
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
