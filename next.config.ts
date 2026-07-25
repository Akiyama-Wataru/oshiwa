import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // A photo may weigh up to MAX_OSHI_IMAGE_BYTES (1 MiB). The default body
      // limit is exactly 1 MiB, so a legitimate upload would fail on the
      // multipart overhead alone with an error the action never sees.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
