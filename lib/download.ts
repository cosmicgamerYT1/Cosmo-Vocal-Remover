export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadMultiple(items: Array<{ blob: Blob; fileName: string }>): Promise<void> {
  for (const item of items) {
    downloadBlob(item.blob, item.fileName);
    // Stagger slightly so browsers don't block "multiple downloads" popups.
    await new Promise((r) => setTimeout(r, 350));
  }
}
