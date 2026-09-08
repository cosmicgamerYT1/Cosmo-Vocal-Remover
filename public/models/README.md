Optional: if you'd rather self-host your ONNX model as a static asset instead
of an external URL, place it here (e.g. `public/models/vocal-mask.onnx`) and
set:

```
NEXT_PUBLIC_MODEL_URL=/models/vocal-mask.onnx
```

Files in `public/` are served as static assets by Next.js/Vercel automatically,
with no extra configuration, and benefit from the long-lived cache headers
already configured for this path in `next.config.mjs`.
