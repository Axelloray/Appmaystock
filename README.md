# May'Stock — backend Supabase

Ce dossier contient le schéma Postgres, les policies RLS et les Edge
Functions du backend de May'Stock, conformément à la spec technique
(`profiles`, `products`, `history`, `recipes`, `recipe_ingredients`,
`settings`, bucket Storage `product-photos`, extraction IA des bons de
livraison, webhook Stripe).

Le CLI Supabase est déjà scaffoldé (`supabase init` a été lancé), mais la
création du **projet hébergé** sur supabase.com nécessite ton compte — je ne
peux pas la faire à ta place depuis cet environnement. Voici la marche à
suivre.

## 1. Créer le projet sur supabase.com

1. Va sur https://supabase.com/dashboard et crée un nouveau projet (choisis
   une région proche de tes utilisateurs, ex. `eu-west-3`).
2. Note l'**URL du projet**, la clé **anon/public**, la clé **service_role**
   (Project Settings > API) et la **référence du projet** (`project-ref`,
   visible dans l'URL du dashboard ou dans Project Settings > General).

## 2. Lier ce repo au projet

En local (ou dans un environnement avec accès navigateur, car `supabase
login` ouvre un flux OAuth) :

```bash
npm install -g supabase   # si pas déjà fait
supabase login
supabase link --project-ref <ton-project-ref>
```

## 3. Pousser le schéma

```bash
supabase db push
```

Cela applique dans l'ordre les migrations de `supabase/migrations/` :
tables, contraintes, index, RLS, triggers, et le bucket Storage
`product-photos`.

## 4. Configurer l'authentification

Dans Authentication > Providers, laisse Email activé. Le prototype utilisait
un identifiant + mot de passe fait maison : on bascule sur email + mot de
passe via Supabase Auth (spec §4). Si tu veux garder un "identifiant" façon
nom de boulangerie plutôt qu'un email comme login, il faudra soit demander
un email quand même (le plus simple), soit mettre en place une résolution
identifiant → email côté client. À trancher avec le client si besoin.

Pense à personnaliser les templates d'email (confirmation, reset password)
dans Authentication > Email Templates.

## 5. Secrets des Edge Functions

Copie `supabase/functions/.env.example` en `supabase/functions/.env.production`
(jamais commité), remplis les vraies valeurs, puis :

```bash
supabase secrets set --env-file supabase/functions/.env.production
```

Secrets nécessaires :
- `ANTHROPIC_API_KEY` — clé API Anthropic (console.anthropic.com), pour la
  lecture des bons de livraison.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`,
  `STRIPE_PRICE_YEARLY` — voir étape 7.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` sont
injectées automatiquement par la plateforme, pas besoin de les définir.

## 6. Déployer les Edge Functions

```bash
supabase functions deploy extract-delivery-note
supabase functions deploy stripe-webhook --no-verify-jwt
```

`extract-delivery-note` exige un JWT Supabase valide (utilisateur connecté)
et vérifie en plus que son abonnement est actif avant d'appeler l'API
Anthropic. `stripe-webhook` est publique mais s'authentifie via la signature
Stripe (`--no-verify-jwt` correspond à `verify_jwt = false` dans
`config.toml`).

## 7. Brancher Stripe

Les Payment Links existent déjà côté client. Pour que le webhook sache à
quel compte Supabase rattacher un paiement, le lien doit être ouvert avec
deux paramètres :

```
https://buy.stripe.com/xxxxxxxx?client_reference_id=<user.id>&prefilled_email=<user.email>
```

(`user.id` = `auth.uid()` de l'utilisateur connecté au moment où il clique
sur "S'abonner" — c'est ce qui permettra au webhook de retrouver la bonne
ligne `profiles`.)

Dans le Dashboard Stripe :
1. Récupère les **Price ID** (pas les Payment Link URL) des deux prix
   récurrents créés → `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`.
2. Développeurs > Webhooks > Ajouter un endpoint :
   `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
   Événements à écouter : `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.created`,
   `customer.subscription.deleted`.
3. Copie le **Signing secret** généré → `STRIPE_WEBHOOK_SECRET`.
4. Récupère la clé secrète API (mode live) → `STRIPE_SECRET_KEY`.

## 8. Vérifier l'accès aux données

Toutes les tables métier (`products`, `history`, `recipes`,
`recipe_ingredients`) sont verrouillées par RLS avec une double condition :
`owner_id = auth.uid()` **et** abonnement actif
(`public.has_active_subscription()`, `subscription_status` dans `trialing`
ou `active`). Un utilisateur dont l'abonnement expire perd donc l'accès à
ses données au niveau base de données, pas seulement à l'écran — c'est le
contrôle "infalsifiable" demandé dans la spec (§6).

La table `profiles` reste lisible/modifiable par son propriétaire même sans
abonnement actif (nécessaire pour afficher le paywall et permettre de se
réabonner), mais les colonnes `subscription_status`, `subscription_plan` et
`stripe_customer_id` ne peuvent être modifiées que par le `service_role`
(donc uniquement par `stripe-webhook`) — un trigger Postgres le bloque
sinon.

## Où trouver quoi

```
supabase/
  config.toml                   config local + verify_jwt par fonction
  migrations/
    ..._profiles.sql             profiles + trigger auto-création + helper has_active_subscription()
    ..._products.sql             products + RLS
    ..._history.sql              history (mouvements de stock) + RLS
    ..._recipes.sql              recipes + recipe_ingredients + RLS
    ..._settings.sql             settings (emails gérant/comptable) + RLS
    ..._storage.sql              bucket product-photos + RLS storage.objects
  functions/
    extract-delivery-note/       OCR/vision IA d'un bon de livraison (Anthropic)
    stripe-webhook/              synchro abonnement Stripe → profiles
    _shared/cors.ts
```

## Prochaine étape : le frontend

Ce backend est prêt à être consommé, mais `index.html` (le prototype) parle
encore à `window.storage` et pas à Supabase. La suite logique : introduire
`@supabase/supabase-js` côté client, remplacer les fonctions
`loadAll/saveProducts/...` par des requêtes Supabase, et remplacer
`window.storage`-based auth par `supabase.auth.signUp/signInWithPassword`.
Dis-moi quand tu veux t'y attaquer.
