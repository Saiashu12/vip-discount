import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

const log = (...args) => console.log("[AUTH-PAGE]", ...args);

/* =========================
   SERVER
========================= */

export const loader = async ({ request }) => {
  log("loader:start");
  log("request.url", request.url);

  try {
    log("login:start (loader)");
    const result = await login(request);
    log("login:result (loader)", result);

    const errors = loginErrorMessage(result);
    log("login:errors (loader)", errors);

    return { errors };
  } catch (error) {
    log("loader:FAILED");
    log("error.name", error?.name);
    log("error.message", error?.message);
    log("error.stack", error?.stack);

    return { errors: { _global: "Login failed" } };
  }
};

export const action = async ({ request }) => {
  log("action:start");

  try {
    log("login:start (action)");
    const result = await login(request);
    log("login:result (action)", result);

    const errors = loginErrorMessage(result);
    log("login:errors (action)", errors);

    return { errors };
  } catch (error) {
    log("action:FAILED");
    log("error.name", error?.name);
    log("error.message", error?.message);
    log("error.stack", error?.stack);

    return { errors: { _global: "Login failed" } };
  }
};

/* =========================
   CLIENT
========================= */

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();

  log("render:start", { loaderData, actionData });

  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  log("render:errors", errors);

  return (
    <AppProvider embedded={false}>
      <s-page>
        <Form method="post">
          <s-section heading="Log in">
            <s-text-field
              name="shop"
              label="Shop domain"
              details="example.myshopify.com"
              value={shop}
              onChange={(e) => {
                log("shop:change", e.currentTarget.value);
                setShop(e.currentTarget.value);
              }}
              autocomplete="on"
              error={errors?.shop}
            ></s-text-field>
            <s-button type="submit">Log in</s-button>
          </s-section>
        </Form>
      </s-page>
    </AppProvider>
  );
}
