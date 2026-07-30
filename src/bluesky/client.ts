import {
  JoseKey,
  NodeOAuthClient,
  requestLocalLock,
  type NodeSavedSession,
  type NodeSavedSessionStore,
  type NodeSavedState,
  type NodeSavedStateStore,
  type OAuthClientMetadataInput,
} from "@atproto/oauth-client-node";
import { config } from "wasp/server";
import type { LoginWithBluesky } from "wasp/server/api";

// The AT Protocol OAuth profile has no client secret. A client identifies
// itself by a `client_id` that is the URL of a public client metadata document.
// See https://atproto.com/specs/oauth
type Request = Parameters<LoginWithBluesky>[0];
type Response = Parameters<LoginWithBluesky>[1];

const SCOPE = "atproto";
const REDIRECT_URI = `${config.serverUrl}/auth/bluesky/callback`;
const CLIENT_METADATA_URI = `${config.serverUrl}/auth/bluesky/client-metadata.json`;
const JWKS_URI = `${config.serverUrl}/auth/bluesky/jwks.json`;

// Authorization servers can only fetch our metadata document if it is served
// over HTTPS. When it isn't, we fall back to the spec's loopback exception: the
// authorization server builds a virtual metadata document out of the query
// parameters we put on a `http://localhost` client id.
const isPubliclyReachable = new URL(config.serverUrl).protocol === "https:";

const loopbackClientId = `http://localhost?${new URLSearchParams({
  redirect_uri: REDIRECT_URI,
  scope: SCOPE,
})}`;

const clientMetadata: OAuthClientMetadataInput = isPubliclyReachable
  ? {
      // Confidential client: we authenticate to the token endpoint with a key
      // published under `jwks_uri`, which buys us longer lived sessions.
      client_id: CLIENT_METADATA_URI,
      client_name: "bsky-login",
      client_uri: config.frontendUrl,
      redirect_uris: [REDIRECT_URI],
      scope: SCOPE,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "web",
      dpop_bound_access_tokens: true,
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      jwks_uri: JWKS_URI,
    }
  : {
      // Loopback clients are always public clients, so there is no key here.
      client_id: loopbackClientId,
      client_name: "bsky-login",
      redirect_uris: [REDIRECT_URI],
      scope: SCOPE,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "native",
      dpop_bound_access_tokens: true,
      token_endpoint_auth_method: "none",
    };

let keyset: Promise<JoseKey[]> | undefined;

function getKeyset(): Promise<JoseKey[]> | undefined {
  if (!isPubliclyReachable) {
    return undefined;
  }
  if (!keyset) {
    const privateKey = process.env.BLUESKY_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error(
        `Please provide BLUESKY_PRIVATE_KEY in .env.server. It is required because ${config.serverUrl} is served over HTTPS, which makes this a confidential OAuth client.`,
      );
    }
    keyset = Promise.all([JoseKey.fromImportable(privateKey, "bsky1")]);
  }
  return keyset;
}

/**
 * Builds an OAuth client bound to the current request.
 *
 * The client is per request because its state store writes to the response's
 * cookies, the same way Wasp stores the state of its own OAuth providers.
 */
export async function createBlueskyClient(
  req: Request,
  res: Response,
): Promise<NodeOAuthClient> {
  return new NodeOAuthClient({
    clientMetadata,
    keyset: await getKeyset(),
    stateStore: createCookieStateStore(req, res),
    sessionStore: createInMemorySessionStore(),
    requestLock: requestLocalLock,
  });
}

const COOKIE_PREFIX = "bluesky_oauth_";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: !config.isDevelopment,
  path: "/",
} as const;

/**
 * Holds the in-flight authorization request (PKCE verifier, DPoP key, issuer)
 * between the login redirect and the callback. The library keys it by the
 * `state` parameter, which comes back to us in the callback URL, so we can
 * derive the cookie name on both legs of the flow.
 */
function createCookieStateStore(
  req: Request,
  res: Response,
): NodeSavedStateStore {
  return {
    set(key, state) {
      res.cookie(COOKIE_PREFIX + key, JSON.stringify(state), {
        ...COOKIE_OPTIONS,
        maxAge: 60 * 60 * 1000, // 1 hour
      });
    },
    get(key) {
      const value = readCookie(req, COOKIE_PREFIX + key);
      return value ? (JSON.parse(value) as NodeSavedState) : undefined;
    },
    del(key) {
      res.clearCookie(COOKIE_PREFIX + key, COOKIE_OPTIONS);
    },
  };
}

/**
 * We only ask for the `atproto` scope and read the user's DID as soon as the
 * callback resolves, so the AT Protocol session never has to outlive the
 * request. The profile we keep is stored on the Wasp user instead.
 */
function createInMemorySessionStore(): NodeSavedSessionStore {
  const sessions = new Map<string, NodeSavedSession>();
  return {
    set(sub, session) {
      sessions.set(sub, session);
    },
    get(sub) {
      return sessions.get(sub);
    },
    del(sub) {
      sessions.delete(sub);
    },
  };
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const cookie of header.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator !== -1 && cookie.slice(0, separator).trim() === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
  return undefined;
}
