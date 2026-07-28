// Reçoit les webhooks Stripe et met à jour profiles.subscription_status.
// Doit être appelée avec verify_jwt = false (voir supabase/config.toml) :
// Stripe n'envoie pas de JWT Supabase, la requête est authentifiée par la
// signature `stripe-signature` vérifiée ci-dessous.
//
// Pour relier un paiement à un compte Supabase, le lien de paiement Stripe
// doit être ouvert avec les paramètres :
//   ?client_reference_id=<supabase_user_id>&prefilled_email=<email>
import Stripe from "npm:stripe@17?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const STRIPE_PRICE_MONTHLY = Deno.env.get("STRIPE_PRICE_MONTHLY") ?? "";
const STRIPE_PRICE_YEARLY = Deno.env.get("STRIPE_PRICE_YEARLY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type PlanId = "monthly" | "yearly";
type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

function planFromPriceId(priceId?: string | null): PlanId | null {
  if (!priceId) return null;
  if (priceId === STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === STRIPE_PRICE_YEARLY) return "yearly";
  return null;
}

function statusFromStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
      return "past_due";
    default:
      // canceled, paused
      return "canceled";
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  if (!signature) return new Response("Missing stripe-signature header", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.error("Stripe signature verification failed", err);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        if (!userId) {
          console.error("checkout.session.completed without client_reference_id", session.id);
          break;
        }

        const customerId = typeof session.customer === "string"
          ? session.customer
          : session.customer?.id ?? null;

        let plan: PlanId | null = null;
        let status: SubscriptionStatus = "active";

        if (typeof session.subscription === "string") {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          plan = planFromPriceId(subscription.items.data[0]?.price?.id);
          status = statusFromStripeStatus(subscription.status);
        }

        const { error } = await supabaseAdmin
          .from("profiles")
          .update({ stripe_customer_id: customerId, subscription_status: status, subscription_plan: plan })
          .eq("id", userId);

        if (error) console.error("Failed to apply checkout.session.completed", error);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
        const plan = planFromPriceId(subscription.items.data[0]?.price?.id);
        const status = statusFromStripeStatus(subscription.status);

        const { error } = await supabaseAdmin
          .from("profiles")
          .update({ subscription_status: status, subscription_plan: plan })
          .eq("stripe_customer_id", customerId);

        if (error) console.error("Failed to apply subscription update", error);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;

        const { error } = await supabaseAdmin
          .from("profiles")
          .update({ subscription_status: "canceled" })
          .eq("stripe_customer_id", customerId);

        if (error) console.error("Failed to apply subscription deletion", error);
        break;
      }

      default:
        break; // événement non géré, ignoré volontairement
    }
  } catch (err) {
    console.error("Error handling Stripe event", event.type, err);
    return new Response("Internal error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
