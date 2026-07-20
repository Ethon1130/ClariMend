export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 12_000_000;

export type SupportedFormat = "jpeg" | "png" | "webp";

export type ImageHeader = {
  format: SupportedFormat;
  width: number;
  height: number;
  orientation: 1 | 3 | 6 | 8;
  hasAlpha: boolean;
  animated: boolean;
};

export type ImageValidationErrorCode =
  | "empty"
  | "too-large"
  | "unsupported-extension"
  | "unsupported-mime"
  | "invalid-signature"
  | "animated"
  | "invalid-dimensions"
  | "too-many-pixels";

export class ImageValidationError extends Error {
  constructor(
    readonly code: ImageValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageValidationError";
  }
}

const MIME_BY_FORMAT: Record<SupportedFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const EXTENSION_BY_FORMAT: Record<SupportedFormat, string[]> = {
  jpeg: ["jpg", "jpeg"],
  png: ["png"],
  webp: ["webp"],
};

function readUint24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function parsePng(bytes: Uint8Array): ImageHeader | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colorType = bytes[25];
  let animated = false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (readAscii(bytes, offset + 4, 4) === "acTL") animated = true;
    offset += 12 + length;
  }
  return {
    format: "png",
    width: view.getUint32(16),
    height: view.getUint32(20),
    orientation: 1,
    hasAlpha: colorType === 4 || colorType === 6,
    animated,
  };
}

function parseExifOrientation(bytes: Uint8Array, start: number, length: number): 1 | 3 | 6 | 8 {
  if (length < 14 || readAscii(bytes, start, 6) !== "Exif\0\0") return 1;
  const tiff = start + 6;
  const littleEndian = readAscii(bytes, tiff, 2) === "II";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const uint16 = (offset: number) => view.getUint16(offset, littleEndian);
  const uint32 = (offset: number) => view.getUint32(offset, littleEndian);
  const ifdOffset = tiff + uint32(tiff + 4);
  if (ifdOffset + 2 > start + length) return 1;

  const entries = uint16(ifdOffset);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    if (entry + 12 > start + length) break;
    if (uint16(entry) === 0x0112) {
      const value = uint16(entry + 8);
      return value === 3 || value === 6 || value === 8 ? value : 1;
    }
  }
  return 1;
}

function parseJpeg(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  let orientation: 1 | 3 | 6 | 8 = 1;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    const dataStart = offset + 4;
    if (marker === 0xe1) orientation = parseExifOrientation(bytes, dataStart, length - 2);

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && length >= 7) {
      return {
        format: "jpeg",
        width: (bytes[dataStart + 3] << 8) | bytes[dataStart + 4],
        height: (bytes[dataStart + 1] << 8) | bytes[dataStart + 2],
        orientation,
        hasAlpha: false,
        animated: false,
      };
    }
    offset += 2 + length;
  }

  throw new ImageValidationError("invalid-dimensions", "无法读取 JPEG 尺寸，文件可能已损坏。");
}

function parseWebp(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 30 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WEBP") {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = readAscii(bytes, offset, 4);
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset + 4, true);
    const data = offset + 8;
    if (data + size > bytes.length) break;

    if (chunk === "VP8X" && size >= 10) {
      return {
        format: "webp",
        width: readUint24LE(bytes, data + 4) + 1,
        height: readUint24LE(bytes, data + 7) + 1,
        orientation: 1,
        hasAlpha: Boolean(bytes[data] & 0x10),
        animated: Boolean(bytes[data] & 0x02),
      };
    }
    if (chunk === "VP8 " && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      return {
        format: "webp",
        width: (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff,
        height: (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff,
        orientation: 1,
        hasAlpha: false,
        animated: false,
      };
    }
    if (chunk === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const bits =
        bytes[data + 1] |
        (bytes[data + 2] << 8) |
        (bytes[data + 3] << 16) |
        (bytes[data + 4] << 24);
      return {
        format: "webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        orientation: 1,
        hasAlpha: true,
        animated: false,
      };
    }
    offset = data + size + (size % 2);
  }

  throw new ImageValidationError("invalid-dimensions", "无法读取 WebP 尺寸，文件可能已损坏。");
}

export function inspectImageHeader(bytes: Uint8Array): ImageHeader {
  const header = parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes);
  if (!header) {
    throw new ImageValidationError("invalid-signature", "文件内容不是有效的 JPEG、PNG 或 WebP 图片。");
  }
  return header;
}

export async function validateImageFile(file: File): Promise<ImageHeader> {
  if (file.size === 0) throw new ImageValidationError("empty", "文件为空。");
  if (file.size > MAX_FILE_BYTES) throw new ImageValidationError("too-large", "文件超过 10 MB 上限。");

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["jpg", "jpeg", "png", "webp"].includes(extension)) {
    throw new ImageValidationError("unsupported-extension", "仅支持 JPEG、PNG 和 WebP 文件。");
  }
  if (file.type && !Object.values(MIME_BY_FORMAT).includes(file.type)) {
    throw new ImageValidationError("unsupported-mime", "浏览器报告的文件类型不受支持。");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = inspectImageHeader(bytes);
  if (!EXTENSION_BY_FORMAT[header.format].includes(extension) || (file.type && file.type !== MIME_BY_FORMAT[header.format])) {
    throw new ImageValidationError("invalid-signature", "文件扩展名、类型和实际内容不一致。");
  }
  if (header.animated) throw new ImageValidationError("animated", "不支持动画图片。");
  if (header.width <= 0 || header.height <= 0) {
    throw new ImageValidationError("invalid-dimensions", "图片尺寸无效。");
  }
  if (header.width * header.height > MAX_INPUT_PIXELS) {
    throw new ImageValidationError("too-many-pixels", "图片超过 1200 万像素上限。");
  }
  return header;
}
