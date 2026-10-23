const states = { 10: "待付款", 20: "下单成功", 30: "制作中", 60: "等待取餐", 80: "已完成", 100: "已取消" };
export function pickupState(order, now = Date.now()) {
  const status = Number(order.orderStatus), code = order.takeMealCodeInfo?.code;
  const about = Number(order.aboutTime), timestamp = about < 1e12 ? about * 1e3 : about;
  const full = typeof code === "string" && code.trim() !== "" && about > 0 && Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime());
  return {
    visible: [20, 30, 60].includes(status),
    status: states[status] || "状态待确认",
    updatedAt: now,
    full,
    code: full ? code : null,
    aboutTime: full ? timestamp : null,
    step: { 20: 0, 30: 1, 60: 2, 80: 3 }[status] ?? null
  };
}
export function paymentUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && ["lkcoffee.com", "weixin.qq.com", "tenpay.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : null;
  } catch {
    return null;
  }
}
export function orderReceipt(data, orderId = "") {
  const status = Number(data.orderStatus), pending = status === 10 || data.orderStatus == null && data.needPay === true;
  const amount = data.discountPrice ?? data.orderPayAmount ?? data.total;
  return {
    orderId: String(data.orderIdStr ?? data.orderId ?? orderId),
    orderStatus: Number.isFinite(status) ? status : null,
    orderStatusName: states[status] || (pending ? "待付款" : "已创建 · 请刷新状态"),
    needPay: pending,
    total: amount != null && amount !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0 ? Number(amount) : null,
    payOrderUrl: paymentUrl(data.payOrderUrl),
    shopInfo: data.shopInfo,
    productInfoList: data.productInfoList,
    pickup: pickupState(data)
  };
}
export function shopSummary(shop, now = Date.now()) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const start = shop.workTimeStart, end = shop.workTimeEnd;
  const hoursKnown = /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start !== end;
  const open = hoursKnown ? start < end ? time >= start && time < end : time >= start || time < end : null;
  return { deptId: Number(shop.deptId), deptName: String(shop.deptName ?? "门店"), address: String(shop.address ?? ""), longitude: shop.longitude, latitude: shop.latitude, workTimeStart: start, workTimeEnd: end, distance: shop.distance, open };
}
