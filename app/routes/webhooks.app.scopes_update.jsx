import { authenticate } from "../shopify.server";
import db from "../db.server";

const log = (...args) => console.log("[WEBHOOK]", ...args);

export const action = async ({ request }) => {
  log("action:start");

  try {
    log("authenticate.webhook:start");
    const { payload, session, topic, shop } =
      await authenticate.webhook(request);

    log("authenticate.webhook:success", { topic, shop });

    log("payload", payload);

    const current = payload?.current;
    log("payload.current", current);

    if (session) {
      log("session:found", {
        id: session.id,
        shop: session.shop,
      });

      log("db.session.update:start");
      await db.session.update({
        where: {
          id: session.id,
        },
        data: {
          scope: current?.toString() ?? "",
        },
      });
      log("db.session.update:success");
    } else {
      log("session:none (offline webhook)");
    }

    log("action:success");
    return new Response(null, { status: 200 });
  } catch (error) {
    log("action:FAILED");
    log("error.name", error?.name);
    log("error.message", error?.message);
    log("error.stack", error?.stack);

    return new Response(null, { status: 500 });
  }
};
