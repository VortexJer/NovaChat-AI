/**
 * Genera los iconos PNG de la aplicacion a partir de `public/icon.svg`.
 *
 * iOS no acepta SVG en `apple-touch-icon`: si solo hay SVG, al añadir la web a
 * la pantalla de inicio pone una miniatura de la pagina en vez del icono. Y el
 * manifest necesita un 192 y un 512 para que Android/Chrome no reescalen mal.
 *
 * El icono de iOS va sobre fondo opaco y con margen: iOS le aplica su propia
 * mascara redondeada, y un logo a sangre queda con las puntas cortadas.
 *
 * Se ejecuta a mano cuando cambie el logo: `node scripts/iconos.mjs`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile(new URL('../public/icon.svg', import.meta.url));
const FONDO = '#0b0c0e';

/** Manifest: sin margen, que Android ya lo añade segun el `purpose`. */
for (const size of [192, 512]) {
  const png = await sharp(svg, { density: 512 })
    .resize(size, size, { fit: 'contain', background: FONDO })
    .flatten({ background: FONDO })
    .png()
    .toBuffer();
  await writeFile(new URL(`../public/icon-${size}.png`, import.meta.url), png);
  console.log(`icon-${size}.png`, png.length, 'bytes');
}

/** iOS: 180x180, con un 18% de margen para sobrevivir a la mascara. */
const lado = 180;
const dentro = Math.round(lado * 0.64);
const apple = await sharp({
  create: {
    width: lado,
    height: lado,
    channels: 4,
    background: FONDO,
  },
})
  .composite([
    {
      input: await sharp(svg, { density: 512 }).resize(dentro, dentro).png().toBuffer(),
      gravity: 'centre',
    },
  ])
  .png()
  .toBuffer();
await writeFile(new URL('../public/apple-touch-icon.png', import.meta.url), apple);
console.log('apple-touch-icon.png', apple.length, 'bytes');
