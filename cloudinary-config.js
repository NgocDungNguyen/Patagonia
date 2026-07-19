// Cloudinary is used instead of Firebase Storage because Cloud Storage for
// Firebase now requires the paid Blaze plan even for small free-tier usage.
// Cloudinary's own free plan handles image/video/audio hosting instead —
// no credit card needed.
//
// Setup (cloudinary.com):
//   1. Sign up for a free account.
//   2. Dashboard home shows your "Cloud name" — copy it below.
//   3. Settings (gear icon) → Upload → Upload presets → Add upload preset.
//      Set "Signing Mode" to UNSIGNED (this is what lets the browser upload
//      directly without exposing any secret key). Give it a name, and while
//      you're there set a max file size / allowed formats under that
//      preset's settings — that's the only place file-size limits are
//      actually enforced, since Firestore never sees the raw file.
//   4. Copy the preset name below.

export const CLOUDINARY_CLOUD_NAME = "myvfbj2h";
export const CLOUDINARY_UPLOAD_PRESET = "Patagonia";
