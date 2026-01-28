import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const log = (...args) => console.log("[AUTH-LOADER]", ...args);

export const loader = async ({ request }) => {
  log("loader:start");
  log("request.url", request.url);

  try {
    log("authenticate.admin:start");
    const admin = await authenticate.admin(request);
    log("authenticate.admin:success", {
      shop: admin?.session?.shop,
      scopes: admin?.session?.scope,
    });
  } catch (error) {
    log("authenticate.admin:FAILED");
    log("error.name", error?.name);
    log("error.message", error?.message);
    log("error.stack", error?.stack);
    throw error; // IMPORTANT: rethrow so Shopify CLI surfaces it
  }

  log("loader:end");
  return null;
};

export const headers = (headersArgs) => {
  log("headers:boundary");
  return boundary.headers(headersArgs);
};
