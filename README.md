# Wasp + Bluesky login

A [Wasp](https://wasp.sh) starter with "Log in with Bluesky" wired up as a custom
auth provider. Users sign in with their AT Protocol handle, and Wasp gets a real
session with a `User` row keyed on the account's DID.

Built by following Wasp's [Custom OAuth Provider
guide](https://wasp.sh/docs/guides/integrations/custom-oauth.md), with the OAuth
half swapped out for AT Protocol. See below for why.

## Why this isn't the usual OAuth setup

Bluesky uses the [AT Protocol OAuth profile](https://atproto.com/specs/oauth),
not plain OAuth 2.0. Four things differ from a typical provider:

- **No client secret, and nothing to register.** Your `client_id` is a URL that
  serves a public client metadata document. Authorization servers fetch it.
- **PAR and DPoP are mandatory.** Authorization requests are pushed server to
  server, and tokens are bound to a per session key.
- **The authorization server is per account.** A handle resolves to a DID, the
  DID document points at the user's PDS, and the PDS points at its authorization
  server. So the flow needs the user's handle up front, and accounts on any PDS
  work, not just `bsky.social`.
- **Localhost is special.** Development uses a spec-defined loopback exception
  instead of a hosted metadata document.

The custom OAuth guide uses [Arctic](https://v1.arcticjs.dev/), which has no
Bluesky provider and cannot express any of the above. This starter uses
[`@atproto/oauth-client-node`](https://www.npmjs.com/package/@atproto/oauth-client-node)
instead. Everything else from the guide carries over unchanged: the `api()`
routes, `findAuthIdentity` / `createUser` / `tokenStore` /
`getRedirectUriForOneTimeCode`, and the switch to `127.0.0.1`.

## Quick start

```sh
npm install
cp .env.server.example .env.server
cp .env.client.example .env.client
wasp db migrate-dev
wasp start
```

Then open **http://127.0.0.1:3000** and enter a Bluesky handle.

> **Use `127.0.0.1`, not `localhost`.** The AT Protocol loopback exception only
> accepts `http://127.0.0.1` and `http://[::1]` as redirect URIs. That is why
> `.env.server` overrides `WASP_SERVER_URL` and `WASP_WEB_CLIENT_URL` away from
> Wasp's `localhost` defaults. The port number does not matter, it is ignored
> when matching loopback redirect URIs, so set `PORT` too if 3001 is taken.

No developer dashboard, API key, or app registration is needed for development.

## How it works

| File | What it does |
| --- | --- |
| `src/bluesky/spec.wasp.ts` | The four `api()` routes, exported as a `Spec` fragment that `main.wasp.ts` splices in |
| `src/bluesky/client.ts` | Builds the OAuth client metadata and a per request `NodeOAuthClient` |
| `src/bluesky/auth.ts` | The route handlers, plus mapping a Bluesky account onto a Wasp user |
| `src/bluesky/profile.ts` | Reads handle, display name, and avatar from the public AppView |
| `src/MainPage.tsx` | Handle input, and the logged in profile view |

The flow:

1. `GET /auth/bluesky?handle=alice.bsky.social` resolves the handle to a PDS,
   pushes the authorization request, and redirects to that PDS's consent screen.
2. The user approves, and the PDS redirects back to `GET /auth/bluesky/callback`.
3. The handler exchanges the code, reads the account's DID, finds or creates the
   Wasp user, and redirects to Wasp's built-in `/oauth/callback` page with a one
   time code.
4. That page exchanges the code for a Wasp session. The user is logged in.

### Two design choices worth knowing

**OAuth state lives in an httpOnly cookie**, with the same options Wasp uses for
its own providers (see `cookies.ts` in Wasp's OAuth internals). That is why the
client is constructed per request rather than once at module scope: the state
store closes over `req` and `res`. No database table is needed for in-flight
logins.

**The AT Protocol session is not persisted.** The `atproto` scope is enough to
log someone in, and the DID is read immediately in the callback, so the session
store is a throwaway `Map`. See "Calling the API as the user" below to change
this.

## Adapting it

### Storing more profile fields

Add columns to `User` in `schema.prisma`, then extend the object passed to
`createUser` in `src/bluesky/auth.ts`. The raw profile is already serialized into
`AuthIdentity.providerData`, so nothing is lost if you add a field later.

### Calling the API as the user

This starter only authenticates. To also act on someone's behalf:

1. Widen `SCOPE` in `src/bluesky/client.ts` to `"atproto transition:generic"`.
   The loopback `client_id` is built from `SCOPE`, so it updates automatically.
2. Replace `createInMemorySessionStore()` with a store backed by a Prisma model
   keyed on the DID. The value is JSON, so a single `String` column is enough.
3. Install `@atproto/api`, then `client.restore(did)` and pass the result to
   `new Agent(session)`. Token refresh is handled for you.

### Renaming the provider

`PROVIDER_NAME` in `src/bluesky/auth.ts` is what lands in
`AuthIdentity.providerName`. Change it before you have real users, not after.

## Deploying

Once your server is reachable over HTTPS, the loopback exception no longer
applies and the app becomes a *confidential* client that signs its token
requests. `src/bluesky/client.ts` switches automatically based on whether
`WASP_SERVER_URL` is `https:`. You need to:

1. Generate an ES256 private key and set it as `BLUESKY_PRIVATE_KEY` in
   `.env.server` (one line):

   ```sh
   node --input-type=module -e "import {generateKeyPair,exportJWK} from 'jose'; const {privateKey} = await generateKeyPair('ES256', {extractable: true}); console.log(JSON.stringify({...await exportJWK(privateKey), alg: 'ES256'}))"
   ```

2. Confirm `GET /auth/bluesky/client-metadata.json` and
   `GET /auth/bluesky/jwks.json` are publicly reachable. Authorization servers
   fetch both.

If you run more than one server instance *and* persist AT Protocol sessions,
replace `requestLocalLock` in `src/bluesky/client.ts` with a distributed lock.
It is process-local, and concurrent token refreshes across instances can get
credentials revoked.

## Gotchas

**`zod` is pinned to v4 in `package.json`.** The `@atproto/*` packages depend on
zod 3, which npm hoists to the root and shadows the zod 4 that Wasp's SDK bundles
against, crashing the server with `z.url is not a function`. Pinning v4 at the
root pushes zod 3 down into nested `node_modules` where the atproto packages
still find it. Keep this line if you add more atproto dependencies.

**Google is enabled with dummy credentials, on purpose.** Wasp only exports the
OAuth helpers these handlers rely on (`tokenStore`,
`getRedirectUriForOneTimeCode`) when at least one built-in OAuth provider is
configured. The Google route exists but is inert. To hide it entirely, reject it
from an `onBeforeOAuthRedirect` hook.

**Every Bluesky route sets `auth: false`.** Wasp defaults `api()` routes to
`auth: true` once the app has auth enabled, which is wrong for login endpoints.

**`tokenStore` and `getRedirectUriForOneTimeCode` are private Wasp APIs.** The
custom OAuth guide uses them for the same reason: there is currently no public
API for a fully custom OAuth flow. They may change between Wasp versions.
Verified against Wasp 0.25.

## Verifying without logging in

The whole server half can be checked without credentials:

```sh
# Should show the loopback client_id and your redirect URI
curl -s http://127.0.0.1:3001/auth/bluesky/client-metadata.json

# Should 302 to bsky.social with a request_uri, proving PAR succeeded
curl -si "http://127.0.0.1:3001/auth/bluesky?handle=bsky.app" | grep -i location
```
