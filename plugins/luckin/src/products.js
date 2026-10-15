const IMAGE_DOMAIN = "luckincoffeecdn.com";

export function officialProductImage(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.endsWith(`.${IMAGE_DOMAIN}`)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function catalogSummary(products) {
  if (!Array.isArray(products)) return [];
  return products.map((product) => ({
    productId: product.productId,
    name: String(product.productName ?? "商品"),
    imageUrl: officialProductImage(product.pictureUrl),
    price: Number(product.estimatePrice ?? product.initialPrice ?? NaN),
    tags: Array.isArray(product.tags) ? product.tags.map(String).join(" · ") : "",
  }));
}
