import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  console.log("Order Create Webhook Received");

  const { admin, payload, session } = await authenticate.webhook(request);
  const shop = session.shop;
  console.log("Shop Domain:", shop);
  const orderId = payload.id.toString();
  console.log("Order ID:", orderId);

  const customer = payload.customer;
  if (!customer) {
    console.log("No customer on order");
    return new Response("No customer", { status: 200 });
  }

  const customerId = customer.id.toString();
  console.log("Customer ID:", customerId);
  const customerQuery = await admin.graphql(`
    query {
      customer(id: "gid://shopify/Customer/${customerId}") {
        id
        tags
      }
    }
  `);

  const customerData = await customerQuery.json();
  const tags = customerData.data.customer.tags;

  console.log("Fetched Customer Tags:", tags);

  const isVip = tags.includes("VIP");
  if (!isVip) {
    console.log("Customer is not VIP");
    return new Response("Not VIP", { status: 200 });
  }

  const subtotal = parseFloat(payload.subtotal_price || "0");
  const points = Math.floor(subtotal * 2);
  console.log(`Order Subtotal: ${subtotal}, Points to Credit: ${points}`);
  await db.vipCustomer.upsert({
    where: {
      customerId,
    },
    update: {
      rewardPoints: {
        increment: points,
      },
    },
    create: {
      shop,
      customerId,
      rewardPoints: points,
    },
  });

  await db.rewardTransaction.create({
    data: {
      customerId,
      orderId,
      pointsEarned: points,
      pointsRedeemed: null,
    },
  });

  console.log(`Credited ${points} points to VIP customer ${customerId}`);

  return new Response("VIP points credited", { status: 200 });
};
