import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./cloudinary-config.js";

const CLIENT_SIZE_LIMITS = {
  image: 15 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
};

// Cloudinary has no separate "audio" endpoint — audio files are uploaded
// through the same /video/upload route and it detects the format itself.
function resourceEndpoint(kind) {
  return kind === "image" ? "image" : "video";
}

export async function uploadToCloudinary(file, kind) {
  const limit = CLIENT_SIZE_LIMITS[kind] || CLIENT_SIZE_LIMITS.video;
  if (file.size > limit) {
    throw new Error(`File is too large (max ${Math.round(limit / 1024 / 1024)}MB).`);
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceEndpoint(kind)}/upload`;
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(endpoint, { method: "POST", body: form });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `Cloudinary upload failed (HTTP ${res.status}).`);
  }
  const data = await res.json();
  return { url: data.secure_url, publicId: data.public_id };
}
