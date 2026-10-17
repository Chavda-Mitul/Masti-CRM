// The image types the CRM stores (Masti's logo and signature, a receiver's photo at handover), told by their first
// bytes rather than by what the upload says it is.

const SIGNATURES = {
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff]),
} as const;

export type ImageType = keyof typeof SIGNATURES;

/** Is this content type one of ours (PNG or JPEG)? */
export function isImageType(contentType: string): contentType is ImageType {
  return Object.hasOwn(SIGNATURES, contentType);
}

/** What the bytes really are: a PNG, a JPEG, or neither (null). */
export function imageType(bytes: Buffer): ImageType | null {
  for (const [type, signature] of Object.entries(SIGNATURES)) {
    if (bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature)) return type as ImageType;
  }
  return null;
}
