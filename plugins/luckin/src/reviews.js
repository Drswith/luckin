import { randomUUID } from "node:crypto";
import { officialProductImage } from "./products.js";

const REVIEW_TTL_MS = 5 * 60 * 1000;

export class ReviewStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.pending = new Map();
    this.revision = 0;
  }

  invalidateOrders() {
    this.revision++;
    for (const [id, item] of this.pending) if (item.kind === "order") this.pending.delete(id);
  }

  discard(id) { this.pending.delete(id); }

  valid(id) {
    const item = this.pending.get(id);
    return Boolean(item && item.expiresAt > this.now());
  }

  expiresAt(id) { return this.pending.get(id)?.expiresAt; }

  create(kind, payload) {
    for (const [id, item] of this.pending) {
      if (item.expiresAt <= this.now()) this.pending.delete(id);
    }
    const id = randomUUID();
    this.pending.set(id, { kind, payload, expiresAt: this.now() + REVIEW_TTL_MS });
    return id;
  }

  take(kind, id) {
    const item = this.pending.get(id);
    if (!item || item.kind !== kind || item.expiresAt <= this.now()) {
      throw new Error("确认已过期或已使用，请重新预览。");
    }
    this.pending.delete(id);
    return item.payload;
  }
}

export function orderCreateArgs(input, preview) {
  const shop = preview?.shopInfo;
  if (!Number.isFinite(shop?.longitude) || Math.abs(shop.longitude) > 180 || !Number.isFinite(shop?.latitude) || Math.abs(shop.latitude) > 90 || (shop.deptId != null && Number(shop.deptId) !== input.deptId)) {
    throw new Error("预览未返回门店坐标，无法安全创建订单。请重新选择门店。");
  }
  return {
    deptId: input.deptId,
    productList: input.productList,
    longitude: shop.longitude,
    latitude: shop.latitude,
    couponCodeList: Array.isArray(preview.couponCodeList) ? preview.couponCodeList : [],
  };
}

export function orderSummary(preview) {
  const total = Number(preview?.discountPrice);
  if (preview?.discountPrice == null || preview.discountPrice === "" || !Number.isFinite(total) || total < 0) {
    throw new Error("瑞幸预览未返回有效订单预览金额，无法继续创建订单。");
  }
  return {
    shop: {
      deptId: preview.shopInfo?.deptId,
      name: String(preview.shopInfo?.deptName ?? "未知门店"),
      address: String(preview.shopInfo?.address ?? ""),
    },
    products: Array.isArray(preview.productInfoList)
      ? preview.productInfoList.map((p) => ({
          productId: p.productId,
          skuCode: p.skuCode,
          name: String(p.name ?? "商品"),
          amount: Number(p.amount ?? 1),
          options: String(p.additionDesc ?? ""),
          price: p.estimateTotalPrice ?? p.estimatePrice ?? null,
          imageUrl: officialProductImage(p.breviaryPicUrl ?? p.bigPicUrl),
        }))
      : [],
    total,
    pickupAt: preview.aboutTime ?? null,
  };
}
