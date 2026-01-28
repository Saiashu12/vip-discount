import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

const log = (...args) => console.log("[LOGIN-ERROR]", ...args);

export function loginErrorMessage(loginErrors) {
  log("input", loginErrors);

  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    log("matched:MissingShop");
    return { shop: "Please enter your shop domain to log in" };
  }

  if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    log("matched:InvalidShop");
    return { shop: "Please enter a valid shop domain to log in" };
  }

  log("matched:none");
  return {};
}
