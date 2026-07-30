import { OAuthResolverError } from "@atproto/oauth-client-node";
import { HttpError } from "wasp/server";
import type {
  BlueskyClientMetadata,
  BlueskyJwks,
  LoginWithBluesky,
  LoginWithBlueskyCallback,
} from "wasp/server/api";
import {
  createUser,
  findAuthIdentity,
  getRedirectUriForOneTimeCode,
  handleOAuthErrorAndGetRedirectUri,
  tokenStore,
  type ProviderId,
  type ProviderName,
} from "wasp/server/auth";
import { createBlueskyClient } from "./client";
import { getBlueskyProfile, type BlueskyProfile } from "./profile";

// Wasp doesn't know about Bluesky, so we name the provider ourselves.
const PROVIDER_NAME = "bluesky" as ProviderName;

// Serves the client metadata document that authorization servers fetch to learn
// about this app. Only reachable over HTTPS deployments; in development the
// loopback `client_id` carries the same information inline.
export const blueskyClientMetadata: BlueskyClientMetadata = async (req, res) => {
  const client = await createBlueskyClient(req, res);
  res.json(client.clientMetadata);
};

// Publishes the public half of the key we authenticate to the token endpoint
// with. Referenced by `jwks_uri` in the client metadata.
export const blueskyJwks: BlueskyJwks = async (req, res) => {
  const client = await createBlueskyClient(req, res);
  res.json(client.jwks);
};

// Handler for /auth/bluesky - initiates the OAuth flow
export const loginWithBluesky: LoginWithBluesky = async (req, res) => {
  try {
    const handle = typeof req.query.handle === "string" ? req.query.handle.trim() : "";
    if (!handle) {
      throw new HttpError(400, "Enter your Bluesky handle to log in.");
    }

    const client = await createBlueskyClient(req, res);
    // Resolves the handle to a DID, the DID to the account's PDS, and the PDS
    // to its authorization server, then pushes the authorization request (PAR).
    const url = await client.authorize(handle).catch((e: unknown) => {
      // Otherwise a typo in the handle just reports "an unknown error".
      if (e instanceof OAuthResolverError) {
        throw new HttpError(400, `Couldn't find the Bluesky account "${handle}"`);
      }
      throw e;
    });
    res.redirect(url.toString());
  } catch (e) {
    console.error(e);
    res.redirect(handleOAuthErrorAndGetRedirectUri(e).toString());
  }
};

// Handler for /auth/bluesky/callback - processes the OAuth callback
export const loginWithBlueskyCallback: LoginWithBlueskyCallback = async (
  req,
  res,
) => {
  try {
    const client = await createBlueskyClient(req, res);
    const params = new URLSearchParams(req.originalUrl.split("?")[1] ?? "");
    const { session } = await client.callback(params);
    const profile = await getBlueskyProfile(session.did);

    const providerId: ProviderId = {
      providerName: PROVIDER_NAME,
      providerUserId: session.did,
    };

    const existingIdentity = await findAuthIdentity(providerId);
    const authId = existingIdentity
      ? existingIdentity.authId
      : await createUserFromBlueskyProfile(providerId, session.did, profile);

    const oneTimeCode = await tokenStore.createToken(authId);
    res.redirect(getRedirectUriForOneTimeCode(oneTimeCode).toString());
  } catch (e) {
    console.error(e);
    res.redirect(handleOAuthErrorAndGetRedirectUri(e).toString());
  }
};

async function createUserFromBlueskyProfile(
  providerId: ProviderId,
  did: string,
  profile: BlueskyProfile,
): Promise<string> {
  const user = await createUser(
    providerId,
    JSON.stringify({ did, ...profile }),
    {
      did,
      handle: profile.handle,
      displayName: profile.displayName ?? null,
      avatarUrl: profile.avatar ?? null,
    },
  );
  return user.auth!.id;
}
