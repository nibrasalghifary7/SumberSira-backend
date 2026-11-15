import sharp from "sharp";

/**
 * Antarmuka perbaikan gambar. Implementasi saat ini memakai sharp secara lokal
 * (tanpa layanan AI berbayar) dan bisa diganti layanan AI sungguhan nanti
 * lewat antarmuka yang sama.
 */
export interface ImageEnhancer {
  enhance(input: Buffer): Promise<Buffer>;
}

export const sharpEnhancer: ImageEnhancer = {
  async enhance(input: Buffer): Promise<Buffer> {
    return sharp(input)
      .rotate() // ikuti orientasi EXIF
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .normalise()
      .modulate({ brightness: 1.05, saturation: 1.2 })
      .sharpen()
      .jpeg({ quality: 88 })
      .toBuffer();
  },
};
