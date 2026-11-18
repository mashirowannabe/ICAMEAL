import { withSupabase } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const allowedProducts = new Set([
  "good_food_club_monthly",
  "recipe_book_30",
  "meal_plan_30_days",
]);

const authenticatedHandler = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  let body: { product_code?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const productCode = typeof body.product_code === "string" ? body.product_code : "";
  if (!allowedProducts.has(productCode)) {
    return Response.json({ error: "Unknown product" }, { status: 400, headers: corsHeaders });
  }

  const userId = ctx.userClaims?.id;
  if (!userId) {
    return Response.json({ error: "Authenticated user not found" }, { status: 401, headers: corsHeaders });
  }

  const { data, error } = await ctx.supabaseAdmin.rpc("complete_demo_purchase", {
    p_user_id: userId,
    p_product_code: productCode,
  });

  if (error) {
    console.error("Demo checkout failed:", error.message);
    return Response.json({ error: "Purchase could not be completed" }, { status: 400, headers: corsHeaders });
  }

  return Response.json({ ok: true, purchase: data }, { status: 200, headers: corsHeaders });
});

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const response = await authenticatedHandler(req);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.error("Demo checkout error:", error);
      return Response.json({ error: "Unexpected checkout error" }, { status: 500, headers: corsHeaders });
    }
  },
};
