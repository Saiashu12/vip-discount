import { authenticate } from "../shopify.server";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useActionData,
} from "react-router";
import { useState, useCallback } from "react";

const INITIAL_CONFIG = {
  excludedVariantIds: [],
};

/* ------------------------------------------------------------------ */
/* LOADER – Fetch products + existing excluded variants */
/* ------------------------------------------------------------------ */

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  // Get shop ID
  const shopId = (
    await (
      await admin.graphql(`
        query {
          shop { id }
        }
      `)
    ).json()
  ).data.shop.id;

  // Read saved config
  const configValue = (
    await (
      await admin.graphql(`
        query {
          shop {
            metafield(namespace: "group_discount", key: "config") {
              value
            }
          }
        }
      `)
    ).json()
  ).data.shop.metafield?.value;

  const config = configValue
    ? JSON.parse(configValue)
    : INITIAL_CONFIG;

  // Fetch products + variants
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

  // Flatten products
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

  return {
    shopId,
    products,
    excludedVariantIds: config.excludedVariantIds || [],
  };
}

/* ------------------------------------------------------------------ */
/* ACTION – Save excluded variants to metafield */
/* ------------------------------------------------------------------ */

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();

  const shopId = form.get("shopId");
  const excludedVariantIds = JSON.parse(
    form.get("excludedVariantIds")
  );

  await admin.graphql(
    `
    mutation ($ownerId: ID!, $value: String!) {
      metafieldsSet(
        metafields: [{
          ownerId: $ownerId
          namespace: "group_discount"
          key: "config"
          type: "json"
          value: $value
        }]
      ) {
        userErrors { message }
      }
    }
    `,
    {
      variables: {
        ownerId: shopId,
        value: JSON.stringify({ excludedVariantIds }),
      },
    }
  );

  return { success: true };
}

export default function ExcludeProductsPage() {
  const { shopId, products, excludedVariantIds: initialExcluded } =
    useLoaderData();

  const submit = useSubmit();
  const nav = useNavigation();
  const actionData = useActionData();

  const [excludedVariantIds, setExcludedVariantIds] =
    useState(initialExcluded);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);

  /* ---------------- Toggle Exclude ---------------- */

  const toggleExclude = useCallback((variantId) => {
    setExcludedVariantIds((prev) =>
      prev.includes(variantId)
        ? prev.filter((id) => id !== variantId)
        : [...prev, variantId]
    );
  }, []);

  /* ---------------- Search Filter ---------------- */

  const filteredProducts = products.filter((p) => {
    if (!search.trim()) return false;
    const q = search.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      p.productTitle.toLowerCase().includes(q) ||
      p.variantTitle.toLowerCase().includes(q)
    );
  });

  const excludedProducts = products.filter((p) =>
    excludedVariantIds.includes(p.variantId)
  );

  /* ---------------- Save ---------------- */

  const handleSave = () => {
    const fd = new FormData();
    fd.append("shopId", shopId);
    fd.append(
      "excludedVariantIds",
      JSON.stringify(excludedVariantIds)
    );
    submit(fd, { method: "post" });
  };

  /* ------------------------------------------------------------------ */

  return (
    <div style={{ padding: 24 }}>
      <h2>Exclude Products</h2>

      <button onClick={() => setShowModal(true)}>
        Exclude Product
      </button>

      {/* ---------------- Modal ---------------- */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              width: 600,
              padding: 20,
              position: "relative",
            }}
          >
            <button
              onClick={() => setShowModal(false)}
              style={{ position: "absolute", right: 10, top: 10 }}
            >
              ✕
            </button>

            <input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", marginBottom: 12 }}
            />

            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {filteredProducts.map((p) => (
                <div
                  key={p.variantId}
                  onClick={() => {
                    toggleExclude(p.variantId);
                    setShowModal(false);
                  }}
                  style={{
                    padding: 8,
                    cursor: "pointer",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  {p.title}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Excluded Table ---------------- */}
      {excludedProducts.length > 0 && (
        <table
          style={{
            width: "70%",
            marginTop: 20,
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr>
              <th align="left">#</th>
              <th align="left">Product</th>
              <th align="left">Action</th>
            </tr>
          </thead>
          <tbody>
            {excludedProducts.map((p, i) => (
              <tr key={p.variantId}>
                <td>{i + 1}</td>
                <td>{p.title}</td>
                <td>
                  <button
                    onClick={() => toggleExclude(p.variantId)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 24 }}>
        <button
          onClick={handleSave}
          disabled={nav.state === "submitting"}
        >
          Save
        </button>
      </div>

      {actionData?.success && <p>Saved successfully</p>}
    </div>
  );
}
