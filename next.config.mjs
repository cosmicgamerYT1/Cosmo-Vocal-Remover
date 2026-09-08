/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // All heavy lifting (ONNX inference, FFmpeg muxing) happens in the browser.
  // We only need static hosting, so Vercel's default runtime is sufficient.
  webpack: (config, { isServer }) => {
    // onnxruntime-web ships a Node build that references `fs`/`path` for the
    // (unused, in-browser) Node execution provider. Stub them out so the
    // client bundle doesn't try to polyfill Node core modules.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        // Allow the ONNX model to be cached aggressively once fetched, since
        // it's versioned and content-addressed by URL.
        source: "/models/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
