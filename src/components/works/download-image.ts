export async function downloadImage(url: string, filenamePrefix = "narra-work") {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("图片下载失败");
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const pathname = new URL(url, window.location.href).pathname;
    const nameFromUrl = pathname.split("/").filter(Boolean).pop();

    link.href = blobUrl;
    link.download =
      nameFromUrl && nameFromUrl.includes(".")
        ? nameFromUrl
        : `${filenamePrefix}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
