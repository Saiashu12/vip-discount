import db from "../db.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");

  if (!customerId) return JSON.stringify({ points: 0 });
  const vip = await db.vipCustomer.findUnique({
    where: { customerId },
  });
  console.log("VIP Customer Record:", vip);
  return JSON.stringify({
    points: vip?.rewardPoints || 0,
  });
};
