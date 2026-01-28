import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  try {
    const { session, admin } = await authenticate.public.appProxy(request);
    const { customerId, points } = await request.json();
    const vip = await db.vipCustomer.findUnique({
      where: { customerId },
    });

    if (!vip || vip.totalPoints < points) {
      return new Response(JSON.stringify({ error: "Invalid points" }), {
        status: 400,
      });
    }

    const discountValue = parseFloat(points);
    const code = `VIP-${customerId}-${Date.now()}`;

    const metafieldRes = await admin.graphql(`
  query {
    shop {
      metafield(namespace: "group_discount", key: "config") {
        value
      }
    }
  }
`);

    const metafieldJson = await metafieldRes.json();

    const excludedVariantIds =
      JSON.parse(metafieldJson.data.shop.metafield?.value || "{}")
        .excludedVariantIds || [];
    console.log("Excluded Variant IDs:", excludedVariantIds);
    const productRes = await (
      await admin.graphql(`
      query {
        products(first: 100) {
          nodes {
            id
            title
            variants(first: 50) {
              nodes {
                id
                title
              }
            }
          }
        }
      }
    `)
    ).json();
    const products = [];
    productRes.data.products.nodes.forEach((product) => {
      product.variants.nodes.forEach((variant) => {
        products.push({
          productId: product.id,
          productTitle: product.title,
          variantId: variant.id,
          variantTitle: variant.title,
          title: `${product.title} - ${variant.title}`,
        });
      });
    });

    const productsToAdd = products.filter(
      (product) => !excludedVariantIds.includes(product.variantId),
    );
    console.log("Products to Add for Discount:", productsToAdd);
    const uniqueProductIds = [
      ...new Set(productsToAdd.map((p) => p.variantId)),
    ];

    console.log("Product IDs to Add:", uniqueProductIds);
    const gqlResponse = await admin.graphql(
      `#graphql
      mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          userErrors {
            field
            message
          }
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
              }
            }
          }
        }
      }`,
      {
        variables: {
          basicCodeDiscount: {
            title: code,
            code: code,
            startsAt: new Date().toISOString(),
            usageLimit: 1,
            customerSelection: {
              customers: {
                add: [`gid://shopify/Customer/${customerId}`],
              },
            },
            customerGets: {
              value: {
                discountAmount: {
                  amount: discountValue,
                  appliesOnEachItem: false,
                },
              },
              items: {
                products: {
                  productVariantsToAdd: uniqueProductIds,
                },
              },
            },
          },
        },
      },
    );
    const pointsInt = parseInt(points, 10);
    await db.$transaction([
      db.vipCustomer.update({
        where: { customerId },
        data: {
          rewardPoints: { decrement: pointsInt },
        },
      }),
      db.rewardTransaction.create({
        data: {
          customerId,
          orderId: "REDEEM",
          pointsEarned: 0,
          pointsRedeemed: pointsInt,
        },
      }),
    ]);

    return new Response(JSON.stringify({ discountCode: code }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
