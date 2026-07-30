# Wasp + Bluesky login

A [Wasp](https://wasp.sh) starter with "Log in with Bluesky" wired up as a custom auth provider. Users sign in with their AT Protocol handle, and Wasp gets a real session with a `User` row keyed on the account's DID.

Built by following Wasp's [Custom OAuth Provider guide](https://wasp.sh/docs/guides/integrations/custom-oauth.md), with the OAuth half swapped out for AT Protocol. See below for why.

> [!NOTE] **New to Wasp?** Wasp is a full-stack React + Node.js + Prisma framework where you describe your app (routes, pages, auth, APIs, jobs) in a single [`main.wasp.ts`](https://wasp.sh/docs/general/spec.md) file and Wasp generates the glue: the client, the server, the database client, and end to end types. The [Introduction](https://wasp.sh/docs.md) is a 5 minute read, and the [Tutorial](https://wasp.sh/docs/tutorial/create.md) builds a full app in about 20 minutes.

## What Wasp is doing for you here

The AT Protocol part of this repo is roughly 300 lines in `src/bluesky/`. Everything around it is Wasp:

| You would otherwise write | Wasp gives you | Where it shows up |
| --- | --- | --- |
| Session cookies, token issuing, `useAuth` plumbing | [Auth](https://wasp.sh/docs/auth/overview.md) | `auth: {}` in `main.wasp.ts`, `useAuth()` in `src/MainPage.tsx` |
| An Express app, route wiring, typed handlers | [Custom HTTP API endpoints](https://wasp.sh/docs/advanced/apis.md) | `src/bluesky/spec.wasp.ts` |
| A Prisma setup and a dev database | [Entities](https://wasp.sh/docs/data-model/entities.md) and [Databases](https://wasp.sh/docs/data-model/databases.md) | `schema.prisma`, `wasp db start` |
| A React router and page/layout wiring | [Pages and routes](https://wasp.sh/docs/tutorial/pages.md) | `route("RootRoute", "/", page(MainPage))` |
| Env var loading, validation, and client/server split | [Env variables](https://wasp.sh/docs/project/env-vars.md) | `.env.server`, `.env.client` |
| A deploy pipeline for two services plus a database | [`wasp deploy`](https://wasp.sh/docs/deployment/deployment-methods/wasp-deploy/overview.md) | see [Deploying](#deploying) |

> [!TIP] Wasp is not a hosted platform or a lock-in. It generates a normal Node.js server and a normal Vite client into `.wasp/out/`, which you can read at any time.

## Why this isn't the usual OAuth setup

Bluesky uses the [AT Protocol OAuth profile](https://atproto.com/specs/oauth), not plain OAuth 2.0. Four things differ from a typical provider:

- **No client secret, and nothing to register.** Your `client_id` is a URL that serves a public client metadata document. Authorization servers fetch it.
- **PAR and DPoP are mandatory.** Authorization requests are pushed server to server, and tokens are bound to a per session key.
- **The authorization server is per account.** A handle resolves to a DID, the DID document points at the user's PDS, and the PDS points at its authorization server. So the flow needs the user's handle up front, and accounts on any PDS work, not just `bsky.social`.
- **Localhost is special.** Development uses a spec-defined loopback exception instead of a hosted metadata document.

The custom OAuth guide uses [Arctic](https://v1.arcticjs.dev/), which has no Bluesky provider and cannot express any of the above. This starter uses [`@atproto/oauth-client-node`](https://www.npmjs.com/package/@atproto/oauth-client-node) instead. Everything else from the guide carries over unchanged: the [`api()`](https://wasp.sh/docs/advanced/apis.md) routes, `findAuthIdentity` / `createUser` / `tokenStore` / `getRedirectUriForOneTimeCode`, and the switch to `127.0.0.1`.

> [!NOTE] If you want a provider Wasp already supports, you do not need any of this. [Social auth](https://wasp.sh/docs/auth/social-auth/overview.md) covers Google, GitHub, Keycloak, Slack, Discord, and Microsoft in a few lines of config, with [prebuilt login UI](https://wasp.sh/docs/auth/ui.md) included.

## Quick start

You need [Wasp installed](https://wasp.sh/docs/quick-start.md) and Docker running (Wasp uses it for the dev database).

```sh
npm install
cp .env.server.example .env.server
cp .env.client.example .env.client
wasp db start          # starts a dev Postgres in Docker, keep this running
wasp db migrate-dev    # in a second terminal
wasp start
```

Then open **http://127.0.0.1:3000** and enter a Bluesky handle.

> [!IMPORTANT] **Use `127.0.0.1`, not `localhost`.** The AT Protocol loopback exception only accepts `http://127.0.0.1` and `http://[::1]` as redirect URIs. That is why `.env.server` overrides `WASP_SERVER_URL` and `WASP_WEB_CLIENT_URL` away from Wasp's `localhost` defaults. The port number does not matter, it is ignored when matching loopback redirect URIs, so set `PORT` too if 3001 is taken. See [Env variables](https://wasp.sh/docs/project/env-vars.md) for the full list of what Wasp reads.

No developer dashboard, API key, or app registration is needed for development.

> [!TIP] `wasp compile` type checks the whole app, spec included. Use it instead of running `tsc` directly. Full command list in the [CLI reference](https://wasp.sh/docs/general/cli.md).

## How it works

| File | What it does |
| --- | --- |
| [`main.wasp.ts`](https://wasp.sh/docs/general/spec.md) | The app spec: auth config, the root route, and the Bluesky routes spliced in |
| `src/bluesky/spec.wasp.ts` | The four [`api()`](https://wasp.sh/docs/advanced/apis.md) routes, exported as a `Spec` fragment |
| `src/bluesky/client.ts` | Builds the OAuth client metadata and a per request `NodeOAuthClient` |
| `src/bluesky/auth.ts` | The route handlers, plus mapping a Bluesky account onto a Wasp user |
| `src/bluesky/profile.ts` | Reads handle, display name, and avatar from the public AppView |
| `src/MainPage.tsx` | Handle input, and the logged in profile view via [`useAuth()`](https://wasp.sh/docs/auth/entities.md) |

The flow:

1. `GET /auth/bluesky?handle=alice.bsky.social` resolves the handle to a PDS, pushes the authorization request, and redirects to that PDS's consent screen.
2. The user approves, and the PDS redirects back to `GET /auth/bluesky/callback`.
3. The handler exchanges the code, reads the account's DID, finds or creates the Wasp user, and redirects to Wasp's built-in `/oauth/callback` page with a one time code.
4. That page exchanges the code for a Wasp session. The user is logged in.

### Two design choices worth knowing

**OAuth state lives in an httpOnly cookie**, with the same options Wasp uses for its own providers (see `cookies.ts` in Wasp's OAuth internals). That is why the client is constructed per request rather than once at module scope: the state store closes over `req` and `res`. No database table is needed for in-flight logins.

**The AT Protocol session is not persisted.** The `atproto` scope is enough to log someone in, and the DID is read immediately in the callback, so the session store is a throwaway `Map`. See "Calling the API as the user" below to change this.

## Adapting it

### Storing more profile fields

Add columns to `User` in [`schema.prisma`](https://wasp.sh/docs/data-model/prisma-file.md), run `wasp db migrate-dev`, then extend the object passed to `createUser` in `src/bluesky/auth.ts`. The raw profile is already serialized into `AuthIdentity.providerData`, so nothing is lost if you add a field later. [Accessing user data](https://wasp.sh/docs/auth/entities.md) explains what Wasp puts on the `User` entity and how to read it on both client and server.

### Calling the API as the user

This starter only authenticates. To also act on someone's behalf:

1. Widen `SCOPE` in `src/bluesky/client.ts` to `"atproto transition:generic"`. The loopback `client_id` is built from `SCOPE`, so it updates automatically.
2. Replace `createInMemorySessionStore()` with a store backed by a Prisma model keyed on the DID. The value is JSON, so a single `String` column is enough.
3. Install [`@atproto/api`](https://www.npmjs.com/package/@atproto/api) as a [regular npm dependency](https://wasp.sh/docs/project/dependencies.md), then `client.restore(did)` and pass the result to `new Agent(session)`. Token refresh is handled for you.

### Renaming the provider

`PROVIDER_NAME` in `src/bluesky/auth.ts` is what lands in `AuthIdentity.providerName`. Change it before you have real users, not after.

## Where to go next with Wasp

Now that login works, the rest of an app is mostly config:

- **Read and write data.** [Queries and actions](https://wasp.sh/docs/data-model/operations/overview.md) are plain server functions that Wasp exposes to React with types, caching, and invalidation. [Automatic CRUD](https://wasp.sh/docs/data-model/crud.md) generates the common ones for you.
- **Run something on a schedule.** Backfill profiles or poll a firehose with [recurring jobs](https://wasp.sh/docs/advanced/jobs.md).
- **Push updates live.** [Web sockets](https://wasp.sh/docs/advanced/web-sockets.md) for feeds and notifications.
- **Send email.** [Sending emails](https://wasp.sh/docs/advanced/email.md) with a provider of your choice.
- **Gate or extend the login.** [Auth hooks](https://wasp.sh/docs/auth/auth-hooks.md) run before redirect, after sign up, and before session creation. Useful for allowlists or invite codes.
- **Make it look like yours.** [Tailwind](https://wasp.sh/docs/guides/libraries/tailwind.md), [shadcn](https://wasp.sh/docs/guides/libraries/shadcn.md), or [Radix Themes](https://wasp.sh/docs/guides/libraries/radix-themes.md).
- **Start from something bigger.** [Starter templates](https://wasp.sh/docs/project/starter-templates.md), including [OpenSaaS](https://opensaas.sh) if you want billing and admin out of the box.

## Deploying

Once your server is reachable over HTTPS, the loopback exception no longer applies and the app becomes a _confidential_ client that signs its token requests. `src/bluesky/client.ts` switches automatically based on whether `WASP_SERVER_URL` is `https:`. You need to:

1. Generate an ES256 private key and set it as `BLUESKY_PRIVATE_KEY` in [the server env](https://wasp.sh/docs/deployment/env-vars.md) (one line):

   ```sh
   node --input-type=module -e "import {generateKeyPair,exportJWK} from 'jose'; const {privateKey} = await generateKeyPair('ES256', {extractable: true}); console.log(JSON.stringify({...await exportJWK(privateKey), alg: 'ES256'}))"
   ```

2. Confirm `GET /auth/bluesky/client-metadata.json` and `GET /auth/bluesky/jwks.json` are publicly reachable. Authorization servers fetch both.

> [!TIP] `wasp deploy fly launch bsky-login mia` provisions the client, the server, and a Postgres database in one command. See [Fly.io](https://wasp.sh/docs/deployment/deployment-methods/wasp-deploy/fly.md) or [Railway](https://wasp.sh/docs/deployment/deployment-methods/wasp-deploy/railway.md), and [Deployment overview](https://wasp.sh/docs/deployment/intro.md) for everything else, including self-hosting.

> [!WARNING] If you run more than one server instance _and_ persist AT Protocol sessions, replace `requestLocalLock` in `src/bluesky/client.ts` with a distributed lock. It is process-local, and concurrent token refreshes across instances can get credentials revoked.

## Gotchas

> [!CAUTION] **`zod` is pinned to v4 in `package.json`.** The `@atproto/*` packages depend on zod 3, which npm hoists to the root and shadows the zod 4 that Wasp's SDK bundles against, crashing the server with `z.url is not a function`. Pinning v4 at the root pushes zod 3 down into nested `node_modules` where the atproto packages still find it. Keep this line if you add more atproto [dependencies](https://wasp.sh/docs/project/dependencies.md).

**Google is enabled with dummy credentials, on purpose.** Wasp only exports the OAuth helpers these handlers rely on (`tokenStore`, `getRedirectUriForOneTimeCode`) when at least one [built-in OAuth provider](https://wasp.sh/docs/auth/social-auth/overview.md) is configured. The Google route exists but is inert. To hide it entirely, reject it from an [`onBeforeOAuthRedirect`](https://wasp.sh/docs/auth/auth-hooks.md) hook.

**Every Bluesky route sets `auth: false`.** Wasp defaults [`api()`](https://wasp.sh/docs/advanced/apis.md) routes to `auth: true` once the app has auth enabled, which is wrong for login endpoints.

**`tokenStore` and `getRedirectUriForOneTimeCode` are private Wasp APIs.** The [custom OAuth guide](https://wasp.sh/docs/guides/integrations/custom-oauth.md) uses them for the same reason: there is currently no public API for a fully custom OAuth flow. They may change between Wasp versions. Verified against Wasp 0.25.

## Verifying without logging in

The whole server half can be checked without credentials:

```sh
# Should show the loopback client_id and your redirect URI
curl -s http://127.0.0.1:3001/auth/bluesky/client-metadata.json

# Should 302 to bsky.social with a request_uri, proving PAR succeeded
curl -si "http://127.0.0.1:3001/auth/bluesky?handle=bsky.app" | grep -i location
```

## Help

- Wasp: [docs](https://wasp.sh/docs.md) · [Discord](https://discord.gg/rzdnErX) · [GitHub](https://github.com/wasp-lang/wasp)
- AT Protocol: [OAuth spec](https://atproto.com/specs/oauth) · [atproto docs](https://atproto.com)
